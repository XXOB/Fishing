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

Gedacht fuer GitHub Actions (alle 6 h), laeuft aber auch lokal:
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
import urllib.request
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
GKD_MAX_NEW_COORDS = 200   # neue Koordinaten je Lauf aufloesen (danach gecacht)
GKD_MAX_AGE_DAYS   = 4     # nur Stationen mit halbwegs aktuellem Wert

BASE_DIR  = Path(__file__).resolve().parent
JSON_FILE = BASE_DIR / "wasserwerte.json"
GKD_COORDS_FILE = BASE_DIR / "gkd_coords.json"   # Cache: Stations-ID -> lat/lon
CSV_DIR   = BASE_DIR / "wasserwerte_csv"
CSV_DIR.mkdir(exist_ok=True)

# Messgroesse (aus Spalte "Bezeichnung") -> (Anzeige-Label, Icon, Nachkommastellen)
# Reihenfolge = Prioritaet: "sättigung" vor "sauerstoff" pruefen.
BEZ_MAP = [
    ("temperatur", ("Wassertemperatur", "\U0001F321️", 1)),
    ("sättigung",  ("O₂-Sättigung",     "\U0001FAE7", 0)),
    ("saettigung", ("O₂-Sättigung",     "\U0001FAE7", 0)),
    ("sauerstoff", ("Sauerstoff",       "\U0001FAE7", 1)),
    ("trüb",       ("Trübung",          "\U0001F32B️", 1)),
    ("trueb",      ("Trübung",          "\U0001F32B️", 1)),
    ("leitf",      ("Leitfähigkeit",    "⚡", 0)),
    ("ph",         ("pH-Wert",          "⚗️", 2)),
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
HIST_LABELS = {"Wassertemperatur", "O₂-Sättigung", "Trübung"}
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
    req = urllib.request.Request(url, headers={"User-Agent":"Mozilla/5.0 (DeepFish Wasserwerte)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", "replace")

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
            if r["val"] is None or r["dt"] is None: continue
            if (now - r["dt"]).days > GKD_MAX_AGE_DAYS: continue     # veraltet/offline
            coords=cache.get(r["id"])
            if not coords and new < GKD_MAX_NEW_COORDS:
                try: coords=resolve_gkd_coords(r["base"], cache); new+=1
                except Exception: coords=None
            if not coords: continue
            results.append({
                "id": r["base"], "name": r["name"], "lat": coords["lat"], "lon": coords["lon"], "river": r["river"],
                "updated": datetime.now(timezone.utc).astimezone().strftime("%d.%m.%Y %H:%M"),
                "items": [{"label":"Wassertemperatur", "value":fmt_value(r["val"],1), "unit":"°C",
                           "icon":"\U0001F321️", "time":r["dt"].strftime("%d.%m.%Y %H:%M")}],
                "history": {},
            })
    save_gkd_coords(cache)
    print(f"[Bayern/GKD] {len(results)} Stationen mit Werten (+{new} neue Koordinaten aufgeloest, {len(cache)} gecacht)")
    return results


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
        if val is None or dt is None or (now - dt).days > NID_MAX_AGE_DAYS:
            continue
        st = by_sid.get(sid)
        if st is None or any("sauerstoff" in i.get("label", "").lower()
                             for i in st.get("items", [])):
            continue
        st.setdefault("items", []).append({
            "label": "Sauerstoff (Tagesminimum)", "value": fmt_value(val, 2),
            "unit": "mg/l", "icon": "🫧", "time": dt.strftime("%d.%m.%Y")
        })
        added += 1
    print(f"[Bayern/NID] {added} automatische Gütestationen mit Sauerstoff ergänzt")
    return stations


# ---------------------------------------------------------- Berlin (Wasserportal) ----
# CORS ist geschlossen -> serverseitig. Koordinaten stehen als m.Point([E,N],pkz,name,gewaesser)
# (ETRS89/UTM33N) in der Kartenseite; aktuelle Temperaturwerte in der Tabellen-Seite.
BERLIN_KARTE   = "https://wasserportal.berlin.de/messwerte.php?anzeige=karte&thema=owt"
BERLIN_TABELLE = "https://wasserportal.berlin.de/messwerte.php?anzeige=tabelle&thema=owt"
BERLIN_MAX_AGE_H = 24

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

BERLIN_PT = re.compile(
    r"m\.Point\(\[\s*([\d.]+)\s*,\s*([\d.]+)\s*\]\)"
    r"[\s\S]{0,200}?pkz:\s*'([^']+)'"
    r"[\s\S]{0,120}?name:\s*'([^']*)'"
    r"[\s\S]{0,160}?gewaesser:\s*'([^']*)'")

def berlin_coords():
    """{pkz: {lat,lon,name,river}} aus der Kartenseite."""
    html=fetch_gkd_html(BERLIN_KARTE)
    coords={}
    for m in BERLIN_PT.finditer(html):
        pkz=m.group(3)
        if pkz in coords: continue
        try: lat,lon=utm33_to_wgs84(float(m.group(1)), float(m.group(2)))
        except Exception: continue
        coords[pkz]={"lat":round(lat,5), "lon":round(lon,5), "name":m.group(4), "river":m.group(5)}
    return coords

def process_berlin():
    coords=berlin_coords()
    html=fetch_gkd_html(BERLIN_TABELLE)
    now=datetime.now(); results=[]
    for row in re.split(r"<tr", html):
        mp=re.search(r"<td[^>]*>\s*<a[^>]*>\s*([0-9A-Za-z_]+)\s*</a>", row)
        if not mp: continue
        pkz=mp.group(1)
        cells=[re.sub(r"<[^>]+>"," ",c).replace("&nbsp;"," ").strip()
               for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        joined=" ".join(cells)
        md=re.search(r"(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2})", joined)
        mt=re.search(r"(-?\d+[.,]\d+)\s*°C", joined)          # Temperaturwert vor der Einheit
        if not md or not mt: continue
        dt=parse_dt(md.group(1)+" "+md.group(2))
        if not dt or (now-dt).total_seconds() > BERLIN_MAX_AGE_H*3600: continue
        c=coords.get(pkz)
        if not c: continue
        val=to_number(mt.group(1))
        if val is None: continue
        results.append({
            "id":"be-"+pkz, "name":(c["name"] or pkz), "lat":c["lat"], "lon":c["lon"], "river":c["river"],
            "updated": datetime.now(timezone.utc).astimezone().strftime("%d.%m.%Y %H:%M"),
            "items":[{"label":"Wassertemperatur", "value":fmt_value(val,1), "unit":"°C",
                      "icon":"\U0001F321️", "time":dt.strftime("%d.%m.%Y %H:%M")}],
            "history":{},
        })
    print(f"[Berlin] {len(results)} Stationen mit Wassertemperatur ({len(coords)} Koordinaten)")
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
                       "icon":"\U0001F321️", "time": dt.strftime("%d.%m.%Y %H:%M") if dt else ""}],
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
UNDINE_COORDS_FILE = Path("undine_coords.json")
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
                                      "icon":"\U0001F321️", "time":dt.strftime("%d.%m.%Y %H:%M") if dt else d.get("d","")})
            if o2_ok: items.append({"label":"Sauerstoff", "value":fmt_value(d["o2"],1), "unit":"mg/l",
                                    "icon":"\U0001FAE7", "time":dto.strftime("%d.%m.%Y %H:%M") if dto else d.get("d_o2","")})
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


# ------------------------------------------------------------------- Main -----
def write_json(stations):
    payload = {
        "updated": datetime.now(timezone.utc).astimezone().strftime("%d.%m.%Y %H:%M"),
        "stations": stations,
    }
    JSON_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


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
    try:                                   # Bayern: Temperatur (GKD) + Sauerstoff (NID)
        bayern = process_gkd_all()
        try:
            bayern = enrich_gkd_with_nid_oxygen(bayern)
        except Exception as e:
            print(f"      FEHLER Bayern/NID Sauerstoff: {e}")
        results.extend(bayern)
    except Exception as e:
        print(f"      FEHLER GKD: {e}")
    try:                                   # Berlin (Wasserportal) – Oberflächen-Wassertemperatur
        results.extend(process_berlin())
    except Exception as e:
        print(f"      FEHLER Berlin: {e}")
    try:                                   # NRW (LANUK/HYWIS) – Wassertemperatur
        results.extend(process_nrw())
    except Exception as e:
        print(f"      FEHLER NRW: {e}")
    try:                                   # Undine (BfG) – Güte-Wassertemperatur Bundeswasserstraßen
        results.extend(process_undine())
    except Exception as e:
        print(f"      FEHLER Undine: {e}")
    if not results:
        print("Keine Station erfolgreich abgerufen.")
        sys.exit(2)
    print(f"Schreibe wasserwerte.json ({len(results)} Station(en)) ...")
    write_json(results)
    print("Fertig.")


if __name__ == "__main__":
    main()
