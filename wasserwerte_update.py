#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
wasserwerte_update.py
---------------------
Holt die aktuellen Wasserqualitaets-Werte der Rheinwasser-Untersuchungsstation
Mainz-Wiesbaden aus dem RLP-Portal und schreibt sie ins Dashboard
(rhein-check-mainz.html).

Ablauf:
  1. Startet einen echten (headless) Chrome-Browser via Playwright.
  2. Oeffnet die Download-Seite der Station.
  3. Klickt auf "als CSV" und speichert die heruntergeladene Datei.
  4. Liest aus der CSV je Messgroesse den JEWEILS LETZTEN (aktuellsten) Wert.
  5. Schreibt die Werte zwischen die Marker /*WQ_DATA_START*/ ... /*WQ_DATA_END*/
     in die HTML-Datei. Beim naechsten Oeffnen zeigt das Dashboard die Zahlen.

EINRICHTUNG (einmalig, in der Eingabeaufforderung / PowerShell):
     pip install playwright
     playwright install chromium

AUSFUEHREN:
     python wasserwerte_update.py

ALLE 6 STUNDEN AUTOMATISCH (Windows-Aufgabenplanung, einmal ausfuehren):
     schtasks /Create /SC HOURLY /MO 6 /TN "RheinCheck Wasserwerte" ^
       /TR "python \"%CD%\wasserwerte_update.py\"" /ST 06:00
   (Pfad ggf. anpassen. /MO 6 = alle 6 Stunden.)
"""

import json
import re
import sys
import csv
import io
from pathlib import Path
from datetime import datetime

# ----------------------------------------------------------------------------
# Konfiguration
# ----------------------------------------------------------------------------
STATION_ID   = "2511510500"
DOWNLOAD_URL = f"https://geodaten-wasser.rlp-umwelt.de/gus/{STATION_ID}/download"

BASE_DIR   = Path(__file__).resolve().parent
HTML_FILE  = BASE_DIR / "rhein-check-mainz.html"      # Dashboard-Datei
CSV_DIR    = BASE_DIR / "wasserwerte_csv"             # Ablage der heruntergeladenen CSVs
CSV_DIR.mkdir(exist_ok=True)

# Zuordnung: Kennwort im Spaltennamen -> (Anzeige-Label, Standard-Einheit, Icon)
# Die Oberfläche verwendet einheitliche SVG-Symbole und keine Emojis.
# (Reihenfolge = Prioritaet; "saettigung" muss vor "sauerstoff" geprueft werden.)
PARAM_MAP = [
    ("temperatur",        ("Wassertemperatur", "°C",   "")),
    ("saettigung",        ("O₂-Sättigung", "%",   "")),
    ("sättigung",    ("O₂-Sättigung", "%",   "")),
    ("sauerstoff",        ("Sauerstoff",     "mg/l",        "")),
    ("trübung",      ("Trübung",   "",            "")),
    ("truebung",          ("Trübung",   "",            "")),
    ("leitf",             ("Leitfähigkeit", "µS/cm", "")),
    ("ph",                ("pH-Wert",        "",            "")),
]


# ----------------------------------------------------------------------------
# 1) CSV herunterladen (Browser-Automation)
# ----------------------------------------------------------------------------
def download_csv() -> Path:
    from playwright.sync_api import sync_playwright

    out = CSV_DIR / f"rust_mainz_{datetime.now():%Y%m%d_%H%M%S}.csv"
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(accept_downloads=True)
        page = ctx.new_page()
        print(f"[1/4] Oeffne {DOWNLOAD_URL}")
        page.goto(DOWNLOAD_URL, wait_until="networkidle", timeout=90_000)

        # evtl. Cookie-/Consent-Banner wegklicken (best effort)
        for label in ["Akzeptieren", "Alle akzeptieren", "Zustimmen",
                      "Einverstanden", "OK", "Accept"]:
            try:
                b = page.get_by_role("button", name=re.compile(label, re.I))
                if b.count() > 0 and b.first.is_visible():
                    b.first.click(timeout=2000)
                    break
            except Exception:
                pass

        # Auf die CSV-Schaltflaeche warten und klicken -> loest Download aus
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
        download = dl_info.value
        download.save_as(out)
        browser.close()
    print(f"      gespeichert: {out.name}")
    return out


# ----------------------------------------------------------------------------
# 2) CSV einlesen (Trennzeichen + Kodierung robust erkennen)
# ----------------------------------------------------------------------------
def read_table(path: Path):
    raw = None
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            raw = path.read_text(encoding=enc)
            break
        except Exception:
            continue
    if raw is None:
        raise RuntimeError("CSV konnte nicht gelesen werden.")

    sample = "\n".join(raw.splitlines()[:20])
    delim = ";"
    best = 0
    for d in (";", "\t", ","):
        c = sample.count(d)
        if c > best:
            best, delim = c, d

    rows = list(csv.reader(io.StringIO(raw), delimiter=delim))
    rows = [r for r in rows if any(c.strip() for c in r)]  # Leerzeilen raus
    return rows


def to_number(text: str):
    """Deutsche Zahl ('21,4' oder '1.234,5') -> float; sonst None."""
    t = text.strip().replace("\xa0", "").replace(" ", "")
    if not t or not re.search(r"\d", t):
        return None
    if "," in t:
        t = t.replace(".", "").replace(",", ".")
    try:
        return float(t)
    except ValueError:
        return None


def find_header(rows):
    """Kopfzeile = erste Zeile, die 'Datum'/'Zeit' oder einen Parameter enthaelt."""
    keys = ("datum", "zeit", "temperatur", "sauerstoff", "trüb", "trueb", "ph", "leitf")
    for i, r in enumerate(rows):
        low = " ".join(r).lower()
        if any(k in low for k in keys) and sum(1 for c in r if c.strip()) >= 2:
            return i
    return 0


def parse_latest(rows):
    """Gibt {spaltenname: (wert_text, float, zeit_text)} fuer den letzten Wert je Spalte."""
    h = find_header(rows)
    header = [c.strip() for c in rows[h]]
    data = rows[h + 1:]

    # Zeit-/Datumsspalten bestimmen
    date_idx = next((i for i, c in enumerate(header) if "datum" in c.lower()), None)
    time_idx = next((i for i, c in enumerate(header) if re.search(r"zeit|uhr", c.lower())), None)
    if date_idx is None:
        date_idx = 0  # Annahme: erste Spalte

    def row_time(r):
        parts = []
        if date_idx is not None and date_idx < len(r) and r[date_idx].strip():
            parts.append(r[date_idx].strip())
        if time_idx is not None and time_idx != date_idx and time_idx < len(r) and r[time_idx].strip():
            parts.append(r[time_idx].strip())
        return " ".join(parts)

    result = {}
    skip = {date_idx, time_idx}
    for ci, name in enumerate(header):
        if ci in skip or not name:
            continue
        for r in reversed(data):                    # von unten = aktuellster Wert
            if ci >= len(r):
                continue
            num = to_number(r[ci])
            if num is not None:
                result[name] = (r[ci].strip(), num, row_time(r))
                break
    return result


# ----------------------------------------------------------------------------
# 3) Spalten -> Dashboard-Kacheln
# ----------------------------------------------------------------------------
def map_param(colname):
    low = colname.lower()
    for key, (label, unit, icon) in PARAM_MAP:
        if key in low:
            # Einheit ggf. aus dem Header [..] uebernehmen
            m = re.search(r"[\[\(]([^\]\)]+)[\]\)]", colname)
            if m and m.group(1).strip():
                unit = m.group(1).strip()
            return label, unit, icon
    return None


def fmt_time(t: str) -> str:
    for fmt in ("%d.%m.%Y %H:%M", "%d.%m.%Y %H:%M:%S", "%Y-%m-%d %H:%M",
                "%d.%m.%Y", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(t.strip(), fmt).strftime("%d.%m.%Y %H:%M")
        except ValueError:
            continue
    return t.strip()


def build_items(latest: dict):
    items, seen = [], set()
    for col, (vtext, _num, t) in latest.items():
        m = map_param(col)
        if not m:
            continue
        label, unit, icon = m
        if label in seen:            # Duplikate (z.B. mehrere Temperatur-Spalten) ueberspringen
            continue
        seen.add(label)
        items.append({"label": label, "value": vtext, "unit": unit,
                      "icon": icon, "time": fmt_time(t)})
    # sinnvolle Reihenfolge
    order = ["Wassertemperatur", "Sauerstoff", "O₂-Sättigung",
             "Trübung", "pH-Wert", "Leitfähigkeit"]
    items.sort(key=lambda it: order.index(it["label"]) if it["label"] in order else 99)
    return items


# ----------------------------------------------------------------------------
# 4) HTML patchen
# ----------------------------------------------------------------------------
def patch_html(items):
    if not HTML_FILE.exists():
        raise FileNotFoundError(f"Dashboard nicht gefunden: {HTML_FILE}")
    html = HTML_FILE.read_text(encoding="utf-8")
    payload = {"updated": datetime.now().strftime("%d.%m.%Y %H:%M"), "items": items}
    block = ("/*WQ_DATA_START*/\nwindow.WQ_DATA = "
             + json.dumps(payload, ensure_ascii=False)
             + ";\n/*WQ_DATA_END*/")
    new_html, n = re.subn(r"/\*WQ_DATA_START\*/.*?/\*WQ_DATA_END\*/",
                          lambda _m: block, html, count=1, flags=re.S)
    if n == 0:
        raise RuntimeError("Marker /*WQ_DATA_START*/.../*WQ_DATA_END*/ nicht in der HTML gefunden.")
    HTML_FILE.write_text(new_html, encoding="utf-8")


# ----------------------------------------------------------------------------
def main():
    try:
        csv_path = download_csv()
    except Exception as e:
        print(f"FEHLER beim Download: {e}")
        print("Tipp: 'pip install playwright' und 'playwright install chromium' ausgefuehrt?")
        sys.exit(1)

    print("[3/4] Lese Werte aus der CSV ...")
    rows = read_table(csv_path)
    latest = parse_latest(rows)
    items = build_items(latest)

    if not items:
        print("      Keine bekannten Messgroessen erkannt. Kopf der CSV:")
        for r in rows[:8]:
            print("      | " + " | ".join(r))
        print("      -> Bitte diese Zeilen an Claude schicken, dann passe ich die Zuordnung an.")
        sys.exit(2)

    for it in items:
        print(f"      {it['label']}: {it['value']} {it['unit']}  (Stand {it['time']})")

    print("[4/4] Schreibe Werte ins Dashboard ...")
    patch_html(items)
    print("Fertig. Dashboard aktualisiert:", HTML_FILE.name)


if __name__ == "__main__":
    main()
