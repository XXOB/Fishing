#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_wasserwerte.py
--------------------
Holt die aktuellen Wasserqualitaets-Werte der Rheinwasser-Untersuchungsstation
Mainz-Wiesbaden aus dem RLP-Portal und schreibt sie als wasserwerte.json.
 
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
from datetime import datetime, timezone
 
STATION_ID   = "2511510500"
DOWNLOAD_URL = f"https://geodaten-wasser.rlp-umwelt.de/gus/{STATION_ID}/download"
 
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
def download_csv() -> Path:
    from playwright.sync_api import sync_playwright
 
    out = CSV_DIR / f"rust_mainz_{datetime.now():%Y%m%d_%H%M%S}.csv"
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(accept_downloads=True)
        page = ctx.new_page()
        print(f"[1/4] Oeffne {DOWNLOAD_URL}")
        page.goto(DOWNLOAD_URL, wait_until="networkidle", timeout=90_000)
 
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
 
 
# ------------------------------------------------------------------- Main -----
def write_json(items):
    payload = {
        "updated": datetime.now(timezone.utc).astimezone().strftime("%d.%m.%Y %H:%M"),
        "station": "Rhein Mainz-Wiesbaden",
        "items": items,
    }
    JSON_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
 
 
def main():
    try:
        csv_path = download_csv()
    except Exception as e:
        print(f"FEHLER beim Download: {e}")
        sys.exit(1)
 
    print("[3/4] Lese Werte aus der CSV ...")
    rows = read_table(csv_path)
    items = build_items(parse_latest(rows))
 
    if not items:
        print("      Keine bekannten Messgroessen erkannt. Kopf der CSV:")
        for r in rows[:8]:
            print("      | " + " | ".join(r))
        sys.exit(2)
 
    for it in items:
        print(f"      {it['label']}: {it['value']} {it['unit']}  (Stand {it['time']})")
 
    print("[4/4] Schreibe wasserwerte.json ...")
    write_json(items)
    print("Fertig.")

if __name__ == "__main__":
    main()
