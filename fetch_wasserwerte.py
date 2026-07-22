#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_wasserwerte.py
--------------------
Holt die aktuellen Wasserqualitaets-Werte der Rheinwasser-Untersuchungsstation
Mainz-Wiesbaden aus dem RLP-Portal und schreibt sie als wasserwerte.json.

Gedacht fuer den Betrieb in GitHub Actions (alle 6 Stunden), funktioniert aber
auch lokal. Ergebnis (wasserwerte.json) wird vom Dashboard (gleiche Herkunft)
geladen -> laeuft in jedem Browser, ohne Erweiterung.

Ablauf:
  1. Headless-Chromium via Playwright oeffnen.
  2. Download-Seite der Station laden, "als CSV" klicken, Datei speichern.
  3. Je Messgroesse den letzten (aktuellsten) Wert auslesen.
  4. wasserwerte.json schreiben: {"updated": "...", "items": [ ... ]}.

Lokal testen:
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

BASE_DIR   = Path(__file__).resolve().parent
JSON_FILE  = BASE_DIR / "wasserwerte.json"
CSV_DIR    = BASE_DIR / "wasserwerte_csv"
CSV_DIR.mkdir(exist_ok=True)

# Kennwort im Spaltennamen -> (Anzeige-Label, Standard-Einheit, Icon)
# Reihenfolge = Prioritaet; "saettigung" vor "sauerstoff" pruefen.
PARAM_MAP = [
    ("temperatur", ("Wassertemperatur", "°C",  "\U0001F321️")),
    ("saettigung", ("O₂-Sättigung",     "%",    "\U0001FAE7")),
    ("sättigung",  ("O₂-Sättigung",     "%",    "\U0001FAE7")),
    ("sauerstoff", ("Sauerstoff",       "mg/l", "\U0001FAE7")),
    ("trübung",    ("Trübung",          "",     "\U0001F32B️")),
    ("truebung",   ("Trübung",          "",     "\U0001F32B️")),
    ("leitf",      ("Leitfähigkeit",    "µS/cm","⚡")),
    ("ph",         ("pH-Wert",          "",     "⚗️")),
]


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
    keys = ("datum", "zeit", "temperatur", "sauerstoff", "trüb", "trueb", "ph", "leitf")
    for i, r in enumerate(rows):
        low = " ".join(r).lower()
        if any(k in low for k in keys) and sum(1 for c in r if c.strip()) >= 2:
            return i
    return 0


def parse_latest(rows):
    h = find_header(rows)
    header = [c.strip() for c in rows[h]]
    data = rows[h + 1:]
    date_idx = next((i for i, c in enumerate(header) if "datum" in c.lower()), None)
    time_idx = next((i for i, c in enumerate(header) if re.search(r"zeit|uhr", c.lower())), None)
    if date_idx is None:
        date_idx = 0

    def row_time(r):
        parts = []
        if date_idx is not None and date_idx < len(r) and r[date_idx].strip():
            parts.append(r[date_idx].strip())
        if time_idx is not None and time_idx != date_idx and time_idx < len(r) and r[time_idx].strip():
            parts.append(r[time_idx].strip())
        return " ".join(parts)

    result, skip = {}, {date_idx, time_idx}
    for ci, name in enumerate(header):
        if ci in skip or not name:
            continue
        for r in reversed(data):
            if ci >= len(r):
                continue
            if to_number(r[ci]) is not None:
                result[name] = (r[ci].strip(), row_time(r))
                break
    return result


def map_param(colname):
    low = colname.lower()
    for key, (label, unit, icon) in PARAM_MAP:
        if key in low:
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
    for col, (vtext, t) in latest.items():
        m = map_param(col)
        if not m:
            continue
        label, unit, icon = m
        if label in seen:
            continue
        seen.add(label)
        items.append({"label": label, "value": vtext, "unit": unit,
                      "icon": icon, "time": fmt_time(t)})
    order = ["Wassertemperatur", "Sauerstoff", "O₂-Sättigung",
             "Trübung", "pH-Wert", "Leitfähigkeit"]
    items.sort(key=lambda it: order.index(it["label"]) if it["label"] in order else 99)
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
