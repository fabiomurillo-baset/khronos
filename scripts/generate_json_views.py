"""
Build the compact JSON views consumed by cartago-web from the Gemini extraction output.

Outputs (all minified) into cartago-web/public/data/:
  events.json   - {"generated", "counts", "volumes", "events": [ {i, y, yi, d, p, l, g, gl, s}, ... ]}
                    i  : event id (source order == chronological order of the index)
                    y  : year (int) or null
                    yi : 1 when the year was inferred from the previous dated entry
                    d  : day/month string or null
                    p  : people involved
                    l  : locations mentioned
                    g  : [lat, lng] of the first location with known coordinates (absent if none)
                    gl : canonical name of that location
  text_en.json  - array of English summaries aligned with events[]
  text_es.json  - array of Spanish summaries aligned with events[] (null when not translated)

Run:  python scripts/generate_json_views.py
"""
import json
import os
import re
import unicodedata
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
GEMINI_DIR = os.path.join(HERE, "data", "gemini_output")
EVENTS_FILE = os.path.join(GEMINI_DIR, "gemini_events.jsonl")
# Community corrections accepted through pull requests (one JSON object per line):
#   {"id": 7, "record": 24, "field": "year", "to": 1608, "from": 1607, "reason": "...", "evidence": [...], "by": "...", "pr": 12}
# field is one of: year, date, people, locations, summary_en, summary_es.
CORRECTIONS_FILE = os.path.join(os.path.dirname(GEMINI_DIR), "corrections.jsonl")
# Record -> source page in the printed volumes (built by link_sources.py).
SOURCES_FILE = os.path.join(os.path.dirname(GEMINI_DIR), "sources.json")
# Other ingested works (manuscripts transcribed with transcribe_pages.py); each becomes a collection.
COLLECTIONS_FILE = os.path.join(os.path.dirname(GEMINI_DIR), "collections.json")
SOURCES_DIR = os.path.join(os.path.dirname(GEMINI_DIR), "sources")
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
EVENTS_ES_FILE = os.path.join(GEMINI_DIR, "gemini_events_es.jsonl")
OUTPUT_DIR = os.path.join(HERE, "..", "cartago-web", "public", "data")

# --------------------------------------------------------------------------------------
# Gazetteer: canonical name -> (lat, lng).  Keys are matched after normalize().
# Colonial-era places of the Province of Costa Rica, the Kingdom of Guatemala and Spain.
# --------------------------------------------------------------------------------------
GAZETTEER = {
    # Costa Rica - Central Valley
    "Cartago": (9.8644, -83.9194),
    "Agua Caliente": (9.8420, -83.9280),
    "Taras": (9.8800, -83.9170),
    "Quircot": (9.8830, -83.9440),
    "Cot": (9.9010, -83.9000),
    "Tobosi": (9.8290, -83.9620),
    "Purires": (9.8010, -83.9790),
    "Ujarrás": (9.8290, -83.8290),
    "Orosi": (9.7970, -83.8530),
    "Paraíso": (9.8380, -83.8660),
    "Tucurrique": (9.8530, -83.7280),
    "Atirro": (9.8640, -83.6510),
    "Turrialba": (9.9050, -83.6830),
    "Reventazón": (9.9000, -83.6000),
    "Tres Ríos": (9.9050, -83.9870),
    "Curridabat": (9.9180, -84.0300),
    "San José": (9.9330, -84.0800),
    "Mata Redonda": (9.9350, -84.1000),
    "Aserrí": (9.8650, -84.1000),
    "Escazú": (9.9180, -84.1400),
    "Santa Ana": (9.9330, -84.1800),
    "Pacaca": (9.9140, -84.3200),
    "Tibás": (9.9500, -84.0800),
    "Heredia": (9.9980, -84.1170),
    "Barva": (10.0880, -84.1230),
    "Chircagres": (10.0300, -84.1500),
    "Río Virilla": (9.9950, -84.1500),
    "Río Segundo": (10.0000, -84.1900),
    "Alajuela": (10.0160, -84.2120),
    "Quebrada Seca": (9.9900, -84.1000),
    "La Candelaria": (9.7300, -84.1000),
    "El Tejar": (9.8450, -83.9450),
    "Toyogres": (9.8700, -83.9000),
    "Poás": (10.0800, -84.2300),
    "Valle Hermoso": (9.8400, -83.8700),
    # Costa Rica - Pacific and Guanacaste
    "Esparza": (9.9900, -84.6700),
    "Landecho": (9.9800, -84.6000),
    "Caldera": (9.9100, -84.7200),
    "Río Grande": (9.8800, -84.5500),
    "Puntarenas": (9.9760, -84.8380),
    "Nicoya": (10.1480, -85.4520),
    "Bagaces": (10.5260, -85.2540),
    "Miravalles": (10.7500, -85.1500),
    "Quepo": (9.4300, -84.1600),
    "Boruca": (9.0000, -83.3300),
    "Térraba": (9.0100, -83.2800),
    # Costa Rica - Caribbean
    "Matina": (10.0000, -83.2900),
    "Barbilla": (9.9800, -83.4200),
    "Suerre": (10.3000, -83.4000),
    "Talamanca": (9.6000, -82.9000),
    "Chirripó": (9.7800, -83.5000),
    "Punta Blanca": (10.1000, -83.3500),
    # Nicaragua
    "León": (12.4350, -86.8780),
    "Granada": (11.9340, -85.9560),
    "Rivas": (11.4370, -85.8260),
    "Masaya": (11.9740, -86.0940),
    "Realejo": (12.5400, -87.1700),
    "Nicaragua": (12.1100, -86.2400),
    # Panama / Tierra Firme
    "Panamá": (8.9800, -79.5200),
    "Portobelo": (9.5540, -79.6550),
    "Santiago de Veraguas": (8.1000, -80.9800),
    "Villa de los Santos": (7.9400, -80.4200),
    "Chiriquí": (8.4300, -82.4300),
    "Natá": (8.3300, -80.5200),
    # Guatemala / Central America
    "Santiago de Guatemala": (14.5570, -90.7330),
    "Nueva Guatemala": (14.6340, -90.5070),
    "San Salvador": (13.6900, -89.1900),
    "Sonsonate": (13.7200, -89.7200),
    "Comayagua": (14.4600, -87.6400),
    "Tegucigalpa": (14.0720, -87.1920),
    "Chiapa": (16.7500, -93.1200),
    # Rest of the Americas
    "Cartagena de Indias": (10.3910, -75.4790),
    "Lima": (-12.0460, -77.0430),
    "La Habana": (23.1130, -82.3670),
    "México": (19.4330, -99.1330),
    "Puebla": (19.0400, -98.2000),
    "Quito": (-0.1800, -78.4700),
    "Santa Fe de Bogotá": (4.7110, -74.0720),
    "Veracruz": (19.1900, -96.1500),
    "Santo Domingo": (18.4860, -69.9310),
    # Spain and Europe
    "Madrid": (40.4168, -3.7038),
    "Sevilla": (37.3890, -5.9840),
    "Cádiz": (36.5270, -6.2880),
    "Málaga": (36.7200, -4.4200),
    "Granada (España)": (37.1770, -3.5990),
    "Extremadura": (39.4700, -6.3700),
    "Castilla": (41.6500, -4.7200),
    "Burgos": (42.3400, -3.7000),
    "Galicia": (42.8800, -8.5400),
    "Navarra": (42.8100, -1.6400),
    "Vizcaya": (43.2600, -2.9300),
    "Asturias": (43.3600, -5.8500),
    "Toledo": (39.8600, -4.0200),
    "Córdoba": (37.8880, -4.7790),
    "Valencia": (39.4700, -0.3760),
    "Barcelona": (41.3870, 2.1700),
    "Canarias": (28.4600, -16.2500),
    "Lisboa": (38.7220, -9.1390),
    "Flandes": (50.8500, 4.3500),
    "Roma": (41.9000, 12.5000),
}

# Alias (normalized) -> canonical gazetteer key
ALIASES = {
    # "this city" in a Cartago notarial index is Cartago
    "esta ciudad": "Cartago", "this city": "Cartago", "esta provincia": "Cartago",
    "costa rica": "Cartago", "provincia de costa rica": "Cartago", "convento de san francisco": "Cartago",
    "ciudad de cartago": "Cartago", "cartago (costa rica)": "Cartago",
    "barba": "Barva", "san bartolome de barba": "Barva", "barba valley": "Barva",
    "villa vieja": "Heredia", "cubujuqui": "Heredia", "inmaculada concepcion de cubujuqui": "Heredia",
    "villa nueva": "San José", "villa nueva de la boca del monte": "San José",
    "villanueva": "San José", "san jose de la boca del monte": "San José", "boca del monte": "San José",
    "la mata redonda": "Mata Redonda",
    "ujarraz": "Ujarrás", "ujarras": "Ujarrás", "ujarraz valley": "Ujarrás",
    "curriraba": "Curridabat", "currirava": "Curridabat", "curridava": "Curridabat",
    "pacacua": "Pacaca", "pacaqua": "Pacaca",
    "quirco": "Quircot",
    "escasu": "Escazú", "escazu": "Escazú",
    "santana": "Santa Ana",
    "tibas": "Tibás",
    "aserri": "Aserrí", "adcerri": "Aserrí", "aserri valley": "Aserrí",
    "tres rios": "Tres Ríos",
    "matina valley": "Matina", "rio matina": "Matina", "malina": "Matina", "puerto de matina": "Matina",
    "barbilla valley": "Barbilla",
    "puerto de suerre": "Suerre",
    "landecho valley": "Landecho",
    "rio grande": "Río Grande", "rio grande de tarcoles": "Río Grande",
    "rio del virilla": "Río Virilla", "virilla": "Río Virilla",
    "rio segundo": "Río Segundo",
    "chirripo": "Chirripó",
    "quepos": "Quepo",
    "terraba": "Térraba",
    "esparsa": "Esparza", "espiritu santo de esparza": "Esparza", "espiritu santo": "Esparza",
    "nicoya (guanacaste)": "Nicoya",
    # Nicaragua
    "leon": "León", "leon (nicaragua)": "León", "leon de nicaragua": "León", "leon (nic)": "León",
    "leon (nic.)": "León", "leon, nicaragua": "León", "ciudad de leon": "León",
    "granada (nicaragua)": "Granada", "granada (nic)": "Granada", "granada (nic.)": "Granada",
    "granada, nicaragua": "Granada", "granada de nicaragua": "Granada",
    "villa de nicaragua": "Rivas", "nicaragua (villa)": "Rivas", "villa de rivas": "Rivas",
    "el realejo": "Realejo", "puerto del realejo": "Realejo",
    # Panama
    "panama": "Panamá", "ciudad de panama": "Panamá", "tierra firme": "Panamá",
    "reino de tierra firme": "Panamá", "panama (tierra firme)": "Panamá",
    "puerto belo": "Portobelo", "san felipe de puerto belo": "Portobelo",
    "san felipe de portobelo": "Portobelo", "puertobelo": "Portobelo",
    "santiago de veragua": "Santiago de Veraguas", "veragua": "Santiago de Veraguas",
    "veraguas": "Santiago de Veraguas", "chiriqui": "Chiriquí", "los santos": "Villa de los Santos",
    "nata": "Natá",
    # Guatemala
    "guatemala": "Santiago de Guatemala", "ciudad de guatemala": "Santiago de Guatemala",
    "reino de guatemala": "Santiago de Guatemala", "audiencia de guatemala": "Santiago de Guatemala",
    "nueva guatemala de la asuncion": "Nueva Guatemala",
    "chiapas": "Chiapa",
    # Americas
    "cartagena": "Cartagena de Indias", "peru": "Lima", "ciudad de los reyes": "Lima",
    "la havana": "La Habana", "habana": "La Habana",
    "mexico": "México", "nueva espana": "México", "ciudad de mexico": "México",
    "santa fe": "Santa Fe de Bogotá", "bogota": "Santa Fe de Bogotá",
    # Spain
    "espana": "Madrid", "spain": "Madrid", "reinos de castilla": "Castilla", "castilla la vieja": "Burgos",
    "castilla la nueva": "Toledo", "andalucia": "Sevilla",
    "islas canarias": "Canarias", "tenerife": "Canarias",
    "portugal": "Lisboa", "flanders": "Flandes", "rome": "Roma",
    "granada (espana)": "Granada (España)",
    # misc frequent variants
    "barba valleys": "Barva", "cartago province": "Cartago", "ejidos de esta ciudad": "Cartago",
    "calle real": "Cartago", "real audiencia": "Santiago de Guatemala", "reino del peru": "Lima",
    "virilla river": "Río Virilla", "rio toyogres": "Toyogres", "poas": "Poás",
    "san luis de aserri": "Aserrí", "san antonio currirava": "Curridabat",
    "san mateo de chirripo": "Chirripó", "sabana grande": "Cartago",
}

STRIP_PREFIXES = (
    "valle de la ", "valle del ", "valle de ", "pueblo de ", "puerto de ", "villa de ", "ciudad de ",
    "provincia de ", "reino de ", "rio de ", "rio ", "la ciudad de ", "el pueblo de ",
    "la provincia de ", "the valley of ", "valley of ", "town of ", "city of ", "province of ",
)
STRIP_SUFFIXES = (" valley", " (costa rica)", " (c.r.)", ", costa rica")

# normalized canonical name -> canonical key (built once)
_CANON_BY_NORM = {}


def normalize(name: str) -> str:
    s = unicodedata.normalize("NFD", name or "")
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    s = s.lower().strip().strip(".,;:")
    s = re.sub(r"\s+", " ", s)
    return s


def _resolve(norm):
    if norm in ALIASES:
        canon = ALIASES[norm]
        return canon, GAZETTEER[canon]
    canon = _CANON_BY_NORM.get(norm)
    if canon:
        return canon, GAZETTEER[canon]
    return None


def lookup_location(name: str):
    """Return (canonical_name, (lat, lng)) or None."""
    if not name:
        return None
    if not _CANON_BY_NORM:
        for canon in GAZETTEER:
            _CANON_BY_NORM[normalize(canon)] = canon
    norm = normalize(name)
    hit = _resolve(norm)
    if hit:
        return hit
    # strip common suffixes / prefixes / parenthetical qualifiers and retry
    stripped = norm
    for suf in STRIP_SUFFIXES:
        if stripped.endswith(suf):
            stripped = stripped[: -len(suf)].strip()
    for pre in STRIP_PREFIXES:
        if stripped.startswith(pre):
            stripped = stripped[len(pre):].strip()
            break
    stripped_noparen = re.sub(r"\s*\([^)]*\)\s*$", "", stripped).strip()
    stripped_nocomma = re.sub(r",.*$", "", stripped).strip()
    for cand in (stripped, stripped_noparen, stripped_nocomma):
        if cand and cand != norm:
            hit = _resolve(cand)
            if hit:
                return hit
    return None


# --------------------------------------------------------------------------------------
# Year parsing with forward fill
# --------------------------------------------------------------------------------------
YEAR_RE = re.compile(r"1[4-9]\d\d")
MIN_YEAR, MAX_YEAR = 1500, 1850  # the Cartago protocols span the colonial / early republican era


def parse_year(raw, prev_year):
    """Return int year or None. Handles '1607', '1629-1630', '92' (relative to prev century)."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s or s.lower() in ("null", "none", "unknown", "desconocido"):
        return None
    m = YEAR_RE.search(s)
    if m:
        year = int(m.group())
        return year if MIN_YEAR <= year <= MAX_YEAR else None
    m2 = re.fullmatch(r"(\d{2})", s)
    if m2 and prev_year:
        century = prev_year - prev_year % 100
        candidate = century + int(m2.group(1))
        if candidate < prev_year - 5:  # e.g. prev 1698, raw "02" -> 1702
            candidate += 100
        return candidate
    return None


def load_jsonl(filepath):
    data = []
    if not os.path.exists(filepath):
        return data
    with open(filepath, "r", encoding="utf-8") as f:
        for i, line in enumerate(f):
            line = line.strip()
            if line:
                item = json.loads(line)
                item.setdefault("id", i + 1)
                data.append(item)
    return data


def clean_list(values):
    out = []
    seen = set()
    for v in values or []:
        if not v or not isinstance(v, str):
            continue
        v = re.sub(r"\s+", " ", v).strip(" .,;")
        if v and v.lower() not in seen:
            seen.add(v.lower())
            out.append(v)
    return out


def load_corrections():
    """record id -> {field: value}; later lines win."""
    out = {}
    if not os.path.exists(CORRECTIONS_FILE):
        return out
    with open(CORRECTIONS_FILE, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            c = json.loads(line)
            out.setdefault(int(c["record"]), {})[c["field"]] = c["to"]
    return out


def iso_to_date(iso):
    """'1620-03-12' -> ('Mar 12', 1620); '1620-03' -> (None, 1620); '1620' -> (None, 1620)."""
    if not iso:
        return None, None
    m = re.match(r"^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?", str(iso))
    if not m:
        return None, None
    year = int(m.group(1))
    if m.group(2) and m.group(3):
        try:
            return f"{MONTHS[int(m.group(2)) - 1]} {int(m.group(3))}", year
        except (ValueError, IndexError):
            return None, year
    return None, year


def collection_events(collection, source_index, counts, out_events, text_en, text_es):
    """Append the records of one transcribed source (pages.jsonl) to the outputs."""
    pages_file = os.path.join(SOURCES_DIR, collection["id"], "pages.jsonl")
    if not os.path.exists(pages_file):
        print(f"  {collection['id']}: no pages.jsonl yet")
        return 0
    n = 0
    next_id = int(collection["id_base"])
    prev_year = None
    with open(pages_file, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            page = json.loads(line)
            for side in ("left", "right"):
                reading = page.get(side)
                if not reading:
                    continue
                for e in reading.get("entries") or []:
                    date, iso_year = iso_to_date(e.get("date"))
                    year = e.get("year") or iso_year
                    inferred = 0
                    if year is None and prev_year is not None:
                        year, inferred = prev_year, 1
                    if year is not None and not inferred:
                        prev_year = year
                        counts["dated"] += 1
                    elif inferred:
                        counts["inferred"] += 1
                    else:
                        counts["undated"] += 1
                    people = clean_list(e.get("people"))
                    locations = clean_list(e.get("locations"))
                    rec = {"i": next_id, "y": year, "yi": inferred, "d": date, "p": people, "l": locations, "c": collection["_index"],
                           "s": [source_index, page["leaf"], reading.get("folio"), round(float(reading.get("legibility") or 0), 2), side[0]]}
                    for loc in locations:
                        hit = lookup_location(loc)
                        if hit:
                            canon, (lat, lng) = hit
                            rec["g"] = [round(lat, 4), round(lng, 4)]
                            rec["gl"] = canon
                            break
                    counts["located" if "g" in rec else "unlocated"] += 1
                    counts["total"] += 1
                    out_events.append(rec)
                    summary = (e.get("summary_es") or "").strip()
                    text_es.append(summary)
                    text_en.append(summary)  # no English for transcribed sources yet
                    counts["translated"] += 1
                    next_id += 1
                    n += 1
    return n


def main():
    print("Loading Gemini events...")
    events = load_jsonl(EVENTS_FILE)
    events.sort(key=lambda e: e["id"])
    print(f"  {len(events)} events")

    corrections = load_corrections()
    print(f"  {len(corrections)} records with community corrections")

    sources = None
    if os.path.exists(SOURCES_FILE):
        with open(SOURCES_FILE, encoding="utf-8") as f:
            sources = json.load(f)
        print(f"  source pages for {len(sources['records'])} records")

    print("Loading Spanish translations...")
    es_by_id = {e["id"]: e for e in load_jsonl(EVENTS_ES_FILE)}
    print(f"  {len(es_by_id)} translated")

    out_events, text_en, text_es = [], [], []
    counts = {"total": len(events), "dated": 0, "inferred": 0, "undated": 0,
              "located": 0, "unlocated": 0, "translated": 0}
    unmatched = {}
    prev_year = None

    for e in events:
        fix = corrections.get(e["id"], {})
        if "year" in fix:
            e["year"] = fix["year"]
        if "date" in fix:
            e["date"] = fix["date"]
        if "people" in fix:
            e["people_involved"] = fix["people"]
        if "locations" in fix:
            e["locations"] = fix["locations"]
        if "summary_en" in fix:
            e["summary"] = fix["summary_en"]

        year = parse_year(e.get("year"), prev_year)
        inferred = 0
        if year is None and prev_year is not None:
            year, inferred = prev_year, 1
        if year is not None and not inferred:
            prev_year = year
            counts["dated"] += 1
        elif inferred:
            counts["inferred"] += 1
        else:
            counts["undated"] += 1

        date = e.get("date")
        if not date or str(date).strip().lower() in ("null", "none", "unknown"):
            date = None

        people = clean_list(e.get("people_involved"))
        locations = clean_list(e.get("locations"))

        rec = {"i": e["id"], "y": year, "yi": inferred, "d": date, "p": people, "l": locations}
        if sources and 0 <= e["id"] - 1 < len(sources["records"]):
            rec["s"] = sources["records"][e["id"] - 1]  # [volume index, pdf page, printed page, confidence]

        for loc in locations:
            hit = lookup_location(loc)
            if hit:
                canon, (lat, lng) = hit
                rec["g"] = [round(lat, 4), round(lng, 4)]
                rec["gl"] = canon
                break
            unmatched[loc] = unmatched.get(loc, 0) + 1
        if "g" in rec:
            counts["located"] += 1
        else:
            counts["unlocated"] += 1

        out_events.append(rec)
        summary_en = (e.get("summary") or "").strip()
        text_en.append(summary_en)

        es = es_by_id.get(e["id"])
        es_summary = (fix.get("summary_es") or (es or {}).get("summary_es") or "").strip()
        if es_summary and es_summary != summary_en:
            text_es.append(es_summary)
            counts["translated"] += 1
        else:
            text_es.append(None)

    # Sources list: the five Índice volumes first (indices 0-4, as in sources.json), then other works.
    source_list = [dict(v, kind="index", collection=0) for v in (sources["volumes"] if sources else [])]
    collections = [{"id": "indice-protocolos-cartago", "label": "Índice de los Protocolos de Cartago", "kind": "index"}]
    if os.path.exists(COLLECTIONS_FILE):
        with open(COLLECTIONS_FILE, encoding="utf-8") as f:
            extra = json.load(f)["sources"]
        for c in extra:
            c["_index"] = len(collections)
            collections.append({"id": c["id"], "label": c["label"], "kind": c.get("kind", "manuscript"), "work": c.get("work")})
            source_list.append({"id": c["ia"], "tomo": None, "label": c["label"], "kind": c.get("kind", "manuscript"), "collection": c["_index"]})
            n = collection_events(c, len(source_list) - 1, counts, out_events, text_en, text_es)
            print(f"  {c['id']}: {n} records")

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    payload = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "counts": counts,
        "volumes": sources["volumes"] if sources else [],
        "sources": source_list,
        "collections": collections,
        "events": out_events,
    }
    compact = dict(ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(OUTPUT_DIR, "events.json"), "w", encoding="utf-8") as f:
        json.dump(payload, f, **compact)
    with open(os.path.join(OUTPUT_DIR, "text_en.json"), "w", encoding="utf-8") as f:
        json.dump(text_en, f, **compact)
    with open(os.path.join(OUTPUT_DIR, "text_es.json"), "w", encoding="utf-8") as f:
        json.dump(text_es, f, **compact)

    print("Counts:", json.dumps(counts))
    top_unmatched = sorted(unmatched.items(), key=lambda kv: -kv[1])[:25]
    print("Top unmatched locations (add to GAZETTEER/ALIASES to improve coverage):")
    for name, n in top_unmatched:
        print(f"  {n:4d}  {name}")
    for fn in ("events.json", "text_en.json", "text_es.json"):
        size = os.path.getsize(os.path.join(OUTPUT_DIR, fn))
        print(f"  wrote {fn}: {size/1024:.0f} KB")


if __name__ == "__main__":
    main()
