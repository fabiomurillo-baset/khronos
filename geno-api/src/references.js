// Bibliography: a catalog of works (digitized books on the Internet Archive, PDFs,
// web pages) and references that attach a work + locator to a record (`r:24`),
// a person (`p:<key>`) or a place (`l:<key>`). Instant and attributed, like
// curation; a reference can be undone by any signed-in person.

export const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS works (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, ia TEXT, url TEXT, author TEXT, title TEXT NOT NULL, year TEXT, publisher TEXT, note TEXT, user_id TEXT NOT NULL, user_name TEXT NOT NULL, at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));",
  "CREATE TABLE IF NOT EXISTS refs (id INTEGER PRIMARY KEY AUTOINCREMENT, target TEXT NOT NULL, work_id TEXT NOT NULL, locator_type TEXT NOT NULL, locator TEXT, quote TEXT, note TEXT, user_id TEXT NOT NULL, user_name TEXT NOT NULL, at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), undone_by INTEGER);",
  'CREATE INDEX IF NOT EXISTS refs_target ON refs(target);',
].join('\n')

let ready = false
async function ensureSchema(db) {
  if (ready) return
  await db.exec(SCHEMA)
  ready = true
}

const TARGET = /^(r:\d+|[pl]:[^\n#]{1,200})$/
const KINDS = new Set(['ia', 'url'])
const LOCATORS = new Set(['leaf', 'page', 'pdfpage', 'url', 'none'])
const IA_ID = /^[A-Za-z0-9._-]{3,100}$/

export function validateWork(b) {
  if (!b || !KINDS.has(b.kind)) return 'kind'
  if (b.kind === 'ia' && !(typeof b.ia === 'string' && IA_ID.test(b.ia))) return 'ia'
  if (b.kind === 'url' && !(typeof b.url === 'string' && /^https?:\/\/\S{1,500}$/.test(b.url))) return 'url'
  if (typeof b.title !== 'string' || !b.title.trim() || b.title.length > 300) return 'title'
  for (const k of ['author', 'year', 'publisher', 'note']) if (b[k] != null && (typeof b[k] !== 'string' || b[k].length > 300)) return k
  return null
}

export function validateRef(b) {
  if (!b || typeof b.target !== 'string' || !TARGET.test(b.target)) return 'target'
  if (!(typeof b.work_id === 'string' || Number.isInteger(b.work_id)) || !String(b.work_id).trim()) return 'work_id'
  if (!LOCATORS.has(b.locator_type)) return 'locator_type'
  if (b.locator_type !== 'none' && !(typeof b.locator === 'string' && b.locator.trim() && b.locator.length <= 500)) return 'locator'
  if (b.quote != null && (typeof b.quote !== 'string' || b.quote.length > 2000)) return 'quote'
  if (b.note != null && (typeof b.note !== 'string' || b.note.length > 1000)) return 'note'
  return null
}

export async function listWorks(db) {
  await ensureSchema(db)
  const { results } = await db.prepare('SELECT id, kind, ia, url, author, title, year, publisher, note, user_name, at FROM works ORDER BY id').all()
  return results
}

export async function addWork(db, user, b) {
  await ensureSchema(db)
  // Reuse an identical Internet Archive item instead of duplicating it.
  if (b.kind === 'ia') {
    const existing = await db.prepare('SELECT id, kind, ia, url, author, title, year, publisher, note, user_name, at FROM works WHERE ia = ?').bind(b.ia).first()
    if (existing) return existing
  }
  return db
    .prepare('INSERT INTO works (kind, ia, url, author, title, year, publisher, note, user_id, user_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, kind, ia, url, author, title, year, publisher, note, user_name, at')
    .bind(b.kind, b.ia || null, b.url || null, (b.author || '').trim() || null, b.title.trim(), (b.year || '').trim() || null, (b.publisher || '').trim() || null, (b.note || '').trim() || null, user.id, user.name)
    .first()
}

export async function listRefs(db) {
  await ensureSchema(db)
  const { results } = await db.prepare('SELECT id, target, work_id, locator_type, locator, quote, note, user_name, at FROM refs WHERE undone_by IS NULL ORDER BY id').all()
  return results
}

export async function addRef(db, user, b) {
  await ensureSchema(db)
  return db
    .prepare('INSERT INTO refs (target, work_id, locator_type, locator, quote, note, user_id, user_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, target, work_id, locator_type, locator, quote, note, user_name, at')
    .bind(b.target, String(b.work_id), b.locator_type, b.locator_type === 'none' ? null : b.locator.trim(), (b.quote || '').trim() || null, (b.note || '').trim() || null, user.id, user.name)
    .first()
}

export async function undoRef(db, user, id) {
  await ensureSchema(db)
  const row = await db.prepare('SELECT id, target, work_id, locator FROM refs WHERE id = ? AND undone_by IS NULL').bind(id).first()
  if (!row) return null
  // The undo is recorded as a row too, so the log keeps who removed what.
  const undo = await db
    .prepare("INSERT INTO refs (target, work_id, locator_type, locator, note, user_id, user_name, undone_by) VALUES (?, ?, 'none', NULL, ?, ?, ?, -1) RETURNING id")
    .bind(row.target, row.work_id, `undo:${id}`, user.id, user.name)
    .first()
  await db.prepare('UPDATE refs SET undone_by = ? WHERE id = ?').bind(undo.id, id).run()
  return row
}
