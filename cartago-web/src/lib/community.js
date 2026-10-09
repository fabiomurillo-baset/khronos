import { t } from './i18n.js'
import { getSummary } from './data.js'

/**
 * Community links. The Discord invite is the one value to update when the
 * server "Historia Documental Costa Rica" opens; until then every community
 * link falls back to the "Participa" section of the write-up.
 */
export const DISCORD_INVITE = ''

export const SITE_URL = 'https://basetlabs.com/costaricahist1500-1800/'

export function communityUrl(lang) {
  return DISCORD_INVITE || `${t(lang, 'aboutUrl')}#participa`
}

/** Permalink to one record: opens the timeline focused on it (see App.jsx). */
export function recordUrl(ev) {
  return `${SITE_URL}#r/${ev.id}`
}

/** Plain-text reference a contributor pastes into a Discord post or an e-mail. */
export function recordReference(ev, lang) {
  const { text } = getSummary(ev, lang)
  const year = ev.year == null ? t(lang, 'undated') : `${ev.inferred ? '≈ ' : ''}${ev.year}`
  const place = ev.locations[0] ? `, ${ev.locations[0]}` : ''
  const summary = text.length > 240 ? `${text.slice(0, 237).trimEnd()}…` : text
  return [`${t(lang, 'referenceTitle')} #${ev.id} (${year}${place})`, `“${summary}”`, recordUrl(ev)].join('\n')
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
