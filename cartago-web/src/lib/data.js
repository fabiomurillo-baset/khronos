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

  return { events, byId, counts: raw.counts, generated: raw.generated, histogram, minYear, maxYear }
}

export function loadDataset() {
  if (cache.dataset) return Promise.resolve(cache.dataset)
  return once('events', async () => {
    const raw = await fetchJson('/data/events.json')
    cache.dataset = buildDataset(raw)
    return cache.dataset
  })
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
    Promise.all([loadDataset(), loadText(lang), lang !== 'en' ? loadText('en').catch(() => null) : null])
      .then(() => {
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
// Derived indexes (computed lazily, cached)
// ------------------------------------------------------------------------------------
let peopleIndex = null

/** Map folded name -> { name, events: Event[] } */
export function getPeopleIndex(dataset) {
  if (peopleIndex) return peopleIndex
  const index = new Map()
  for (const ev of dataset.events) {
    for (const person of ev.people) {
      const key = fold(person)
      let entry = index.get(key)
      if (!entry) {
        entry = { name: person, key, events: [] }
        index.set(key, entry)
      }
      entry.events.push(ev)
    }
  }
  peopleIndex = index
  return index
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
    const keys = [...new Set(ev.people.map(fold))]
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
