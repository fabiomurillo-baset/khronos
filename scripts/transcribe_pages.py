"""
Transcribe the pages of a digitized manuscript (or any scanned work) with Gemini and
extract dated entries from them, so a new source can join Khronos as its own collection.

    python scripts/transcribe_pages.py --source cabildo-guatemala-11 --images cabildo-guatemala-images
    python scripts/transcribe_pages.py --source cabildo-guatemala-11 --ia libro-once-de-cabildo   # once the Archive has derived the item

`--source` names an entry of scripts/data/collections.json (the registry of ingested works,
which also fixes the record id range and the Archive identifier used for links).
Output: scripts/data/sources/<source>/pages.jsonl — one line per page image:

    {"leaf": 100, "folio": "48", "transcription": "...", "marginalia": ["..."],
     "entries": [{"date": "1620-03-12", "year": 1620, "summary_es": "...", "people": [...], "locations": [...], "kind": "acuerdo"}],
     "legibility": 0.6, "model": "gemini-2.5-pro"}

Resumable: pages already in the output are skipped. Images are downscaled before upload.
Backends, chosen by the model name:
  gemini-*    GEMINI_API_KEY   (google-genai)
  deepseek-*  DEEPSEEK_API_KEY (OpenAI-compatible endpoint; only deepseek-flash takes images)
  claude-*    ANTHROPIC_API_KEY (anthropic SDK; --effort low|medium|high|xhigh|max, default high)
`--out NAME` writes to scripts/data/sources/<source>/NAME instead of pages.jsonl, so several models can be
run on the same leaves for a pilot and scored with scripts/score_transcription.py.
Few-shot: corrected pages in scripts/data/sources/<source>/ground_truth/<leaf>.txt are quoted in the prompt
as samples of the scribe's hand (the leaf being transcribed is never quoted to itself).
Spreads (two pages in one image) are transcribed as left/right.
"""

import argparse
import base64
import io
import json
import os
import re
import sys
import time
import urllib.request

from google import genai
from google.genai import types

try:
    import anthropic
except ImportError:  # only needed for claude-* models
    anthropic = None
from PIL import Image
from pydantic import BaseModel, Field

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "scripts", "data")
REGISTRY = os.path.join(DATA, "collections.json")
DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"

# USD per 1M tokens (input, output incl. thinking) for the estimate printed per page; unknown models print tokens only.
PRICES = {
    "gemini-3.1-pro-preview": (2.00, 12.00),
    "gemini-3.8-flash": (0.75, 3.75),
    "gemini-3-flash-preview": (0.50, 3.00),
    "claude-opus-5-5": (4.00, 20.00),
    "claude-sonnet-5-5": (2.00, 10.00),
    "deepseek-flash": (0.14, 0.28),
}


def est_cost(model, usage):
    pr = PRICES.get(model)
    if not pr or not usage:
        return None
    out = (usage.get("output") or 0) + (usage.get("thoughts") or 0)
    return (usage.get("input") or 0) * pr[0] / 1e6 + out * pr[1] / 1e6


class Entry(BaseModel):
    date: str | None = Field(description="ISO date YYYY-MM-DD when the entry gives one, else YYYY-MM or YYYY, else null")
    year: int | None = Field(description="Year of the entry if it can be read or inferred from context on this page")
    kind: str | None = Field(description="Type of entry: acuerdo, nombramiento, petición, pregón, auto, testimonio, cuentas, etc.")
    summary_es: str = Field(description="Resumen de 1-3 oraciones en español moderno de lo que se trata, con nombres y cargos")
    people: list[str] = Field(description="Full names as written, modern spelling of first name + surnames; include title/role in parentheses if given")
    locations: list[str] = Field(description="Places mentioned (towns, valleys, provinces, buildings)")


class PageReading(BaseModel):
    folio: str | None = Field(description="Folio number written on the page (e.g. '48', '48v'), null if none")
    transcription: str = Field(description="Diplomatic transcription in Spanish, line breaks preserved with '/', abbreviations expanded in [brackets], illegible stretches as [...]")
    marginalia: list[str] = Field(description="Marginal headings/notes, transcribed")
    entries: list[Entry] = Field(description="Distinct dated acts or matters on the page; split a long session into its separate matters")
    legibility: float = Field(description="0-1: how much of the page you could read with confidence")


class Spread(BaseModel):
    left: PageReading | None = Field(description="Left page (verso), null if blank or absent")
    right: PageReading | None = Field(description="Right page (recto), null if blank or absent")


PROMPT = """Eres un paleógrafo experto en escritura procesal y procesal encadenada del siglo XVII (América española).
La imagen es una página o un pliego (dos páginas) de: {title} ({years}). Tipo de documento: {doctype}.

Tareas, para cada página visible (izquierda y derecha si es un pliego):
1. Transcripción diplomática en español: respeta la grafía original, desarrolla abreviaturas entre [corchetes], marca saltos de línea con " / ", usa [...] para lo ilegible y [?] tras lecturas dudosas. No inventes texto: si una zona no se lee, déjala como [...].
2. Notas marginales (encabezados al margen, "ojo", rúbricas descritas como [rúbrica]).
3. Lista de asuntos o actos fechados de la página: fecha (en ISO si se lee), tipo, resumen en español moderno, personas (nombre completo con cargo entre paréntesis), lugares.
4. Número de folio si aparece escrito.
5. Legibilidad estimada (0-1): fracción de las palabras de la página que leíste con confianza.

Marcas de confianza por palabra: pon [?] inmediatamente después de cada palabra que leas con duda, no al final de la línea. Una palabra que no se lee en absoluto es [...]. No des una lectura "probable" sin marcarla.

Fórmulas propias de las actas de cabildo de Santiago de Guatemala en esta época; úsalas para orientar la lectura, pero transcribe lo que está escrito, no la fórmula de memoria:
- Apertura: "En la ciudad de Santiago de Guatemala a [día] días del mes de [mes] de mil y seiscientos y [año] años, se juntaron a cabildo según lo han de uso y costumbre los señores justicia y regimiento desta ciudad, conviene a saber [nombres y cargos]..."
- Cargos frecuentes: alcalde hordinario, rregidor, alférez mayor, alguacil mayor, fiel executor, depositario general, procurador síndico, escribano de cabildo, provincial de la Santa Hermandad, mayordomo de la ciudad, corregidor del valle.
- Asuntos frecuentes: postura y remate del abasto de carne y de velas, sementeras y pan, propios y rentas, fiestas (Corpus, San Juan, Santiago), nombramientos de oficios por año nuevo, peticiones de vecinos, pregones, fianzas, cartas de la Audiencia y del Rey.
- Abreviaturas usuales: q = que; dho/dha = dicho/dicha; mrd = merced; Magd = Majestad; scrivo/sno = escribano; rregor = regidor; alde = alcalde; procor = procurador; ciud = ciudad; Guata = Guatemala; Sant = Santiago; nro = nuestro; pa = para; po = pero; dsta = desta; ss = señores; ffs = firmas.
- Cierre: "y con esto se acabó este cabildo y lo firmaron" seguido de firmas y rúbricas; "ante mí" y el nombre del escribano.

Contexto útil: {context}
Si la imagen es una sola página, devuelve solo "right" y deja "left" en null.
"""

GROUND_TRUTH_INTRO = """
Muestras de transcripción correcta de este mismo escribano, tomadas de otros folios del mismo libro
(te sirven para reconocer la mano, las abreviaturas y las fórmulas; no copies su contenido):
"""

GROUND_TRUTH_MAX = 3  # corrected pages quoted as few-shot examples


def load_ground_truth(out_dir, skip_leaf=None):
    """Corrected transcriptions in ground_truth/<leaf>.txt, as (leaf, text) sorted by leaf."""
    d = os.path.join(out_dir, "ground_truth")
    if not os.path.isdir(d):
        return []
    rows = []
    for f in os.listdir(d):
        m = re.fullmatch(r"(\d+)\.txt", f)
        if not m or int(m.group(1)) == skip_leaf:
            continue
        with open(os.path.join(d, f), encoding="utf-8") as fh:
            text = fh.read().strip()
        if text and not text.startswith("#"):
            rows.append((int(m.group(1)), text))
    return sorted(rows)[:GROUND_TRUTH_MAX]


def with_examples(prompt, examples):
    if not examples:
        return prompt
    blocks = [f"--- folio (hoja {leaf}) ---{chr(10)}{text}" for leaf, text in examples]
    return prompt + GROUND_TRUTH_INTRO + (chr(10) * 2).join(blocks) + chr(10)



def load_registry():
    with open(REGISTRY, encoding="utf-8") as f:
        return json.load(f)["sources"]


def list_images(args, source):
    if args.images:
        d = os.path.join(ROOT, args.images) if not os.path.isabs(args.images) else args.images
        files = sorted(f for f in os.listdir(d) if re.search(r"\.(jpe?g|png|tiff?)$", f, re.I))
        # Leaf = position in the sorted list (1-based). Keep the file name for traceability.
        return [(i + 1, os.path.join(d, f)) for i, f in enumerate(files)]
    if args.ia:
        count = int(source.get("leaves") or 0)
        if not count:
            meta = json.load(urllib.request.urlopen(f"https://archive.org/metadata/{args.ia}"))
            count = int(meta["metadata"].get("imagecount") or 0)
            if not count:
                sys.exit("The Archive has not derived this item yet (no imagecount); use --images meanwhile.")
        return [(n + 1, f"https://archive.org/download/{args.ia}/page/n{n}_w2000.jpg") for n in range(count)]
    sys.exit("give --images DIR or --ia IDENTIFIER")


def load_image(path_or_url, max_side):
    if path_or_url.startswith("http"):
        data = urllib.request.urlopen(path_or_url, timeout=120).read()
        im = Image.open(io.BytesIO(data))
    else:
        im = Image.open(path_or_url)
    im = im.convert("L")  # microfilm-like scans: grayscale keeps the strokes, shrinks the upload
    scale = max_side / max(im.size)
    if scale < 1:
        im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def deepseek_read(api_key, model, jpeg, prompt, max_output=8192):
    """One page through DeepSeek's chat endpoint, JSON mode, validated against Spread."""
    schema = json.dumps(Spread.model_json_schema(), ensure_ascii=False)
    body = {
        "model": model,
        "temperature": 0.1,
        "max_tokens": max_output,
        "response_format": {"type": "json_object"},
        "messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()}},
            {"type": "text", "text": prompt + "\nResponde únicamente con un objeto JSON que cumpla este esquema (sin texto fuera del JSON):\n" + schema},
        ]}],
    }
    req = urllib.request.Request(
        DEEPSEEK_URL, data=json.dumps(body).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=900) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{e.code} {e.read().decode('utf-8', 'replace')[:300]}") from e
    text = data["choices"][0]["message"]["content"].strip()
    if text.startswith("```"):
        text = text.strip("`").removeprefix("json").strip()
    u = data.get("usage") or {}
    usage = {"input": u.get("prompt_tokens"), "output": u.get("completion_tokens"),
             "thoughts": (u.get("completion_tokens_details") or {}).get("reasoning_tokens"), "total": u.get("total_tokens")}
    return Spread.model_validate_json(text).model_dump(), usage


def claude_read(client, model, effort, jpeg, prompt, max_output=8192):
    """One page through the Messages API with structured output validated against Spread."""
    resp = client.messages.parse(
        model=model,
        max_tokens=max_output,
        output_config={"effort": effort},
        messages=[{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                         "data": base64.b64encode(jpeg).decode()}},
            {"type": "text", "text": prompt},
        ]}],
        output_format=Spread,
    )
    if resp.stop_reason == "refusal":
        raise RuntimeError(f"refusal: {getattr(resp, 'stop_details', None)}")
    if resp.stop_reason == "max_tokens":
        raise RuntimeError("max_tokens reached before the JSON was complete")
    usage = {"input": resp.usage.input_tokens, "output": resp.usage.output_tokens, "thoughts": None,
             "total": resp.usage.input_tokens + resp.usage.output_tokens}
    return resp.parsed_output.model_dump(), usage


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, help="id in scripts/data/sources.json")
    ap.add_argument("--images", help="folder of page images (sorted by name = leaf order)")
    ap.add_argument("--ia", help="Internet Archive identifier (page images are fetched from the Archive)")
    ap.add_argument("--model", default="gemini-2.5-pro", help="gemini-* id, deepseek-flash, or claude-opus-5-5 (best for procesal; see --effort)")
    ap.add_argument("--max-side", type=int, default=2600)
    ap.add_argument("--limit", type=int, default=0, help="stop after N pages (for a trial run)")
    ap.add_argument("--start", type=int, default=1, help="first leaf to process")
    ap.add_argument("--leaves", default="", help="comma-separated leaf numbers to process (overrides --start/--limit)")
    ap.add_argument("--effort", default="high", choices=["low", "medium", "high", "xhigh", "max"],
                    help="reasoning effort for claude-* models")
    ap.add_argument("--out", default="pages.jsonl", help="output file name inside the source folder")
    ap.add_argument("--pause", type=float, default=4.0, help="seconds to wait between pages (rate-limit pacing)")
    ap.add_argument("--thinking", choices=["low", "medium", "high"], default=None,
                    help="Gemini thinking_level (default: the model's own default, which bills heavily on hard pages)")
    ap.add_argument("--budget", type=float, default=0.0, help="stop once the estimated spend of this run reaches this many USD")
    ap.add_argument("--temperature", type=float, default=1.0,
                    help="sampling temperature; Gemini 3 loops at low values, keep 1.0 there")
    ap.add_argument("--max-output", type=int, default=8192,
                    help="output token ceiling per page; a repetition loop then costs cents instead of dollars")
    args = ap.parse_args()

    use_deepseek = args.model.startswith("deepseek")
    use_claude = args.model.startswith("claude")
    key_var = "DEEPSEEK_API_KEY" if use_deepseek else "ANTHROPIC_API_KEY" if use_claude else "GEMINI_API_KEY"
    api_key = os.environ.get(key_var)
    if not api_key:
        sys.exit(f"Set {key_var}")
    if use_deepseek:
        client = None
    elif use_claude:
        if anthropic is None:
            sys.exit("pip install anthropic")
        client = anthropic.Anthropic(api_key=api_key, max_retries=3, timeout=900)
    else:
        client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=300_000))

    sources = {s["id"]: s for s in load_registry()}
    if args.source not in sources:
        sys.exit(f"unknown source {args.source}; add it to {REGISTRY}")
    source = sources[args.source]

    out_dir = os.path.join(DATA, "sources", args.source)
    os.makedirs(out_dir, exist_ok=True)
    out_file = os.path.join(out_dir, args.out)
    done = set()
    if os.path.exists(out_file):
        with open(out_file, encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    done.add(json.loads(line)["leaf"])

    images = [(leaf, p) for leaf, p in list_images(args, source) if leaf >= args.start and leaf not in done]
    if args.leaves:
        wanted = {int(x) for x in args.leaves.split(",") if x.strip()}
        images = [(leaf, p) for leaf, p in images if leaf in wanted]
    if args.limit and not args.leaves:
        images = images[: args.limit]
    print(f"{len(images)} pages to transcribe with {args.model} ({len(done)} already done)")

    base_prompt = PROMPT.format(
        title=source.get("title", args.source),
        years=source.get("years", ""),
        doctype=source.get("doctype", "manuscrito"),
        context=source.get("context", "—"),
    )
    n_gt = len(load_ground_truth(out_dir))
    if n_gt:
        print(f"{n_gt} corrected page(s) in ground_truth/ will be quoted as examples")

    spent = 0.0
    with open(out_file, "a", encoding="utf-8") as out:
        for i, (leaf, path) in enumerate(images, 1):
            t0 = time.time()
            try:
                jpeg = load_image(path, args.max_side)
            except Exception as e:  # noqa: BLE001
                print(f"  leaf {leaf}: cannot load image ({e})")
                continue
            prompt = with_examples(base_prompt, load_ground_truth(out_dir, skip_leaf=leaf))
            backoff = 10
            spread = None
            usage = None
            for attempt in range(6):
                try:
                    if use_deepseek:
                        spread, usage = deepseek_read(api_key, args.model, jpeg, prompt, args.max_output)
                    elif use_claude:
                        spread, usage = claude_read(client, args.model, args.effort, jpeg, prompt, args.max_output)
                    else:
                        cfg = dict(response_mime_type="application/json", response_schema=Spread,
                                   temperature=args.temperature, max_output_tokens=args.max_output)
                        if args.thinking:
                            cfg["thinking_config"] = types.ThinkingConfig(thinking_level=args.thinking)
                        resp = client.models.generate_content(
                            model=args.model,
                            contents=[types.Part.from_bytes(data=jpeg, mime_type="image/jpeg"), prompt],
                            config=types.GenerateContentConfig(**cfg),
                        )
                        spread = json.loads(resp.text)
                        um = resp.usage_metadata
                        usage = {"input": um.prompt_token_count, "output": um.candidates_token_count,
                                 "thoughts": um.thoughts_token_count, "total": um.total_token_count} if um else None
                    break
                except Exception as e:  # noqa: BLE001
                    msg = str(e)
                    if "402" in msg or "credits are depleted" in msg or "check your plan and billing" in msg:
                        sys.exit(f"  leaf {leaf}: billing stop, nothing more will be transcribed: {msg[:300]}")
                    transient = ("429", "RESOURCE_EXHAUSTED", "503", "502", "504", "disconnected",
                                 "Connection", "timed out", "timeout", "RemoteProtocolError", "overloaded")
                    if any(t in msg for t in transient):
                        detail = re.sub(r"\s+", " ", msg)[:220]
                        print(f"  leaf {leaf}: transient error, waiting {backoff}s: {detail}")
                        time.sleep(backoff)
                        backoff = min(backoff * 2, 120)
                        continue
                    if isinstance(e, (json.JSONDecodeError, ValueError)) and "JSON" in msg or "Expecting" in msg or "Unterminated" in msg:
                        msg = "output hit the ceiling before the JSON closed (probable repetition loop): " + msg
                    print(f"  leaf {leaf}: error {msg[:200]}")
                    spread = None
                    break
            if spread is None:
                wasted = est_cost(args.model, {"input": 2000, "output": args.max_output, "thoughts": 0}) or 0
                spent += wasted
                print(f"  leaf {leaf}: counted ${wasted:.3f} for the failed attempt (run ${spent:.2f})")
                if args.budget and spent >= args.budget:
                    print(f"budget of ${args.budget:.2f} reached; stopping (resume later)")
                    break
                continue
            if args.pause:
                time.sleep(args.pause)
            row = {
                "leaf": leaf,
                "file": os.path.basename(path) if not path.startswith("http") else None,
                "left": spread.get("left"),
                "right": spread.get("right"),
                "model": args.model,
                "effort": args.effort if use_claude else None,
                "thinking": args.thinking if not (use_claude or use_deepseek) else None,
                "usage": usage,
                "cost_usd": est_cost(args.model, usage),
                "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            out.write(json.dumps(row, ensure_ascii=False) + "\n")
            out.flush()
            n_entries = sum(len((p or {}).get("entries") or []) for p in (row["left"], row["right"]))
            leg = [round((p or {}).get("legibility") or 0, 2) for p in (row["left"], row["right"]) if p]
            cost = row["cost_usd"]
            spent += cost or 0
            tok = (f"in {usage['input']} out {usage['output']} think {usage['thoughts']}" if usage else "usage n/a")
            cost_s = f", ${cost:.3f} (run ${spent:.2f})" if cost is not None else ""
            print(f"  [{i}/{len(images)}] leaf {leaf}: {n_entries} entries, legibility {leg}, {time.time() - t0:.0f}s, {tok}{cost_s}")
            if args.budget and spent >= args.budget:
                print(f"budget of ${args.budget:.2f} reached after {i} pages; stopping (resume later)")
                break

    print(f"done → {out_file}")


if __name__ == "__main__":
    main()
