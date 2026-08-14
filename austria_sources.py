#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Amtliche bzw. öffentlich angebotene Wasser-Datenquellen aus Österreich.

Wichtig: Das eHYD-Webportal und dessen nicht als Download angebotene interne
Daten werden hier bewusst NICHT ausgelesen. Verwendet werden getrennt
veröffentlichte OGD-/JSON-/OGC-Downloads. Bei Quellen ohne eindeutige
Lizenzangabe wird dies im Datensatz markiert; die gewünschte schriftliche
Bestätigung kann später eingeholt werden.
"""

import io
import json
import math
import re
import unicodedata
import urllib.request
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timezone


UA = "Mozilla/5.0 (PetriKlar Wasserwerte; kontakt via GitHub XXOB/Fishing)"

BMLUK_PEGEL_URL = (
    "https://gis.lfrz.gv.at/api/geodata/i000501/ogc/features/v1/collections/"
    "i000501%3Apegel_aktuell/items?f=json&limit=10000"
)
NOE_MAPLIST_URL = "https://www.noel.gv.at/wasserstand/kidata/maplist/MapList.json"
OOE_WATERLEVEL_URL = "https://data.ooe.gv.at/files/hydro/HDOOE_Export_OG.zrxp"
OOE_WATERTEMP_URL = "https://data.ooe.gv.at/files/hydro/HDOOE_Export_WT.zrxp"
OOE_STATIONS_URL = "https://data.ooe.gv.at/files/hydro/ogw_liste.xlsx"
KTN_FLOW_URL = "https://info.ktn.gv.at/asp/hydro/daten/json/hdkaernten_abfluss.json"
KTN_LAKE_URL = "https://info.ktn.gv.at/asp/hydro/daten/json/hdkaernten_see.json"
SALZBURG_STATIONS_URL = (
    "https://www.salzburg.gv.at/ogd/943b7dda-5c3d-40d3-80de-f29a491a59fa/"
    "Abfluss_und_Seepegel.json"
)

# Wird zuerst aus dem österreichweiten OGC-Feed gefüllt. Landesfeeds können
# damit Messreihen (z. B. ZRXP) sicher über die HZB-Nummer georeferenzieren.
AT_META = {}


def _now_text():
    return datetime.now(timezone.utc).astimezone().strftime("%d.%m.%Y %H:%M")


def _fetch_bytes(url, timeout=90):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return response.read()


def _fetch_json(url):
    raw = _fetch_bytes(url)
    for enc in ("utf-8-sig", "utf-8", "cp1252", "latin1"):
        try:
            return json.loads(raw.decode(enc))
        except (UnicodeDecodeError, json.JSONDecodeError):
            pass
    raise ValueError("keine gültige JSON-Antwort")


def _decode(raw):
    for enc in ("utf-8-sig", "utf-8", "cp1252", "latin1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            pass
    return raw.decode("utf-8", "replace")


def _norm(value):
    s = unicodedata.normalize("NFKD", str(value or ""))
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z0-9]+", "", s)


def _pick(mapping, *keys):
    if not isinstance(mapping, dict):
        return ""
    low = {_norm(k): v for k, v in mapping.items()}
    for key in keys:
        value = low.get(_norm(key))
        if value not in (None, ""):
            return value
    return ""


def _number(value):
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(float(value)) else None
    s = str(value).strip().replace("\xa0", " ")
    if not s or s.lower() in ("null", "none", "nan", "-", "--"):
        return None
    s = re.sub(r"^(?:<|>|≤|≥|ca\.?|n\.\s*d\.)\s*", "", s, flags=re.I)
    m = re.search(r"[-+]?\d+(?:[.,]\d+)?", s)
    if not m:
        return None
    try:
        return float(m.group(0).replace(",", "."))
    except ValueError:
        return None


def _fmt(value, digits=1):
    n = _number(value)
    if n is None:
        return ""
    text = f"{n:.{digits}f}"
    if digits:
        text = text.rstrip("0").rstrip(".")
    return text.replace(".", ",")


def _time_text(value):
    if value in (None, ""):
        return ""
    s = str(value).strip()
    # ZRXP nutzt kompakte Zeitstempel. Diese vor den allgemeineren Formaten
    # behandeln, damit 12-stellige Werte nicht an der 14-stelligen Maske scheitern.
    for compact_fmt in ("%Y%m%d%H%M%S", "%Y%m%d%H%M"):
        try:
            dt = datetime.strptime(s, compact_fmt)
            return dt.strftime("%d.%m.%Y %H:%M")
        except ValueError:
            pass
    # ISO-Datum gut lesbar machen; unbekannte amtliche Formate unverändert lassen.
    for fmt in (
        "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S",
        "%d.%m.%Y %H:%M:%S", "%d.%m.%Y %H:%M", "%d.%m.%Y", "%Y-%m-%d",
    ):
        try:
            dt = datetime.strptime(s.replace("Z", "+00:00") if "%z" in fmt else s[:19], fmt)
            return dt.strftime("%d.%m.%Y %H:%M") if "%H" in fmt else dt.strftime("%d.%m.%Y")
        except ValueError:
            pass
    return s


def _iso_time(value):
    """Zeitstempel für die in Chart.js verwendeten historischen Reihen."""
    if value in (None, ""):
        return ""
    s = str(value).strip()
    for fmt in ("%Y%m%d%H%M%S", "%Y%m%d%H%M"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%dT%H:%M:%S")
        except ValueError:
            pass
    # Bereits gelieferte ISO-Werte unverändert nutzbar lassen.
    if re.match(r"^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2})?", s):
        return s.replace(" ", "T", 1)
    return s


def _coords_from_geometry(feature):
    geometry = feature.get("geometry") if isinstance(feature, dict) else None
    coords = geometry.get("coordinates") if isinstance(geometry, dict) else None
    if isinstance(coords, (list, tuple)) and len(coords) >= 2:
        return _normalize_coords(coords[0], coords[1])
    props = feature.get("properties", feature) if isinstance(feature, dict) else {}
    # Niederösterreich nennt den Längengrad schlicht "Long".
    lon = _pick(props, "lon", "lng", "long", "longitude", "laengengrad", "längengrad", "x")
    lat = _pick(props, "lat", "latitude", "breitengrad", "y")
    return _normalize_coords(lon, lat)


def _normalize_coords(x, y):
    x, y = _number(x), _number(y)
    if x is None or y is None:
        return None
    # Kärnten dokumentiert EPSG:3857. Andere Quellen liefern CRS84/WGS84.
    if abs(x) > 180 or abs(y) > 90:
        if abs(x) <= 20037509 and abs(y) <= 20048967:
            lon = x * 180.0 / 20037508.34
            lat = math.degrees(2 * math.atan(math.exp(y / 6378137.0)) - math.pi / 2)
            if 8.0 <= lon <= 18.0 and 45.0 <= lat <= 50.0:
                return lat, lon
        return None
    lon, lat = x, y
    if 8.0 <= lon <= 18.0 and 45.0 <= lat <= 50.0:
        return lat, lon
    if 8.0 <= lat <= 18.0 and 45.0 <= lon <= 50.0:
        return lon, lat
    return None


def _item(label, value, unit, time="", digits=1):
    item = {"label": label, "value": _fmt(value, digits), "unit": unit,
            "icon": "", "time": _time_text(time)}
    return item


def _empty_station(sid, name, lat, lon, river, src, source_url, license_text, attribution):
    return {
        "id": sid, "name": str(name or sid), "lat": round(float(lat), 6),
        "lon": round(float(lon), 6), "river": str(river or "Österreich"),
        "updated": _now_text(), "src": src, "source_url": source_url,
        "license": license_text, "attribution": attribution,
        "params": {"pegel": False, "wt": False, "o2": False, "tr": False},
        "items": [], "history": {},
    }


def process_bmluk_current():
    """Alle aktuellen österreichischen Pegel/Abflüsse aus dem offenen OGC-Feed."""
    obj = _fetch_json(BMLUK_PEGEL_URL)
    grouped = {}
    for feature in obj.get("features", []):
        p = feature.get("properties") or {}
        sid = str(_pick(p, "hzbnr", "id") or feature.get("id") or "").strip()
        coords = _coords_from_geometry(feature)
        if not sid or not coords:
            continue
        name = _pick(p, "messstelle", "name") or sid
        river = _pick(p, "gewaesser", "gewässer") or "Österreich"
        source_url = _pick(p, "internet", "url") or BMLUK_PEGEL_URL
        st = grouped.setdefault(sid, _empty_station(
            "at-bmluk-" + sid, name, coords[0], coords[1], river, "at-bmluk",
            source_url, "CC BY 4.0", "BMLUK – data.gv.at",
        ))
        AT_META[sid] = {"lat": coords[0], "lon": coords[1], "name": name,
                        "river": river, "source_url": source_url,
                        "state": _pick(p, "hydrodienst")}
        parameter = str(_pick(p, "parameter") or "").upper().strip()
        value = _pick(p, "wert", "value")
        unit = str(_pick(p, "einheit", "unit") or "")
        when = _pick(p, "zeitpunkt", "timestamp", "datum")
        if parameter == "W":
            st["items"].append(_item("Pegelstand", value, unit, when, 2))
            st["params"]["pegel"] = True
        elif parameter == "Q":
            st["items"].append(_item("Durchfluss", value, unit or "m³/s", when, 2))
            st["params"]["pegel"] = True
        if when:
            st["updated"] = _time_text(when)
    out = list(grouped.values())
    print(f"[Österreich/BMLUK OGC] {len(out)} aktuelle Pegel-/Abflussstationen")
    return out


def process_noe_live():
    """Niederösterreich: Temperatur, Wasserstand und Durchfluss aus dem Kartenfeed."""
    rows = _fetch_json(NOE_MAPLIST_URL)
    if isinstance(rows, dict):
        rows = rows.get("items") or rows.get("data") or rows.get("features") or []
    grouped = {}
    for raw in rows if isinstance(rows, list) else []:
        row = raw.get("properties", raw) if isinstance(raw, dict) else {}
        parameter = str(_pick(row, "Parameter") or "")
        plow = _norm(parameter)
        if "prognose" in plow:
            continue
        kind = ""
        if "wassertemperatur" in plow or plow in ("wt", "temperatur"):
            kind = "wt"
        elif "wasserstand" in plow or plow == "w":
            kind = "pegel"
        elif "durchfluss" in plow or plow == "q":
            kind = "q"
        if not kind:
            continue
        sid = str(_pick(row, "Stationnumber", "StationNumber", "hzbnr", "id") or "").strip()
        if not sid:
            continue
        coords = _coords_from_geometry(raw) if isinstance(raw, dict) else None
        meta = AT_META.get(sid, {})
        if not coords and meta:
            coords = (meta["lat"], meta["lon"])
        if not coords:
            continue
        name = _pick(row, "Stationname", "StationName", "messstelle") or meta.get("name") or sid
        river = _pick(row, "Rivername", "RiverName", "gewaesser") or meta.get("river") or "Niederösterreich"
        st = grouped.setdefault(sid, _empty_station(
            "at-noe-" + sid, name, coords[0], coords[1], river, "at-noe",
            "https://www.noe.gv.at/wasserstand/", "Bestätigung ausstehend",
            "Land Niederösterreich",
        ))
        value = _pick(row, "Value", "Wert")
        unit = str(_pick(row, "Unit", "Einheit") or "")
        when = _pick(row, "Timestamp", "Time", "Datum", "Date", "Messzeit")
        if kind == "wt":
            st["items"].append(_item("Wassertemperatur", value, unit or "°C", when, 1))
            st["params"]["wt"] = True
        elif kind == "pegel":
            st["items"].append(_item("Pegelstand", value, unit or "cm", when, 2))
            st["params"]["pegel"] = True
        else:
            st["items"].append(_item("Durchfluss", value, unit or "m³/s", when, 2))
            st["params"]["pegel"] = True
        if when:
            st["updated"] = _time_text(when)
    out = list(grouped.values())
    print(f"[Österreich/Niederösterreich] {len(out)} Live-Stationen")
    return out


def _xlsx_rows(raw):
    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        shared = []
        if "xl/sharedStrings.xml" in zf.namelist():
            root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            for si in root.findall("{*}si"):
                shared.append("".join(t.text or "" for t in si.iter() if t.tag.endswith("}t")))
        sheets = []
        names = sorted(n for n in zf.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml$", n))
        for name in names:
            root = ET.fromstring(zf.read(name)); matrix = []
            for row in root.findall(".//{*}row"):
                vals = {}; max_col = -1
                for cell in row.findall("{*}c"):
                    ref = cell.attrib.get("r", "")
                    letters = re.match(r"[A-Z]+", ref)
                    if not letters:
                        continue
                    col = 0
                    for ch in letters.group(0):
                        col = col * 26 + ord(ch) - 64
                    col -= 1; max_col = max(max_col, col)
                    typ = cell.attrib.get("t", "")
                    node = cell.find("{*}v"); val = node.text if node is not None else ""
                    if typ == "s" and val:
                        try: val = shared[int(val)]
                        except (ValueError, IndexError): pass
                    elif typ == "inlineStr":
                        val = "".join(t.text or "" for t in cell.iter() if t.tag.endswith("}t"))
                    vals[col] = val
                if max_col >= 0:
                    matrix.append([vals.get(i, "") for i in range(max_col + 1)])
            if matrix:
                sheets.append(matrix)
        return sheets


def _ooe_station_meta():
    """HZB-/Namensindex aus der offiziellen OÖ-Messstellenübersicht."""
    by_id, by_name = {}, {}
    for rows in _xlsx_rows(_fetch_bytes(OOE_STATIONS_URL)):
        header_i = next((i for i, row in enumerate(rows[:30])
                         if any("messstell" in _norm(v) for v in row)), None)
        if header_i is None:
            continue
        header = [_norm(v) for v in rows[header_i]]
        for values in rows[header_i + 1:]:
            row = {header[i]: values[i] if i < len(values) else "" for i in range(len(header))}
            sid = str(next((v for k, v in row.items()
                            if "hzb" in k or "stationsnummer" in k
                            or "messstellennummer" in k), "")).strip()
            name = next((v for k, v in row.items()
                         if k == "name" or ("messstell" in k and
                                             ("name" in k or "bezeichnung" in k))), "")
            river = next((v for k, v in row.items() if "gewasser" in k or "fluss" in k), "")
            lat = next((v for k, v in row.items()
                        if k in ("lat", "latitude", "breitengrad")
                        or "geogrbreite" in k), "")
            lon = next((v for k, v in row.items()
                        if k in ("lon", "lng", "long", "longitude", "langengrad")
                        or "geogrlange" in k), "")
            coords = _normalize_coords(lon, lat)
            meta = {"name": name, "river": river}
            if coords:
                meta.update({"lat": coords[0], "lon": coords[1]})
            if sid:
                by_id[re.sub(r"\.0$", "", sid)] = meta
            if name:
                by_name[_norm(name)] = meta
    return by_id, by_name


def _zrxp_series(raw):
    """Minimaler ZRXP-2/3-Parser für die amtlichen OÖ-Sammeldateien."""
    out, header, values = [], {}, []

    def flush():
        nonlocal header, values
        if values and (header.get("SANR") or header.get("SNAME")):
            invalid = _number(header.get("RINVAL"))
            usable = [(t, v) for t, v in values if invalid is None or abs(v - invalid) > 1e-12]
            if usable:
                out.append({"header": dict(header), "latest": usable[-1], "values": usable[-192:]})
        header, values = {}, []

    for line in _decode(raw).splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("#"):
            if values:
                flush()
            for part in re.split(r"(?:\|\*\||;\*;)", line.lstrip("#")):
                part = part.strip()
                if not part:
                    continue
                # Längere Schlüssel zuerst, damit z. B. SNAME nicht als SANR zerlegt wird.
                m = re.match(r"(ZRXPVERSION|ZRXPMODE|ZRXPCREATOR|REXCHANGE|RTIMELVL|LAYOUT|RINVAL|SANR|SNAME|SWATER|CUNIT|CNAME|TZ)(.*)", part)
                if m:
                    header[m.group(1)] = m.group(2).strip()
            continue
        cols = re.split(r"[;\s]+", line)
        if len(cols) < 2 or not re.fullmatch(r"\d{8,14}", cols[0]):
            continue
        value = _number(cols[1])
        if value is not None:
            values.append((cols[0], value))
    flush()
    return out


def process_ooe_live():
    by_id, by_name = {}, {}
    try:
        by_id, by_name = _ooe_station_meta()
    except Exception as exc:
        print(f"      OÖ Messstellenübersicht: {exc}")
    grouped = {}
    for url, kind in ((OOE_WATERLEVEL_URL, "pegel"), (OOE_WATERTEMP_URL, "wt")):
        for series in _zrxp_series(_fetch_bytes(url)):
            h = series["header"]
            sid = str(h.get("SANR") or h.get("REXCHANGE") or "").strip()
            name = h.get("SNAME") or sid
            meta = AT_META.get(sid) or by_id.get(sid) or by_name.get(_norm(name)) or {}
            if not meta.get("lat"):
                continue
            river = h.get("SWATER") or meta.get("river") or "Oberösterreich"
            st = grouped.setdefault(sid or _norm(name), _empty_station(
                "at-ooe-" + (sid or _norm(name)), name or meta.get("name"), meta["lat"],
                meta["lon"], river, "at-ooe", url, "CC BY 4.0",
                "Land Oberösterreich – data.gv.at",
            ))
            stamp, value = series["latest"]
            unit = h.get("CUNIT") or ("°C" if kind == "wt" else "cm")
            if kind == "wt":
                st["items"].append(_item("Wassertemperatur", value, unit, stamp, 1))
                st["params"]["wt"] = True
                st["history"]["Wassertemperatur"] = [
                    {"t": _iso_time(t), "v": v} for t, v in series["values"]
                ]
            else:
                st["items"].append(_item("Pegelstand", value, unit, stamp, 2))
                st["params"]["pegel"] = True
            st["updated"] = _time_text(stamp)
    out = list(grouped.values())
    print(f"[Österreich/Oberösterreich] {len(out)} Pegel-/Temperaturstationen")
    return out


def process_kaernten_live():
    grouped = {}
    for url in (KTN_FLOW_URL, KTN_LAKE_URL):
        obj = _fetch_json(url)
        features = obj.get("features", []) if isinstance(obj, dict) else obj
        for feature in features if isinstance(features, list) else []:
            p = feature.get("properties") or {}
            coords = _coords_from_geometry(feature)
            if not coords:
                continue
            sid = str(_pick(p, "hzbnr", "id") or feature.get("id") or "").strip()
            if not sid:
                continue
            name = _pick(p, "name", "messstelle") or sid
            river = _pick(p, "gewaesser", "gewässer", "flussgebiet") or "Kärnten"
            st = grouped.setdefault(sid, _empty_station(
                "at-ktn-" + sid, name, coords[0], coords[1], river, "at-ktn", url,
                "CC BY 4.0", "Land Kärnten – data.gv.at",
            ))
            definitions = (
                ("pegel", "Pegelstand", ("letzter_wert_w", "wert_w"),
                 ("letzter_wert_w_date", "wert_w_date"), "cm", 2),
                ("q", "Durchfluss", ("letzter_wert_q", "wert_q"),
                 ("letzter_wert_q_date", "wert_q_date"), "m³/s", 2),
                ("wt", "Wassertemperatur", ("letzter_wert_wt", "wert_wt"),
                 ("letzter_wert_wt_date", "wert_wt_date"), "°C", 1),
            )
            for kind, label, value_keys, time_keys, default_unit, digits in definitions:
                value = _pick(p, *value_keys)
                if _number(value) is None:
                    continue
                when = _pick(p, *time_keys)
                units = p.get("einheiten") if isinstance(p.get("einheiten"), dict) else {}
                unit = _pick(units, kind, label) or default_unit
                st["items"].append(_item(label, value, unit, when, digits))
                st["params"]["wt" if kind == "wt" else "pegel"] = True
                if when:
                    st["updated"] = _time_text(when)
    out = list(grouped.values())
    print(f"[Österreich/Kärnten] {len(out)} Pegel-/Temperaturstationen")
    return out


def process_salzburg_open_data():
    """Offener Salzburger Stations-JSON; übernimmt auch alle enthaltenen letzten Werte."""
    obj = _fetch_json(SALZBURG_STATIONS_URL)
    features = obj.get("features", []) if isinstance(obj, dict) else obj
    out = []
    for feature in features if isinstance(features, list) else []:
        p = feature.get("properties", feature) if isinstance(feature, dict) else {}
        coords = _coords_from_geometry(feature)
        if not coords:
            continue
        sid = str(_pick(p, "hzbnr", "stationnumber", "id") or feature.get("id") or "").strip()
        name = _pick(p, "messstelle", "name", "pegelname") or sid
        river = _pick(p, "gewaesser", "gewässer", "rivername", "see") or "Salzburg"
        st = _empty_station(
            "at-sbg-" + (sid or _norm(name)), name, coords[0], coords[1], river,
            "at-salzburg", SALZBURG_STATIONS_URL, "Bestätigung ausstehend", "Land Salzburg",
        )
        # Feldnamen des ArcGIS-Exports können sich ändern; deshalb semantisch suchen.
        for key, value in p.items():
            low = _norm(key)
            if _number(value) is None:
                continue
            when = _pick(p, key + "_datum", key + "_zeit", "zeitpunkt", "datum")
            if "wassertemperatur" in low or low in ("wt", "temperaturwasser"):
                st["items"].append(_item("Wassertemperatur", value, "°C", when, 1))
                st["params"]["wt"] = True
            elif "wasserstand" in low or low in ("pegelstand", "w"):
                st["items"].append(_item("Pegelstand", value, "cm", when, 2))
                st["params"]["pegel"] = True
            elif "durchfluss" in low or low == "q":
                st["items"].append(_item("Durchfluss", value, "m³/s", when, 2))
                st["params"]["pegel"] = True
        # Auch reine Stationspunkte sind erwünscht; der nationale Feed ergänzt aktuelle Pegel.
        if not st["items"]:
            st["params"]["pegel"] = True
        out.append(st)
    print(f"[Österreich/Salzburg OGD] {len(out)} Abfluss-/Seepegel")
    return out


def process_austria_sources():
    """Alle aktivierten Österreich-Adapter; eine defekte Quelle stoppt keine andere."""
    out = []
    processors = (
        ("BMLUK OGC", process_bmluk_current),
        ("Niederösterreich", process_noe_live),
        ("Oberösterreich", process_ooe_live),
        ("Kärnten", process_kaernten_live),
        ("Salzburg", process_salzburg_open_data),
    )
    for name, processor in processors:
        try:
            out.extend(processor())
        except Exception as exc:
            print(f"      FEHLER Österreich/{name}: {exc}")
    print(f"[Österreich gesamt] {len(out)} Datensätze aus offenen/öffentlichen Alternativquellen")
    return out
