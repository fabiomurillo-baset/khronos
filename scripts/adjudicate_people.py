"""
People resolution, phase 2: a model reads the summaries where the arithmetic could not decide.

Phase 1 (resolve_people.py) leaves two kinds of open questions:
  * splits whose boundary is `arbitrary`: only the 85-year rule separated the lives and they touch,
    so a father and a son with one name are in there somewhere, but the cut was placed blindly;
  * merges scored 0.5–0.75: a subset or similar name with compatible years and no shared relation.

This script sends each question to Gemini with the record summaries as context and stores one
decision per question in scripts/data/resolution/adjudications.jsonl. resolve_people.py reads that
file on its next run and applies the decisions (moves a cut, drops a split, raises or drops a
merge), so the proposals the app shows carry the model's reading and reason. Nothing is applied
to the data: a decision is still a proposal until a person accepts it in the app.

Resumable (questions already answered are skipped), budgeted (--max-cost stops the run), and
cheap by design: a question costs a few thousand input tokens and ~100 output tokens.

    set GEMINI_API_KEY=...
    python scripts/adjudicate_people.py --limit 5 --dry-run     # print the first prompts, call nothing
    python scripts/adjudicate_people.py --limit 20              # trial
    python scripts/adjudicate_people.py --max-cost 3            # everything, stop at ~3 USD
    python scripts/adjudicate_people.py --mock                   # plumbing test without a key
    python scripts/resolve_people.py                             # apply the decisions to the proposals
"""

import argparse
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "cartago-web", "public", "data")
RES = os.path.join(ROOT, "scripts", "data", "resolution")
OUT = os.path.join(RES, "adjudications.jsonl")

# USD per 1M tokens (input, output); used only for the running estimate and --max-cost
PRICES = {"gemini-2.5-flash": (0.30, 2.50), "gemini-2.5-pro": (1.25, 10.0), "gemini-3.1-pro": (2.0, 12.0), "gemini-3-flash": (0.5, 3.0)}

CONTEXT = (
    "Eres un genealogista que trabaja con el Índice de los Protocolos de Cartago (Costa Rica, 1540–1839) "
    "y las actas del Cabildo de Guatemala. Cada registro es el resumen de una escritura notarial con su año. "
    "Los nombres se repiten de padres a hijos y nietos; los títulos cambian a lo largo de una carrera "
    "(alférez, capitán, sargento mayor); una persona aparece como difunta en escrituras posteriores a su "
    "muerte (testamentos, herencias, viudas). Razona con fechas, edades, cónyuges, padres, cargos y vecindad. "
    "Responde solo con el JSON pedido."
)

SPLIT_SCHEMA = {
    "type": "object",
    "properties": {
        "n_persons": {"type": "integer"},
        "assignments": {"type": "array", "items": {"type": "object", "properties": {"record": {"type": "integer"}, "person": {"type": "integer"}}, "required": ["record", "person"]}},
        "confidence": {"type": "number"},
        "reason": {"type": "string"},
    },
    "required": ["n_persons", "assignments", "confidence", "reason"],
}
MERGE_SCHEMA = {
    "type": "object",
    "properties": {
        "verdicts": {"type": "array", "items": {"type": "object", "properties": {"pair": {"type": "string"}, "verdict": {"type": "string", "enum": ["same", "different", "unsure"]}, "confidence": {"type": "number"}, "reason": {"type": "string"}}, "required": ["pair", "verdict", "confidence", "reason"]}},
    },
    "required": ["verdicts"],
}


def load():
    events = json.load(open(os.path.join(DATA, "events.json"), encoding="utf-8"))["events"]
    texts = json.load(open(os.path.join(DATA, "text_es.json"), encoding="utf-8"))
    pos = {e["i"]: i for i, e in enumerate(events)}
    summary = lambda rid: (texts[pos[rid]] if rid in pos and pos[rid] < len(texts) else "") or ""
    year = lambda rid: events[pos[rid]].get("y") if rid in pos else None
    persons = {p["id"]: p for p in json.load(open(os.path.join(RES, "persons.json"), encoding="utf-8"))["persons"]}
    proposals = [json.loads(l) for l in open(os.path.join(RES, "proposals.jsonl"), encoding="utf-8") if l.strip()]
    for m in proposals:
        if m["type"] == "merge":
            m["id"] = f"merge:{m['a']}:{m['b']}"  # the id the app and resolve_people.py use
    return summary, year, persons, proposals


def record_line(rid, year, summary, width=260):
    y = year(rid)
    s = summary(rid).replace("\n", " ")
    return f"- #{rid} ({'≈' if y is None else y}): {s[:width]}{'…' if len(s) > width else ''}"


def split_question(sp, persons, year, summary, max_records=40):
    """Prompt for one arbitrary-boundary split: the lives and the records around each cut."""
    lives = [persons[x["id"]] for x in sp["into"]]
    all_ids = [rid for p in lives for rid in p["records"]]
    shown = []
    if len(all_ids) <= max_records:
        shown = all_ids
    else:
        for i in range(len(lives) - 1):
            shown += lives[i]["records"][-8:] + lives[i + 1]["records"][:8]
        shown = sorted(set(shown), key=lambda r: (year(r) or 0, r))
    lines = "\n".join(record_line(r, year, summary) for r in shown)
    plan = "\n".join(f"  persona {i + 1}: {p['span'][0]}–{p['span'][1] if p.get('span') else '?'}, {len(p['records'])} registros" if p.get("span") else f"  persona {i + 1}: sin fecha, {len(p['records'])} registros" for i, p in enumerate(lives))
    prompt = (
        f"{CONTEXT}\n\nNombre: «{sp['key']}». Un programa dividió sus {len(all_ids)} registros en {len(lives)} personas "
        f"solo porque juntos abarcan más de 85 años; el corte es arbitrario:\n{plan}\n\n"
        f"Registros{' (los cercanos a cada corte)' if len(shown) < len(all_ids) else ''}:\n{lines}\n\n"
        "Decide cuántas personas distintas hay entre estos registros y asigna cada registro mostrado a una persona "
        "(1, 2, 3… en orden cronológico). Si todos pueden ser una sola persona, n_persons = 1. "
        "Da una confianza de 0 a 1 y una razón breve con las pistas que usaste."
    )
    return {"id": sp["key"], "type": "split", "shown": shown, "prompt": prompt}


def merge_question(batch, persons, year, summary, per_side=4):
    """Prompt for up to ten uncertain merges at once."""
    blocks = []
    for m in batch:
        a, b = persons[m["a"]], persons[m["b"]]
        def side(p, tag):
            recs = p["records"]
            pick = recs[:per_side] if len(recs) <= per_side else recs[:2] + recs[-2:]
            facts = []
            for f in ("spouse", "parents", "residence"):
                if p.get(f):
                    facts.append(f"{f}: " + ", ".join(n for n, _ in p[f][:3]))
            if p.get("born"):
                facts.append(f"nacido ≈{p['born'][0]}")
            if p.get("dead_by"):
                facts.append(f"difunto antes de {p['dead_by'][0]}")
            span = f"{p['span'][0]}–{p['span'][1]}" if p.get("span") else "sin fecha"
            return f"  {tag}) «{p['name']}» ({span}; {len(recs)} registros){'; ' + '; '.join(facts) if facts else ''}\n" + "\n".join("    " + record_line(r, year, summary, 200) for r in pick)
        blocks.append(f"Par {m['id']} (parecido de nombre {m['confidence']:.2f}; {' · '.join(m['reasons'])}):\n{side(a, 'A')}\n{side(b, 'B')}")
    prompt = (
        f"{CONTEXT}\n\nPara cada par, decide si A y B son la misma persona (same), personas distintas (different) "
        f"o no se puede saber con estos registros (unsure). Confianza de 0 a 1 y razón breve.\n\n" + "\n\n".join(blocks)
    )
    return {"id": "|".join(m["id"] for m in batch), "type": "merge", "pairs": [m["id"] for m in batch], "prompt": prompt}


def call_gemini(client, model, prompt, schema, temperature):
    from google.genai import types

    for attempt in range(5):
        try:
            r = client.models.generate_content(
                model=model,
                contents=prompt,
                config=types.GenerateContentConfig(response_mime_type="application/json", response_schema=schema, temperature=temperature, max_output_tokens=4096),
            )
            usage = r.usage_metadata
            return json.loads(r.text), (usage.prompt_token_count or 0, (usage.candidates_token_count or 0) + (getattr(usage, "thoughts_token_count", 0) or 0))
        except Exception as e:  # noqa: BLE001
            wait = 2 ** attempt
            print(f"  retry {attempt + 1}: {e} (waiting {wait}s)", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError("gave up after 5 attempts")


def mock_answer(q):
    if q["type"] == "split":
        return {"n_persons": 2, "assignments": [{"record": r, "person": 1 if i < len(q["shown"]) // 2 else 2} for i, r in enumerate(q["shown"])], "confidence": 0.5, "reason": "mock"}, (len(q["prompt"]) // 4, 120)
    return {"verdicts": [{"pair": p, "verdict": "unsure", "confidence": 0.5, "reason": "mock"} for p in q["pairs"]]}, (len(q["prompt"]) // 4, 60)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="gemini-2.5-flash")
    ap.add_argument("--temperature", type=float, default=1.0)
    ap.add_argument("--limit", type=int, default=None, help="answer at most this many questions")
    ap.add_argument("--max-cost", type=float, default=None, help="stop when the estimated spend (USD) reaches this")
    ap.add_argument("--only", choices=["split", "merge"], default=None)
    ap.add_argument("--merge-low", type=float, default=0.5)
    ap.add_argument("--merge-high", type=float, default=0.75)
    ap.add_argument("--batch", type=int, default=10, help="merge pairs per call")
    ap.add_argument("--dry-run", action="store_true", help="print prompts, call nothing, write nothing")
    ap.add_argument("--mock", action="store_true", help="no API: canned answers, to test the plumbing")
    args = ap.parse_args()

    summary, year, persons, proposals = load()
    done = set()
    if os.path.exists(OUT):
        for l in open(OUT, encoding="utf-8"):
            if l.strip():
                done.add(json.loads(l)["id"])

    questions = []
    if args.only != "merge":
        for sp in proposals:
            if sp["type"] == "split" and sp.get("boundary") == "arbitrary" and sp["key"] not in done:
                questions.append(split_question(sp, persons, year, summary))
    if args.only != "split":
        pending = [m for m in proposals if m["type"] == "merge" and args.merge_low <= m["confidence"] < args.merge_high and m["id"] not in done and m["a"] in persons and m["b"] in persons]
        for i in range(0, len(pending), args.batch):
            questions.append(merge_question(pending[i : i + args.batch], persons, year, summary))
    if args.limit:
        questions = questions[: args.limit]
    print(f"{len(questions)} questions to ask ({len(done)} already answered)")

    if args.dry_run:
        for q in questions[:3]:
            print("\n" + "=" * 100 + f"\n{q['type']} {q['id']}\n" + q["prompt"])
        return

    client = None
    if not args.mock:
        key = os.environ.get("GEMINI_API_KEY")
        if not key:
            raise SystemExit("Set GEMINI_API_KEY (or use --mock / --dry-run).")
        from google import genai

        client = genai.Client(api_key=key)

    price = PRICES.get(args.model)
    spent = 0.0
    tokens_in = tokens_out = 0
    with open(OUT, "a", encoding="utf-8") as out:
        for n, q in enumerate(questions, 1):
            if args.mock:
                answer, (ti, to) = mock_answer(q)
            else:
                answer, (ti, to) = call_gemini(client, args.model, q["prompt"], SPLIT_SCHEMA if q["type"] == "split" else MERGE_SCHEMA, args.temperature)
            tokens_in += ti
            tokens_out += to
            if price:
                spent += ti * price[0] / 1e6 + to * price[1] / 1e6
            rows = []
            if q["type"] == "split":
                groups = {}
                for a in answer.get("assignments", []):
                    groups.setdefault(int(a["person"]), []).append(int(a["record"]))
                rows.append({"id": q["id"], "type": "split", "n_persons": int(answer.get("n_persons", len(groups))), "groups": [sorted(groups[k]) for k in sorted(groups)], "shown": q["shown"], "confidence": float(answer.get("confidence", 0)), "reason": answer.get("reason", ""), "model": "mock" if args.mock else args.model, "tokens": [ti, to]})
            else:
                for v in answer.get("verdicts", []):
                    if v.get("pair") in q["pairs"]:
                        rows.append({"id": v["pair"], "type": "merge", "verdict": v["verdict"], "confidence": float(v.get("confidence", 0)), "reason": v.get("reason", ""), "model": "mock" if args.mock else args.model, "tokens": [ti // len(q["pairs"]), to // len(q["pairs"])]})
                # a batch is only "done" per pair; pairs the model skipped get asked again next run
            for r in rows:
                out.write(json.dumps(r, ensure_ascii=False) + "\n")
            out.flush()
            print(f"[{n}/{len(questions)}] {q['type']} {q['id'][:60]}  tokens {ti}+{to}" + (f"  ≈${spent:.3f}" if price else ""))
            if args.max_cost and spent >= args.max_cost:
                print(f"budget reached (${spent:.2f}); stopping. Rerun to continue.")
                break
    print(f"done: {tokens_in} input + {tokens_out} output tokens" + (f", ≈${spent:.2f}" if price else ""))


if __name__ == "__main__":
    main()
