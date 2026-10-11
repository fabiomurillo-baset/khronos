"""
Transcribe the pages of a digitized manuscript (or any scanned work) with Gemini and
extract dated entries from them, so a new source can join Geno as its own collection.

    python scripts/transcribe_pages.py --source cabildo-guatemala-11 --images cabildo-guatemala-images
    python scripts/transcribe_pages.py --source cabildo-guatemala-11 --ia libro-once-de-cabildo   # once the Archive has derived the item

`--source` names an entry of scripts/data/collections.json (the registry of ingested works,
which also fixes the record id range and the Archive identifier used for links).
Output: scripts/data/sources/<source>/pages.jsonl — one line per page image:

    {"leaf": 100, "folio": "48", "transcription": "...", "marginalia": ["..."],
     "entries": [{"date": "1620-03-12", "year": 1620, "summary_es": "...", "people": [...], "locations": [...], "kind": "acuerdo"}],
     "legibility": 0.6, "model": "gemini-2.5-pro"}

Resumable: pages already in the output are skipped. Images are downscaled before upload.
Requires GEMINI_API_KEY. Spreads (two pages in one image) are transcribed as left/right.
"""

import argparse
import io
import json
import os
import re
import sys
import time
import urllib.request

from google import genai
from google.genai import types
from PIL import Image
from pydantic import BaseModel, Field

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "scripts", "data")
REGISTRY = os.path.join(DATA, "collections.json")


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
5. Legibilidad estimada (0-1).

Contexto útil: {context}
Si la imagen es una sola página, devuelve solo "right" y deja "left" en null.
"""


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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, help="id in scripts/data/sources.json")
    ap.add_argument("--images", help="folder of page images (sorted by name = leaf order)")
    ap.add_argument("--ia", help="Internet Archive identifier (page images are fetched from the Archive)")
    ap.add_argument("--model", default="gemini-2.5-pro", help="gemini-2.5-pro reads procesal far better than flash")
    ap.add_argument("--max-side", type=int, default=2600)
    ap.add_argument("--limit", type=int, default=0, help="stop after N pages (for a trial run)")
    ap.add_argument("--start", type=int, default=1, help="first leaf to process")
    args = ap.parse_args()

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        sys.exit("Set GEMINI_API_KEY")
    client = genai.Client(api_key=api_key)

    sources = {s["id"]: s for s in load_registry()}
    if args.source not in sources:
        sys.exit(f"unknown source {args.source}; add it to {REGISTRY}")
    source = sources[args.source]

    out_dir = os.path.join(DATA, "sources", args.source)
    os.makedirs(out_dir, exist_ok=True)
    out_file = os.path.join(out_dir, "pages.jsonl")
    done = set()
    if os.path.exists(out_file):
        with open(out_file, encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    done.add(json.loads(line)["leaf"])

    images = [(leaf, p) for leaf, p in list_images(args, source) if leaf >= args.start and leaf not in done]
    if args.limit:
        images = images[: args.limit]
    print(f"{len(images)} pages to transcribe with {args.model} ({len(done)} already done)")

    prompt = PROMPT.format(
        title=source.get("title", args.source),
        years=source.get("years", ""),
        doctype=source.get("doctype", "manuscrito"),
        context=source.get("context", "—"),
    )

    with open(out_file, "a", encoding="utf-8") as out:
        for i, (leaf, path) in enumerate(images, 1):
            t0 = time.time()
            try:
                jpeg = load_image(path, args.max_side)
            except Exception as e:  # noqa: BLE001
                print(f"  leaf {leaf}: cannot load image ({e})")
                continue
            backoff = 10
            for attempt in range(6):
                try:
                    resp = client.models.generate_content(
                        model=args.model,
                        contents=[types.Part.from_bytes(data=jpeg, mime_type="image/jpeg"), prompt],
                        config=types.GenerateContentConfig(response_mime_type="application/json", response_schema=Spread, temperature=0.1),
                    )
                    spread = json.loads(resp.text)
                    break
                except Exception as e:  # noqa: BLE001
                    msg = str(e)
                    if "429" in msg or "RESOURCE_EXHAUSTED" in msg or "503" in msg:
                        print(f"  leaf {leaf}: rate limited, waiting {backoff}s")
                        time.sleep(backoff)
                        backoff = min(backoff * 2, 120)
                        continue
                    print(f"  leaf {leaf}: error {msg[:200]}")
                    spread = None
                    break
            if spread is None:
                continue
            row = {
                "leaf": leaf,
                "file": os.path.basename(path) if not path.startswith("http") else None,
                "left": spread.get("left"),
                "right": spread.get("right"),
                "model": args.model,
                "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            out.write(json.dumps(row, ensure_ascii=False) + "\n")
            out.flush()
            n_entries = sum(len((p or {}).get("entries") or []) for p in (row["left"], row["right"]))
            leg = [round((p or {}).get("legibility") or 0, 2) for p in (row["left"], row["right"]) if p]
            print(f"  [{i}/{len(images)}] leaf {leaf}: {n_entries} entries, legibility {leg}, {time.time() - t0:.0f}s")

    print(f"done → {out_file}")


if __name__ == "__main__":
    main()
