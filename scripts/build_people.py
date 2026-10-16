"""
Biographical facts per person for the profile pages -> cartago-web/public/data/people.json

Two inputs, both already produced by the pipeline:
  * scripts/data/gemini_output/gemini_people.jsonl  (Cartago index): role or occupation, age or birth hints,
    relationships (spouse, parents, children, siblings) as the model read them chunk by chunk. The
    relationship_type is the profiled person's own role toward the other name ("son" = the other is a parent).
  * cartago-web/public/data/events.json + text_es.json (all collections): the record summaries, scanned
    sentence by sentence around each person's name for the phrases notarial records use:
      "natural de X" (origin), "vecino de X" (residence), "hijo/a legítimo/a de A y B" (parents),
      "casado/a con X", "esposa/marido/mujer de X" (spouse), "viuda/o de X" (spouse, deceased),
      "de N años" (birth ~ year - N), "testamento"/"codicilo" (will, year), "difunto/a" (death before year),
      "dote" (marriage, year), "bautis-" (christening, year).
Every derived fact keeps the ids of the records it came from, so the profile can show its evidence and a
reader can judge it. People are keyed exactly like the app (foldPerson in cartago-web/src/lib/text.js).

Output: {"<key>": {"roles": [[role, n]...], "age": [[hint, record_id]...],
                   "spouse": [[name, [ids]]...], "parents": [...], "children": [...], "siblings": [...],
                   "origin": [[place, [ids]]...], "residence": [[place, [ids]]...],
                   "born": [[year, id, phrase]...], "bapt": [[year, id]...], "marr": [[year, id]...],
                   "will": [[year, id]...], "dead": [[year, id]...]}}
"""

import collections
import json
import os
import re
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PEOPLE_IN = os.path.join(ROOT, "scripts", "data", "gemini_output", "gemini_people.jsonl")
DATA_DIR = os.path.join(ROOT, "cartago-web", "public", "data")
OUT = os.path.join(DATA_DIR, "people.json")

# ---- same key as the app's foldPerson() ----------------------------------------------------------
PREFIX = re.compile(r"^(?:(?:don|dona|doña|el|la|sr\.?|sra\.?|señor|señora|fray|fr\.?|sor|padre|pbro\.?|presbitero|presbítero|capitan|capitán|capn\.?|cap\.?|alferez|alférez|alfz\.?|sargento|sarjento|sgto\.?|ayudante|teniente|tte\.?|licenciado|lic\.?|bachiller|br\.?|doctor|dr\.?|general|gobernador|maestre de campo|maese de campo|sargento mayor|adelantado|reverendo|obispo|canonigo|canónigo)\s+)+")
KEEP = re.compile(r"\b(father|son|daughter|mother|elder|younger|nephew|niece|widow|padre|madre|hijo|hija|viejo|mozo|sobrino|sobrina|viuda|viudo|nieto|nieta|abuelo|abuela)\b", re.I)


def fold(s):
    return "".join(c for c in unicodedata.normalize("NFD", (s or "").lower()) if unicodedata.category(c) != "Mn")


def fold_person(name):
    s = fold(name)
    s = re.sub(r"\s*\(([^)]*)\)\s*", lambda m: f" ({m.group(1).strip()}) " if KEEP.search(m.group(1)) else " ", s)
    s = re.sub(r"\s*,\s*(?:vecin[oa]|natural|residente|oriund[oa])\b.*$", "", s)
    s = PREFIX.sub("", s)
    return re.sub(r"\s+", " ", s).strip(" .,;")


# ---- relationships from the extraction profiles: the type is the person's role toward the other name ----
REL = {
    "spouse": "spouse", "husband": "spouse", "wife": "spouse", "esposo": "spouse", "esposa": "spouse", "marido": "spouse",
    "son": "parents", "daughter": "parents", "child": "parents", "son of": "parents", "daughter of": "parents", "child of": "parents", "hijo": "parents", "hija": "parents",
    "father": "children", "mother": "children", "father of": "children", "mother of": "children", "padre": "children", "madre": "children",
    "brother": "siblings", "sister": "siblings", "sibling": "siblings", "hermano": "siblings", "hermana": "siblings",
}

# ---- phrases in the summaries ----------------------------------------------------------------------
NAME = r"([A-ZÁÉÍÓÚÑ][\w'áéíóúñü-]*(?:\s+(?:[A-ZÁÉÍÓÚÑ][\w'áéíóúñü-]*|de|del|la|las|los)){0,6})"
DEAD_PFX = r"(?:(?:los|las|el|la)\s+)?(?:difunt[oa]s?\s+)?(?:(?:don|doña|dona|capitán|capitan|alférez|alferez|sargento mayor|licenciado|capn\.|alfz\.)\s+)?"
P_NATURAL = re.compile(r"\bnatural(?:es)? de\s+" + NAME)
P_VECINO = re.compile(r"\bvecin[oa]s? de\s+" + NAME)
P_PARENTS = re.compile(r"\bhij[oa]s? (?:legítim[oa]s? |natural(?:es)? )?(?:de|del)\s+" + DEAD_PFX + NAME + r"(?:\s+y\s+(?:de\s+)?" + DEAD_PFX + NAME + r")?")
P_SPOUSE = re.compile(r"\b(?:casad[oa] con|esposa de|esposo de|marido de|mujer de|viud[oa] de)\s+" + DEAD_PFX + NAME)
P_AGE = re.compile(r"\bde\s+(?:unos\s+|como\s+|aproximadamente\s+)?(\d{1,2})\s+años\b")
# Between a person's name and a phrase about them there must be no other subject: the slave being
# sold, the child being placed, a spouse or parent named in passing. Otherwise the phrase is theirs.
OTHER_SUBJECT = re.compile(r"esclav|llamad|mulat|negr|niñ|\bnin[oa]\b|\bindi[oa]\b|\bpard[oa]\b|\bhij[oa]s?\b|esposa|esposo|mujer|marido|criad|sirvient|aprendiz|hu[eé]rfan|\bpadres?\b|\bmadre\b|viud[oa]", re.I)
# What may stand between a person's name and their own age: a residence clause, a kinship aside
# in parentheses, "más de", "mayor de", "de edad de", "dijo ser". Anything else (a verb, another
# name, "por un periodo") means the age belongs to someone or something else.
AGE_GAP = re.compile(
    r"^[\s,]*(?:\([^)]{0,40}\)[\s,]*)?(?:(?:vecin[oa]s? de|natural(?:es)? de|residentes? (?:en|de)|oriund[oa] de|estante en)\s+[a-z .]{1,40}[\s,]*)?"
    r"(?:(?:quien dijo ser|dijo ser|declaro ser|declaro tener|que dijo ser|de edad de|de edad|mayor de|menor de|de mas de|mas de|de unos|como de|casad[oa]|solter[oa]|viud[oa])[\s,]*)*$"
)
P_AGE_FOLDED = re.compile(r"\bde\s+(?:unos\s+|como\s+|aproximadamente\s+)?(\d{1,2})\s+anos\b")  # on folded text
DEAD_BEFORE = re.compile(r"(difunt[oa]s?|viud[oa] de|albaceas? de|herederos? de|bienes de|testamentar[ií]a de|finad[oa])\s*(?:(?:el|la|los|las|don|dona|capitan|alferez|sargento mayor|licenciado|presbitero|padre|fray|sr|dr)\.?\s+){0,3}$")
DEAD_AFTER = re.compile(r"^[\s,(]{0,3}(?:ya\s+)?(?:difunt[oa]|finad[oa])")
P_WILL = re.compile(r"\btestamento\b|\bcodicilo\b")
P_DEAD = re.compile(r"\bdifunt[oa]s?\b")
P_DOTE = re.compile(r"\b(?:carta de )?dote\b")
P_BAPT = re.compile(r"\bbautis|\bbautiz")

STOP_TAIL = re.compile(r"\s+(?:de|del|la|las|los|y|e)$")
JUNK = {"alferez", "alférez", "capitan", "capitán", "don", "doña", "dona", "los", "las", "el", "la", "e", "y",
        "licenciado", "sargento", "ayudante", "teniente", "difunto", "difunta", "difuntos", "capn.", "alfz."}


def clean_name(s):
    s = STOP_TAIL.sub("", (s or "").strip(" ,.;")).strip()
    s = " ".join(t for t in s.split() if t.lower() not in ("difunto", "difunta", "difuntos", "difuntas"))
    if not s or s.lower() in JUNK or len(s) < 3:
        return ""
    return s


def sentences(text):
    return [s.strip() for s in re.split(r"(?<=[.;])\s+", text or "") if s.strip()]


def name_tokens(key):
    return [t for t in key.split() if len(t) > 2 and t not in ("de", "del", "la", "las", "los", "y", "e", "don", "dona")]


def name_spans(sentence, key, raw_names):
    """Character spans where this person's own name sits in the sentence (folded), longest spelling first."""
    f = fold(sentence)
    out = []
    for raw in sorted({fold(r).strip() for r in raw_names} | {key}, key=len, reverse=True):
        if len(raw) < 4:
            continue
        start = 0
        while True:
            i = f.find(raw, start)
            if i < 0:
                break
            if not any(a <= i < b for a, b in out):
                out.append((i, i + len(raw)))
            start = i + 1
    return f, out


def own_age(sentence, key, raw_names, year):
    """Birth year from "de N años" that follows the person's own name with nobody else in between."""
    f, spans = name_spans(sentence, key, raw_names)
    for _a, b in spans:
        tail = f[b : b + 80]
        m = P_AGE_FOLDED.search(tail)
        if m and AGE_GAP.match(tail[: m.start()]):
            age = int(m.group(1))
            if 0 < age < 100 and year:
                return year - age, m.group(0)
    return None


def own_death(sentence, key, raw_names):
    """The sentence calls this person dead by name: "difunto X", "X, difunto", "viuda de X", "albacea de X"."""
    f, spans = name_spans(sentence, key, raw_names)
    for a, b in spans:
        if DEAD_BEFORE.search(f[max(0, a - 60) : a]) or DEAD_AFTER.match(f[b : b + 14]):
            return True
    return False


P_SUBJECT = re.compile(NAME + r"\s*,?\s*$")


def subject_before(sentence, pos):
    """The capitalized name that ends right before position pos ("Luisa Hernández, viuda de …")."""
    head = sentence[:pos]
    head = re.sub(r"\s*,?\s*(?:(?:el|la|don|doña|dona|capitán|capitan|alférez|alferez|sargento mayor|licenciado|presbítero|presbitero|padre|fray|sr\.|dr\.)\s+)*$", "", head, flags=re.I)
    m = P_SUBJECT.search(head)
    return clean_name(m.group(1)) if m else ""


def own_subject(sentence, key, raw_names, pos):
    """This person's name ends within a few words before pos, with nobody else named in between."""
    f, spans = name_spans(sentence, key, raw_names)
    for _a, b in spans:
        if b <= pos and not OTHER_SUBJECT.search(f[b:pos]) and len(f[b:pos].split()) <= 6:
            return True
    return False


def mentions(sentence, key):
    """The person's distinctive tokens appear in this sentence (accent- and case-insensitive)."""
    f = fold(sentence)
    toks = name_tokens(key)
    if not toks:
        return False
    hits = sum(1 for t in toks if re.search(r"\b" + re.escape(t) + r"\b", f))
    return hits >= min(2, len(toks))


def main():
    events = json.load(open(os.path.join(DATA_DIR, "events.json"), encoding="utf-8"))["events"]
    text_es = json.load(open(os.path.join(DATA_DIR, "text_es.json"), encoding="utf-8"))
    facts = collections.defaultdict(lambda: {"roles": collections.Counter(), "age": [], "spouse": collections.defaultdict(set),
                                             "parents": collections.defaultdict(set), "children": collections.defaultdict(set),
                                             "siblings": collections.defaultdict(set), "origin": collections.defaultdict(set),
                                             "residence": collections.defaultdict(set), "born": [], "bapt": [], "marr": [], "will": [], "dead": []})

    # 1. extraction profiles (Cartago index): roles, age hints, relationships
    n_prof = 0
    if os.path.exists(PEOPLE_IN):
        with open(PEOPLE_IN, encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                p = json.loads(line)
                key = fold_person(p.get("name") or "")
                if not key:
                    continue
                n_prof += 1
                fx = facts[key]
                if p.get("role"):
                    fx["roles"][p["role"].strip()] += 1
                if p.get("inferred_age_or_birth"):
                    fx["age"].append([p["inferred_age_or_birth"].strip(), None])
                for r in p.get("relationships") or []:
                    field = REL.get((r.get("relationship_type") or "").strip().lower())
                    other = clean_name(r.get("person_name"))
                    if field and other:
                        fx[field][other].add(None)

    # 2. record summaries, sentence by sentence
    n_sent = 0
    for i, ev in enumerate(events):
        summ = text_es[i] if i < len(text_es) else ""
        if not summ:
            continue
        year = ev.get("y")
        rid = ev["i"]
        raws = collections.defaultdict(set)
        for p in ev.get("p") or []:
            raws[fold_person(p)].add(p)
        keys = set(raws)
        sents = sentences(summ)
        for key in keys:
            if not key:
                continue
            fx = facts[key]
            raw_names = raws[key]
            for s in sents:
                if not mentions(s, key):
                    continue
                n_sent += 1
                for m in P_NATURAL.finditer(s):
                    if clean_name(m.group(1)):
                        fx["origin"][clean_name(m.group(1))].add(rid)
                for m in P_VECINO.finditer(s):
                    if clean_name(m.group(1)):
                        fx["residence"][clean_name(m.group(1))].add(rid)
                m = P_PARENTS.search(s)
                # "X, hijo de A y B": only when this person is X: named right before "hijo de", and not A or B
                if m and not any(g and fold_person(clean_name(g)) == key for g in (m.group(1), m.group(2))) and own_subject(s, key, raw_names, m.start()):
                    for g in (m.group(1), m.group(2)):
                        if g and clean_name(g):
                            fx["parents"][clean_name(g)].add(rid)
                for m in P_SPOUSE.finditer(s):
                    other = clean_name(m.group(1))
                    if not other:
                        continue
                    if fold_person(other) == key:
                        # "Y, viuda de X" where X is this person: the spouse is the subject Y, right before
                        subj = subject_before(s, m.start())
                        if subj and fold_person(subj) != key:
                            fx["spouse"][subj].add(rid)
                    elif own_subject(s, key, raw_names, m.start()):
                        fx["spouse"][other].add(rid)
                age = own_age(s, key, raw_names, year)
                if age:
                    fx["born"].append([age[0], rid, age[1]])
                if year and P_WILL.search(s):
                    fx["will"].append([year, rid])
                if year and own_death(s, key, raw_names):
                    fx["dead"].append([year, rid])
                if year and P_DOTE.search(s):
                    fx["marr"].append([year, rid])
                if year and P_BAPT.search(s):
                    fx["bapt"].append([year, rid])

    # 3. compact output
    out = {}
    for key, fx in facts.items():
        rec = {}
        # The extraction used "son"/"father" in both directions. Two repairs:
        #  - "(daughter of X)" / "(son of X)" on the other name says it is this person's child;
        #  - a name cannot be both parent and child of the same person: keep the side with record
        #    evidence and drop a pair that has none either way (compared without parentheticals).
        surname = name_tokens(key)[-1] if name_tokens(key) else None
        for name in list(fx["parents"]):
            m = re.search(r"\((?:daughter|son|child|hij[oa]) of ([^)]*)\)", name, re.I)
            if m and surname and surname in fold(m.group(1)):
                fx["children"][name] |= fx["parents"].pop(name)

        def base(n):
            return fold(re.sub(r"\s*\([^)]*\)", "", n)).strip()

        children_base = {base(n): n for n in fx["children"]}
        for name in list(fx["parents"]):
            other = children_base.get(base(name))
            if other is None:
                continue
            ev_p = {i for i in fx["parents"][name] if i is not None}
            ev_c = {i for i in fx["children"][other] if i is not None}
            marked_child = bool(re.search(r"\((?:daughter|son|child|hij[oa]) of ", other, re.I))
            if ev_p and not ev_c:
                del fx["children"][other]
            elif (ev_c and not ev_p) or marked_child:
                del fx["parents"][name]
            else:
                del fx["parents"][name]
                del fx["children"][other]
        if fx["roles"]:
            rec["roles"] = fx["roles"].most_common(5)
        if fx["age"]:
            rec["age"] = fx["age"][:6]
        for field in ("spouse", "parents", "children", "siblings", "origin", "residence"):
            items = [[name, sorted(i for i in ids if i is not None)] for name, ids in fx[field].items() if name and fold_person(name) != key]
            if items:
                items.sort(key=lambda x: (-len(x[1]), x[0]))
                rec[field] = items[:8]
        for field in ("born", "bapt", "marr", "will", "dead"):
            if fx[field]:
                seen, items = set(), []
                for it in sorted(fx[field]):
                    if it[1] not in seen:
                        seen.add(it[1])
                        items.append(it)
                rec[field] = items[:8]
        if rec:
            out[key] = rec
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    kb = os.path.getsize(OUT) // 1024
    c = collections.Counter(f for rec in out.values() for f in rec)
    print(f"people.json: {len(out)} people with facts ({kb} KB) from {n_prof} profiles and {n_sent} sentences")
    print("  fields:", dict(c))


if __name__ == "__main__":
    main()
