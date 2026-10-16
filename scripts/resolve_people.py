"""
Entity resolution for the people of the index, phase 1: pure data, no model calls.

The app keys people by a folded name (foldPerson in cartago-web/src/lib/text.js), so every
"Francisco de Ocampo Golfín" across three centuries is one profile, while "Ocampo Golfin" and
"Ocampo y Golfín" are two. This script turns name keys into *persons*:

  1. SPLIT. Within a key, the record mentions are clustered into lives that are mutually
     compatible: no life longer than MAX_LIFE years, stated ages that agree on a birth year,
     nobody acting decades after being called difunto, no priest with a wife. Shared spouses,
     parents and titles pull mentions together; conflicts push them apart.
  2. MERGE. Across keys, persons whose names are spelling variants of each other (Jaro-Winkler
     and token overlap, with the usual abbreviations expanded) and whose lives are compatible
     are proposed as the same person; a shared spouse or parent raises the confidence, being
     named side by side in one record lowers it.
  3. REPORT. persons.json (stable ids, variants, span, consolidated facts citing record ids),
     proposals.jsonl (splits and merges with evidence and confidence, for the community to
     accept or reject), and a scorecard before/after.

Nothing here modifies people.json or the app: the output is a layer on top, like curation.

    python scripts/resolve_people.py            # writes scripts/data/resolution/
    python scripts/resolve_people.py --sample   # also prints 20 splits and 20 merges to read
"""

import argparse
import collections
import hashlib
import json
import os
import re
import statistics
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "cartago-web", "public", "data")
OUT = os.path.join(ROOT, "scripts", "data", "resolution")

MAX_LIFE = 85  # first to last mention of one person, in years
BIRTH_TOL = 8  # two stated ages must agree on the birth year within this
AFTER_DEATH = 40  # a mention this long after a "difunto" mention is another person
MIN_MERGE = 0.5  # proposals below this are not written
SURE_MERGE = 0.75  # proposals at or above this count as applied in the "after" scorecard

# ---- names -----------------------------------------------------------------------------------------
PREFIX = re.compile(
    r"^(?:(?:don|dona|doña|el|la|sr\.?|sra\.?|señor|señora|fray|fr\.?|sor|padre|pbro\.?|presbitero|presbítero|capitan|capitán|capn\.?|cap\.?|alferez|alférez|alfz\.?|sargento|sarjento|sgto\.?|ayudante|teniente|tte\.?|licenciado|lic\.?|bachiller|br\.?|doctor|dr\.?|general|gobernador|maestre de campo|maese de campo|sargento mayor|adelantado|reverendo|obispo|canonigo|canónigo)\s+)+"
)
KEEP = re.compile(r"\b(father|son|daughter|mother|elder|younger|nephew|niece|widow|padre|madre|hijo|hija|viejo|mozo|sobrino|sobrina|viuda|viudo|nieto|nieta|abuelo|abuela)\b", re.I)
PARTICLES = {"de", "del", "la", "las", "los", "y", "e", "san", "santa"}
# Title words that survive the app's fold (English titles from the extraction, abbreviations) and
# must not count as name tokens when comparing names.
TITLE_TOKENS = {"captain", "capt", "capn", "lieutenant", "ensign", "sergeant", "sarjento", "sargento", "major", "licentiate", "bachelor", "friar", "father", "governor", "presbyter", "priest", "pro", "pbro", "bdo", "br", "lic", "dr", "don", "dona", "senor", "senora", "mr", "mrs", "alcalde", "regidor", "escribano", "tesorero", "depositario", "alguacil", "general", "teniente", "ayudante", "alferez", "capitan"}
CLERGY = re.compile(r"\b(fray|fr\.|presbitero|presbítero|pbro|padre|cura|clerigo|clérigo|canonigo|canónigo|obispo|vicario|sor|religios[oa]|monja)\b", re.I)
MILITARY = re.compile(r"\b(capitan|capitán|alferez|alférez|sargento|sarjento|teniente|ayudante|maestre de campo|maese de campo|general|gobernador)\b", re.I)
ABBREV = {
    "frco": "francisco", "fran": "francisco", "franco": "francisco", "fco": "francisco", "fr": "francisco",
    "ant": "antonio", "anto": "antonio", "antº": "antonio",
    "ju": "juan", "jn": "juan", "juº": "juan",
    "jph": "jose", "joseph": "jose", "josef": "jose", "josefe": "jose",
    "ma": "maria", "mª": "maria",
    "dgo": "domingo", "bme": "bartolome", "bartholome": "bartolome",
    "gmo": "guillermo", "greg": "gregorio", "gregº": "gregorio",
    "pº": "pedro", "po": "pedro", "ped": "pedro",
    "mig": "miguel", "migl": "miguel",
    "nic": "nicolas", "nicº": "nicolas",
    "seb": "sebastian", "sebn": "sebastian",
    "agn": "agustin", "agustn": "agustin",
    "ysabel": "isabel", "ynes": "ines", "ygnacio": "ignacio", "ylario": "hilario",
    "xpoval": "cristobal", "xptoval": "cristobal", "cristoval": "cristobal", "christoval": "cristobal",
    "phelipe": "felipe", "philipe": "felipe", "thomas": "tomas", "thome": "tome", "mathias": "matias",
    "estevan": "esteban", "estephan": "esteban", "joan": "juan", "joana": "juana", "catharina": "catalina",
    "geronimo": "jeronimo", "hieronimo": "jeronimo", "raphael": "rafael", "theresa": "teresa",
    "balthasar": "baltasar", "balthazar": "baltasar", "gaspard": "gaspar",
}


def fold(s):
    return "".join(c for c in unicodedata.normalize("NFD", (s or "").lower()) if unicodedata.category(c) != "Mn")


def fold_person(name):
    """Same key as the app: strip titles, parentheses (except kinship) and ', vecino de …'."""
    s = fold(name)
    s = re.sub(r"\s*\(([^)]*)\)\s*", lambda m: f" ({m.group(1).strip()}) " if KEEP.search(m.group(1)) else " ", s)
    s = re.sub(r"\s*,\s*(?:vecin[oa]|natural|residente|oriund[oa])\b.*$", "", s)
    s = PREFIX.sub("", s)
    return re.sub(r"\s+", " ", s).strip(" .,;")


def tokens(key):
    out = []
    for t in re.split(r"[\s,]+", key):
        t = t.strip(".()")
        if not t or t in PARTICLES or t in TITLE_TOKENS:
            continue
        out.append(ABBREV.get(t, t))
    return out


def gender_swap(a, b):
    """francisca/francisco, antonia/antonio, juana/juan: different people, not spelling variants."""
    if a == b:
        return False
    stem = lambda x: x[:-1] if x.endswith(("a", "o")) else x
    return stem(a) == stem(b) or a == b + "a" or b == a + "a"


def title_of(raw):
    """Which world a mention lives in, from its title: 'clergy', 'military', 'don' or ''."""
    f = fold(raw)
    if CLERGY.search(f):
        return "clergy"
    if MILITARY.search(f):
        return "military"
    if re.match(r"^(don|dona)\b", f):
        return "don"
    return ""


def jaro_winkler(a, b):
    if a == b:
        return 1.0
    la, lb = len(a), len(b)
    if not la or not lb:
        return 0.0
    window = max(la, lb) // 2 - 1
    ma = [False] * la
    mb = [False] * lb
    matches = 0
    for i, ca in enumerate(a):
        lo, hi = max(0, i - window), min(lb, i + window + 1)
        for j in range(lo, hi):
            if not mb[j] and b[j] == ca:
                ma[i] = mb[j] = True
                matches += 1
                break
    if not matches:
        return 0.0
    t = 0
    k = 0
    for i in range(la):
        if ma[i]:
            while not mb[k]:
                k += 1
            if a[i] != b[k]:
                t += 1
            k += 1
    jaro = (matches / la + matches / lb + (matches - t / 2) / matches) / 3
    prefix = 0
    for x, y in zip(a, b):
        if x != y or prefix == 4:
            break
        prefix += 1
    return jaro + prefix * 0.1 * (1 - jaro)


def name_similarity(ka, kb):
    """0..1: Jaro-Winkler on the normalized string, averaged with token Jaccard; equal normalized tokens = 1."""
    ta, tb = tokens(ka), tokens(kb)
    if not ta or not tb:
        return 0.0
    if ta == tb or sorted(ta) == sorted(tb):
        return 1.0
    if gender_swap(ta[0], tb[0]):
        return 0.0
    sa, sb = set(ta), set(tb)
    jacc = len(sa & sb) / len(sa | sb)
    jw = jaro_winkler(" ".join(ta), " ".join(tb))
    # same given name, and every surname token of the shorter name has a close match in the longer
    # one (OCR-level differences); a close match never crosses a gender swap
    def close_match(x, ys):
        return any(jaro_winkler(x, y) >= 0.92 and not gender_swap(x, y) for y in ys)
    short, long_ = (ta, tb) if len(ta) <= len(tb) else (tb, ta)
    close = ta[0] == tb[0] and all(close_match(x, long_) for x in short[1:])
    return max(jw * 0.5 + jacc * 0.5, 0.9 if close and len(short) >= 2 else 0)


# ---- data ------------------------------------------------------------------------------------------
def load():
    with open(os.path.join(DATA, "events.json"), encoding="utf-8") as f:
        ev = json.load(f)
    with open(os.path.join(DATA, "people.json"), encoding="utf-8") as f:
        facts = json.load(f)
    texts = None
    p = os.path.join(DATA, "text_es.json")
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            texts = json.load(f)
    return ev["events"], facts, texts


def summary_of(texts, events_by_id, ev_pos, rid):
    if texts is None or rid not in ev_pos:
        return ""
    i = ev_pos[rid]
    t = texts[i] if i < len(texts) else ""
    return t if isinstance(t, str) else (t.get("s") or t.get("es") or "")


class Mention:
    __slots__ = ("rid", "year", "inferred", "raw", "title", "birth", "dead", "spouses", "parents", "children", "siblings", "residence", "will", "marr")

    def __init__(self, rid, year, inferred, raw):
        self.rid, self.year, self.inferred, self.raw = rid, year, inferred, raw
        self.title = title_of(raw)
        self.birth = None
        self.dead = False
        self.will = self.marr = False
        self.spouses, self.parents, self.children, self.siblings, self.residence = set(), set(), set(), set(), set()


AGE = re.compile(r"\bde (?:unos |como |aproximadamente )?(\d{1,2}) a[nñ]os")
OTHER_SUBJECT = re.compile(r"esclav|llamad|mulat|negr|niñ|nin[oa]\b|indi[oa]\b|pard[oa]\b|hij[oa]\b|esposa|mujer|marido|criad|sirvient|aprendiz|hu[eé]rfan", re.I)


def trusted_birth(summary, raw_name, year):
    """Birth year from a stated age, only when "de N años" follows the person's own name and nothing
    in between names somebody else (the slave being sold, a child being placed). people.json's
    "born" hints attach any nearby age to the name, which turns a seller into a 10-year-old."""
    if not summary or year is None:
        return None
    text = fold(summary)
    name = fold(raw_name).strip()
    short = fold_person(raw_name)
    for needle in (name, short):
        if not needle:
            continue
        start = 0
        while True:
            i = text.find(needle, start)
            if i < 0:
                break
            tail = text[i + len(needle) : i + len(needle) + 60]
            m = AGE.search(tail)
            if m and not OTHER_SUBJECT.search(tail[: m.start()]):
                age = int(m.group(1))
                if 0 < age < 100:
                    return year - age
            start = i + 1
    return None


DEAD_BEFORE = re.compile(r"(difunt[oa]s?|viud[oa] de|albaceas? de|herederos? de|bienes de|testamentar[ií]a de|finad[oa])\s*(?:(?:el|la|los|las|don|dona|capitan|alferez|sargento mayor|licenciado|presbitero|padre|fray|sr|dr)\.?\s+){0,3}$")
DEAD_AFTER = re.compile(r"^[\s,(]{0,3}(difunt[oa]|finad[oa]|ya difunt[oa])")


def trusted_dead(summary, raw_name):
    """True when the summary calls this person dead *by name*: "difunto X", "X, difunto", "viuda de X",
    "albacea de X". people.json's "dead" hints fire on any "difunto" in the sentence, so a buyer gets
    killed by the seller's late parents."""
    if not summary:
        return False
    text = fold(summary)
    for needle in (fold(raw_name).strip(), fold_person(raw_name)):
        if not needle:
            continue
        start = 0
        while True:
            i = text.find(needle, start)
            if i < 0:
                break
            if DEAD_BEFORE.search(text[max(0, i - 60) : i]) or DEAD_AFTER.match(text[i + len(needle) : i + len(needle) + 14]):
                return True
            start = i + 1
    return False


def build_mentions(events, facts, texts=None, ev_pos=None):
    """key -> [Mention], with the per-record facts of people.json attached to the record they came from."""
    by_key = collections.defaultdict(list)
    for e in events:
        for raw in e.get("p", []):
            k = fold_person(raw)
            if k:
                by_key[k].append(Mention(e["i"], e.get("y"), bool(e.get("yi")), raw))
    for k, ms in by_key.items():
        f = facts.get(k)
        if not f:
            continue
        idx = collections.defaultdict(list)
        for m in ms:
            idx[m.rid].append(m)
        for year, rid, _phrase in f.get("born", []):
            for m in idx.get(rid, []):
                if texts is None:
                    m.birth = year
                else:
                    m.birth = trusted_birth(summary_of(texts, None, ev_pos, rid), m.raw, m.year)
        for field, attr in (("dead", "dead"), ("will", "will"), ("marr", "marr")):
            for _year, rid in f.get(field, []):
                for m in idx.get(rid, []):
                    if field == "dead" and texts is not None:
                        m.dead = trusted_dead(summary_of(texts, None, ev_pos, rid), m.raw)
                    else:
                        setattr(m, attr, True)
        for field in ("spouse", "parents", "children", "siblings", "residence"):
            for name, ids in f.get(field, []):
                for rid in ids:
                    for m in idx.get(rid, []):
                        getattr(m, field if field != "spouse" else "spouses").add(fold_person(name) if field != "residence" else fold(name))
    return by_key


# ---- split -----------------------------------------------------------------------------------------
class Life:
    def __init__(self):
        self.mentions = []
        self.births = []
        self.dead_year = None
        self.spouses, self.parents, self.children, self.siblings = set(), set(), set(), set()
        self.titles = collections.Counter()

    @property
    def first(self):
        return self.mentions[0].year

    @property
    def last(self):
        return self.mentions[-1].year

    def birth(self):
        """Established birth year: the median of the hints, only once two of them agree.
        A single "de N años" is often the age of someone else in the deed (a slave being sold),
        so one hint never splits a life on its own."""
        if len(self.births) < 2:
            return None
        med = statistics.median(self.births)
        agree = [b for b in self.births if abs(b - med) <= BIRTH_TOL]
        return statistics.median(agree) if len(agree) >= 2 else None

    def compatible(self, m):
        """Can this mention be the same person as this life? (reason, or None when it can)"""
        if m.year is None:
            return None
        if m.year - self.first > MAX_LIFE:
            return "lifespan"
        b = self.birth()
        if b is not None:
            if m.birth is not None and abs(m.birth - b) > BIRTH_TOL:
                return "birth"
            if m.year < b - 2 or m.year > b + MAX_LIFE + 5:
                return "birth"
        if m.birth is not None and b is None and (self.first < m.birth - 2 or self.last > m.birth + MAX_LIFE + 5):
            return "birth"  # the hint, if true, puts this life outside one lifetime
        if self.dead_year is not None and m.year > self.dead_year + AFTER_DEATH:
            return "death"
        if m.title == "clergy" and (self.spouses or m.spouses and False):
            return "clergy"
        if m.spouses and self.titles.get("clergy"):
            return "clergy"
        return None

    def affinity(self, m):
        s = 0.0
        if m.spouses & self.spouses:
            s += 10
        if m.parents & self.parents:
            s += 8
        if (m.children & self.children) or (m.siblings & self.siblings):
            s += 4
        if m.title and self.titles.get(m.title):
            s += 1
        if m.birth is not None and self.births:
            s += 2
        if self.last is not None and m.year is not None:
            s += max(0, 1 - abs(m.year - self.last) / 60)
        return s

    def add(self, m):
        self.mentions.append(m)
        if m.birth is not None:
            self.births.append(m.birth)
        if m.dead and (self.dead_year is None or m.year < self.dead_year):
            self.dead_year = m.year
        self.spouses |= m.spouses
        self.parents |= m.parents
        self.children |= m.children
        self.siblings |= m.siblings
        if m.title:
            self.titles[m.title] += 1


def split_key(mentions):
    """Greedy chronological clustering; returns (lives, undated mentions, conflicts seen)."""
    dated = sorted([m for m in mentions if m.year is not None], key=lambda m: (m.year, m.inferred, m.rid))
    undated = [m for m in mentions if m.year is None]
    lives = []
    reasons = collections.Counter()
    for m in dated:
        best, best_score = None, -1
        for life in reversed(lives):
            why = life.compatible(m)
            if why:
                reasons[why] += 1
                continue
            score = life.affinity(m)
            if score > best_score:
                best, best_score = life, score
        if best is None:
            best = Life()
            lives.append(best)
        best.add(m)
    # undated mentions: attach to the life sharing a relation, else to the only life, else keep apart
    for m in undated:
        home = next((l for l in lives if (m.spouses & l.spouses) or (m.parents & l.parents)), None)
        if home is None and len(lives) == 1:
            home = lives[0]
        if home is None:
            home = Life()
            lives.append(home)
        home.mentions.append(m)
        home.spouses |= m.spouses
        home.parents |= m.parents
    return lives, undated, reasons


def given_names(by_key):
    """Tokens that start multi-token keys often enough to be given names (for the unresolvable test)."""
    c = collections.Counter()
    for k in by_key:
        t = tokens(k)
        if len(t) >= 2:
            c[t[0]] += 1
    return {t for t, n in c.items() if n >= 15}


# ---- persons ---------------------------------------------------------------------------------------
def person_id(key, life):
    first = min(m.rid for m in life.mentions)
    return "P" + hashlib.sha1(f"{key}|{first}".encode()).hexdigest()[:8]


def consolidate(key, life, n_in_key):
    ms = life.mentions
    raw = collections.Counter(m.raw for m in ms)
    years = sorted(m.year for m in ms if m.year is not None)
    births = sorted((m.birth, m.rid) for m in ms if m.birth is not None)
    rel = lambda attr: sorted({(name, m.rid) for m in ms for name in getattr(m, attr)})
    group = lambda pairs: [[n, sorted(r for x, r in pairs if x == n)] for n in sorted({n for n, _ in pairs})]
    p = {
        "id": person_id(key, life),
        "key": key,
        "name": raw.most_common(1)[0][0],
        "variants": [[r, c] for r, c in raw.most_common()],
        "records": sorted(m.rid for m in ms),
        "span": [years[0], years[-1]] if years else None,
        "born": [round(statistics.median(b for b, _ in births)), [r for _, r in births], life.birth() is not None] if births else None,
        "dead_by": [life.dead_year, sorted(m.rid for m in ms if m.dead)] if life.dead_year is not None else None,
        "will": sorted(m.rid for m in ms if m.will) or None,
        "spouse": group(rel("spouses")) or None,
        "parents": group(rel("parents")) or None,
        "children": group(rel("children")) or None,
        "siblings": group(rel("siblings")) or None,
        "residence": group(rel("residence")) or None,
        "titles": dict(life.titles) or None,
        "split_from": n_in_key,
    }
    return {k: v for k, v in p.items() if v is not None}


# ---- merge -----------------------------------------------------------------------------------------
def surname_tokens(key):
    t = tokens(key)
    return t[1:] if len(t) >= 2 else t


def life_compatible(a, b):
    sa, sb = a.get("span"), b.get("span")
    if sa and sb and (max(sa[1], sb[1]) - min(sa[0], sb[0]) > MAX_LIFE):
        return False
    ba, bb = a.get("born"), b.get("born")
    if ba and bb and ba[2] and bb[2] and abs(ba[0] - bb[0]) > BIRTH_TOL:
        return False
    if ba and ba[2] and sb and (sb[0] < ba[0] - 2 or sb[1] > ba[0] + MAX_LIFE + 5):
        return False
    if bb and bb[2] and sa and (sa[0] < bb[0] - 2 or sa[1] > bb[0] + MAX_LIFE + 5):
        return False
    ta, tb = a.get("titles") or {}, b.get("titles") or {}
    if ("clergy" in ta and (b.get("spouse") or "military" in tb)) or ("clergy" in tb and (a.get("spouse") or "military" in ta)):
        return False
    return True


def shared(a, b, field):
    xa = {n for n, _ in (a.get(field) or [])}
    xb = {n for n, _ in (b.get(field) or [])}
    return xa & xb


def merge_candidates(persons, record_people):
    by_tok = collections.defaultdict(list)
    for i, p in enumerate(persons):
        for t in set(surname_tokens(p["key"])):
            if len(t) >= 3:
                by_tok[t].append(i)
    seen = set()
    out = []
    for tok, idxs in by_tok.items():
        if len(idxs) > 400:  # "de la", "garcia"-sized blocks: only compare when a second token also matches
            continue
        for x in range(len(idxs)):
            for y in range(x + 1, len(idxs)):
                i, j = sorted((idxs[x], idxs[y]))
                a, b = persons[i], persons[j]
                if a["key"] == b["key"] or (i, j) in seen:
                    continue
                seen.add((i, j))
                sim = name_similarity(a["key"], b["key"])
                if sim < 0.82:
                    continue
                if not life_compatible(a, b):
                    continue
                conf = 0.45 + (sim - 0.82) * 1.5
                reasons = [f"nombre {sim:.2f}"]
                sp = shared(a, b, "spouse")
                pa = shared(a, b, "parents")
                if sp:
                    conf += 0.25
                    reasons.append("mismo cónyuge: " + ", ".join(sorted(sp)))
                if pa:
                    conf += 0.2
                    reasons.append("mismos padres: " + ", ".join(sorted(pa)))
                if a.get("born") and b.get("born"):
                    conf += 0.1
                    reasons.append(f"nacimiento ≈{a['born'][0]} / ≈{b['born'][0]}")
                sa, sb = a.get("span"), b.get("span")
                if sa and sb:
                    overlap = min(sa[1], sb[1]) - max(sa[0], sb[0])
                    if overlap >= 0:
                        conf += 0.05
                        reasons.append(f"años {sa[0]}–{sa[1]} y {sb[0]}–{sb[1]}")
                    else:
                        conf -= min(0.2, -overlap / 200)
                        reasons.append(f"años {sa[0]}–{sa[1]} y {sb[0]}–{sb[1]} (sin solape)")
                together = set(a["records"]) & set(b["records"])
                if together:
                    conf -= 0.3
                    reasons.append(f"nombrados juntos en #{sorted(together)[0]}")
                # both single-mention and no relation: leave it to a reader
                if len(a["records"]) == 1 and len(b["records"]) == 1 and not (sp or pa):
                    conf -= 0.1
                conf = max(0.0, min(0.99, conf))
                kind = "spelling" if sim >= 0.999 else "similar"
                if kind == "spelling" and not together:
                    conf = max(conf, 0.8)  # same name once particles and abbreviations are normalized, compatible lives
                if conf >= MIN_MERGE:
                    out.append({"type": "merge", "kind": kind, "a": a["id"], "b": b["id"], "keys": [a["key"], b["key"]], "names": [a["name"], b["name"]], "confidence": round(conf, 2), "reasons": reasons})
    out.sort(key=lambda r: -r["confidence"])
    return out


# ---- adjudications (phase 2, adjudicate_people.py) ------------------------------------------------
def load_adjudications():
    out = {"split": {}, "merge": {}}
    path = os.path.join(OUT, "adjudications.jsonl")
    if not os.path.exists(path):
        return out
    for line in open(path, encoding="utf-8"):
        if not line.strip():
            continue
        r = json.loads(line)
        out[r["type"]][r["id"]] = r  # the latest answer per question wins
    return out


def regroup(lives, adj):
    """Rebuild the lives of a key from the model's record → person assignment. Mentions the model did
    not see go with the life of their nearest assigned record in time."""
    mentions = [m for l in lives for m in l.mentions]
    person_of = {}
    for i, group in enumerate(adj.get("groups") or []):
        for rid in group:
            person_of[rid] = i
    if not person_of:
        return lives
    n = max(person_of.values()) + 1
    if adj.get("n_persons", n) <= 1 or n == 1:
        one = Life()
        for m in sorted(mentions, key=lambda m: (m.year is None, m.year or 0, m.rid)):
            one.add(m) if m.year is not None else one.mentions.append(m)
        return [one]
    anchors = sorted((m.year, person_of[m.rid]) for m in mentions if m.rid in person_of and m.year is not None)
    new = [Life() for _ in range(n)]
    for m in sorted(mentions, key=lambda m: (m.year is None, m.year or 0, m.rid)):
        if m.rid in person_of:
            i = person_of[m.rid]
        elif m.year is not None and anchors:
            i = min(anchors, key=lambda a: abs(a[0] - m.year))[1]
        else:
            i = n - 1
        new[i].add(m) if m.year is not None else new[i].mentions.append(m)
    new = [l for l in new if l.mentions]
    new.sort(key=lambda l: (l.mentions[0].year is None, l.mentions[0].year or 0))
    return new


# ---- main ------------------------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", action="store_true", help="print 20 splits and 20 merges to read")
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)

    events, facts, texts = load()
    ev_pos = {e["i"]: i for i, e in enumerate(events)}
    adjud = load_adjudications()
    by_key = build_mentions(events, facts, texts, ev_pos)
    given = given_names(by_key)
    n_hints = sum(len(f.get("born", [])) for f in facts.values())
    n_trusted = sum(1 for ms in by_key.values() for m in ms if m.birth is not None)
    n_dead_hints = sum(len(f.get("dead", [])) for f in facts.values())
    n_dead_trusted = sum(1 for ms in by_key.values() for m in ms if m.dead)

    persons, splits = [], []
    unresolvable = []
    reasons_total = collections.Counter()
    before_over = 0
    for key, ms in by_key.items():
        years = [m.year for m in ms if m.year is not None]
        if years and max(years) - min(years) > MAX_LIFE:
            before_over += 1
        t = tokens(key)
        if len(t) <= 1 or all(x in given for x in t):
            unresolvable.append({"key": key, "records": len(ms)})
            life = Life()
            for m in sorted(ms, key=lambda m: (m.year is None, m.year or 0, m.rid)):
                life.mentions.append(m)
            p = consolidate(key, life, 1)
            p["unresolvable"] = "given name only"
            persons.append(p)
            continue
        lives, _undated, reasons = split_key(ms)
        reasons_total.update(reasons)
        lives.sort(key=lambda l: (l.mentions[0].year is None, l.mentions[0].year or 0))
        gaps = [lives[i + 1].first - lives[i].last for i in range(len(lives) - 1) if lives[i].mentions and lives[i + 1].mentions and lives[i].last is not None and lives[i + 1].first is not None]
        boundary = "arbitrary" if len(lives) > 1 and set(reasons) <= {"lifespan"} and gaps and min(gaps) < 15 else "evidence"
        model_note = None
        adj = adjud["split"].get(key)
        if adj and boundary == "arbitrary":
            # the model read the records around the cut: regroup the mentions it assigned, keep the
            # rest where chronology put them (a record it did not see follows its nearest neighbour)
            lives = regroup(lives, adj)
            boundary = "model"
            model_note = adj
        ps = [consolidate(key, l, len(lives)) for l in lives]
        persons.extend(ps)
        if len(lives) > 1:
            splits.append({
                "boundary": boundary,
                "model": {"n_persons": model_note["n_persons"], "confidence": model_note["confidence"], "reason": model_note["reason"], "model": model_note["model"]} if model_note else None,
                "type": "split",
                "key": key,
                "records": len(ms),
                "into": [{"id": p["id"], "name": p["name"], "span": p.get("span"), "born": p.get("born", [None])[0], "n": len(p["records"]), "spouse": [n for n, _ in p.get("spouse", [])][:3], "titles": p.get("titles")} for p in ps],
                "reasons": dict(reasons),
                "confidence": round(min(0.95, 0.6 + 0.1 * sum(1 for p in ps if p.get("born") or p.get("spouse"))), 2),
            })

    record_people = {e["i"]: e.get("p", []) for e in events}
    merges = merge_candidates(persons, record_people)
    kept = []
    for m in merges:
        adj = adjud["merge"].get(f"merge:{m['a']}:{m['b']}")
        if not adj:
            kept.append(m)
            continue
        m["model"] = {"verdict": adj["verdict"], "confidence": adj["confidence"], "reason": adj["reason"], "model": adj["model"]}
        if adj["verdict"] == "same":
            m["confidence"] = round(max(m["confidence"], 0.6 + 0.35 * adj["confidence"]), 2)
            m["reasons"].append(f"modelo ({adj['confidence']:.2f}): {adj['reason']}")
            kept.append(m)
        elif adj["verdict"] == "different":
            if adj["confidence"] < 0.7:
                m["confidence"] = round(min(m["confidence"], 0.4), 2)
                m["reasons"].append(f"modelo duda ({adj['confidence']:.2f}): {adj['reason']}")
                kept.append(m)
            # confident "different": the proposal is dropped
        else:
            m["reasons"].append(f"modelo no decide: {adj['reason']}")
            kept.append(m)
    merges = [m for m in kept if m["confidence"] >= MIN_MERGE]
    merges.sort(key=lambda r: -r["confidence"])

    # scorecard
    after_over = sum(1 for p in persons if p.get("span") and p["span"][1] - p["span"][0] > MAX_LIFE and not p.get("unresolvable"))
    single_persons = sum(1 for p in persons if len(p["records"]) == 1)
    single_before = sum(1 for ms in by_key.values() if len(ms) == 1)
    sure = [m for m in merges if m["confidence"] >= SURE_MERGE]
    absorbed = {m["a"] for m in sure} | {m["b"] for m in sure}
    single_after = sum(1 for p in persons if len(p["records"]) == 1 and p["id"] not in absorbed)
    score = {
        "name_keys": len(by_key),
        "persons": len(persons),
        "keys_split": len(splits),
        "persons_from_splits": sum(len(s["into"]) for s in splits),
        "unresolvable_given_name_keys": len(unresolvable),
        "records_in_unresolvable_keys": sum(u["records"] for u in unresolvable),
        f"keys_span_over_{MAX_LIFE}y_before": before_over,
        f"persons_span_over_{MAX_LIFE}y_after": after_over,
        "split_conflicts": dict(reasons_total),
        "splits_with_arbitrary_boundary": sum(1 for x in splits if x["boundary"] == "arbitrary"),
        "birth_hints_in_people_json": n_hints,
        "birth_hints_trusted": n_trusted,
        "dead_hints_in_people_json": n_dead_hints,
        "dead_hints_trusted": n_dead_trusted,
        "merge_proposals": len(merges),
        "merge_proposals_spelling": sum(1 for m in merges if m["kind"] == "spelling"),
        "merge_proposals_sure": len(sure),
        "single_record_keys_before": single_before,
        "single_record_persons_after_split": single_persons,
        "single_record_persons_after_sure_merges": single_after,
    }

    with open(os.path.join(OUT, "persons.json"), "w", encoding="utf-8") as f:
        json.dump({"generated_from": "cartago-web/public/data", "params": {"MAX_LIFE": MAX_LIFE, "BIRTH_TOL": BIRTH_TOL, "AFTER_DEATH": AFTER_DEATH}, "persons": persons}, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(OUT, "proposals.jsonl"), "w", encoding="utf-8") as f:
        for s in splits:
            f.write(json.dumps(s, ensure_ascii=False) + "\n")
        for m in merges:
            f.write(json.dumps(m, ensure_ascii=False) + "\n")
    with open(os.path.join(OUT, "scorecard.json"), "w", encoding="utf-8") as f:
        json.dump(score, f, ensure_ascii=False, indent=2)

    # compact copy for the app: proposals a profile can show and a signed-in user can accept
    by_id = {p["id"]: p for p in persons}
    app_splits = {}
    for sp in splits:
        labels = collections.Counter()
        into = []
        for x in sp["into"]:
            p = by_id[x["id"]]
            label = f"{p['span'][0]}–{p['span'][1]}" if p.get("span") else "s. f."
            labels[label] += 1
            if labels[label] > 1:
                label = f"{label} ({labels[label]})"
            into.append({"label": label, "n": len(p["records"]), "records": p["records"], "born": (p.get("born") or [None])[0], "spouse": [n for n, _ in (p.get("spouse") or [])][:3], "titles": p.get("titles"), "dead_by": (p.get("dead_by") or [None])[0]})
        app_splits[sp["key"]] = {"id": f"split:{sp['key']}", "boundary": sp["boundary"], "confidence": sp["confidence"], "reasons": sp["reasons"], "into": into, "model": sp.get("model")}
    app_merges = []
    for m in merges:
        a, b = by_id[m["a"]], by_id[m["b"]]
        app_merges.append({"id": f"merge:{m['a']}:{m['b']}", "kind": m["kind"], "confidence": m["confidence"], "reasons": m["reasons"], "model": m.get("model"),
                           "a": {"key": a["key"], "name": a["name"], "span": a.get("span"), "n": len(a["records"])},
                           "b": {"key": b["key"], "name": b["name"], "span": b.get("span"), "n": len(b["records"])}})
    with open(os.path.join(DATA, "resolution.json"), "w", encoding="utf-8") as f:
        json.dump({"splits": app_splits, "merges": app_merges}, f, ensure_ascii=False, separators=(",", ":"))
    print(json.dumps(score, ensure_ascii=False, indent=2))

    if args.sample:
        import random

        random.seed(7)
        snippet = lambda rid: summary_of(texts, None, ev_pos, rid)[:140]
        big = sorted(splits, key=lambda s: -s["records"])[:10]
        rest = random.sample([s for s in splits if s not in big and s["records"] >= 4], 10)
        print("\n=== SPLITS (10 largest, 10 random) ===")
        for s in big + rest:
            print(f"\n{s['key']}  ({s['records']} records → {len(s['into'])} persons; conflicts {s['reasons']}; boundary {s['boundary']})")
            for p in s["into"]:
                sp = f"  cónyuge: {', '.join(p['spouse'])}" if p["spouse"] else ""
                b = f"  nac≈{p['born']}" if p["born"] else ""
                print(f"  - {p['id']} {p['name']}  {p['span']}  n={p['n']}{b}{sp}  {p['titles'] or ''}")
                first = next(x for x in persons if x["id"] == p["id"])["records"][0]
                print(f"      #{first}: {snippet(first)}")
        print("\n=== MERGES (10 surest, 10 random ≥0.5) ===")
        top = merges[:10]
        rest = random.sample([m for m in merges if m["kind"] == "similar" and m["confidence"] < 0.75], 10)
        for m in top + rest:
            print(f"\n{m['confidence']:.2f} {m['kind']:8} {m['names'][0]}  ↔  {m['names'][1]}")
            print(f"      {' · '.join(m['reasons'])}")


if __name__ == "__main__":
    main()
