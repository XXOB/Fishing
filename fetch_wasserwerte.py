#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_wasserwerte.py
--------------------
Holt die aktuellen Wasserqualitaets-Werte aller kontinuierlichen RLP-Gewaesser-
Untersuchungsstationen (Rhein, Mosel, Saar, Lahn, Nahe) aus dem RLP-Portal und
schreibt sie als wasserwerte.json. Faellt eine Station aus, laufen die uebrigen weiter.

Die CSV liegt im LANGFORMAT vor (eine Zeile je Messgroesse):
  Messstellennummer;Messstellenbezeichnung;Messleitung;Datum;Bezeichnung;Wert;Einheit
Je Messgroesse (Spalte "Bezeichnung") wird der Wert mit dem juengsten Datum genommen.

Gedacht fuer GitHub Actions (stuendlich), laeuft aber auch lokal:
    pip install playwright
    playwright install chromium
    python fetch_wasserwerte.py
"""

import json
import re
import sys
import csv
import io
import math
import html as html_lib
import zipfile
import xml.etree.ElementTree as ET
import urllib.request
from urllib.parse import urljoin, quote
from pathlib import Path
from datetime import datetime, timezone, timedelta

# Unterstuetzte Guetestationen (RLP-Portal, gleicher Download-Mechanismus).
# Neue Station ergaenzen: "id" = Zahl aus der Portal-URL /gus/<id>/messwerte,
# plus Koordinaten (lat/lon) und Fluss. Die App zeigt je Angelplatz die naechste
# Station am selben Fluss.
# Alle 7 kontinuierlichen Gewaesser-Untersuchungsstationen von RLP
# (Quelle: wasserportal.rlp-umwelt.de – "Chemisch-physikalische Gewaesseruntersuchung").
# Neue Station ergaenzen: "id" = Zahl aus der Portal-URL /gus/<id>, plus lat/lon und Fluss.
QUALITY_STATIONS = [
    {"id": "2511510500", "name": "Mainz-Wiesbaden",    "lat": 50.0068, "lon": 8.2795, "river": "Rhein"},
    {"id": "2391566500", "name": "Worms",              "lat": 49.6353, "lon": 8.3838, "river": "Rhein"},
    {"id": "2691510700", "name": "Fankel",             "lat": 50.1647, "lon": 7.2017, "river": "Mosel"},
    {"id": "2619521210", "name": "Palzem",             "lat": 49.5033, "lon": 6.4517, "river": "Mosel"},
    {"id": "2649525000", "name": "Kanzem Land",        "lat": 49.6533, "lon": 6.5828, "river": "Saar"},
    {"id": "2589535410", "name": "Lahnstein",          "lat": 50.3050, "lon": 7.5983, "river": "Lahn"},
    {"id": "2549523210", "name": "Bingen-Dietersheim", "lat": 49.9686, "lon": 7.8956, "river": "Nahe"},
]
GUS_URL = "https://geodaten-wasser.rlp-umwelt.de/gus/{id}/download"

# --- Hessen (HLNUG) --------------------------------------------------------
# Kontinuierliche Guetestationen von Hessen. Der Headless-Browser oeffnet die
# Portalseite und faengt den Datenabruf (JSON) der Seite selbst ab -> laeuft
# serverseitig in jeder Umgebung, ohne Browser-Erweiterung. Weitere Stationen:
# messstelle-URL aus dem HLNUG-Datenportal + Koordinaten + Fluss ergaenzen.
HESSEN_STATIONS = [
    {"url": "https://www.hlnug.de/messwerte/datenportal/messstelle/4/6/2101",
     "name": "Bischofsheim (Main)", "lat": 50.0040, "lon": 8.3430, "river": "Main"},
]

# --- Bayern (GKD) ----------------------------------------------------------
# GKD hat je eine serverseitig gerenderte Gesamttabelle (Fluesse + Seen) mit ALLEN
# Wassertemperatur-Stationen inkl. aktuellem Wert. Der Scraper liest daraus ALLE
# Stationen (eine Anfrage je Uebersicht) und loest die Koordinaten je Station
# einmalig aus der Stammdatenseite (ETRS89/UTM32 -> WGS84) auf und cacht sie.
GKD_OVERVIEWS = [
    {"url": "https://www.gkd.bayern.de/de/fluesse/wassertemperatur/tabellen", "typ": "fluss"},
    {"url": "https://www.gkd.bayern.de/de/seen/wassertemperatur/tabellen",    "typ": "see"},
]
GKD_SCHWEBSTOFF_URL = "https://www.gkd.bayern.de/de/fluesse/schwebstoff/tabellen"
GKD_MAX_NEW_COORDS = 200   # neue Koordinaten je Lauf aufloesen (danach gecacht)
GKD_MAX_AGE_DAYS   = 4     # nur Stationen mit halbwegs aktuellem Wert

BASE_DIR  = Path(__file__).resolve().parent
JSON_FILE = BASE_DIR / "wasserwerte.json"
GKD_COORDS_FILE = BASE_DIR / "gkd_coords.json"   # Cache: Stations-ID -> lat/lon
NLWKN_COORDS_FILE = BASE_DIR / "nlwkn_coords.json"
BERLIN_COORDS_FILE = BASE_DIR / "berlin_coords.json"
CSV_DIR   = BASE_DIR / "wasserwerte_csv"
CSV_DIR.mkdir(exist_ok=True)

# Messgroesse (aus Spalte "Bezeichnung") -> (Anzeige-Label, Icon, Nachkommastellen)
# Die App zeichnet die passenden einheitlichen SVG-Symbole selbst; deshalb werden
# hier keine Emoji-Zeichen mehr in den Datensatz geschrieben.
# Reihenfolge = Prioritaet: "sättigung" vor "sauerstoff" pruefen.
BEZ_MAP = [
    ("temperatur", ("Wassertemperatur", "", 1)),
    ("sättigung",  ("O₂-Sättigung",     "", 0)),
    ("saettigung", ("O₂-Sättigung",     "", 0)),
    ("sauerstoff", ("Sauerstoff",       "", 1)),
    ("trüb",       ("Trübung",          "", 1)),
    ("trueb",      ("Trübung",          "", 1)),
    ("leitf",      ("Leitfähigkeit",    "", 0)),
    ("ph",         ("pH-Wert",          "", 2)),
]
ORDER = ["Wassertemperatur", "Sauerstoff", "O₂-Sättigung",
         "Trübung", "pH-Wert", "Leitfähigkeit"]

DATE_FORMATS = ("%d.%m.%Y %H:%M", "%d.%m.%Y %H:%M:%S", "%d.%m.%Y",
                "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M")


# ---------------------------------------------------------------- Download ----
def download_csv(station_id) -> Path:
    from playwright.sync_api import sync_playwright

    url = GUS_URL.format(id=station_id)
    out = CSV_DIR / f"rust_{station_id}_{datetime.now():%Y%m%d_%H%M%S}.csv"
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(accept_downloads=True)
        page = ctx.new_page()
        print(f"      oeffne {url}")
        page.goto(url, wait_until="networkidle", timeout=90_000)

        for label in ["Akzeptieren", "Alle akzeptieren", "Zustimmen",
                      "Einverstanden", "OK", "Accept"]:
            try:
                b = page.get_by_role("button", name=re.compile(label, re.I))
                if b.count() > 0 and b.first.is_visible():
                    b.first.click(timeout=2000)
                    break
            except Exception:
                pass

        print("[2/4] Klicke 'als CSV' ...")
        page.wait_for_selector("text=/als CSV/i", timeout=60_000)
        with page.expect_download(timeout=90_000) as dl_info:
            clicked = False
            for getter in (
                lambda: page.get_by_role("button", name=re.compile("CSV", re.I)),
                lambda: page.get_by_text(re.compile(r"als\s*CSV", re.I)),
                lambda: page.locator("button:has-text('CSV')"),
            ):
                try:
                    loc = getter()
                    if loc.count() > 0:
                        loc.first.click(timeout=8000)
                        clicked = True
                        break
                except Exception:
                    continue
            if not clicked:
                raise RuntimeError("CSV-Schaltflaeche nicht gefunden.")
        dl_info.value.save_as(out)
        browser.close()
    print(f"      gespeichert: {out.name}")
    return out


# ------------------------------------------------------------------ Parse -----
def read_table(path: Path):
    raw = None
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            raw = path.read_text(encoding=enc); break
        except Exception:
            continue
    if raw is None:
        raise RuntimeError("CSV konnte nicht gelesen werden.")
    sample = "\n".join(raw.splitlines()[:20])
    delim, best = ";", 0
    for d in (";", "\t", ","):
        c = sample.count(d)
        if c > best:
            best, delim = c, d
    rows = list(csv.reader(io.StringIO(raw), delimiter=delim))
    return [r for r in rows if any(c.strip() for c in r)]


def to_number(text: str):
    t = (text or "").strip().replace("\xa0", "").replace(" ", "")
    if not t or not re.search(r"\d", t):
        return None
    if "," in t:
        t = t.replace(".", "").replace(",", ".")
    try:
        return float(t)
    except ValueError:
        return None


def parse_dt(text: str):
    t = (text or "").strip()
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(t, fmt)
        except ValueError:
            continue
    return None


def find_col(header, exact, contains, exclude=()):
    low = [c.strip().lower() for c in header]
    for i, c in enumerate(low):            # zuerst exakte Treffer (z.B. "bezeichnung")
        if c in exact:
            return i
    for i, c in enumerate(low):            # dann Teilstring, aber Ausschluesse beachten
        if any(k in c for k in contains) and not any(x in c for x in exclude):
            return i
    return None


def find_header(rows):
    for i, r in enumerate(rows):
        low = " ".join(r).lower()
        if "bezeichnung" in low and "wert" in low:
            return i
    return 0


def parse_latest(rows):
    """Langformat: je Bezeichnung den Wert mit dem juengsten Datum."""
    h = find_header(rows)
    header = [c.strip() for c in rows[h]]
    data = rows[h + 1:]

    i_datum = find_col(header, {"datum", "zeit", "zeitpunkt"}, ("datum", "zeit"))
    i_bez   = find_col(header, {"bezeichnung", "parameter", "kenngroesse"},
                       ("bezeichnung", "parameter", "kenngr"), exclude=("messstell",))
    i_wert  = find_col(header, {"wert", "messwert"}, ("wert", "messwert"),
                       exclude=("nummer", "einheit"))
    i_einh  = find_col(header, {"einheit"}, ("einheit",))
    if i_bez is None or i_wert is None:
        return {}

    best = {}  # bezeichnung -> (dt, wert_text, einheit, datum_text)
    for r in data:
        if i_bez >= len(r) or i_wert >= len(r):
            continue
        bez = r[i_bez].strip()
        if not bez or to_number(r[i_wert]) is None:
            continue
        unit  = r[i_einh].strip() if (i_einh is not None and i_einh < len(r)) else ""
        dtxt  = r[i_datum].strip() if (i_datum is not None and i_datum < len(r)) else ""
        dt    = parse_dt(dtxt)
        cur = best.get(bez)
        take = (cur is None
                or (dt is not None and (cur[0] is None or dt >= cur[0])))
        if take:
            best[bez] = (dt, r[i_wert].strip(), unit, dtxt)
    return best


def map_bez(bez):
    low = bez.lower()
    for key, val in BEZ_MAP:
        if key in low:
            return val
    return None


def fmt_time(t: str) -> str:
    dt = parse_dt(t)
    return dt.strftime("%d.%m.%Y %H:%M") if dt else t.strip()


def fmt_value(num, decimals):
    s = f"{num:.{decimals}f}"
    return s.replace(".", ",")


def build_items(best: dict):
    items, seen = [], set()
    for bez, (_dt, vtext, unit, dtxt) in best.items():
        m = map_bez(bez)
        if not m:
            continue
        label, icon, dec = m
        if label in seen:
            continue
        seen.add(label)
        num = to_number(vtext)
        value = fmt_value(num, dec) if num is not None else vtext
        items.append({"label": label, "value": value, "unit": unit,
                      "icon": icon, "time": fmt_time(dtxt)})
    items.sort(key=lambda it: ORDER.index(it["label"]) if it["label"] in ORDER else 99)
    return items


# --------------------------------------------------------------- Historie -----
HIST_LABELS = {"Wassertemperatur", "Sauerstoff", "O₂-Sättigung", "Trübung"}
HIST_DAYS = 8
def build_history(rows):
    """Stündlicher Verlauf der letzten HIST_DAYS Tage je Messgroesse (für die Grafen)."""
    h = find_header(rows)
    header = [c.strip() for c in rows[h]]
    data = rows[h + 1:]
    i_datum = find_col(header, {"datum", "zeit", "zeitpunkt"}, ("datum", "zeit"))
    i_bez   = find_col(header, {"bezeichnung", "parameter", "kenngroesse"},
                       ("bezeichnung", "parameter", "kenngr"), exclude=("messstell",))
    i_wert  = find_col(header, {"wert", "messwert"}, ("wert", "messwert"), exclude=("nummer", "einheit"))
    if i_bez is None or i_wert is None or i_datum is None:
        return {}
    cutoff = datetime.now() - timedelta(days=HIST_DAYS)
    buckets = {}  # label -> {stunde: (dt, wert)}
    for r in data:
        if i_bez >= len(r) or i_wert >= len(r) or i_datum >= len(r):
            continue
        m = map_bez(r[i_bez].strip())
        if not m or m[0] not in HIST_LABELS:
            continue
        num = to_number(r[i_wert])
        if num is None:
            continue
        dt = parse_dt(r[i_datum].strip())
        if dt is None or dt < cutoff:
            continue
        hk = dt.replace(minute=0, second=0, microsecond=0)
        buckets.setdefault(m[0], {})[hk] = (hk, num)   # letzter Wert je Stunde
    out = {}
    for label, by in buckets.items():
        series = sorted(by.values(), key=lambda x: x[0])
        out[label] = [{"t": dt.strftime("%Y-%m-%dT%H:%M"), "v": round(v, 3)} for dt, v in series]
    return out


# --------------------------------------------------------- Hessen (HLNUG) -----
def _safe_json(txt):
    try: return json.loads(txt)
    except Exception: return None

def capture_hessen(url):
    """Oeffnet die HLNUG-Portalseite und faengt alle JSON-Antworten der Seite ab."""
    from playwright.sync_api import sync_playwright
    payloads = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(accept_downloads=True)
        page = ctx.new_page()
        def on_resp(resp):
            try:
                ct = (resp.headers or {}).get("content-type", "").lower()
                u  = resp.url
                if ("json" in ct) or u.lower().endswith(".json") or \
                   any(k in u.lower() for k in ("messwert","daten","json","chart","tabelle","werte","api")):
                    body = resp.text()
                    if body and body[:1] in "[{":
                        payloads.append((u, ct, body))
            except Exception:
                pass
        page.on("response", on_resp)
        print(f"      oeffne {url}")
        page.goto(url, wait_until="networkidle", timeout=90_000)
        for label in ["Akzeptieren","Alle akzeptieren","Zustimmen","Einverstanden","OK","Accept","Speichern"]:
            try:
                b = page.get_by_role("button", name=re.compile(label, re.I))
                if b.count() and b.first.is_visible(): b.first.click(timeout=1500); break
            except Exception: pass
        for sel in ["text=/Tabellarische Darstellung/i","text=/Tabelle/i","text=/Grafische/i"]:
            try:
                loc = page.locator(sel)
                if loc.count(): loc.first.click(timeout=3000); page.wait_for_timeout(2500)
            except Exception: pass
        page.wait_for_timeout(3000)
        browser.close()
    print(f"      {len(payloads)} JSON-Antwort(en) erfasst:")
    for (u, ct, body) in payloads[:15]:
        snip = re.sub(r"\s+", " ", body[:160])
        print(f"        - {u}  [{ct}]  {len(body)}B :: {snip}")
    return payloads

def _find_dt(d):
    for k in d:
        if any(x in k.lower() for x in ("datum","zeit","time","date","stamp")): return d[k]
    return None
def _find_val(d):
    for k in d:
        if any(x in k.lower() for x in ("wert","value","messwert","mw","y")): return d[k]
    return None

def hessen_extract(objs):
    """Sucht in beliebig geschachteltem JSON nach (Parametername + Messreihe)."""
    series = {}   # label -> {"unit":u, "icon":ic, "dec":d, "pts":[(dt,val)]}
    def add(name, unit, data):
        m = map_bez(str(name))
        if not m: return
        label, icon, dec = m
        pts = []
        for pt in data:
            dt = val = None
            if isinstance(pt, dict):
                dt = parse_dt(str(_find_dt(pt) or "")); val = to_number(str(_find_val(pt)))
            elif isinstance(pt, (list, tuple)) and len(pt) >= 2:
                dt = parse_dt(str(pt[0])); val = to_number(str(pt[1]))
            if val is not None: pts.append((dt, val))
        if not pts: return
        s = series.setdefault(label, {"unit":unit or "", "icon":icon, "dec":dec, "pts":[]})
        s["pts"].extend(pts)
        if unit and not s["unit"]: s["unit"] = unit
    def visit(node, ctx=None):
        if isinstance(node, dict):
            name = (node.get("parameter") or node.get("name") or node.get("kenngroesse")
                    or node.get("bezeichnung") or node.get("title") or ctx)
            unit = node.get("einheit") or node.get("unit") or node.get("uom") or ""
            for dk in ("data","values","werte","messwerte","series","points","daten"):
                if isinstance(node.get(dk), list) and node[dk] and isinstance(node[dk][0], (dict, list, tuple)):
                    add(name, unit, node[dk])
            for k, v in node.items():
                if isinstance(v, (dict, list)): visit(v, k)
        elif isinstance(node, list):
            for it in node: visit(it, ctx)
    for o in objs:
        if o is not None:
            try: visit(o)
            except Exception: pass
    return series

def hessen_build(series):
    items = []
    for label in ORDER:
        s = series.get(label)
        if not s or not s["pts"]: continue
        pts = sorted([p for p in s["pts"] if p[0] is not None], key=lambda x: x[0]) or s["pts"]
        dt, val = pts[-1]
        items.append({"label":label, "value":fmt_value(val, s["dec"]), "unit":s["unit"],
                      "icon":s["icon"], "time":(dt.strftime("%d.%m.%Y %H:%M") if dt else "")})
    cutoff = datetime.now() - timedelta(days=HIST_DAYS)
    history = {}
    for label in HIST_LABELS:
        s = series.get(label)
        if not s: continue
        buckets = {}
        for dt, val in s["pts"]:
            if dt is None or dt < cutoff: continue
            hk = dt.replace(minute=0, second=0, microsecond=0)
            buckets[hk] = val
        if buckets:
            history[label] = [{"t":k.strftime("%Y-%m-%dT%H:%M"), "v":round(v,3)}
                              for k, v in sorted(buckets.items())]
    return items, history

def process_hessen(st):
    print(f"[Hessen] {st['name']} ...")
    payloads = capture_hessen(st["url"])
    series = hessen_extract([_safe_json(b) for (_u,_c,b) in payloads])
    items, history = hessen_build(series)
    if not items:
        raise RuntimeError("keine Messgroessen erkannt – siehe erfasste Endpunkte oben")
    for it in items:
        print(f"      {it['label']}: {it['value']} {it['unit']}  (Stand {it['time']})")
    return {
        "id": st["url"], "name": st["name"], "lat": st["lat"], "lon": st["lon"], "river": st["river"],
        "updated": datetime.now(timezone.utc).astimezone().strftime("%d.%m.%Y %H:%M"),
        "items": items, "history": history,
    }


# ------------------------------------------------------------ Bayern (GKD) ----
def fetch_gkd_html(url):
    req = urllib.request.Request(url, headers={"User-Agent":"Mozilla/5.0 (PetriKlar Wasserwerte)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", "replace")

def fetch_bytes(url):
    req = urllib.request.Request(url, headers={"User-Agent":"Mozilla/5.0 (PetriKlar Wasserwerte)"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.read()

def decode_text(raw):
    for enc in ("utf-8-sig", "utf-8", "cp1252", "latin1"):
        try: return raw.decode(enc)
        except UnicodeDecodeError: pass
    return raw.decode("utf-8", "replace")

def clean_html(fragment):
    text = re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>", " ", fragment or "", flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", html_lib.unescape(text).replace("\xa0", " ")).strip()

def now_text():
    return datetime.now(timezone.utc).astimezone().strftime("%d.%m.%Y %H:%M")

def utm32_to_wgs84(E, N):
    """ETRS89 / UTM Zone 32N -> WGS84 (lat, lon), GRS80."""
    a=6378137.0; f=1/298.257222101; k0=0.9996
    e2=f*(2-f); E0=500000.0; lon0=math.radians(9.0)
    x=E-E0; M=N/k0
    mu=M/(a*(1-e2/4-3*e2**2/64-5*e2**3/256))
    e1=(1-math.sqrt(1-e2))/(1+math.sqrt(1-e2))
    phi1=(mu+(3*e1/2-27*e1**3/32)*math.sin(2*mu)+(21*e1**2/16-55*e1**4/32)*math.sin(4*mu)
            +(151*e1**3/96)*math.sin(6*mu)+(1097*e1**4/512)*math.sin(8*mu))
    ep2=e2/(1-e2); C1=ep2*math.cos(phi1)**2; T1=math.tan(phi1)**2
    N1=a/math.sqrt(1-e2*math.sin(phi1)**2); R1=a*(1-e2)/(1-e2*math.sin(phi1)**2)**1.5
    D=x/(N1*k0)
    lat=phi1-(N1*math.tan(phi1)/R1)*(D**2/2-(5+3*T1+10*C1-4*C1**2-9*ep2)*D**4/24
        +(61+90*T1+298*C1+45*T1**2-252*ep2-3*C1**2)*D**6/720)
    lon=lon0+(D-(1+2*T1+C1)*D**3/6+(5-2*C1+28*T1-3*C1**2+8*ep2+24*T1**2)*D**5/120)/math.cos(phi1)
    return math.degrees(lat), math.degrees(lon)

def gkd_id(url):
    m=re.search(r"-(\d+)(?:[/?]|$)", url); return m.group(1) if m else url

def parse_gkd_overview(html):
    """Zerlegt die GKD-Gesamttabelle je Zeile: Name, Stations-URL, Gewaesser, Datum, Wert."""
    out=[]
    for row in re.split(r"<tr", html):
        m=re.search(r'href="([^"]*?/wassertemperatur/[^"]*?)/messwerte', row)
        if not m: continue
        href=m.group(1); base = href if href.startswith("http") else "https://www.gkd.bayern.de"+href
        cells=[re.sub(r"<[^>]+>"," ",c).replace("&nbsp;"," ").strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        if len(cells)<2: continue
        joined=" ".join(cells).replace("\xa0"," ")
        # GKD nutzt beschriftete Zellen: "Messstelle: X", "Gewässer: Y", "Datum: … Uhr", "Wassertemperatur [°C]: 23,7"
        def _label(prefix):   # Zelle finden, die mit prefix beginnt, Label entfernen
            for c in cells:
                if re.match(prefix, c): return re.sub(prefix, "", c).strip()
            return ""
        name  = _label(r"^\s*Messstelle\s*:\s*") or cells[0]
        river = _label(r"^\s*Gew[aä]sser\s*:\s*") or cells[1]
        river = re.split(r"\s+(?:Lkr|Datum|Wassertemp)", river)[0].strip()
        dm=re.search(r"(\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2})", joined)
        vm=re.search(r"Wassertemperatur[^:]*:\s*([-]?\d+(?:,\d+)?)", joined) \
           or re.search(r"Uhr[\s|]*([-]?\d+(?:,\d+)?)", joined)      # Fallback altes Format
        dt=parse_dt(dm.group(1)) if dm else None
        val=to_number(vm.group(1)) if vm else None
        out.append({"base":base, "id":gkd_id(base), "name":name, "river":river, "dt":dt, "val":val})
    return out

def load_gkd_coords():
    try: return json.loads(GKD_COORDS_FILE.read_text(encoding="utf-8"))
    except Exception: return {}
def save_gkd_coords(d):
    try: GKD_COORDS_FILE.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
    except Exception: pass

def resolve_gkd_coords(base, cache):
    sid=gkd_id(base)
    if sid in cache: return cache[sid]
    html=fetch_gkd_html(base)   # Stammdatenseite
    e=re.search(r"Ostwert[\s\S]{0,120}?([0-9]{6,7})", html)
    n=re.search(r"Nordwert[\s\S]{0,120}?([0-9]{6,7})", html)
    if not e or not n: return None
    lat,lon=utm32_to_wgs84(float(e.group(1)), float(n.group(1)))
    cache[sid]={"lat":round(lat,5), "lon":round(lon,5)}
    return cache[sid]

def process_gkd_all():
    cache=load_gkd_coords(); results=[]; new=0; now=datetime.now()
    for ov in GKD_OVERVIEWS:
        try: html=fetch_gkd_html(ov["url"])
        except Exception as ex: print(f"      GKD-Uebersicht Fehler ({ov['typ']}): {ex}"); continue
        rows=parse_gkd_overview(html)
        print(f"[Bayern/GKD] {ov['typ']}: {len(rows)} Stationen in Uebersicht")
        for r in rows:
            coords=cache.get(r["id"])
            if not coords and new < GKD_MAX_NEW_COORDS:
                try: coords=resolve_gkd_coords(r["base"], cache); new+=1
                except Exception: coords=None
            if not coords: continue
            fresh=(r["val"] is not None and r["dt"] is not None and
                   (now-r["dt"]).total_seconds() <= GKD_MAX_AGE_DAYS*86400)
            items=[]
            if fresh:
                items.append({"label":"Wassertemperatur", "value":fmt_value(r["val"],1), "unit":"°C",
                              "icon":"", "time":r["dt"].strftime("%d.%m.%Y %H:%M")})
            results.append({
                "id": r["base"], "name": r["name"], "lat": coords["lat"], "lon": coords["lon"], "river": r["river"],
                "updated": now_text(), "src":"gkd", "source_url":r["base"]+"/messwerte",
                "params":{"wt":True,"o2":False,"tr":False}, "items":items, "history": {},
            })
    save_gkd_coords(cache)
    print(f"[Bayern/GKD] {len(results)} Stationen mit Werten (+{new} neue Koordinaten aufgeloest, {len(cache)} gecacht)")
    return results


# ---------------------------------------------- Bayern (GKD Schwebstoff) ----
def parse_gkd_schwebstoff(page):
    """Alle GKD-Schwebstoffstationen aus der landesweiten Tabelle."""
    out=[]
    for row in re.split(r"<tr", page, flags=re.I):
        m=re.search(r'href="([^"]*?/schwebstoff/[^"]*?)/messwerte', row, re.I)
        if not m: continue
        href=m.group(1); base=href if href.startswith("http") else "https://www.gkd.bayern.de"+href
        cells=[clean_html(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S|re.I)]
        joined=" ".join(cells)
        def labelled(pattern):
            for c in cells:
                if re.match(pattern,c,re.I): return re.sub(pattern,"",c,flags=re.I).strip()
            return ""
        name=labelled(r"^\s*Messstelle\s*:\s*") or (cells[0] if cells else gkd_id(base))
        river=labelled(r"^\s*Gew[aä]sser\s*:\s*") or (cells[1] if len(cells)>1 else "")
        river=re.split(r"\s+(?:Lkr|Datum|Konzentration)",river)[0].strip()
        dm=re.search(r"(\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2})",joined)
        vm=(re.search(r"Konzentration[^:]*:\s*([-]?\d[\d.]*?(?:,\d+)?)",joined,re.I)
            or re.search(r"Uhr\s*([-]?\d[\d.]*?(?:,\d+)?)",joined,re.I))
        out.append({"base":base,"id":gkd_id(base),"name":name,"river":river,
                    "dt":parse_dt(dm.group(1)) if dm else None,
                    "val":to_number(vm.group(1)) if vm else None})
    return out

def enrich_gkd_with_schwebstoff(stations):
    """Braunes Segment = Schwebstoff. Gleiche GKD-Stationsnummern werden vereinigt."""
    page=fetch_gkd_html(GKD_SCHWEBSTOFF_URL)
    rows=parse_gkd_schwebstoff(page); cache=load_gkd_coords(); now=datetime.now(); new=0
    by_sid={gkd_id(str(s.get("id",""))):s for s in stations}; added=0; standalone=0
    for r in rows:
        st=by_sid.get(r["id"])
        if st is None:
            coords=cache.get(r["id"])
            if not coords and new<GKD_MAX_NEW_COORDS:
                try: coords=resolve_gkd_coords(r["base"],cache); new+=1
                except Exception: coords=None
            if not coords: continue
            st={"id":r["base"],"name":r["name"],"lat":coords["lat"],"lon":coords["lon"],
                "river":r["river"],"updated":now_text(),"src":"gkd",
                "source_url":r["base"]+"/messwerte","params":{"wt":False,"o2":False,"tr":True},
                "items":[],"history":{}}
            stations.append(st); by_sid[r["id"]]=st; standalone+=1
        st.setdefault("params",{})["tr"]=True
        fresh=(r["val"] is not None and r["dt"] is not None and
               (now-r["dt"]).total_seconds()<=GKD_MAX_AGE_DAYS*86400)
        if fresh and not any("schwebstoff" in i.get("label","").lower() for i in st.get("items",[])):
            st.setdefault("items",[]).append({"label":"Schwebstoff","value":fmt_value(r["val"],1),
                "unit":"g/m³","icon":"","time":r["dt"].strftime("%d.%m.%Y %H:%M")})
            added+=1
    save_gkd_coords(cache)
    print(f"[Bayern/GKD] {len(rows)} Schwebstoffstationen ({added} aktuelle Werte, {standalone} zusaetzliche Punkte)")
    return stations


# ------------------------------------------------ Bayern (NID Sauerstoff) ----
# Die automatischen Gütestationen an Donau, Main und Regnitz veröffentlichen
# im NID ein aktuelles Sauerstoff-Tagesminimum. Über die gemeinsame
# Stationsnummer wird es mit der jeweiligen GKD-Temperaturstation vereinigt.
NID_O2_URL = "https://www.nid.bayern.de/sauerstoff/bayern/tabellen"
NID_MAX_AGE_DAYS = 3

def enrich_gkd_with_nid_oxygen(stations):
    html = fetch_gkd_html(NID_O2_URL)
    by_sid = {gkd_id(str(s.get("id", ""))): s for s in stations}
    now = datetime.now()
    added = 0
    for row in re.split(r"<tr", html):
        mh = re.search(r'href="([^"]*/sauerstoff/[^"]*?-(\d+)(?:/[^"]*)?)"', row)
        if not mh:
            continue
        sid = mh.group(2)
        cells = [re.sub(r"<[^>]+>", " ", c).replace("&nbsp;", " ").strip()
                 for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        joined = " ".join(cells).replace("\xa0", " ")
        dm = re.search(r"(\d{2}\.\d{2}\.\d{4})", joined)
        vm = re.search(r"Sauerstoffminimum\s*\[?mg/l\]?\s*:\s*([-]?\d+(?:,\d+)?)",
                       joined, re.I)
        if vm:
            val = to_number(vm.group(1))
        else:
            tail = joined[dm.end():] if dm else ""
            nums = re.findall(r"(?<!\d)(\d{1,2},\d{1,2})(?!\d)", tail)
            val = to_number(nums[0]) if nums else None
        dt = parse_dt(dm.group(1)) if dm else None
        st = by_sid.get(sid)
        if st is None:
            continue
        st.setdefault("params", {})["o2"] = True
        if val is None or dt is None or (now - dt).days > NID_MAX_AGE_DAYS:
            continue
        if any("sauerstoff" in i.get("label", "").lower() for i in st.get("items", [])):
            continue
        st.setdefault("items", []).append({
            "label": "Sauerstoff (Tagesminimum)", "value": fmt_value(val, 2),
            "unit": "mg/l", "icon": "", "time": dt.strftime("%d.%m.%Y")
        })
        added += 1
    print(f"[Bayern/NID] {added} automatische Gütestationen mit Sauerstoff ergänzt")
    return stations


# ------------------------------------------- Niedersachsen (NLWKN live) ----
NLWKN_URL = "https://www.gewaessergueteonline.nlwkn.niedersachsen.de/Messwerte"
NLWKN_STATION = "https://www.gewaessergueteonline.nlwkn.niedersachsen.de/Station/ID/{id}"
NLWKN_MAX_AGE_H = 36

def load_json_cache(path):
    try: return json.loads(path.read_text(encoding="utf-8"))
    except Exception: return {}

def save_json_cache(path, data):
    try: path.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding="utf-8")
    except Exception: pass

def nlwkn_station_info(sid, cache):
    if sid in cache: return cache[sid]
    url=NLWKN_STATION.format(id=sid); page=fetch_gkd_html(url); text=clean_html(page)
    mr=re.search(r"Rechtswert\s+(\d{7,8})",text,re.I)
    mn=re.search(r"Hochwert\s+(\d{6,8})",text,re.I)
    if not mr or not mn: return None
    rv=float(mr.group(1)); nv=float(mn.group(1))
    # NLWKN schreibt die UTM-Zone vor den Ostwert: 32514994 -> Zone 32, E=514994.
    if 32_000_000 <= rv < 33_000_000: rv-=32_000_000
    lat,lon=utm32_to_wgs84(rv,nv)
    low=text.lower()
    info={"lat":round(lat,5),"lon":round(lon,5),
          "params":{"wt":"wassertemperatur" in low,
                    "o2":"sauerstoff" in low,
                    "tr":"trübung" in low or "truebung" in low}}
    cache[sid]=info
    return info

def process_nlwkn():
    page=fetch_gkd_html(NLWKN_URL); cache=load_json_cache(NLWKN_COORDS_FILE)
    now=datetime.now(); results=[]; seen=0
    for row in re.findall(r"<tr[^>]*>([\s\S]*?)</tr>",page,re.I):
        mh=re.search(r'href="[^"]*/Station/ID/(\d+)"',row,re.I)
        if not mh: continue
        sid=mh.group(1); cells=[clean_html(c) for c in re.findall(r"<td[^>]*>(.*?)</td>",row,re.S|re.I)]
        if len(cells)<9: continue
        seen+=1; name=cells[0]; river=cells[1]
        dm=re.search(r"\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}",cells[2])
        dt=parse_dt(dm.group(0)) if dm else None
        try: info=nlwkn_station_info(sid,cache)
        except Exception as ex: print(f"      NLWKN {name}: Koordinatenfehler {ex}"); continue
        if not info: continue
        defs=[(6,"Wassertemperatur","°C",1),(4,"Sauerstoff","mg/l",1),(8,"Trübung","FNU",1),
              (5,"pH-Wert","",1),(3,"Leitfähigkeit","µS/cm",0)]
        fresh=bool(dt and (now-dt).total_seconds()<=NLWKN_MAX_AGE_H*3600)
        items=[]
        if fresh:
            for idx,label,unit,digits in defs:
                val=to_number(cells[idx]) if idx<len(cells) else None
                if val is not None:
                    items.append({"label":label,"value":fmt_value(val,digits),"unit":unit,"icon":"",
                                  "time":dt.strftime("%d.%m.%Y %H:%M")})
        p=dict(info.get("params") or {})
        p["wt"]=p.get("wt") or any(i[1]=="Wassertemperatur" and to_number(cells[i[0]]) is not None for i in defs)
        p["o2"]=p.get("o2") or any(i[1]=="Sauerstoff" and to_number(cells[i[0]]) is not None for i in defs)
        p["tr"]=p.get("tr") or any(i[1]=="Trübung" and to_number(cells[i[0]]) is not None for i in defs)
        results.append({"id":"nlwkn-"+sid,"name":name,"lat":info["lat"],"lon":info["lon"],
            "river":river,"updated":now_text(),"src":"nlwkn","source_url":NLWKN_STATION.format(id=sid),
            "params":p,"items":items,"history":{}})
    save_json_cache(NLWKN_COORDS_FILE,cache)
    print(f"[Niedersachsen/NLWKN] {len(results)} von {seen} automatischen Gütestationen")
    return results


# ----------------------------------------- Brandenburg (LfU, 10 Stationen) ----
BRANDENBURG_OVERVIEW = ("https://lfu.brandenburg.de/lfu/de/aufgaben/wasser/"
    "fliessgewaesser-und-seen/gewaesserueberwachung/wasserguetemessnetz/")
BRANDENBURG_SLUGS = ["beeskow","cumlosen","frankfurt-oder","hohenwutzen","kleinmachnow",
                     "leibsch","neuhausen","potsdam","ratzdorf","spremberg"]
BB_MAX_AGE_H = 48

def normalized_header(value):
    return (str(value or "").lower().replace("ä","ae").replace("ö","oe")
            .replace("ü","ue").replace("ß","ss").replace("₂","2"))

def matrix_datetime(row):
    for i,cell in enumerate(row):
        try:
            serial=float(cell)
            if 30000 < serial < 80000:
                if i+1<len(row):
                    try:
                        frac=float(row[i+1])
                        if 0<=frac<1: serial+=frac
                    except Exception: pass
                return datetime(1899,12,30)+timedelta(days=serial)
        except Exception: pass
        d=parse_dt(str(cell).strip())
        if d: return d
        if i+1<len(row):
            d=parse_dt((str(cell)+" "+str(row[i+1])).strip())
            if d: return d
    return None

def parse_wide_sensor_csv(raw):
    """Liest unterschiedlich aufgebaute Amts-CSV mit Zeit + Sensorspalten."""
    text=decode_text(raw).replace("\x00","")
    sample=text[:12000]
    try: delimiter=csv.Sniffer().sniff(sample,delimiters=";\t,").delimiter
    except Exception: delimiter=";"
    rows=[[c.strip() for c in r] for r in csv.reader(io.StringIO(text),delimiter=delimiter)]
    header_i=None; columns={}
    for ri,row in enumerate(rows[:80]):
        for ci,h in enumerate(row):
            n=normalized_header(h)
            kind=None
            if "wassertemp" in n or ("temperatur" in n and "luft" not in n): kind="wt"
            elif "sauerstoff" in n and not any(x in n for x in ("saettig","prozent","%")): kind="o2"
            elif "trueb" in n or "turbid" in n: kind="tr"
            elif n.strip() in ("ph","ph-wert") or "ph-wert" in n: kind="ph"
            elif "leitfaeh" in n: kind="lf"
            if kind and kind not in columns: columns[kind]=ci; header_i=ri if header_i is None else min(header_i,ri)
    if header_i is None or not columns: return {},{}
    data={k:[] for k in columns}
    for row in rows[header_i+1:]:
        dt=matrix_datetime(row)
        if not dt: continue
        for kind,ci in columns.items():
            if ci>=len(row): continue
            val=to_number(row[ci])
            if val is None: continue
            if kind=="wt" and not (-5<=val<=45): continue
            if kind=="o2" and not (0<=val<=30): continue
            if kind=="ph" and not (0<=val<=14): continue
            if kind=="tr" and not (0<=val<1_000_000): continue
            data[kind].append((dt,val))
    latest={}; history={}
    labels={"wt":"Wassertemperatur","o2":"Sauerstoff","tr":"Trübung","ph":"pH-Wert","lf":"Leitfähigkeit"}
    for kind,vals in data.items():
        vals.sort(key=lambda x:x[0])
        if vals:
            latest[kind]=vals[-1]
            cutoff=vals[-1][0]-timedelta(days=8)
            history[labels[kind]]=[{"t":d.strftime("%Y-%m-%dT%H:%M"),"v":round(v,3)} for d,v in vals if d>=cutoff]
    return latest,history

def process_brandenburg():
    overview=fetch_gkd_html(BRANDENBURG_OVERVIEW)
    urls=[urljoin(BRANDENBURG_OVERVIEW,s+"/") for s in BRANDENBURG_SLUGS]
    for href in re.findall(r'href="([^"]*?/wasserguetemessnetz/[^"#?]+/)"',overview,re.I):
        u=urljoin(BRANDENBURG_OVERVIEW,html_lib.unescape(href))
        if u.rstrip("/")==BRANDENBURG_OVERVIEW.rstrip("/") or u in urls: continue
        urls.append(u)
    results=[]; now=datetime.now()
    for url in urls:
        try: page=fetch_gkd_html(url)
        except Exception as ex: print(f"      Brandenburg {url}: {ex}"); continue
        mh=re.search(r"<h1[^>]*>\s*(?:Messstation\s+)?([\s\S]*?)</h1>",page,re.I)
        name=clean_html(mh.group(1)) if mh else url.rstrip("/").rsplit("/",1)[-1].title()
        text=clean_html(page)
        mg=re.search(r"Gew[aä]sser:\s*([A-Za-zÄÖÜäöüß()\- ]+?)(?:\s+Messstellennummer|\s+mittlere)",text,re.I)
        river=mg.group(1).strip() if mg else ""
        mn=re.search(r"Hochwert\s*\(ETRS89\s*UTM33N\)\s*:\s*(\d{7})",text,re.I)
        me=re.search(r"Rechtswert\s*\(ETRS89\s*UTM33N\)\s*:\s*(\d{6,7})",text,re.I)
        if not mn or not me: continue
        lat,lon=utm33_to_wgs84(float(me.group(1)),float(mn.group(1)))
        csvm=re.search(r'href="([^"]+\.csv)"',page,re.I)
        latest={}; history={}
        if csvm:
            csvurl=urljoin(url,html_lib.unescape(csvm.group(1)))
            try: latest,history=parse_wide_sensor_csv(fetch_bytes(csvurl))
            except Exception as ex: print(f"      Brandenburg {name}: CSV {ex}")
        else: csvurl=""
        low=normalized_header(text)
        params={"wt":"wassertemperatur" in low or "wt" in latest,
                "o2":"sauerstoff" in low or "o2" in latest,
                "tr":"truebung" in low or "tr" in latest}
        defs={"wt":("Wassertemperatur","°C",1),"o2":("Sauerstoff","mg/l",1),
              "tr":("Trübung","FNU",1),"ph":("pH-Wert","",2),"lf":("Leitfähigkeit","µS/cm",0)}
        items=[]
        for kind,(dt,val) in latest.items():
            if (now-dt).total_seconds()>BB_MAX_AGE_H*3600: continue
            label,unit,digits=defs[kind]
            items.append({"label":label,"value":fmt_value(val,digits),"unit":unit,"icon":"",
                          "time":dt.strftime("%d.%m.%Y %H:%M")})
        results.append({"id":"bb-"+url.rstrip("/").rsplit("/",1)[-1],"name":name,"lat":round(lat,5),
            "lon":round(lon,5),"river":river,"updated":now_text(),"src":"brandenburg",
            "source_url":url,"download_url":csvurl,"params":params,"items":items,"history":history})
    print(f"[Brandenburg/LfU] {len(results)} automatische Gütestationen")
    return results


# ---------------------------------------------- Sachsen (BfUL, 5 Stationen) ----
SAXONY_STATIONS = [
    ("Schmilka","Elbe",50.8897,14.2283,"https://www.wasser.sachsen.de/messstation-schmilka-elbe-rechts-fluss-km-726-alte-kilometrierung-4-18339.html"),
    ("Zehren","Elbe",51.1989,13.4090,"https://www.wasser.sachsen.de/messstation-zehren-elbe-links-fluss-km-638-alte-kilometrierung-92-18337.html"),
    ("Dommitzsch","Elbe",51.6402,12.8820,"https://www.wasser.sachsen.de/messstation-dommitzsch-elbe-links-fluss-km-557-alte-kilometrierung-173-18335.html"),
    ("Bad Düben","Vereinigte Mulde",51.5900,12.5860,"https://www.wasser.sachsen.de/messstation-bad-dueben-vereinigte-mulde-links-fluss-km-67-18333.html"),
    ("Görlitz","Lausitzer Neiße",51.1520,14.9930,"https://www.wasser.sachsen.de/goerlitz-18253.html"),
]
SAXONY_MAX_AGE_H=48

def xlsx_rows(raw):
    """Kleine XLSX-Leseroutine ohne externe Python-Pakete."""
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        shared=[]
        if "xl/sharedStrings.xml" in z.namelist():
            root=ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root.findall("{*}si"):
                shared.append("".join(t.text or "" for t in si.iter() if t.tag.endswith("}t")))
        sheets=[]
        for path in sorted(n for n in z.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml$",n)):
            root=ET.fromstring(z.read(path)); matrix=[]
            for row in root.findall(".//{*}row"):
                vals={}; maxcol=-1
                for c in row.findall("{*}c"):
                    ref=c.attrib.get("r","")
                    letters=re.match(r"[A-Z]+",ref)
                    if not letters: continue
                    col=0
                    for ch in letters.group(0): col=col*26+ord(ch)-64
                    col-=1; maxcol=max(maxcol,col); typ=c.attrib.get("t","")
                    v=c.find("{*}v"); val=v.text if v is not None else ""
                    if typ=="s" and val:
                        try: val=shared[int(val)]
                        except Exception: pass
                    elif typ=="inlineStr":
                        val="".join(t.text or "" for t in c.iter() if t.tag.endswith("}t"))
                    vals[col]=val
                if maxcol>=0: matrix.append([vals.get(i,"") for i in range(maxcol+1)])
            if matrix: sheets.append(matrix)
    return sheets

def parse_xlsx_sensors(raw):
    merged={}; histories={}
    for rows in xlsx_rows(raw):
        # In eine temporaere CSV ueberfuehren, damit dieselbe robuste Spaltenerkennung greift.
        buf=io.StringIO(); wr=csv.writer(buf,delimiter=";",lineterminator="\n"); wr.writerows(rows)
        latest,hist=parse_wide_sensor_csv(buf.getvalue().encode("utf-8"))
        for kind,pair in latest.items():
            if kind not in merged or pair[0]>merged[kind][0]: merged[kind]=pair
        for label,vals in hist.items(): histories[label]=vals
    return merged,histories

def process_sachsen():
    results=[]; now=datetime.now()
    defs={"wt":("Wassertemperatur","°C",1),"o2":("Sauerstoff","mg/l",1),
          "tr":("Trübung","FNU",1),"ph":("pH-Wert","",2),"lf":("Leitfähigkeit","µS/cm",0)}
    for name,river,lat,lon,url in SAXONY_STATIONS:
        latest={}; history={}; xurl=""; page=""
        try:
            page=fetch_gkd_html(url)
            links=[urljoin(url,html_lib.unescape(x)) for x in re.findall(r'href="([^"]+\.xlsx)"',page,re.I)]
            # Auf den Stationsseiten steht die aktuelle 14-Tage-Datei vor den Jahresarchiven.
            xurl=next((x for x in links if "/stationen/download/" in x and "365" not in x.lower()),links[0] if links else "")
            if xurl: latest,history=parse_xlsx_sensors(fetch_bytes(xurl))
        except Exception as ex: print(f"      Sachsen {name}: {ex}")
        items=[]
        for kind,(dt,val) in latest.items():
            if (now-dt).total_seconds()>SAXONY_MAX_AGE_H*3600: continue
            label,unit,digits=defs[kind]
            items.append({"label":label,"value":fmt_value(val,digits),"unit":unit,"icon":"",
                          "time":dt.strftime("%d.%m.%Y %H:%M")})
        low=normalized_header(clean_html(page))
        params={"wt":"wassertemperatur" in low or "wt" in latest,
                "o2":"sauerstoff" in low or "o2" in latest,
                "tr":"truebung" in low or "tr" in latest}
        results.append({"id":"sn-"+normalized_header(name).replace(" ","-"),"name":name,"lat":lat,"lon":lon,
            "river":river,"updated":now_text(),"src":"sachsen","source_url":url,"download_url":xurl,
            "params":params,"items":items,"history":history})
    print(f"[Sachsen/BfUL] {len(results)} automatische Gütestationen")
    return results


# ---------------------------------------------------------- Berlin (Wasserportal) ----
# Ausschliesslich aktuelle Online-Messwerte. Die periodischen Probenahmen (thema=opq)
# werden bewusst nicht importiert. Das Portal liefert je Parameter eine Tabelle; die
# Stammdatenseite enthaelt die Koordinaten in ETRS89/UTM33N.
BERLIN_BASE = "https://wasserportal.berlin.de/"
BERLIN_THEMES = [
    ("owt", "Wassertemperatur", "°C", 1),
    ("oog", "Sauerstoff", "mg/l", 1),
    ("oph", "pH-Wert", "", 2),
    ("olf", "Leitfähigkeit", "µS/cm", 0),
]
BERLIN_MAX_AGE_H = 48
BERLIN_MAX_NEW_COORDS = 100

def utm33_to_wgs84(E, N):
    """ETRS89 / UTM Zone 33N -> WGS84 (lat, lon), GRS80."""
    a=6378137.0; f=1/298.257222101; k0=0.9996
    e2=f*(2-f); E0=500000.0; lon0=math.radians(15.0)
    x=E-E0; M=N/k0
    mu=M/(a*(1-e2/4-3*e2**2/64-5*e2**3/256))
    e1=(1-math.sqrt(1-e2))/(1+math.sqrt(1-e2))
    phi1=(mu+(3*e1/2-27*e1**3/32)*math.sin(2*mu)+(21*e1**2/16-55*e1**4/32)*math.sin(4*mu)
            +(151*e1**3/96)*math.sin(6*mu)+(1097*e1**4/512)*math.sin(8*mu))
    ep2=e2/(1-e2); C1=ep2*math.cos(phi1)**2; T1=math.tan(phi1)**2
    N1=a/math.sqrt(1-e2*math.sin(phi1)**2); R1=a*(1-e2)/(1-e2*math.sin(phi1)**2)**1.5
    D=x/(N1*k0)
    lat=phi1-(N1*math.tan(phi1)/R1)*(D**2/2-(5+3*T1+10*C1-4*C1**2-9*ep2)*D**4/24
        +(61+90*T1+298*C1+45*T1**2-252*ep2-3*C1**2)*D**6/720)
    lon=lon0+(D-(1+2*T1+C1)*D**3/6+(5-2*C1+28*T1-3*C1**2+8*ep2+24*T1**2)*D**5/120)/math.cos(phi1)
    return math.degrees(lat), math.degrees(lon)

def parse_berlin_theme(page, label, unit, digits):
    """Aktuelle Online-Werte einer Berliner Parametertabelle nach Stations-ID."""
    out={}; now=datetime.now()
    for row in re.findall(r"<tr[^>]*>([\s\S]*?)</tr>", page, re.I):
        mh=re.search(r'href=["\'][^"\']*station\.php\?[^"\']*?station=([0-9A-Za-z_-]+)', row, re.I)
        if not mh: continue
        sid=mh.group(1)
        cells=[clean_html(c) for c in re.findall(r"<td[^>]*>([\s\S]*?)</td>", row, re.I)]
        if len(cells)<3: continue
        date_i=-1; dt=None
        for i,cell in enumerate(cells):
            md=re.search(r"(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2})(?::\d{2})?", cell)
            if md:
                dt=parse_dt(md.group(1)+" "+md.group(2)); date_i=i; break
        if not dt or date_i<0: continue
        age=(now-dt).total_seconds()
        if age>BERLIN_MAX_AGE_H*3600 or age < -6*3600: continue
        val=None
        for cell in cells[date_i+1:]:
            mv=re.search(r"-?\d+(?:[.,]\d+)?", cell)
            if mv:
                val=to_number(mv.group(0)); break
        if val is None: continue
        if cells[0].strip()==sid and len(cells)>2:
            name=cells[1].strip(); river=cells[2].strip()
        else:
            name=cells[0].strip(); river=""
        item={"label":label, "value":fmt_value(val,digits), "unit":unit,
              "time":dt.strftime("%d.%m.%Y %H:%M"), "_dt":dt}
        old=out.get(sid)
        if not old or item["_dt"]>old["item"]["_dt"]:
            out[sid]={"name":name, "river":river, "item":item}
    return out

def berlin_station_detail(sid):
    url=urljoin(BERLIN_BASE, "station.php?anzeige=i&thema=owq&station="+str(sid)+"&sfrom=owt&sgrafik=ew")
    page=fetch_gkd_html(url); fields={}
    for row in re.findall(r"<tr[^>]*>([\s\S]*?)</tr>", page, re.I):
        cells=[clean_html(c) for c in re.findall(r"<(?:th|td)[^>]*>([\s\S]*?)</(?:th|td)>", row, re.I)]
        if len(cells)>=2 and cells[0] and cells[1] and cells[0] not in fields:
            fields[cells[0]]=cells[1]
    east=north=None
    for key,value in fields.items():
        if "Rechtswert" in key:
            east=to_number(value)
        elif "Hochwert" in key:
            north=to_number(value)
    if east is None or north is None: return None
    lat,lon=utm33_to_wgs84(float(east),float(north))
    return {"lat":round(lat,6), "lon":round(lon,6),
            "name":fields.get("Messstellenname", ""), "river":fields.get("Gewässer", "")}

def berlin_coords(station_ids):
    cache=load_json_cache(BERLIN_COORDS_FILE); changed=False; added=0
    for sid in station_ids:
        if sid in cache and cache[sid].get("lat") is not None: continue
        if added>=BERLIN_MAX_NEW_COORDS: break
        try:
            detail=berlin_station_detail(sid)
            if detail:
                cache[sid]=detail; changed=True; added+=1
        except Exception as e:
            print(f"      Berlin-Koordinaten {sid}: {e}")
    if changed: save_json_cache(BERLIN_COORDS_FILE,cache)
    return cache

def process_berlin():
    merged={}
    for theme,label,unit,digits in BERLIN_THEMES:
        table_url=urljoin(BERLIN_BASE, "messwerte.php?anzeige=tabelle&thema="+theme)
        rows=parse_berlin_theme(fetch_gkd_html(table_url),label,unit,digits)
        for sid,rec in rows.items():
            st=merged.setdefault(sid,{"name":rec["name"],"river":rec["river"],"items":[]})
            if not st["name"]: st["name"]=rec["name"]
            if not st["river"]: st["river"]=rec["river"]
            st["items"].append(rec["item"])
    coords=berlin_coords(sorted(merged))
    results=[]; order={name:i for i,name in enumerate(ORDER)}
    for sid,st in merged.items():
        c=coords.get(sid)
        if not c: continue
        items=sorted(st["items"],key=lambda x:order.get(x["label"],99))
        newest=max(x["_dt"] for x in items)
        for item in items: item.pop("_dt",None)
        labels={x["label"] for x in items}
        results.append({
            "id":"be-"+sid, "name":c.get("name") or st["name"] or sid,
            "lat":c["lat"], "lon":c["lon"], "river":c.get("river") or st["river"],
            "updated":newest.strftime("%d.%m.%Y %H:%M"), "items":items, "history":{},
            "src":"berlin", "source_url":urljoin(BERLIN_BASE,"station.php?anzeige=i&thema=owq&station="+sid+"&sfrom=owt&sgrafik=ew"),
            "params":{"wt":"Wassertemperatur" in labels, "o2":"Sauerstoff" in labels, "tr":"Trübung" in labels},
        })
    print(f"[Berlin] {len(results)} aktuelle Online-Stationen ({len(coords)} Koordinaten im Cache)")
    return results


# ---------------------------------------------------------- Saarland (SEBA Hydrocenter) ----
# Oeffentlicher Nur-Lese-Zugang des im Landesauftrag betriebenen Online-Messnetzes.
# Es werden nur die auf der Webmap aktuell sichtbaren Live-Sonden ausgelesen, keine
# Laborwerte und keine periodischen Probenahmen.
SAARLAND_LOGIN = "https://seba-hydrocenter.com/login?publicUser=unisaarland"
SAARLAND_SOURCE = "https://www.gewaesser-monitoring.de/?Messdaten-Saar"
SAARLAND_MAX_AGE_H = 48

def saarland_river(title):
    low=(title or "").lower()
    for needle,river in (("blies","Blies"),("prims","Prims"),("theel","Theel"),
                         ("ill","Ill"),("nied","Nied"),("mosel","Mosel"),("saar","Saar")):
        if needle in low: return river
    if "staustufe" in low: return "Saar"
    return ""

def process_saarland_live():
    from playwright.sync_api import sync_playwright
    results=[]; now=datetime.now()
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        page=browser.new_page(viewport={"width":1280,"height":850})
        page.goto(SAARLAND_LOGIN,wait_until="domcontentloaded",timeout=90_000)
        page.wait_for_url(re.compile(r"/webmap(?:\?.*)?$"),timeout=90_000)
        page.wait_for_selector(".leaflet-marker-icon",timeout=60_000)
        page.wait_for_timeout(1200)
        markers=page.eval_on_selector_all(".leaflet-marker-icon", """els => {
          const tiles=[...document.querySelectorAll('.leaflet-tile')];
          const tile=tiles.find(e=>/\/(\d+)\/(\d+)\/(\d+)\.png/.test(e.src||''));
          if(!tile) return [];
          const tm=(tile.src||'').match(/\/(\d+)\/(\d+)\/(\d+)\.png/);
          const tp=(tile.style.transform||'').match(/translate3d\(([-\d.]+)px,\s*([-\d.]+)px/);
          if(!tm||!tp) return [];
          const z=+tm[1], tx=+tm[2], ty=+tm[3], ox=tx*256-(+tp[1]), oy=ty*256-(+tp[2]);
          const world=256*Math.pow(2,z);
          return els.map((e,i)=>{
            const mp=(e.style.transform||'').match(/translate3d\(([-\d.]+)px,\s*([-\d.]+)px/);
            if(!mp) return null;
            const gx=ox+(+mp[1]), gy=oy+(+mp[2]);
            return {index:i,title:(e.title||'').trim(),
              lon:gx/world*360-180,
              lat:180/Math.PI*Math.atan(Math.sinh(Math.PI*(1-2*gy/world)))};
          }).filter(Boolean);
        }""")
        for marker in markers:
            title=marker.get("title","").strip()
            if not title: continue
            selector='.leaflet-marker-icon[title='+json.dumps(" "+title)+']'
            loc=page.locator(selector)
            if loc.count()!=1:
                selector='.leaflet-marker-icon[title='+json.dumps(title)+']'; loc=page.locator(selector)
            if loc.count()!=1: continue
            try:
                loc.press("Enter")
                page.wait_for_selector(".leaflet-popup",timeout=10_000)
                rows=page.eval_on_selector(".leaflet-popup", """p => [...p.querySelectorAll('tr')].map(tr => {
                  const a=tr.querySelector('a[href*="visualization/"]');
                  return {cells:[...tr.querySelectorAll('td')].map(td=>(td.innerText||'').trim().replace(/\s+/g,' ')),
                    href:a ? a.getAttribute('href') : ''};
                })""")
            except Exception as e:
                print(f"      Saarland-Popup {title}: {e}"); continue
            items=[]; temp_series=""
            for row in rows:
                cells=row.get("cells") or []
                if len(cells)<4: continue
                pname=cells[0].lower()
                if "mittelwert" in pname or "batter" in pname or "chlorophyll" in pname: continue
                if "temperatur" in pname: label,unit,digits="Wassertemperatur","°C",1
                elif "o2-konzentration" in pname: label,unit,digits="Sauerstoff","mg/l",1
                elif "o2-sättigung" in pname or "o2-saettigung" in pname: label,unit,digits="O₂-Sättigung","%",0
                elif "leitfähigkeit" in pname or "leitfaehigkeit" in pname: label,unit,digits="Leitfähigkeit","µS/cm",0
                elif re.search(r"(^|\s)ph(\s|$)",pname): label,unit,digits="pH-Wert","",2
                elif "trüb" in pname or "trueb" in pname: label,unit,digits="Trübung",cells[2],1
                else: continue
                val=to_number(cells[1]); dt=parse_dt(cells[3])
                if val is None or not dt: continue
                age=(now-dt).total_seconds()
                if age>SAARLAND_MAX_AGE_H*3600 or age < -6*3600: continue
                href=row.get("href") or ""
                item={"label":label,"value":fmt_value(val,digits),"unit":unit,
                      "time":dt.strftime("%d.%m.%Y %H:%M"),"_dt":dt}
                if href: item["chart_url"]=urljoin("https://seba-hydrocenter.com/",href)
                if label=="Wassertemperatur": temp_series=href
                items.append(item)
            if items:
                newest=max(x["_dt"] for x in items)
                for item in items: item.pop("_dt",None)
                labels={x["label"] for x in items}
                m_sid=re.search(r"visualization/(\d+)",temp_series or "")
                sid=m_sid.group(1) if m_sid else re.sub(r"\W+","-",title.lower()).strip("-")
                results.append({
                    "id":"saar-live-"+str(sid), "name":re.sub(r"\s+20\d{2}\s*$","",title),
                    "lat":round(float(marker["lat"]),6), "lon":round(float(marker["lon"]),6),
                    "river":saarland_river(title), "updated":newest.strftime("%d.%m.%Y %H:%M"),
                    "items":items, "history":{}, "src":"saarland-live", "source_url":SAARLAND_SOURCE,
                    "params":{"wt":"Wassertemperatur" in labels,"o2":"Sauerstoff" in labels,"tr":"Trübung" in labels},
                })
            close=page.locator(".leaflet-popup-close-button")
            if close.count()==1: close.click()
        browser.close()
    print(f"[Saarland] {len(results)} aktuelle Online-Stationen")
    return results


# ------------------------------------------------------------------- NRW (LANUK/HYWIS) ----
# KISTERS-Portal (hydrologie.nrw.de). Layer 20 = Wassertemperatur: ein JSON-Array mit
# aktuellem Wert + WGS84-Koordinaten je Station. CORS geschlossen -> serverseitig.
NRW_URL = "https://www.hydrologie.nrw.de/data/internet/layers/20/index.json"
NRW_MAX_AGE_H = 24

def _iso_dt(s):
    try: return datetime.fromisoformat(str(s))
    except Exception: return None

def process_nrw():
    data = json.loads(fetch_gkd_html(NRW_URL))
    if not isinstance(data, list): return []
    now = datetime.now(timezone.utc); results = []
    for o in data:
        try:
            lat = float(o.get("station_latitude")); lon = float(o.get("station_longitude"))
        except Exception:
            continue
        val = to_number(str(o.get("ts_value")))
        if val is None or not lat or not lon: continue
        dt = _iso_dt(o.get("timestamp"))
        if dt is not None:
            age = (now - dt.astimezone(timezone.utc)).total_seconds()
            if age > NRW_MAX_AGE_H*3600 or age < -6*3600: continue
        river = (o.get("WTO_OBJECT") or o.get("catchment_name") or "").strip()
        name  = (o.get("station_name") or o.get("station_longname") or "").strip()
        sid   = str(o.get("station_no") or o.get("station_id") or name)
        results.append({
            "id": "nrw-"+sid, "name": name or sid, "lat": round(lat,5), "lon": round(lon,5), "river": river,
            "updated": datetime.now(timezone.utc).astimezone().strftime("%d.%m.%Y %H:%M"),
            "items": [{"label":"Wassertemperatur", "value":fmt_value(val,1), "unit":"°C",
                       "icon":"", "time": dt.strftime("%d.%m.%Y %H:%M") if dt else ""}],
            "history": {},
        })
    print(f"[NRW] {len(results)} Stationen mit Wassertemperatur")
    return results


# ------------------------------------------------------------ Undine (BfG) ----
# BfG-Informationsplattform Undine: aktuelle Güte-Wassertemperatur an den großen Bundeswasser-
# straßen (Rhein, Ems, Weser, Elbe, Oder, Donau). Werte je Flussgebiet in einer JS-Datei;
# Koordinaten (Gauß-Krüger/Bessel) auf den Stationsseiten -> WGS84. Dubletten mit bereits
# vorhandenen Netzen werden client-seitig beim Zeichnen entfernt.
UNDINE_REGIONS = ["rhein", "ems", "weser", "elbe", "oder", "donau"]
UNDINE_COORDS_FILE = BASE_DIR / "undine_coords.json"
UNDINE_MAX_AGE_H = 30

def gk_bessel_to_wgs84(R, H):
    """Gauß-Krüger (Bessel/Potsdam, Zone aus 1. Ziffer des Rechtswerts) -> WGS84 (lat, lon)."""
    a=6377397.155; f=1/299.1528128; e2=f*(2-f)
    zone=int(R//1_000_000); lon0=math.radians(zone*3.0)
    y=R-zone*1_000_000-500000.0; x=H
    bar=x/(a*(1-e2/4-3*e2**2/64-5*e2**3/256))
    e1=(1-math.sqrt(1-e2))/(1+math.sqrt(1-e2))
    phi=(bar+(3*e1/2-27*e1**3/32)*math.sin(2*bar)+(21*e1**2/16-55*e1**4/32)*math.sin(4*bar)
         +(151*e1**3/96)*math.sin(6*bar))
    ep2=e2/(1-e2); C=ep2*math.cos(phi)**2; T=math.tan(phi)**2
    N=a/math.sqrt(1-e2*math.sin(phi)**2); R1=a*(1-e2)/(1-e2*math.sin(phi)**2)**1.5; D=y/N
    lat=phi-(N*math.tan(phi)/R1)*(D**2/2-(5+3*T+10*C-4*C*C-9*ep2)*D**4/24
        +(61+90*T+298*C+45*T*T-252*ep2-3*C*C)*D**6/720)
    lon=lon0+(D-(1+2*T+C)*D**3/6+(5-2*C+28*T-3*C*C+8*ep2+24*T*T)*D**5/120)/math.cos(phi)
    lat=math.degrees(lat); lon=math.degrees(lon)
    # Bessel/Potsdam -> WGS84 (3-Parameter-Helmert über ECEF, ~100 m genau)
    dx=-598.1; dy=-73.7; dz=-418.2
    la=math.radians(lat); lo=math.radians(lon); Nn=a/math.sqrt(1-e2*math.sin(la)**2)
    X=Nn*math.cos(la)*math.cos(lo)+dx; Y=Nn*math.cos(la)*math.sin(lo)+dy; Z=Nn*(1-e2)*math.sin(la)+dz
    aW=6378137.0; fW=1/298.257223563; e2W=fW*(2-fW); p=math.hypot(X,Y); l2=math.atan2(Z,p*(1-e2W))
    for _ in range(5):
        Nw=aW/math.sqrt(1-e2W*math.sin(l2)**2); l2=math.atan2(Z+e2W*Nw*math.sin(l2), p)
    return round(math.degrees(l2),5), round(math.degrees(math.atan2(Y,X)),5)

def undine_wt(region):
    """Temperatur und Sauerstoff aus der Undine-Flussgebiets-JS-Datei."""
    urls=[f"https://undine.bafg.de/bilder/undine/{region}/aktuell_wt_o2_{region}.js",
          f"https://undine.bafg.de/bilder/undine/aktuell_wt_o2_{region}.js"]
    t=""
    for u in urls:
        try:
            t=fetch_gkd_html(u)
            if "wt_" in t: break
        except Exception: continue
    out={}
    for m in re.finditer(r'((?:wt|o2)_[a-z0-9_]+)\s*=\s*"([^"]*)"', t, re.I):
        var=m.group(1).lower(); kind="o2" if var.startswith("o2_") else "t"
        key=var.split("_",1)[1]; v=m.group(2)
        mv=(re.search(r"Sauerstoff(?:gehalt|konzentration)?:\s*([\-\d.,]+)", v, re.I)
            if kind=="o2" else re.search(r"Wassertemperatur:\s*([\-\d.,]+)", v, re.I))
        md=re.search(r"Datum:\s*([\d.]+),?\s*([\d:]+)", v, re.I)
        if not mv: continue
        d=out.setdefault(key,{"t":None,"d":"","o2":None,"d_o2":""})
        d[kind]=to_number(mv.group(1))
        d["d_o2" if kind=="o2" else "d"]=(md.group(1)+" "+md.group(2)) if md else ""
    return out

def undine_station_coords(region, key, cache):
    ck=region+"/"+key
    if ck in cache: return cache[ck]
    try:
        html=fetch_gkd_html(f"https://undine.bafg.de/{region}/guetemessstellen/{region}_mst_{key}.html")
    except Exception:
        cache[ck]=None; return None
    txt=re.sub(r"<[^>]+>"," ",html).replace("&nbsp;"," ")
    mrh=re.search(r"Rechtswert\s*/\s*Hochwert:\s*(\d{6,7})\s*/\s*(\d{6,7})", txt)
    name=key; river=""
    mt=re.search(r"<title>([^<]+)</title>", html)
    if mt:
        nm=re.sub(r"^\s*Messstation\s+","",mt.group(1).split("|")[0].strip())
        if "," in nm: river=nm.rsplit(",",1)[1].strip(); name=nm.rsplit(",",1)[0].strip()
        else: name=nm
    if not mrh:
        cache[ck]=None; return None
    lat,lon=gk_bessel_to_wgs84(float(mrh.group(1)), float(mrh.group(2)))
    if not (47.0<=lat<=55.2 and 5.5<=lon<=15.6):
        cache[ck]=None; return None
    cache[ck]={"lat":lat, "lon":lon, "name":name, "river":river}
    return cache[ck]

def process_undine():
    try: cache=json.loads(UNDINE_COORDS_FILE.read_text(encoding="utf-8"))
    except Exception: cache={}
    now=datetime.now(); results=[]
    for region in UNDINE_REGIONS:
        try: wt=undine_wt(region)
        except Exception as ex: print(f"      Undine {region}: {ex}"); continue
        for key,d in wt.items():
            dt=parse_dt(d.get("d","")) if d.get("d") else None
            dto=parse_dt(d.get("d_o2","")) if d.get("d_o2") else None
            temp_ok=d.get("t") is not None and not (dt and (now-dt).total_seconds()>UNDINE_MAX_AGE_H*3600)
            o2_ok=d.get("o2") is not None and not (dto and (now-dto).total_seconds()>UNDINE_MAX_AGE_H*3600)
            if not temp_ok and not o2_ok: continue
            c=undine_station_coords(region, key, cache)
            if not c: continue
            items=[]
            if temp_ok: items.append({"label":"Wassertemperatur", "value":fmt_value(d["t"],1), "unit":"°C",
                                      "icon":"", "time":dt.strftime("%d.%m.%Y %H:%M") if dt else d.get("d","")})
            if o2_ok: items.append({"label":"Sauerstoff", "value":fmt_value(d["o2"],1), "unit":"mg/l",
                                    "icon":"", "time":dto.strftime("%d.%m.%Y %H:%M") if dto else d.get("d_o2","")})
            results.append({
                "id":"undine-"+region+"-"+key, "name":c["name"], "lat":c["lat"], "lon":c["lon"], "river":c["river"], "src":"undine",
                "updated": datetime.now(timezone.utc).astimezone().strftime("%d.%m.%Y %H:%M"),
                "items":items,
                "history":{},
            })
    try: UNDINE_COORDS_FILE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    except Exception: pass
    print(f"[Undine/BfG] {len(results)} Gütestationen (Temperatur/Sauerstoff soweit verfügbar)")
    return results


# -------------------------------------------------- Nord-/Ostsee (BSH MARNET) ----
# Das BSH veröffentlicht die aktuellen Messreihen als Diagramme, aber nicht als
# frei abrufbare Zahlen-API. Deshalb erscheinen alle Hauptstationen auf der Karte;
# wo ein Stationsdiagramm verfügbar ist, kann es direkt aus PetriKlar geöffnet werden.
MARNET_OVERVIEW="https://www2.bsh.de/daten/MARNET/Uebersichtskarte/Uebersichtskarte.html"
MARNET_STATIONS=[
    ("Nordseeboje 2","Nordsee",55.00000,6.33333),
    ("Deutsche Bucht","Nordsee",54.16667,7.45000),
    ("Ems","Nordsee",54.16667,6.35000),
    ("Nordseeboje 3","Nordsee",54.68333,6.78333),
    ("FINO 1","Nordsee",54.01667,6.58333),
    ("FINO 3","Nordsee",55.19500,7.15833),
    ("Kiel","Ostsee",54.50000,10.26667),
    ("Fehmarn Belt","Ostsee",54.60000,11.15000),
    ("Darßer Schwelle","Ostsee",54.70000,12.70000),
    ("Oder Bank","Ostsee",54.08333,14.16667),
    ("Arkona Becken","Ostsee",54.88333,13.86667),
    ("FINO 2","Ostsee",55.00832,13.15418),
]

def process_marnet_metadata():
    results=[]
    for idx,(name,sea,lat,lon) in enumerate(MARNET_STATIONS):
        source=MARNET_OVERVIEW; items=[]
        if name=="Kiel":
            source="https://www2.bsh.de/daten/MARNET/Stationen/Kiel.html"
            items=[{"label":"Wassertemperatur","value":None,"unit":"","icon":"","time":"",
                    "chart_url":"https://www2.bsh.de/aktdat/marnet_export/Kiel/KielTemperatur14Tage.png"},
                   {"label":"Sauerstoff","value":None,"unit":"","icon":"","time":"",
                    "chart_url":"https://www2.bsh.de/aktdat/marnet_export/Kiel/KielOx14Tage.png"}]
        elif name=="Fehmarn Belt":
            source="https://www2.bsh.de/daten/MARNET/Stationen/Fehmarn.html"
            items=[{"label":"Wassertemperatur","value":None,"unit":"","icon":"","time":"","source_url":source},
                   {"label":"Sauerstoff","value":None,"unit":"","icon":"","time":"","source_url":source}]
        results.append({"id":f"marnet-{idx+1}","name":name,"lat":lat,"lon":lon,"river":sea,
            "updated":now_text(),"src":"bsh-marnet","source_url":source,
            "params":{"wt":True,"o2":True,"tr":False},"items":items,"history":{}})
    print(f"[BSH/MARNET] {len(results)} Hauptstationen in Nord- und Ostsee (Diagramm-/Metadaten)")
    return results


# ------------------------------------------ Schweiz (BAFU Datenplattform) ----
BAFU_API = "https://data.bafu.admin.ch/api"

def post_json(url, payload, timeout=120):
    body=json.dumps(payload).encode("utf-8")
    req=urllib.request.Request(url, data=body, headers={
        "User-Agent":"PetriKlar/1.0 (water monitoring map)",
        "Content-Type":"application/json", "Accept":"application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8"))

def process_switzerland_bafu():
    """Alle aktiven BAFU-Stationen und deren Live-Parameter aus der offenen GraphQL-API."""
    # Metadaten und Livewerte getrennt abrufen. Die frühere kombinierte, ungefilterte
    # data_live-Abfrage überschritt regelmäßig das 10.000-Zeilen-Limit und ließ dann
    # das komplette Schweizer Netz aus wasserwerte.json verschwinden.
    station_query="""
    { water { observations {
      stations(where:{status:{_eq:\"Aufgebaut\"}}, limit:10000) {
        no name siteName riverName latitude longitude status
      }
    } } }
    """
    station_obj=post_json(BAFU_API,{"query":station_query},120)
    if station_obj.get("errors"): raise RuntimeError("BAFU Stationen: "+str(station_obj["errors"])[:500])
    station_rows=station_obj.get("data",{}).get("water",{}).get("observations",{}).get("stations",[])
    stations={str(s.get("no")):s for s in station_rows if s.get("latitude") is not None}

    since=(datetime.now(timezone.utc)-timedelta(hours=3)).isoformat().replace("+00:00","Z")
    live_query="""
    { water { observations {
      data_live(
        where:{timestamp:{_gte:\"%s\"},parameterName:{_in:[\"W\",\"Q\",\"WT\"]}},
        order_by:{timestamp:desc}, limit:10000
      ) { stationNo parameterName timestamp value releaseStatus }
    } } }
    """ % since
    live_obj=post_json(BAFU_API,{"query":live_query},120)
    if live_obj.get("errors"): raise RuntimeError("BAFU Livewerte: "+str(live_obj["errors"])[:500])
    live_rows=live_obj.get("data",{}).get("water",{}).get("observations",{}).get("data_live",[])
    grouped={}
    for row in live_rows:
        sid=str(row.get("stationNo") or ""); code=str(row.get("parameterName") or "").upper()
        if sid not in stations: continue
        # Die API dokumentiert WT/W/Q. Weitere Qualitätscodes werden mitgenommen,
        # sobald sie vom BAFU im Live-Feed ausgegeben werden.
        if code not in ("WT","T","W","Q","O2","DO","OXY","TR","TURB","NTU","SS"):
            continue
        old=grouped.setdefault(sid,{}).get(code)
        if not old or str(row.get("timestamp") or "") > str(old.get("timestamp") or ""):
            grouped[sid][code]=row
    out=[]
    for sid,vals in grouped.items():
        s=stations[sid]; items=[]; params={"pegel":False,"wt":False,"o2":False,"tr":False}
        def add(codes,label,unit,dec,param):
            hit=next((vals[c] for c in codes if c in vals),None)
            if not hit: return
            params[param]=True
            items.append({"label":label,"value":fmt_value(hit.get("value"),dec),"unit":unit,
                          "icon":"","time":str(hit.get("timestamp") or "")})
        add(("W",),"Pegelstand","m ü. M.",2,"pegel")
        add(("Q",),"Durchfluss","m³/s",2,"pegel")
        add(("WT","T"),"Wassertemperatur","°C",1,"wt")
        add(("O2","DO","OXY"),"Sauerstoff","mg/l",1,"o2")
        add(("TR","TURB","NTU","SS"),"Trübung/Schwebstoff","NTU",1,"tr")
        if not items: continue
        out.append({"id":"ch-bafu-"+sid,"name":s.get("name") or s.get("siteName") or sid,
            "lat":float(s["latitude"]),"lon":float(s["longitude"]),
            "river":s.get("riverName") or "Schweiz","updated":now_text(),"src":"ch-bafu",
            "source_url":"https://www.hydrodaten.admin.ch/de/seen-und-fluesse/stationen/"+sid,
            "params":params,"items":items,"history":{}})
    print(f"[Schweiz/BAFU] {len(out)} Stationen mit aktuellen Pegel-/Temperatur-/Gütewerten")
    return out


# -------------------------------------- Niederlande (Rijkswaterstaat WFS) ----
RWS_LATEST_CSV=("https://geo.rijkswaterstaat.nl/services/ogc/hws/DDAPI20/ows?"
                "SERVICE=WFS&VERSION=1.1.0&REQUEST=GetFeature&"
                "TYPENAME=locatiesmetlaatstewaarneming&outputFormat=csv&"
                "format_options=csvseparator:semicolon")
RWS_FILTER_TERMS=("Temperatuur","Zuurstof","Troebel","Waterhoogte","Waterstand","Debiet","Afvoer")

def _pick(row, *names):
    low={str(k).lower():v for k,v in row.items()}
    for n in names:
        if n.lower() in low and low[n.lower()] not in (None,""): return low[n.lower()]
    return ""

def process_netherlands_rws():
    """Alle letzten relevanten RWS-Beobachtungen, inklusive Nordsee/Wattenmeer."""
    # Der ungefilterte WFS-Export ist inzwischen so groß, dass er regelmäßig in
    # einen Gateway-Timeout läuft. Deshalb nur die benötigten Live-Parameter
    # einzeln laden und anschließend je Standort zusammenführen.
    rows=[]
    for term in RWS_FILTER_TERMS:
        cql="PARAMETER_WAT_OMSCHRIJVING ILIKE '%%%s%%'" % term
        url=RWS_LATEST_CSV+"&CQL_FILTER="+quote(cql,safe="")
        try:
            raw=fetch_bytes(url).decode("utf-8-sig","replace")
            delimiter=";" if raw.splitlines() and raw.splitlines()[0].count(";")>raw.splitlines()[0].count(",") else ","
            rows.extend(csv.DictReader(io.StringIO(raw),delimiter=delimiter))
        except Exception as e:
            print(f"      RWS {term}: {e}")
    if not rows:
        raise RuntimeError("RWS-WFS lieferte für keinen Live-Parameter Daten")
    grouped={}
    for row in rows:
        desc=str(_pick(row,"parameter_wat_omschrijving","PARAMETER_WAT_OMSCHRIJVING","omschrijving") or "")
        dl=desc.lower(); param=None; label=""; unit=str(_pick(row,"eenheid_code","EENHEID_CODE","eenheid") or "")
        if "temperatuur" in dl and ("water" in dl or "oppervlakte" in dl): param,label="wt","Wassertemperatur"
        elif "zuurstof" in dl or "oxygen" in dl: param,label="o2","Sauerstoff"
        elif any(x in dl for x in ("troebel","turbid","zwevend","suspende","doorzicht")): param,label="tr","Trübung/Schwebstoff"
        elif "waterhoogte" in dl or "waterstand" in dl: param,label="pegel","Pegelstand"
        elif "debiet" in dl or "afvoer" in dl: param,label="pegel","Durchfluss"
        if not param: continue
        code=str(_pick(row,"locatie_code","LOCATIE_CODE","code","locatie") or "").strip()
        if not code: continue
        # DDAPI20 liefert ETRS89 lat/lon; Feldnamen können je WFS-Version variieren.
        lat=_pick(row,"latitude","lat","y"); lon=_pick(row,"longitude","lon","lng","x")
        geom=str(_pick(row,"wkt","geom","geometry","the_geom") or "")
        if (not lat or not lon) and geom:
            m=re.search(r"POINT\s*\(\s*([-0-9.]+)\s+([-0-9.]+)",geom,re.I)
            if m: lon,lat=m.group(1),m.group(2)
        try: lat=float(str(lat).replace(",",".")); lon=float(str(lon).replace(",","."))
        except Exception: continue
        if not (49.0<=lat<=56.5 and 2.0<=lon<=8.5): continue
        value=_pick(row,"meetwaarde_waarde_numeriek","meetwaarde","waarde_numeriek","waarde")
        try: value=float(str(value).replace(",","."))
        except Exception: continue
        t=str(_pick(row,"tijdstip","waarnemingdatum","begindatumtijd","datumtijd","timestamp") or "")
        name=str(_pick(row,"locatie_omschrijving","naam","locatienaam") or code)
        water=str(_pick(row,"waterlichaam_omschrijving","waternaam","waterlichaam","compartiment_omschrijving") or "Niederlande")
        g=grouped.setdefault(code,{"id":"nl-rws-"+code,"name":name,"lat":lat,"lon":lon,"river":water,
            "updated":now_text(),"src":"nl-rws","source_url":"https://waterinfo.rws.nl/","params":{"pegel":False,"wt":False,"o2":False,"tr":False},"items":{},"history":{}})
        old=g["items"].get(param)
        if not old or t>=old.get("time",""):
            g["params"][param]=True
            g["items"][param]={"label":label,"value":fmt_value(value,1 if param!="pegel" else 2),"unit":unit,"icon":"","time":t}
    out=[]
    for g in grouped.values(): g["items"]=list(g["items"].values()); out.append(g)
    print(f"[Niederlande/RWS] {len(out)} Stationen mit Pegel/Temperatur/O2/Trübung")
    return out


# ------------------------------------------------------------------- Main -----
def write_json(stations):
    payload = {
        "updated": datetime.now(timezone.utc).astimezone().strftime("%d.%m.%Y %H:%M"),
        "stations": stations,
    }
    JSON_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def retain_cached_neighbor_networks(stations):
    """Nachbarland-Netze bei einer vorübergehend gestörten Behörde nicht löschen."""
    try:
        old=json.loads(JSON_FILE.read_text(encoding="utf-8"))
        old_rows=old.get("stations",[]) if isinstance(old,dict) else []
    except Exception:
        return stations
    prefixes=("ch-bafu-","nl-rws-","at-")
    ids=[str(s.get("id") or "") for s in stations]
    for prefix in prefixes:
        if any(i.startswith(prefix) for i in ids):
            continue
        cached=[s for s in old_rows if str(s.get("id") or "").startswith(prefix)]
        if cached:
            print(f"[Cache] {len(cached)} Stationen für {prefix} beibehalten")
            stations.extend(cached)
    return stations


def process_station(st):
    print(f"[Station] {st['name']} (id {st['id']}) ...")
    csv_path = download_csv(st["id"])
    rows = read_table(csv_path)
    items = build_items(parse_latest(rows))
    if not items:
        print("      Keine bekannten Messgroessen erkannt. Kopf der CSV:")
        for r in rows[:8]:
            print("      | " + " | ".join(r))
        raise RuntimeError("keine Messgroessen")
    for it in items:
        print(f"      {it['label']}: {it['value']} {it['unit']}  (Stand {it['time']})")
    history = build_history(rows)
    return {
        "id": st["id"], "name": st["name"], "lat": st["lat"], "lon": st["lon"], "river": st["river"],
        "updated": datetime.now(timezone.utc).astimezone().strftime("%d.%m.%Y %H:%M"),
        "items": items, "history": history,
    }

def main():
    results = []
    for st in QUALITY_STATIONS:            # RLP
        try:
            results.append(process_station(st))
        except Exception as e:
            print(f"      FEHLER bei {st['name']}: {e}")
    # Hessen (HLNUG) wird jetzt client-seitig in der App geladen (app.hlnug.de, alle
    # kontinuierlichen Stationen) – daher hier deaktiviert, um Doppelungen zu vermeiden.
    # for st in HESSEN_STATIONS:
    #     try:
    #         results.append(process_hessen(st))
    #     except Exception as e:
    #         print(f"      FEHLER bei {st['name']}: {e}")
    try:                                   # Bayern: Temperatur + Schwebstoff (GKD) + Sauerstoff (NID)
        bayern = process_gkd_all()
        try:
            bayern = enrich_gkd_with_schwebstoff(bayern)
        except Exception as e:
            print(f"      FEHLER Bayern/GKD Schwebstoff: {e}")
        try:
            bayern = enrich_gkd_with_nid_oxygen(bayern)
        except Exception as e:
            print(f"      FEHLER Bayern/NID Sauerstoff: {e}")
        results.extend(bayern)
    except Exception as e:
        print(f"      FEHLER GKD: {e}")
    try:                                   # Niedersachsen: Temperatur, O2, Trübung
        results.extend(process_nlwkn())
    except Exception as e:
        print(f"      FEHLER Niedersachsen/NLWKN: {e}")
    try:                                   # Brandenburg: zehn automatische Gütestationen
        results.extend(process_brandenburg())
    except Exception as e:
        print(f"      FEHLER Brandenburg/LfU: {e}")
    try:                                   # Sachsen: fünf automatische Gütestationen
        results.extend(process_sachsen())
    except Exception as e:
        print(f"      FEHLER Sachsen/BfUL: {e}")
    try:                                   # Berlin: aktuelle Temperatur-, O2-, pH- und Leitfähigkeitswerte
        results.extend(process_berlin())
    except Exception as e:
        print(f"      FEHLER Berlin: {e}")
    try:                                   # Saarland: aktuelle Online-Gütesonden (SEBA/Uni Saarland)
        results.extend(process_saarland_live())
    except Exception as e:
        print(f"      FEHLER Saarland/SEBA: {e}")
    try:                                   # NRW (LANUK/HYWIS) – Wassertemperatur
        results.extend(process_nrw())
    except Exception as e:
        print(f"      FEHLER NRW: {e}")
    try:                                   # Undine (BfG) – Güte-Wassertemperatur Bundeswasserstraßen
        results.extend(process_undine())
    except Exception as e:
        print(f"      FEHLER Undine: {e}")
    try:                                   # BSH-Messnetz in Nord- und Ostsee
        results.extend(process_marnet_metadata())
    except Exception as e:
        print(f"      FEHLER BSH/MARNET: {e}")
    try:                                   # Schweiz: offizielle offene BAFU-GraphQL-API
        results.extend(process_switzerland_bafu())
    except Exception as e:
        print(f"      FEHLER Schweiz/BAFU: {e}")
    try:                                   # Niederlande inkl. Küste: offizielle RWS-DDAPI20/WFS
        results.extend(process_netherlands_rws())
    except Exception as e:
        print(f"      FEHLER Niederlande/RWS: {e}")
    try:                                   # Österreich: OGD/OGC/Landesfeeds; kein eHYD-Scraping
        from austria_sources import process_austria_sources
        results.extend(process_austria_sources())
    except Exception as e:
        print(f"      FEHLER Österreich gesamt: {e}")
    if not results:
        print("Keine Station erfolgreich abgerufen.")
        sys.exit(2)
    results=retain_cached_neighbor_networks(results)
    print(f"Schreibe wasserwerte.json ({len(results)} Station(en)) ...")
    write_json(results)
    print("Fertig.")


if __name__ == "__main__":
    main()
