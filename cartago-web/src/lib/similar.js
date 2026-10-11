import { fold } from './text.js'

/**
 * Name similarity for "possible duplicates". Names in the index are noisy OCR:
 * "Gaspar Pereira Cardoso" / "Gaspar Pereyra Cardoso" / "Capitán Gaspar Pereira".
 * We strip honorifics and particles, then combine token overlap with Jaro-Winkler
 * on the remaining string.
 */

const HONORIFICS = new Set(
  'don dona doña sr sra señor señora capitan capitán alferez alférez sargento mayor maestre campo teniente general gobernador licenciado lic doctor dr bachiller br fray fr padre pbro presbitero presbítero reverendo obispo canonigo canónigo cura vicario escribano alcalde regidor procurador capn capn. tte el la los las'.split(
    ' ',
  ),
)
const PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'do', 'dos', 'van', 'von', 'san', 'santa'])

/** Significant tokens of a name: folded, without honorifics, particles and punctuation. */
export function nameTokens(name) {
  return fold(name)
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !HONORIFICS.has(t) && !PARTICLES.has(t))
}

export function normalizeName(name) {
  return nameTokens(name).join(' ')
}

/** Jaro-Winkler similarity in [0, 1]. */
export function jaroWinkler(a, b) {
  if (a === b) return 1
  const la = a.length
  const lb = b.length
  if (!la || !lb) return 0
  const range = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1)
  const ma = new Array(la).fill(false)
  const mb = new Array(lb).fill(false)
  let matches = 0
  for (let i = 0; i < la; i++) {
    const lo = Math.max(0, i - range)
    const hi = Math.min(lb - 1, i + range)
    for (let j = lo; j <= hi; j++) {
      if (!mb[j] && a[i] === b[j]) {
        ma[i] = mb[j] = true
        matches++
        break
      }
    }
  }
  if (!matches) return 0
  let t = 0
  let k = 0
  for (let i = 0; i < la; i++) {
    if (!ma[i]) continue
    while (!mb[k]) k++
    if (a[i] !== b[k]) t++
    k++
  }
  const jaro = (matches / la + matches / lb + (matches - t / 2) / matches) / 3
  let prefix = 0
  while (prefix < 4 && prefix < la && prefix < lb && a[prefix] === b[prefix]) prefix++
  return jaro + prefix * 0.1 * (1 - jaro)
}

/** Token-level similarity: how many significant tokens match (exactly or nearly). */
function tokenScore(ta, tb) {
  if (!ta.length || !tb.length) return 0
  let hits = 0
  const used = new Set()
  for (const x of ta) {
    for (let j = 0; j < tb.length; j++) {
      if (used.has(j)) continue
      const y = tb[j]
      if (x === y || (x.length > 3 && y.length > 3 && jaroWinkler(x, y) >= 0.92) || (x.length === 1 && y.startsWith(x)) || (y.length === 1 && x.startsWith(y))) {
        hits++
        used.add(j)
        break
      }
    }
  }
  return hits / Math.max(ta.length, tb.length)
}

/**
 * Similarity of two names in [0, 1]. ≥ 0.86 is a strong candidate; ≥ 0.75 is worth a look.
 * Subset names ("Gaspar Pereira" vs "Gaspar Pereira Cardoso") score high on purpose:
 * in the index the same person is often cited with and without the second surname.
 */
export function nameSimilarity(a, b) {
  const ta = nameTokens(a)
  const tb = nameTokens(b)
  const tokens = tokenScore(ta, tb)
  const jw = jaroWinkler(ta.join(' '), tb.join(' '))
  const subset = ta.length !== tb.length && Math.min(ta.length, tb.length) >= 2 && tokens * Math.max(ta.length, tb.length) === Math.min(ta.length, tb.length) ? 0.9 : 0
  return Math.max(0.6 * tokens + 0.4 * jw, subset)
}

/**
 * Candidates for `entry` among `entries` (each { key, name, events }), cheapest filter
 * first: share at least one significant token of 4+ letters (or a near match of the
 * last token), then score. Returns [{ entry, score }] sorted by score desc.
 */
export function findSimilar(entry, entries, { limit = 10, threshold = 0.75 } = {}) {
  const tokens = nameTokens(entry.name)
  if (!tokens.length) return []
  const anchors = new Set(tokens.filter((t) => t.length >= 4))
  const last = tokens[tokens.length - 1]
  const out = []
  for (const other of entries) {
    if (other.key === entry.key) continue
    const ot = nameTokens(other.name)
    if (!ot.length) continue
    let shares = ot.some((t) => anchors.has(t))
    if (!shares && last.length >= 4) shares = ot.some((t) => t.length >= 4 && jaroWinkler(t, last) >= 0.9)
    if (!shares) continue
    const score = nameSimilarity(entry.name, other.name)
    if (score >= threshold) out.push({ entry: other, score })
  }
  out.sort((x, y) => y.score - x.score || y.entry.events.length - x.entry.events.length)
  return out.slice(0, limit)
}
