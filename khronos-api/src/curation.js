// Curation: community decisions about people and places (merging name variants,
// renaming). Stored in D1 so every visitor sees the same canonical names; each
// decision is attributed, logged to Discord and can be undone.
//
//   kind:    'person' | 'place'
//   action:  'merge'  subject = key being folded into target (both folded keys)
//            'rename' subject = key, target = new display name
//   An undo is a row with action 'undo' whose target is the id of the undone row.

// D1's exec() runs one statement per line.
export const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS curation (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, action TEXT NOT NULL, subject TEXT NOT NULL, target TEXT, note TEXT, user_id TEXT NOT NULL, user_name TEXT NOT NULL, at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), undone_by INTEGER);",
  'CREATE INDEX IF NOT EXISTS curation_subject ON curation(kind, subject);',
].join('\n')

let ready = false
async function ensureSchema(db) {
  if (ready) return
  await db.exec(SCHEMA)
  ready = true
}

const KINDS = new Set(['person', 'place'])
const FACT_FIELDS = new Set(['born', 'bapt', 'origin', 'parents', 'spouse', 'marr', 'children', 'siblings', 'roles', 'residence', 'will', 'dead', 'deathPlace', 'familysearch'])
const KEY = /^[^\s][^\n]{0,199}$/
// FamilySearch Family Tree person id, e.g. LZXX-ABC; the app normalizes pasted URLs to this before sending.
const FS_ID = /^[A-Z0-9]{4}-[A-Z0-9]{3,4}$/

/** All active (not undone) decisions, oldest first. */
export async function listCuration(db) {
  await ensureSchema(db)
  const { results } = await db
    .prepare('SELECT id, kind, action, subject, target, note, user_name, at FROM curation WHERE undone_by IS NULL AND action != ? ORDER BY id')
    .bind('undo')
    .all()
  return results
}

export function validate(body) {
  const { kind, action, subject, target, note } = body || {}
  if (!KINDS.has(kind)) return 'kind'
  if (action !== 'merge' && action !== 'rename' && action !== 'fact') return 'action'
  if (typeof subject !== 'string' || !KEY.test(subject)) return 'subject'
  if (action === 'fact') {
    // target = {"field": one of FACT_FIELDS, "value": short text}
    let f = null
    try {
      f = JSON.parse(target)
    } catch {
      return 'target'
    }
    if (!f || !FACT_FIELDS.has(f.field) || typeof f.value !== 'string' || !f.value.trim() || f.value.length > 160) return 'target'
    if (f.field === 'familysearch' && !FS_ID.test(f.value)) return 'target'
  } else if (typeof target !== 'string' || !KEY.test(target)) return 'target'
  if (action === 'merge' && subject === target) return 'target'
  if (note != null && (typeof note !== 'string' || note.length > 500)) return 'note'
  return null
}

export async function addCuration(db, user, body) {
  await ensureSchema(db)
  const { kind, action, subject, target } = body
  const note = (body.note || '').trim() || null
  const row = await db
    .prepare('INSERT INTO curation (kind, action, subject, target, note, user_id, user_name) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id, kind, action, subject, target, note, user_name, at')
    .bind(kind, action, subject.trim(), target.trim(), note, user.id, user.name)
    .first()
  return row
}

/** Marks a decision as undone (by anyone signed in: curation is a shared, reversible edit). */
export async function undoCuration(db, user, id) {
  await ensureSchema(db)
  const row = await db.prepare('SELECT id, kind, action, subject, target FROM curation WHERE id = ? AND undone_by IS NULL AND action != ?').bind(id, 'undo').first()
  if (!row) return null
  const undo = await db
    .prepare('INSERT INTO curation (kind, action, subject, target, user_id, user_name) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
    .bind(row.kind, 'undo', row.subject, String(row.id), user.id, user.name)
    .first()
  await db.prepare('UPDATE curation SET undone_by = ? WHERE id = ?').bind(undo.id, id).run()
  return row
}

/** Human line for the Discord log channel. */
export function describe(row, user, undone = false) {
  const what =
    row.action === 'merge'
      ? `unió **${row.subject}** → **${row.target}**`
      : row.action === 'rename'
        ? `renombró **${row.subject}** como **${row.target}**`
        : row.action === 'fact'
          ? `anotó en **${row.subject}**: ${row.target}`
          : `cambió **${row.subject}**`
  const kind = row.kind === 'person' ? 'persona' : 'lugar'
  const note = row.note ? ` — _${row.note}_` : ''
  return undone ? `↩️ ${user.name} deshizo #${row.id} (${kind}: ${what})` : `✏️ ${user.name} (${kind}) ${what}${note} · #${row.id}`
}
