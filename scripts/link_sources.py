"""
Link every record to the page of the printed index it was extracted from.

The five volumes of the *Índice de los Protocolos de Cartago* on the Internet Archive
carry an OCR text layer. Records were extracted in reading order, and pages are in
reading order too, so we align the two sequences: a banded, monotonic dynamic
program that scores how many of a record's name tokens (people, places) appear on
a page. Output: scripts/data/sources.json, consumed by generate_json_views.py.

Usage:
    python scripts/link_sources.py [--pdf-dir DIR] [--band 250] [--window 8]

Needs `pdftotext` (poppler) and the five PDFs (indicedelosproto0*.pdf) in --pdf-dir
(default: repository root). Per-page text is cached in scripts/data/pages/.
"""

import argparse
import json
import math
import os
import re
import subprocess
import sys
import unicodedata

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "scripts", "data")
EVENTS_FILE = os.path.join(DATA_DIR, "gemini_output", "gemini_events.jsonl")
PAGES_DIR = os.path.join(DATA_DIR, "pages")
OUTPUT = os.path.join(DATA_DIR, "sources.json")

VOLUMES = [
    {"id": "indicedelosproto01arch", "tomo": "I"},
    {"id": "indicedelosproto02cost", "tomo": "II"},
    {"id": "indicedelosproto03arch", "tomo": "III"},
    {"id": "indicedelosproto04arch", "tomo": "IV"},
    {"id": "indicedelosproto05cost", "tomo": "V"},
]

STOP = set(
    """don dona sr sra senor senora capitan alferez sargento mayor maestre campo teniente general
    gobernador licenciado doctor bachiller fray padre presbitero reverendo obispo canonigo cura vicario
    escribano alcalde regidor procurador vecino vecina ciudad valle pueblo villa provincia reino
    de del la las los y e da do dos san santa santo el al en por para con sin sobre esta este ese esa
    cartago costa rica guatemala nicaragua espana mujer hijo hija hijos viuda difunto difunta
    juan jose josef maria francisco francisca pedro diego antonio antonia manuel manuela ana""".split()
)


def fold(s):
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.lower()


def tokens(text):
    return [t for t in re.split(r"[^a-z0-9ñ]+", fold(text)) if len(t) >= 4 and t not in STOP]


def ensure_page_texts(pdf_dir):
    os.makedirs(PAGES_DIR, exist_ok=True)
    pages = []  # [(vol_index, pdf_page_1based, text)]
    for vi, vol in enumerate(VOLUMES):
        txt = os.path.join(PAGES_DIR, f"{vol['id']}.txt")
        if not os.path.exists(txt):
            pdf = os.path.join(pdf_dir, f"{vol['id']}.pdf")
            if not os.path.exists(pdf):
                sys.exit(f"missing {pdf} (and no cached {txt})")
            print(f"pdftotext {os.path.basename(pdf)} …")
            subprocess.run(["pdftotext", "-enc", "UTF-8", pdf, txt], check=True)
        with open(txt, encoding="utf-8") as f:
            parts = f.read().split("\f")
        if parts and not parts[-1].strip():
            parts = parts[:-1]
        for pi, text in enumerate(parts):
            pages.append((vi, pi + 1, text))
        print(f"  tomo {vol['tomo']}: {len(parts)} pages")
    return pages


def printed_page_numbers(vol_pages):
    """
    Printed page numbers for one volume's pages (list of texts), or None where unknown.
    OCR puts the folio number on its own line near the top, but day numbers look the same,
    so instead of trusting each page we find the volume's constant offset
    (pdf page - printed page) as the mode over all candidate numbers, and apply it
    from the first page that agrees with it onwards.
    """
    cands = []
    for i, text in enumerate(vol_pages):
        nums = [int(l.strip()) for l in text.strip().split("\n")[:12] if re.fullmatch(r"\d{1,3}", l.strip())]
        cands.append(nums)
    offsets = {}
    for i, nums in enumerate(cands):
        for n in nums:
            offsets[i + 1 - n] = offsets.get(i + 1 - n, 0) + 1
    if not offsets:
        return [None] * len(vol_pages)
    k = max(offsets, key=offsets.get)
    first = next((i for i, nums in enumerate(cands) if (i + 1 - k) in nums), None)
    return [(i + 1 - k) if first is not None and i >= first and i + 1 - k > 0 else None for i in range(len(vol_pages))]


def load_events():
    events = []
    with open(EVENTS_FILE, encoding="utf-8") as f:
        for i, line in enumerate(f):
            line = line.strip()
            if line:
                e = json.loads(line)
                e.setdefault("id", i + 1)
                events.append(e)
    events.sort(key=lambda e: e["id"])
    return events


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf-dir", default=ROOT)
    ap.add_argument("--band", type=int, default=700, help="pages either side of the expected position")
    ap.add_argument("--window", type=int, default=8, help="max pages a record may advance past the previous one")
    ap.add_argument("--jump-penalty", type=float, default=0.06)
    args = ap.parse_args()

    pages = ensure_page_texts(args.pdf_dir)
    events = load_events()
    M, N = len(pages), len(events)
    print(f"{N} records, {M} pages")

    # Page vocabularies (exact words plus 5-letter prefixes, to forgive OCR tails).
    page_words = []
    df = {}
    for _, _, text in pages:
        words = set(tokens(text))
        words |= {w[:5] for w in words}
        page_words.append(words)
        for w in words:
            df[w] = df.get(w, 0) + 1

    def weight(tok):
        return math.log((M + 1) / (df.get(tok, 0) + 1))

    rec_tokens = []
    for e in events:
        toks = set()
        for name in (e.get("people_involved") or []) + (e.get("locations") or []):
            toks.update(tokens(name))
        rec_tokens.append([(t, weight(t)) for t in toks])

    def score(i, j):
        toks = rec_tokens[i]
        if not toks:
            return 0.0
        total = sum(w for _, w in toks)
        if total <= 0:
            return 0.0
        words = page_words[j]
        hit = sum(w for t, w in toks if t in words or t[:5] in words)
        return hit / total

    # Banded monotonic DP. Band for record i is centred on its proportional position.
    B, W, pen = args.band, args.window, args.jump_penalty
    NEG = -1e9
    centers = [int(round(i * (M - 1) / max(1, N - 1))) for i in range(N)]
    starts = [max(0, c - B) for c in centers]
    width = 2 * B + 1
    dp_prev = None
    back = np.zeros((N, width), dtype=np.int16)  # offset (0..W) back to previous page, relative

    for i in range(N):
        s0 = starts[i]
        row_scores = np.full(width, NEG, dtype=np.float32)
        for k in range(width):
            j = s0 + k
            if j >= M:
                break
            row_scores[k] = score(i, j)
        if dp_prev is None:
            dp = row_scores.copy()
        else:
            shift = s0 - starts[i - 1]  # band moved forward by `shift` pages (0 or 1)
            prev = np.full(width + W, NEG, dtype=np.float32)
            # prev[k + W - d] holds dp_prev for page (s0 + k - d)
            src = np.full(width, NEG, dtype=np.float32)
            if shift < width:
                src[: width - shift] = dp_prev[shift:]
            best = np.full(width, NEG, dtype=np.float32)
            arg = np.zeros(width, dtype=np.int16)
            for d in range(W + 1):
                cand = np.full(width, NEG, dtype=np.float32)
                if d == 0:
                    cand[:] = src
                else:
                    cand[d:] = src[:-d]
                cand = cand - pen * d
                better = cand > best
                best[better] = cand[better]
                arg[better] = d
            dp = np.where(row_scores > NEG / 2, row_scores + best, NEG)
            back[i] = arg
        dp_prev = dp
        if i % 2000 == 0:
            print(f"  aligned {i}/{N}")

    # Backtrack.
    assign = [0] * N
    k = int(np.argmax(dp_prev))
    j = starts[N - 1] + k
    for i in range(N - 1, -1, -1):
        assign[i] = j
        if i > 0:
            j = j - int(back[i][j - starts[i]])

    printed = {}
    for vi in range(len(VOLUMES)):
        texts = [t for v, _, t in pages if v == vi]
        printed[vi] = printed_page_numbers(texts)

    records = []
    confs = []
    for i, e in enumerate(events):
        j = assign[i]
        vi, pdf_page, text = pages[j]
        c = round(score(i, j), 2)
        confs.append(c)
        records.append([vi, pdf_page, printed[vi][pdf_page - 1], c])

    out = {
        "volumes": [{"id": v["id"], "tomo": v["tomo"], "pages": sum(1 for p in pages if p[0] == i)} for i, v in enumerate(VOLUMES)],
        "records": records,  # index = record id - 1: [volume index, pdf page (1-based), printed page or null, confidence 0..1]
    }
    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    conf = np.array(confs)
    print(f"wrote {OUTPUT}")
    print(f"confidence: mean {conf.mean():.2f} · ≥0.5: {(conf >= 0.5).mean():.0%} · =0: {(conf == 0).mean():.0%}")
    per_vol = {}
    for r in records:
        per_vol[r[0]] = per_vol.get(r[0], 0) + 1
    print("records per volume:", {VOLUMES[k]["tomo"]: v for k, v in sorted(per_vol.items())})


if __name__ == "__main__":
    main()
