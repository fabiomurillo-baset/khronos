/**
 * FamilySearch links. Nothing here calls FamilySearch: the profile only offers a prefilled
 * search on their site, and a Family Tree person id that a contributor attached as a fact.
 */

// "Costa Rica, Catholic Church Records, 1595–1992" (index and images): the parish books
// behind most of the people in the Cartago index.
export const FS_COSTA_RICA_COLLECTION = '1460016'

/** Family Tree person ids look like "LZXX-ABC" (4-3) or "XXXX-XXXX"; also accept a pasted person URL. */
const ID = /^[A-Z0-9]{4}-[A-Z0-9]{3,4}$/

export function parseFamilySearchId(input) {
  const s = String(input || '').trim()
  const m = s.match(/familysearch\.org\/(?:[a-z]{2}\/)?tree\/person\/(?:details|sources|memories|ordinances|collaborate)?\/?([A-Za-z0-9]{4}-[A-Za-z0-9]{3,4})/i) || s.match(/^([A-Za-z0-9]{4}-[A-Za-z0-9]{3,4})$/)
  if (!m) return null
  const id = m[1].toUpperCase()
  return ID.test(id) ? id : null
}

export const familySearchPersonUrl = (id) => `https://www.familysearch.org/tree/person/details/${encodeURIComponent(id)}`

// Name particles that start the surname in a Spanish colonial name: "Francisco | de Ocampo Golfín".
const PARTICLE = /^(de|del|de la|de las|de los|y|san|santa)$/i

/** Split a folded or display name into given names and surname, the way FamilySearch's form wants them. */
export function splitName(name) {
  const clean = String(name || '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s*,.*$/, '')
    .trim()
  const words = clean.split(/\s+/).filter(Boolean)
  if (words.length <= 1) return { given: '', surname: clean }
  let cut = words.findIndex((w, i) => i > 0 && PARTICLE.test(w))
  if (cut < 0) cut = words.length - 1
  return { given: words.slice(0, cut).join(' '), surname: words.slice(cut).join(' ') }
}

/**
 * Prefilled search in the Costa Rica church records: name, Cartago, and the years the person
 * appears in the index padded to cover a lifetime (a 1680 will belongs to someone born ~1620).
 */
export function familySearchRecordsUrl(name, span) {
  const { given, surname } = splitName(name)
  const p = new URLSearchParams()
  p.set('f.collectionId', FS_COSTA_RICA_COLLECTION)
  if (given) p.set('q.givenName', given)
  if (surname) p.set('q.surname', surname)
  p.set('q.anyPlace', 'Cartago, Costa Rica')
  if (span) {
    p.set('q.anyDate.from', String(Math.max(1500, span[0] - 60)))
    p.set('q.anyDate.to', String(Math.min(1950, span[1] + 20)))
  }
  return `https://www.familysearch.org/search/record/results?${p.toString()}`
}

/** The same name in the Family Tree ("Find by name"). */
export function familySearchTreeUrl(name, span) {
  const { given, surname } = splitName(name)
  const p = new URLSearchParams()
  p.set('search', '1')
  if (given) p.set('q.givenName', given)
  if (surname) p.set('q.surname', surname)
  p.set('q.anyPlace', 'Cartago, Costa Rica')
  if (span) {
    p.set('q.birthLikeDate.from', String(Math.max(1500, span[0] - 60)))
    p.set('q.birthLikeDate.to', String(span[1]))
  }
  return `https://www.familysearch.org/tree/find/name?${p.toString()}`
}
