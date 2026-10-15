import { useCallback, useEffect, useReducer, useState } from 'react'
import { fold } from './text.js'

/**
 * Data access layer. Fetches /data/events.json once and the summary texts per language
 * on demand; everything is cached at module level so switching views never refetches.
 */
const cache = {
  dataset: null, // { events, counts, generated, years, minYear, maxYear, histogram }
  text: { en: null, es: null },
  pending: {},
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

async function fetchJson(path) {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`)
  return res.json()
}

function once(key, loader) {
  if (!cache.pending[key]) {
    cache.pending[key] = loader().catch((err) => {
      delete cache.pending[key] // allow retry
      throw err
    })
  }
  return cache.pending[key]
}

function buildDataset(raw) {
  const events = raw.events.map((e, idx) => ({
    idx,
    id: e.i,
    year: e.y,
    inferred: e.yi === 1,
    date: e.d,
    people: e.p,
    locations: e.l,
    lat: e.g ? e.g[0] : null,
    lng: e.g ? e.g[1] : null,
    place: e.gl || null,
    // Page this record was read from: [source index, page/leaf, printed page or folio, confidence, side?]
    source: e.s ? { vol: e.s[0], page: e.s[1], printed: e.s[2], conf: e.s[3], side: e.s[4] || null } : null,
    collection: e.c || 0,
  }))

  const histogram = new Map()
  let minYear = Infinity
  let maxYear = -Infinity
  for (const ev of events) {
    if (ev.year == null) continue
    histogram.set(ev.year, (histogram.get(ev.year) || 0) + 1)
    if (ev.year < minYear) minYear = ev.year
    if (ev.year > maxYear) maxYear = ev.year
  }

  const byId = new Map(events.map((ev) => [ev.id, ev]))

  const sources = raw.sources || (raw.volumes || []).map((v) => ({ ...v, kind: 'index', collection: 0 }))
  const collections = raw.collections || [{ id: 'indice-protocolos-cartago', label: 'Índice de los Protocolos de Cartago', kind: 'index' }]
  return { events, byId, counts: raw.counts, generated: raw.generated, volumes: raw.volumes || [], sources, collections, histogram, minYear, maxYear }
}

/** The cached dataset (null until loaded). */
export const getDataset = () => cache.dataset

export function loadDataset() {
  if (cache.dataset) return Promise.resolve(cache.dataset)
  return once('events', async () => {
    const raw = await fetchJson('/data/events.json')
    cache.dataset = buildDataset(raw)
    return cache.dataset
  })
}

/**
 * Links to the original page of a record on the Internet Archive: the page viewer
 * (leaf numbers are 0-based, pdf pages 1-based) and the PDF opened at that page.
 */
export function sourceLinks(dataset, ev) {
  if (!ev.source) return null
  const src = dataset.sources[ev.source.vol]
  if (!src) return null
  return {
    kind: src.kind || 'index',
    tomo: src.tomo,
    label: src.label || null,
    printed: ev.source.printed,
    page: ev.source.page,
    side: ev.source.side,
    conf: ev.source.conf,
    viewer: `https://archive.org/details/${src.id}/page/n${ev.source.page - 1}/mode/1up`,
    embed: `https://archive.org/embed/${src.id}?ui=embed#page/n${ev.source.page - 1}/mode/1up`,
    pdf: `https://archive.org/download/${src.id}/${src.id}.pdf#page=${ev.source.page}`,
  }
}

// ------------------------------------------------------------------------------------
// Community corrections accepted through pull requests (scripts/data/corrections.jsonl
// on GitHub main). Read at load time so a merged PR shows up without a rebuild; the
// pipeline applies the same file when it regenerates the JSON views.
// ------------------------------------------------------------------------------------
export const CORRECTIONS_URL =
  import.meta.env.VITE_CORRECTIONS_URL || 'https://raw.githubusercontent.com/fabiomurillo-baset/khronos/main/scripts/data/corrections.jsonl'

const corrections = { list: [], byRecord: new Map(), appliedEvents: false, appliedText: { en: false, es: false } }

export function loadCorrections() {
  return once('corrections', async () => {
    try {
      const res = await fetch(CORRECTIONS_URL, { cache: 'no-cache' })
      if (!res.ok) return []
      const text = await res.text()
      const list = []
      for (const line of text.split('\n')) {
        const l = line.trim()
        if (!l) continue
        try {
          list.push(JSON.parse(l))
        } catch {
          /* skip malformed line */
        }
      }
      corrections.list = list
      for (const c of list) {
        if (!corrections.byRecord.has(c.record)) corrections.byRecord.set(c.record, new Map())
        corrections.byRecord.get(c.record).set(c.field, c)
      }
      return list
    } catch {
      return []
    }
  })
}

/** Accepted corrections for one record: Map field -> correction (empty when none). */
export function correctionsFor(recordId) {
  return corrections.byRecord.get(recordId) || new Map()
}

/** Mutates the cached events / texts with the corrections loaded so far (idempotent per target). */
function applyCorrections() {
  if (!cache.dataset || !corrections.list.length) return
  if (!corrections.appliedEvents) {
    for (const [id, fields] of corrections.byRecord) {
      const ev = cache.dataset.byId.get(id)
      if (!ev) continue
      if (fields.has('year')) {
        ev.year = fields.get('year').to == null ? null : Number(fields.get('year').to)
        ev.inferred = false
      }
      if (fields.has('date')) ev.date = fields.get('date').to || null
      if (fields.has('people')) ev.people = [...fields.get('people').to]
      if (fields.has('locations')) ev.locations = [...fields.get('locations').to]
      ev.corrected = true
    }
    corrections.appliedEvents = true
    peopleIndex = null
    placesIndex = null
    graphCache = null
  }
  for (const lang of ['en', 'es']) {
    if (corrections.appliedText[lang] || !cache.text[lang]) continue
    for (const [id, fields] of corrections.byRecord) {
      const c = fields.get(`summary_${lang}`)
      const ev = cache.dataset.byId.get(id)
      if (c && ev) cache.text[lang][ev.idx] = c.to
    }
    corrections.appliedText[lang] = true
  }
}

export function loadText(lang) {
  if (cache.text[lang]) return Promise.resolve(cache.text[lang])
  return once(`text:${lang}`, async () => {
    const arr = await fetchJson(`/data/text_${lang}.json`)
    cache.text[lang] = arr
    return arr
  })
}

/** Summary for an event in the requested language, falling back to English. */
export function getSummary(ev, lang) {
  const own = cache.text[lang]?.[ev.idx]
  if (own) return { text: own, fallback: false }
  const en = cache.text.en?.[ev.idx]
  return { text: en || '', fallback: lang !== 'en' }
}

export function hasText(lang) {
  return Boolean(cache.text[lang])
}

/** React hook: dataset + texts for `lang`, with loading / error / retry. */
export function useDataset(lang) {
  // The cache is the source of truth; `version` only forces a re-render when a load settles.
  const [, bump] = useReducer((n) => n + 1, 0)
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    Promise.all([loadDataset(), loadText(lang), lang !== 'en' ? loadText('en').catch(() => null) : null, loadCorrections()])
      .then(() => {
        applyCorrections()
        if (!cancelled) bump()
      })
      .catch((err) => {
        if (!cancelled) setError(err)
      })
    return () => {
      cancelled = true
    }
  }, [lang, attempt])

  const retry = useCallback(() => {
    setError(null)
    setAttempt((a) => a + 1)
  }, [])

  return { dataset: cache.dataset, textReady: Boolean(cache.text[lang]), error, retry }
}

// ------------------------------------------------------------------------------------
// Curation: community decisions (merges, renames) applied on top of the raw names
// ------------------------------------------------------------------------------------
const curation = {
  entries: [],
  canon: { person: new Map(), place: new Map() }, // folded key -> folded key it was merged into
  names: { person: new Map(), place: new Map() }, // folded key -> display name chosen by a rename
  version: 0,
}

/** Install the active curation entries (from khronos-api) and drop every derived index. */
export function setCuration(entries) {
  curation.entries = entries || []
  curation.canon = { person: new Map(), place: new Map() }
  curation.names = { person: new Map(), place: new Map() }
  for (const e of curation.entries) {
    if (!curation.canon[e.kind]) continue
    if (e.action === 'merge') curation.canon[e.kind].set(e.subject, e.target)
    else if (e.action === 'rename') curation.names[e.kind].set(e.subject, e.target)
  }
  peopleIndex = null
  placesIndex = null
  graphCache = null
  curation.version++
}

export const getCuration = () => curation.entries
export const curationVersion = () => curation.version

/** Follow merges to the canonical key (with a guard against accidental cycles). */
export function canonicalKey(kind, key) {
  const map = curation.canon[kind]
  let k = key
  for (let i = 0; i < 25 && map.has(k); i++) {
    const next = map.get(k)
    if (next === key) break
    k = next
  }
  return k
}

export const personKey = (name) => canonicalKey('person', fold(name))
export const placeKey = (name) => canonicalKey('place', fold(name))

/** Active decisions that touch a key (as subject or target). */
export function curationFor(kind, key) {
  return curation.entries.filter((e) => e.kind === kind && (e.subject === key || e.target === key))
}

// ------------------------------------------------------------------------------------
// Derived indexes (computed lazily, cached, rebuilt when curation changes)
// ------------------------------------------------------------------------------------
let peopleIndex = null
let placesIndex = null

/**
 * Generic index: folded + canonical key -> { key, name, events, aliases }.
 * `aliases` maps each raw spelling that landed on the key to its number of mentions,
 * and `name` is the rename if any, else the most frequent spelling.
 */
function buildIndex(dataset, kind, pick) {
  const index = new Map()
  for (const ev of dataset.events) {
    let lastKey = null
    for (const raw of pick(ev)) {
      const key = canonicalKey(kind, fold(raw))
      let entry = index.get(key)
      if (!entry) {
        entry = { key, kind, name: raw, events: [], aliases: new Map() }
        index.set(key, entry)
      }
      entry.aliases.set(raw, (entry.aliases.get(raw) || 0) + 1)
      if (entry.events[entry.events.length - 1] !== ev && key !== lastKey) entry.events.push(ev)
      lastKey = key
    }
  }
  for (const entry of index.values()) {
    const rename = curation.names[kind].get(entry.key)
    if (rename) entry.name = rename
    else {
      let best = null
      let bestCount = -1
      for (const [raw, count] of entry.aliases) {
        // Prefer the spelling that is itself the canonical key, then the most frequent one.
        const own = fold(raw) === entry.key ? 1e9 : 0
        if (own + count > bestCount) {
          bestCount = own + count
          best = raw
        }
      }
      entry.name = best
    }
  }
  return index
}

/** Map canonical key -> { name, key, events, aliases } for people */
export function getPeopleIndex(dataset) {
  if (peopleIndex) return peopleIndex
  peopleIndex = buildIndex(dataset, 'person', (ev) => ev.people)
  return peopleIndex
}

/** Same for places (raw location names), with coordinates when the gazetteer placed them. */
export function getPlacesIndex(dataset) {
  if (placesIndex) return placesIndex
  placesIndex = buildIndex(dataset, 'place', (ev) => ev.locations)
  for (const ev of dataset.events) {
    if (ev.lat == null || !ev.place) continue
    const entry = placesIndex.get(canonicalKey('place', fold(ev.place)))
    if (entry && entry.lat == null) {
      entry.lat = ev.lat
      entry.lng = ev.lng
    }
  }
  return placesIndex
}

/** [first, last] year of an entry's dated records, or null. */
export function yearSpan(entry) {
  let a = Infinity
  let b = -Infinity
  for (const ev of entry.events) {
    if (ev.year == null) continue
    if (ev.year < a) a = ev.year
    if (ev.year > b) b = ev.year
  }
  return a === Infinity ? null : [a, b]
}

/** Entries sorted by number of records, descending. */
export function sortedEntries(index) {
  return [...index.values()].sort((a, b) => b.events.length - a.events.length || a.name.localeCompare(b.name))
}

let graphCache = null

/**
 * Co-occurrence graph: one node per person, one weighted link per pair that appears
 * together in a record (the first named person is linked to every other participant,
 * mirroring how the notarial index lists grantor first).
 */
export function getGraph(dataset) {
  if (graphCache) return graphCache
  const people = getPeopleIndex(dataset)
  const nodes = new Map()
  const links = new Map()
  const ensureNode = (key) => {
    let n = nodes.get(key)
    if (!n) {
      const entry = people.get(key)
      n = { id: key, name: entry.name, degree: 0, records: entry.events.length, neighbors: new Set() }
      nodes.set(key, n)
    }
    return n
  }
  for (const ev of dataset.events) {
    const keys = [...new Set(ev.people.map(personKey))]
    if (keys.length < 2) {
      if (keys.length === 1) ensureNode(keys[0])
      continue
    }
    const source = keys[0]
    for (let i = 1; i < keys.length; i++) {
      const target = keys[i]
      const pairKey = source < target ? `${source}|${target}` : `${target}|${source}`
      let link = links.get(pairKey)
      if (!link) {
        link = { source, target, weight: 0, eventIds: [] }
        links.set(pairKey, link)
        const a = ensureNode(source)
        const b = ensureNode(target)
        a.degree++
        b.degree++
        a.neighbors.add(target)
        b.neighbors.add(source)
      }
      link.weight++
      link.eventIds.push(ev.id)
    }
  }
  const nodeList = [...nodes.values()].sort((a, b) => b.degree - a.degree)
  graphCache = { nodes: nodes, nodeList, links }
  return graphCache
}
