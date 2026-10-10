# Geno · Protocolos de Cartago (1540–1839)

Interactive explorer of the *Índice de los Protocolos de Cartago*, the early-twentieth-century index of the notarial records of Cartago, Costa Rica, published by the Archivos Nacionales. The OCR text of the printed volumes was turned into 11,053 structured events (people, places, dates, summaries) with Gemini, geolocated against a hand-built gazetteer of colonial places, and published as a map, a timeline and a people network.

Live: **https://basetlabs.com/costaricahist1500-1800/** · Write-up: https://fabiomurillo.com/blog/geno-protocolos-de-cartago/

## Layout

```
scripts/                      data pipeline (Python)
  extract_data_gemini.py      OCR text → events + people profiles (Gemini 2.5 Flash, structured output, resumable)
  translate_data_gemini.py    English summaries → Spanish, in batches (resumable)
  generate_json_views.py      Gemini output → compact JSON for the web app (gazetteer, year inference)
  extract_data.py             earlier spaCy-based attempt, kept for reference
  data/gemini_output/         extraction and translation output (*.jsonl) and progress files
cartago-web/                  React 19 + Vite + Tailwind app: map (MapLibre), timeline, people network
  public/data/                events.json, text_en.json, text_es.json consumed by the app
geno-api/                     Cloudflare Worker behind the contribution panel: sign-in + bridge to Discord (see its README)
```

The source scans (`*.pdf`), the OCR text (`Cartago.txt`) and the Cabildo de Guatemala page images are not in the repository (hundreds of MB); see `.gitignore`. The pipeline output under `scripts/data/gemini_output/` **is** committed, so the web app can be built without re-running the extraction.

## Web app

```bash
cd cartago-web
npm install
npm run dev              # http://localhost:5173
npm run build            # production bundle in dist/
npm run build:basetlabs  # bundle for basetlabs.com/costaricahist1500-1800 (writes into ../../murillo-sites)
```

See [cartago-web/README.md](cartago-web/README.md) for the data format and the component structure.

## Pipeline

```bash
python -m venv venv && venv\Scripts\activate      # Windows
pip install -r scripts/requirements.txt
set GEMINI_API_KEY=...                             # never commit it

python scripts/extract_data_gemini.py     # reads Cartago.txt, writes scripts/data/gemini_output/*.jsonl
python scripts/translate_data_gemini.py   # adds gemini_events_es.jsonl
python scripts/generate_json_views.py     # rebuilds cartago-web/public/data/*.json
```

`generate_json_views.py` prints the most frequent place names it could not geolocate; add them to `GAZETTEER` / `ALIASES` in that file to improve map coverage. Records without a year inherit the year of the previous dated entry (the index is chronological) and are flagged in the UI.

## Community

Every record has an **Aportar** button that opens a side panel: sign in (Discord, Google, Facebook), read the conversation about the record, post messages and attach images or PDFs. The panel talks to the `geno-api` Worker ([`geno-api/`](geno-api/README.md), deployed at geno-api.basetlabs.com), which bridges to the `#aportes` forum of the Discord server *Historia Documental Costa Rica*; Discord holds the conversation and every upload is also copied to R2. Permalinks: `#r/<id>` opens the timeline on a record. Point the app at a local API with `VITE_GENO_API=http://localhost:8788 npm run dev`.

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
