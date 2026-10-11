import { useSyncExternalStore } from 'react'
import { api } from './community.js'

/**
 * Bibliography store: works (seed file + works added through geno-api) and
 * references attached to targets `r:<record id>`, `p:<person key>`, `l:<place key>`.
 * Loaded once; components subscribe with useReferences().
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

const state = {
  works: new Map(), // id -> work ({ id, kind, ia, url, author, title, year, publisher, note })
  refs: [], // active references
  byTarget: new Map(), // target -> refs[]
  loaded: false,
  version: 0,
}
const listeners = new Set()
const emit = () => {
  state.version++
  for (const l of listeners) l()
}

function index() {
  state.byTarget = new Map()
  for (const r of state.refs) {
    if (!state.byTarget.has(r.target)) state.byTarget.set(r.target, [])
    state.byTarget.get(r.target).push(r)
  }
}

let loading = null
export function loadReferences() {
  if (loading) return loading
  loading = (async () => {
    try {
      const seed = await fetch(`${BASE}/data/works.json`).then((r) => (r.ok ? r.json() : { works: [] }))
      for (const w of seed.works || []) state.works.set(w.id, { ...w, seed: true })
    } catch {
      /* no seed */
    }
    try {
      const [{ works }, { refs }] = await Promise.all([api.works(), api.refs()])
      for (const w of works || []) state.works.set(String(w.id), { ...w, id: String(w.id) })
      state.refs = refs || []
    } catch {
      state.refs = []
    }
    index()
    state.loaded = true
    emit()
  })()
  return loading
}

export async function refreshReferences() {
  try {
    const [{ works }, { refs }] = await Promise.all([api.works(), api.refs()])
    for (const w of works || []) state.works.set(String(w.id), { ...w, id: String(w.id) })
    state.refs = refs || []
    index()
  } catch {
    /* keep what we have */
  }
  emit()
}

const subscribe = (l) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const snapshot = () => state.version

/** Subscribe to the store; returns helpers bound to the current snapshot. */
export function useReferences() {
  useSyncExternalStore(subscribe, snapshot, snapshot)
  return {
    loaded: state.loaded,
    works: state.works,
    refsFor: (target) => state.byTarget.get(target) || [],
    work: (id) => state.works.get(String(id)) || null,
    allWorks: () => [...state.works.values()].sort((a, b) => (a.author || '').localeCompare(b.author || '') || (a.year || '').localeCompare(b.year || '')),
  }
}

export const targetFor = {
  record: (ev) => `r:${ev.id}`,
  person: (key) => `p:${key}`,
  place: (key) => `l:${key}`,
}

/** Short citation: "Fernández Guardia, History of the Discovery… (1913), p. 112". */
export function citation(work, ref, lang) {
  if (!work) return '—'
  const parts = []
  if (work.author) parts.push(work.author)
  parts.push(work.year ? `${work.title} (${work.year})` : work.title)
  const loc = locatorLabel(ref, lang)
  return `${parts.join(', ')}${loc ? `, ${loc}` : ''}`
}

export function locatorLabel(ref, lang) {
  if (!ref || ref.locator_type === 'none' || !ref.locator) return ''
  const es = lang === 'es'
  switch (ref.locator_type) {
    case 'page':
      return `${es ? 'p.' : 'p.'} ${ref.locator}`
    case 'leaf':
      return es ? `hoja ${ref.locator} del escaneo` : `scan leaf ${ref.locator}`
    case 'pdfpage':
      return es ? `pág. ${ref.locator} del PDF` : `PDF page ${ref.locator}`
    case 'url':
      return es ? 'enlace' : 'link'
    default:
      return ref.locator
  }
}

/** Where a reference points: { open, embed } (embed null when the host cannot be framed). */
export function referenceLinks(work, ref) {
  if (!work) return null
  if (work.kind === 'ia') {
    let frag = ''
    if (ref?.locator_type === 'leaf') frag = `#page/n${Math.max(0, Number(ref.locator) - 1)}/mode/1up`
    else if (ref?.locator_type === 'page') frag = `#page/${encodeURIComponent(ref.locator)}/mode/1up`
    else if (ref?.locator_type === 'pdfpage') frag = `#page/n${Math.max(0, Number(ref.locator) - 1)}/mode/1up`
    return {
      open: `https://archive.org/details/${work.ia}${frag.replace('#', '/')}`,
      embed: `https://archive.org/embed/${work.ia}?ui=embed${frag}`,
    }
  }
  const url = ref?.locator_type === 'url' && ref.locator ? ref.locator : work.url
  if (!url) return null
  const isPdf = /\.pdf(\?|#|$)/i.test(url)
  const withPage = isPdf && ref?.locator_type === 'pdfpage' ? `${url.split('#')[0]}#page=${ref.locator}` : url
  return { open: withPage, embed: isPdf ? withPage : null }
}

/** Fetch Internet Archive metadata for an identifier (CORS-enabled) to prefill a new work. */
export async function fetchIaMetadata(idOrUrl) {
  const m = String(idOrUrl)
    .trim()
    .match(/(?:archive\.org\/(?:details|embed|download)\/)?([A-Za-z0-9._-]{3,100})/)
  if (!m) return null
  const id = m[1]
  const res = await fetch(`https://archive.org/metadata/${id}/metadata`)
  if (!res.ok) return null
  const { result } = await res.json()
  if (!result || !result.title) return null
  const one = (v) => (Array.isArray(v) ? v.join('; ') : v || '')
  return {
    kind: 'ia',
    ia: id,
    title: one(result.title) + (result.volume ? `, ${/^\d+$/.test(result.volume) ? `tomo ${result.volume}` : result.volume}` : ''),
    author: one(result.creator),
    year: String(result.date || result.year || '').slice(0, 4),
    publisher: one(result.publisher),
  }
}
