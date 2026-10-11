import { t } from './i18n.js'
import { getSummary } from './data.js'

/**
 * Community layer: the contribution panel talks to the geno-api Worker
 * (murillo-sites/sites/geno-api), which bridges to the Discord server
 * "Historia Documental Costa Rica". Discord holds the conversation; the
 * panel is a window into the forum post of each record.
 */
export const API_URL = import.meta.env.VITE_GENO_API || 'https://geno-api.basetlabs.com'
export const SITE_URL = 'https://basetlabs.com/costaricahist1500-1800/'

/** Permalink to one record: opens the timeline focused on it (see App.jsx). */
export function recordUrl(ev) {
  return `${SITE_URL}#r/${ev.id}`
}

/** Short label used as the forum post name and the panel header. */
export function recordTitle(ev, lang) {
  const year = ev.year == null ? t(lang, 'undated') : `${ev.inferred ? '≈ ' : ''}${ev.year}`
  const place = ev.locations[0] ? ` · ${ev.locations[0]}` : ''
  return `#${ev.id} · ${year}${place}`
}

export function recordSummary(ev, lang, max = 240) {
  const { text } = getSummary(ev, lang)
  return text.length > max ? `${text.slice(0, max - 3).trimEnd()}…` : text
}

/** Plain-text reference a contributor can paste anywhere. */
export function recordReference(ev, lang) {
  return [`${t(lang, 'referenceTitle')} ${recordTitle(ev, lang)}`, `“${recordSummary(ev, lang)}”`, recordUrl(ev)].join('\n')
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    /* clipboard unavailable (insecure context or denied): fall through */
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}

// ---- session ----------------------------------------------------------------

const SESSION_KEY = 'geno.session'

export function getSession() {
  try {
    return localStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}

export function setSession(token) {
  try {
    if (token) localStorage.setItem(SESSION_KEY, token)
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    /* storage unavailable */
  }
}

/**
 * After sign-in the Worker sends the browser back to `SITE_URL?auth=<token>#r/<id>`.
 * Store the token, clean the address bar, and report whether a sign-in just happened.
 */
export function consumeAuthFromUrl() {
  const url = new URL(window.location.href)
  const auth = url.searchParams.get('auth')
  if (!auth) return null
  url.searchParams.delete('auth')
  window.history.replaceState(null, '', url.pathname + url.search + url.hash)
  if (auth === 'error') return { error: true }
  setSession(auth)
  return { ok: true }
}

/** `returnHash` is where to land after sign-in, e.g. `r/12`, `p/juan de ocon`, `places`. */
export function loginUrl(provider, returnHash) {
  return `${API_URL}/auth/${provider}/start?return=${encodeURIComponent(returnHash)}`
}

// ---- API ---------------------------------------------------------------------

async function call(path, init = {}) {
  const headers = new Headers(init.headers || {})
  const token = getSession()
  if (token) headers.set('authorization', `Bearer ${token}`)
  const res = await fetch(`${API_URL}${path}`, { ...init, headers })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(body.error || `HTTP ${res.status}`)
    err.status = res.status
    err.body = body
    throw err
  }
  return body
}

export const api = {
  config: () => call('/config'),
  me: () => call('/me'),
  messages: (ev, after) => call(`/records/${ev.id}/messages${after ? `?after=${after}` : ''}`),
  post(ev, lang, { content, files }) {
    const form = new FormData()
    form.set('content', content)
    form.set('title', recordTitle(ev, lang))
    form.set('summary', recordSummary(ev, lang, 400))
    for (const f of files) form.append('files', f, f.name)
    return call(`/records/${ev.id}/messages`, { method: 'POST', body: form })
  },
  // curation (merges / renames of people and places)
  curation: () => call('/curation', { cache: 'no-store' }),
  curate: (body) => call('/curation', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  undo: (id) => call(`/curation/${id}/undo`, { method: 'POST' }),
}
