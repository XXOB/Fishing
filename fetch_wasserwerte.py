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

BASE_DIR  = Path(__file__).resolve().parent
JSON_FILE = BASE_DIR / "wasserwerte.json"
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
    for st in HESSEN_STATIONS:             # Hessen (HLNUG)
        try:
            results.append(process_hessen(st))
        except Exception as e:
            print(f"      FEHLER bei {st['name']}: {e}")
    if not results:
        print("Keine Station erfolgreich abgerufen.")
        sys.exit(2)
    print(f"Schreibe wasserwerte.json ({len(results)} Station(en)) ...")
    write_json(results)
    print("Fertig.")


if __name__ == "__main__":
    main()
