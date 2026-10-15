/** Lower-case and strip diacritics so "Ocampo Golfín" matches "golfin". */
export function fold(str) {
  return (str || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

// Leading honorifics and offices that the sources prefix to a name ("Capitán don Gil de Alvarado").
const PERSON_PREFIX =
  /^(?:(?:don|dona|doña|el|la|sr\.?|sra\.?|señor|señora|fray|fr\.?|sor|padre|pbro\.?|presbitero|presbítero|capitan|capitán|capn\.?|cap\.?|alferez|alférez|alfz\.?|sargento|sarjento|sgto\.?|ayudante|teniente|tte\.?|licenciado|lic\.?|bachiller|br\.?|doctor|dr\.?|general|gobernador|maestre de campo|maese de campo|sargento mayor|adelantado|reverendo|obispo|canonigo|canónigo)\s+)+/
// Qualifiers in parentheses that tell two namesakes apart are kept; roles and residences are not.
const KEEP_QUALIFIER = /\b(father|son|daughter|mother|elder|younger|nephew|niece|widow|padre|madre|hijo|hija|viejo|mozo|sobrino|sobrina|viuda|viudo|nieto|nieta|abuelo|abuela)\b/i

/**
 * Key under which a person's spellings are gathered: diacritics, case, leading titles,
 * "(cargo)" / "(fletador, vecino de X)" qualifiers and a trailing ", vecino de X" are removed,
 * so "Alférez Andrés Morillo", "Andrés Morillo (fletador, vecino de Llerena)" and
 * "Andrés Morillo" are one person. Kinship qualifiers such as "(father)" stay in the key.
 */
export function foldPerson(name) {
  let s = fold(name)
  s = s.replace(/\s*\(([^)]*)\)\s*/g, (m, inner) => (KEEP_QUALIFIER.test(inner) ? ` (${inner.trim()}) ` : ' '))
  s = s.replace(/\s*,\s*(?:vecin[oa]|natural|residente|oriund[oa])\b.*$/, '')
  s = s.replace(PERSON_PREFIX, '')
  return s.replace(/\s+/g, ' ').replace(/^[\s.,;]+|[\s.,;]+$/g, '')
}

/** Split `text` into [plain, match, plain, ...] segments for highlighting `query` (accent-insensitive). */
export function highlightSegments(text, query) {
  if (!query || !text) return [text]
  const foldedText = fold(text)
  const foldedQuery = fold(query)
  // Folding never changes string length for Latin text with combining marks removed,
  // so indexes into the folded text map 1:1 onto the original.
  if (foldedText.length !== text.length) return [text]
  const segments = []
  let cursor = 0
  let hit = foldedText.indexOf(foldedQuery)
  while (hit !== -1) {
    segments.push(text.slice(cursor, hit))
    segments.push(text.slice(hit, hit + foldedQuery.length))
    cursor = hit + foldedQuery.length
    hit = foldedText.indexOf(foldedQuery, cursor)
  }
  segments.push(text.slice(cursor))
  return segments
}

export function formatNumber(n, lang) {
  return new Intl.NumberFormat(lang === 'es' ? 'es-CR' : 'en-US').format(n)
}
