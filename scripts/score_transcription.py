"""
Score model transcriptions of a leaf against a hand-corrected ground truth, and prepare that ground truth.

    python scripts/score_transcription.py --source cabildo-guatemala-11 --leaf 4 --template
        writes scripts/data/sources/<source>/ground_truth/4.txt pre-filled with the best available model
        reading of leaf 4, for a paleographer to correct by hand (delete the leading '#' lines when done).

    python scripts/score_transcription.py --source cabildo-guatemala-11 --leaf 4
        compares every pages*.jsonl in the source folder against ground_truth/4.txt and prints
        character error rate (CER) and word error rate (WER) per model, plus a side-by-side file
        ground_truth/compare_4.md.

Text is normalised before scoring: line marks " / " become spaces, whitespace collapses, case is folded,
[?] confidence marks are dropped, and bracketed expansions keep their content ([merce]d -> merced).
A spread (left + right page) is scored as one text, left then right, matching the template layout.
"""

import argparse
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "scripts", "data")

SIDE_MARK = "=== right ==="  # separates left/right pages inside a ground-truth file


def normalise(text):
    text = text.replace("[?]", "")
    text = re.sub(r"\[([^\]]*)\]", r"\1", text)  # keep expansions, drop brackets ([...] -> ...)
    text = text.replace(" / ", " ").replace("/", " ")
    text = re.sub(r"\s+", " ", text).strip().lower()
    return text


def levenshtein(a, b):
    """Edit distance between two sequences (lists or strings)."""
    if len(a) < len(b):
        a, b = b, a
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i]
        for j, y in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y)))
        prev = cur
    return prev[-1]


def page_text(row):
    parts = []
    for side in ("left", "right"):
        p = row.get(side)
        if p and p.get("transcription"):
            parts.append(p["transcription"])
    return (chr(10) + SIDE_MARK + chr(10)).join(parts)


def load_leaf(path, leaf):
    with open(path, encoding="utf-8") as f:
        for line in f:
            if line.strip():
                row = json.loads(line)
                if row["leaf"] == leaf:
                    return row
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True)
    ap.add_argument("--leaf", type=int, required=True)
    ap.add_argument("--template", action="store_true", help="write ground_truth/<leaf>.txt to be corrected")
    args = ap.parse_args()

    src_dir = os.path.join(DATA, "sources", args.source)
    gt_dir = os.path.join(src_dir, "ground_truth")
    gt_file = os.path.join(gt_dir, f"{args.leaf}.txt")
    outputs = sorted(glob.glob(os.path.join(src_dir, "pages*.jsonl")))
    readings = {}
    for path in outputs:
        row = load_leaf(path, args.leaf)
        if row:
            readings[os.path.basename(path)] = row

    if not readings:
        sys.exit(f"leaf {args.leaf} is not in any pages*.jsonl under {src_dir}")

    if args.template:
        if os.path.exists(gt_file):
            sys.exit(f"{gt_file} already exists; correct it in place or delete it first")
        os.makedirs(gt_dir, exist_ok=True)
        # Seed with the reading that claims the highest legibility, so the corrector starts from the best draft.
        def leg(row):
            return max((p or {}).get("legibility") or 0 for p in (row.get("left"), row.get("right")))
        best_name, best = max(readings.items(), key=lambda kv: leg(kv[1]))
        header = [
            f"# Ground truth for leaf {args.leaf} of {args.source} ({best['file']})",
            f"# Seeded from {best_name} ({best['model']}). Correct every line against the image, keep ' / ' as",
            f"# the line separator and '{SIDE_MARK}' between the two pages of a spread. Delete these '#' lines",
            "# when the page is fully corrected; the scorer and the few-shot prompt ignore files that still start with '#'.",
            "",
        ]
        with open(gt_file, "w", encoding="utf-8") as f:
            f.write(chr(10).join(header) + page_text(best) + chr(10))
        print(f"template written: {gt_file}")
        return

    if not os.path.exists(gt_file):
        sys.exit(f"no ground truth yet: run with --template, then correct {gt_file}")
    with open(gt_file, encoding="utf-8") as f:
        gt_raw = f.read()
    if gt_raw.lstrip().startswith("#"):
        sys.exit(f"{gt_file} still has its '#' header lines: finish correcting it and delete them")
    gt = normalise(gt_raw)
    gt_words = gt.split()

    print(f"leaf {args.leaf}: {len(gt)} chars, {len(gt_words)} words of ground truth")
    print(f"{'output':34} {'model':24} {'CER':>7} {'WER':>7}")
    lines = [f"# Leaf {args.leaf} of {args.source}: model readings vs ground truth", "", "## Ground truth", "", gt_raw.strip(), ""]
    for name, row in readings.items():
        hyp = normalise(page_text(row))
        cer = levenshtein(hyp, gt) / max(1, len(gt))
        wer = levenshtein(hyp.split(), gt_words) / max(1, len(gt_words))
        print(f"{name:34} {row['model']:24} {cer:7.3f} {wer:7.3f}")
        lines += [f"## {name} ({row['model']}, CER {cer:.3f}, WER {wer:.3f})", "", page_text(row).strip(), ""]
    cmp_file = os.path.join(gt_dir, f"compare_{args.leaf}.md")
    with open(cmp_file, "w", encoding="utf-8") as f:
        f.write(chr(10).join(lines))
    print(f"side-by-side: {cmp_file}")


if __name__ == "__main__":
    main()
