/** Lower-case and strip diacritics so "Ocampo Golfín" matches "golfin". */
export function fold(str) {
  return (str || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
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
