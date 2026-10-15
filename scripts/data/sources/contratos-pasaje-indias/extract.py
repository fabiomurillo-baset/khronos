"""Structure the Rodríguez Lorenzo article with DeepSeek Flash.

  python extract.py summary  TXT OUT.json BODY_FIRST BODY_LAST
  python extract.py table1   TXT OUT.json FIRST LAST      # appendix 1 rows (contracts)
  python extract.py table2   TXT OUT.json FIRST LAST      # appendix 2 rows (accommodation prices)
Needs DEEPSEEK_API_KEY. Page numbers are 1-based PDF pages.
"""
import json, os, sys, time, urllib.request

KEY = os.environ["DEEPSEEK_API_KEY"]
URL = "https://api.deepseek.com/chat/completions"

EFFORT = os.environ.get("DEEPSEEK_EFFORT")  # low | high | max; omitted -> model default

def call(prompt, max_tokens=60000, temperature=0.1):
    body = {"model": "deepseek-flash", "temperature": temperature, "max_tokens": max_tokens,
            "response_format": {"type": "json_object"},
            "messages": [{"role": "user", "content": prompt}]}
    if EFFORT:
        body["reasoning_effort"] = EFFORT
    req = urllib.request.Request(URL, data=json.dumps(body).encode("utf-8"),
                                 headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=900) as r:
                data = json.loads(r.read())
            u = data.get("usage", {})
            return json.loads(data["choices"][0]["message"]["content"]), u
        except urllib.error.HTTPError as e:
            print("  http", e.code, e.read().decode("utf-8", "replace")[:200]); time.sleep(10 * (attempt + 1))
        except Exception as e:  # noqa: BLE001
            print("  retry", attempt + 1, str(e)[:120]); time.sleep(10 * (attempt + 1))
    return None, {}

TABLE1 = """Esta es una página (texto extraído de un PDF, columnas desalineadas) del apéndice 1 de un artículo de historia:
la muestra de 409 contratos de pasaje a Indias protocolizados en Sevilla (1561-1622). Las columnas de la tabla son:
Fecha (AAAA-M-D de la escritura) · Barco (nombre de la nao) · Fletantes (quien otorga el pasaje, con cargo entre paréntesis:
Sr. = señor o dueño de la nao, Mtre. = maestre, Pil. = piloto, Sr.-Mtre. = ambos) · Fletadores (quien contrata el pasaje) ·
Vecindad (lugar de vecindad del fletador) · Adultos, Jóvenes, Esclavos (precio del pasaje por persona en ducados y, entre
paréntesis, número de personas de esa clase; puede haber varias líneas) · Cámara (precio del alojamiento y entre paréntesis
cuántos; CP = cámara de popa, C = cámara, Cte = camarote) · Tamaño (largo x ancho en pies) · Rancho (precio del rancho) ·
Total (precio total de la expedición en ducados) · Destino (puerto de destino).
El texto viene en orden de lectura: cada fila empieza con una fecha al inicio de línea y sus celdas siguen en el orden de
las columnas, una celda larga puede ocupar varias líneas, y el puerto de destino es lo último de cada fila (justo antes de la
fecha siguiente). Si una celda numérica falta, la columna está vacía en esa fila: no desplaces los valores. Ignora el
encabezado de la tabla, los encabezados corrientes, el número de página y el nombre del autor. Los corchetes [ ] indican datos
reconstruidos por el autor: consérvalos como texto. Abreviaturas del autor: SD = sin determinar (número de personas),
M = con mantenimiento, DB = de balde, SP = sin precio, CP = cámara de popa, ACZ = alcázar completo.

Devuelve únicamente JSON: {"rows": [{"date": "1570-10-07" (ISO con ceros; null si no hay), "ship": str, "shippers": [{"name": str, "role": str|null}],
"charterers": [str], "residence": str|null, "fares": [{"class": "adulto|joven|esclavo", "price": number|null, "count": number|null}],
"cabin": {"price": number|null, "count": number|null, "type": str|null}|null, "size": str|null, "rancho": number|null,
"total": number|null, "destination": str|null, "notes": str|null}]}

Texto de la página:
"""

TABLE2 = """Esta es una página (texto extraído de un PDF, columnas desalineadas) del apéndice 2 de un artículo de historia sobre
los contratos de pasaje a Indias protocolizados en Sevilla (1561-1622): precios y dimensiones de los alojamientos contratados.
Columnas: Fecha (AAAA-M-D) · Barco · Fletantes (con cargo entre paréntesis: Sr., Mtre., Pil.) · Fletadores · Precio (ducados) ·
Tamaño (pies, largo x ancho; si hay una sola cifra es el largo) · Ducados/pies (precio por pie de largo) · Destino.
El texto viene en orden de lectura: cada fila empieza con una fecha al inicio de línea, sus celdas siguen en el orden de las
columnas y el destino es lo último de la fila. Ignora el encabezado de la tabla, encabezados corrientes, número de página y
nombre del autor. Conserva los corchetes [ ] del autor como texto.

Devuelve únicamente JSON: {"rows": [{"date": "AAAA-MM-DD"|null, "ship": str, "shippers": [{"name": str, "role": str|null}],
"charterers": [str], "price": number|null, "size": str|null, "ducats_per_foot": number|null, "destination": str|null}]}

Texto de la página:
"""

SUMMARY = """Lee el cuerpo de este artículo académico (texto extraído de PDF, con notas al pie intercaladas) y devuelve únicamente JSON
con esta forma:
{"reference": {"author": str, "title": str, "journal": str, "volume": str, "year": int, "pages": str},
 "thesis": "2-3 oraciones con la pregunta y el aporte del artículo",
 "sources": "qué fuentes usa el autor y cómo las localizó, con cifras",
 "sections": [{"title": "título o tema de la sección", "findings": ["hallazgo concreto con cifras si las hay", ...]}],
 "key_numbers": [{"what": str, "value": str}],
 "places": ["puertos y lugares de destino o de vecindad mencionados, con frecuencia relativa si el autor la da"],
 "conclusions": ["conclusión del autor", ...],
 "relevance_central_america": "qué dice el artículo, si algo, sobre Honduras, Guatemala, Nicaragua, Costa Rica, Nombre de Dios, Portobelo o la ruta a Tierra Firme"}

Texto del artículo:
"""

def main():
    mode, txt, out = sys.argv[1], sys.argv[2], sys.argv[3]
    first, last = int(sys.argv[4]), int(sys.argv[5])
    pages = open(txt, encoding="utf-8", errors="replace").read().split("\f")
    spent_in = spent_out = 0
    if mode == "summary":
        body = "\n\f\n".join(pages[first - 1:last])
        res, u = call(SUMMARY + body, max_tokens=60000)
        json.dump(res, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print("summary tokens:", u.get("prompt_tokens"), u.get("completion_tokens"))
        return
    prompt = TABLE1 if mode == "table1" else TABLE2
    partial = out + ".pages.jsonl"   # one line per finished page, so a crash or a failed page loses nothing
    done = {}
    if os.path.exists(partial):
        for line in open(partial, encoding="utf-8"):
            if line.strip():
                d = json.loads(line); done[d["page"]] = d["rows"]
    rows = []
    for n in range(first, last + 1):
        page = pages[n - 1]
        if len(page.strip()) < 80:
            continue
        if n in done:
            rows.extend(done[n]); continue
        res, u = call(prompt + page)
        if res is None:
            print(f"  page {n}: FAILED, skipped"); continue
        got = res.get("rows") or []
        for r in got:
            r["pdf_page"] = n
        with open(partial, "a", encoding="utf-8") as f:
            f.write(json.dumps({"page": n, "rows": got}, ensure_ascii=False) + "\n")
        rows.extend(got)
        spent_in += u.get("prompt_tokens", 0); spent_out += u.get("completion_tokens", 0)
        print(f"  page {n}: {len(got)} rows (tokens {u.get('prompt_tokens')}/{u.get('completion_tokens')})")
    json.dump(rows, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"{len(rows)} rows -> {out}; tokens in {spent_in} out {spent_out}")

if __name__ == "__main__":
    main()
