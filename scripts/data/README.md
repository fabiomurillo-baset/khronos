# scripts/data

- `gemini_output/` — pipeline output (extraction and translation), committed so the web app can be rebuilt without re-running Gemini.
- `corrections.jsonl` — community corrections accepted through pull requests, one JSON object per line. Created by `geno-api` when a proposal reaches the vote threshold; every line is a reviewed, documented change to one field of one record:

  ```json
  {"id": 7, "record": 24, "field": "year", "from": 1607, "to": 1608, "reason": "El folio dice 1608", "evidence": ["https://…"], "by": "Ana Mora", "at": "2026-10-11T18:00:00Z", "pr": 12}
  ```

  `field` is one of `year`, `date`, `people`, `locations`, `summary_en`, `summary_es`. `generate_json_views.py` applies the file when rebuilding `cartago-web/public/data/`, and the web app also reads it from `main` at load time, so a merged PR is visible without a rebuild. Later lines override earlier ones for the same record and field.
