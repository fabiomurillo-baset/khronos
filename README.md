# Khronos · Protocolos de Cartago (1540–1839)

Interactive explorer of the *Índice de los Protocolos de Cartago*, the early-twentieth-century index of the notarial records of Cartago, Costa Rica, published by the Archivos Nacionales. The OCR text of the printed volumes was turned into 11,053 structured events (people, places, dates, summaries) with Gemini, geolocated against a hand-built gazetteer of colonial places, and published as a map, a timeline and a people network.

Live: **https://basetlabs.com/khronos/** · Write-up: https://fabiomurillo.com/blog/khronos-protocolos-de-cartago/

## Layout

```
scripts/                      data pipeline (Python)
  transcribe_pages.py         new sources: page images (local or Internet Archive) → Gemini transcription + dated entries → data/sources/<id>/pages.jsonl
  link_sources.py             aligns every record with its page in the five scanned volumes → data/sources.json
  extract_data_gemini.py      OCR text → events + people profiles (Gemini 2.5 Flash, structured output, resumable)
  translate_data_gemini.py    English summaries → Spanish, in batches (resumable)
  generate_json_views.py      Gemini output → compact JSON for the web app (gazetteer, year inference)
  extract_data.py             earlier spaCy-based attempt, kept for reference
  data/gemini_output/         extraction and translation output (*.jsonl) and progress files
cartago-web/                  React 19 + Vite + Tailwind app: map (MapLibre), timeline, people network
  public/data/                events.json, text_en.json, text_es.json consumed by the app
khronos-api/                     Cloudflare Worker behind the contribution panel: sign-in + bridge to Discord (see its README)
```

The source scans (`*.pdf`), the OCR text (`Cartago.txt`) and the Cabildo de Guatemala page images are not in the repository (hundreds of MB); see `.gitignore`. The pipeline output under `scripts/data/gemini_output/` **is** committed, so the web app can be built without re-running the extraction.

## Web app

```bash
cd cartago-web
npm install
npm run dev              # http://localhost:5173
npm run build            # production bundle in dist/
npm run build:basetlabs  # bundle for basetlabs.com/khronos (writes into ../../murillo-sites)
```

See [cartago-web/README.md](cartago-web/README.md) for the data format and the component structure.

## Pipeline

```bash
python -m venv venv && venv\Scripts\activate      # Windows
pip install -r scripts/requirements.txt
set GEMINI_API_KEY=...                             # never commit it

python scripts/extract_data_gemini.py     # reads Cartago.txt, writes scripts/data/gemini_output/*.jsonl
python scripts/translate_data_gemini.py   # adds gemini_events_es.jsonl
python scripts/link_sources.py            # record → page of the printed volume (needs pdftotext; page text is cached in scripts/data/pages/)
python scripts/generate_json_views.py     # rebuilds cartago-web/public/data/*.json
```

`generate_json_views.py` prints the most frequent place names it could not geolocate; add them to `GAZETTEER` / `ALIASES` in that file to improve map coverage. Records without a year inherit the year of the previous dated entry (the index is chronological) and are flagged in the UI.

## Community

Every record has an **Aportar** button that opens a side panel: sign in (Discord, Google, Facebook), read the conversation about the record, post messages and attach images or PDFs. The panel talks to the `khronos-api` Worker ([`khronos-api/`](khronos-api/README.md), deployed at khronos-api.basetlabs.com), which bridges to the `#aportes` forum of the Discord server *Historia Documental Costa Rica*; Discord holds the conversation and every upload is also copied to R2. Permalinks: `#r/<id>` opens the timeline on a record. Point the app at a local API with `VITE_KHRONOS_API=http://localhost:8788 npm run dev`.

## People and places

The **Personas** and **Lugares** views list every name in the index; each one has a profile page (`#p/<name>`, `#l/<name>`) with a generated summary, the records it appears in, related people and places, a per-decade histogram and the spelling variants merged into it. Modeled on FamilySearch's person pages: a **Posibles duplicados** section lists similar names (token overlap + Jaro-Winkler, see `cartago-web/src/lib/similar.js`), **Comparar** opens a side-by-side merge dialog, and **Cambios** shows who merged or renamed what, with undo. Decisions are shared through `khronos-api` (D1) and applied on top of the raw data at load time, so the pipeline output is never modified.

## Adding a new source (collection)

Any digitized work can join Khronos as its own collection, with every record linked to its page on the Internet Archive. Example, the *Libro Once de Cabildo* (Ayuntamiento de Guatemala, 1617–1626, a manuscript in *procesal* script):

1. **Upload the scans to the Internet Archive** (done: `libro-once-de-cabildo`). The Archive's own OCR is useless for manuscripts, so we transcribe ourselves.
2. **Register the source** in [`scripts/data/collections.json`](scripts/data/collections.json): id, label, Archive identifier, years, a short context paragraph for the model, and an `id_base` for its record ids (the Cabildo starts at 100000).
3. **Transcribe** with Gemini (vision), page by page, from your local images (leaf = position in the folder) or from the Archive once it has derived the item:
   ```bash
   set GEMINI_API_KEY=...
   python scripts/transcribe_pages.py --source cabildo-guatemala-11 --images cabildo-guatemala-images --limit 5   # trial
   python scripts/transcribe_pages.py --source cabildo-guatemala-11 --images cabildo-guatemala-images             # all, resumable
   ```
   Each page yields a diplomatic transcription, marginalia, a legibility estimate and the dated entries (date, type, summary, people, places). `gemini-2.5-pro` reads *procesal* far better than Flash; expect a provisional reading that the community then corrects through proposals.
4. **Regenerate and publish**: `python scripts/generate_json_views.py` (the new records get `c` = collection index and `s` = [source, leaf, folio, legibility, side]) and rebuild the web app. The timeline gains a collection filter; records show the collection, the leaf (and folio) and the usual inline viewer; people and places merge across collections.

For scholarly-grade transcription of selected pages, Transkribus (public models for 17th-century Spanish exist) can replace step 3: export its text per page into the same `pages.jsonl` shape.

## Sources

Every record links to the page of the printed index it was read from, on the Internet Archive (page viewer and PDF at that page). The mapping comes from `scripts/link_sources.py`: the five volumes' OCR text is split per page, and records (which are in reading order) are aligned to pages with a banded monotonic dynamic program scored on the record's people and place names. Mean confidence 0.88 (92% of records ≥ 0.5); records with a weak match carry a `≈` mark in the UI. Volume ids and pages live in `events.json` (`volumes`, `s`), so pointing the links at another host (e.g. copies of the PDFs in R2) is a one-line change in `sourceLinks()`.

## References (bibliography)

Records, people and places can carry **references** to other works: published histories (Fernández Guardia, González Víquez…), document collections, genealogies, digitized books, PDFs or web pages. A reference is a work + a page (printed page or scan leaf for Internet Archive items, PDF page or exact link otherwise) with an optional quote and note; it opens inline with the same viewer as the source page. The catalog of works starts from [`cartago-web/public/data/works.json`](cartago-web/public/data/works.json) (seeded with the Archive's copies of the *Colección de documentos para la historia de Costa Rica*, *History of the Discovery and Conquest of Costa Rica*, *Obras históricas*, *Mortuorias de Alajuela y Heredia*…) and grows from the app: paste an archive.org identifier and the metadata is filled in, or give a URL. To cite something not yet online, upload it to the Internet Archive first and add it by identifier. References and works added from the app are stored by `khronos-api` (D1), attributed, and removable.

## Corrections through pull requests

Discussion in the Aportar panel can turn into a **proposed correction** to a record (one field, before/after, reason, evidence). The community votes; at the threshold `khronos-api` opens a pull request that appends the change to [`scripts/data/corrections.jsonl`](scripts/data/README.md). A maintainer reviews and merges it on GitHub, and only then does it become data: the app reads the file from `main` at load (records show "Corregido por la comunidad") and `generate_json_views.py` applies it when the views are regenerated.

## Numbers (October 2026)

| | |
| --- | --- |
| Events | 11,053 |
| Explicit / inferred year | 4,294 / 6,759 |
| Placed on the map | 6,645 |
| Distinct person names | 23,811 |
| Gazetteer entries | ~165 |

## Caveats

AI-assisted extraction over noisy OCR: summaries, names and dates may contain errors. Person names are not yet deduplicated and coordinates are approximate locations of historical settlements. Source: Índice de los Protocolos de Cartago, Archivo Nacional de Costa Rica.
