// Proposals: documented changes to one field of one record, voted on by the
// community. When the vote threshold is reached a pull request is opened on
// GitHub; the change becomes data only when a maintainer merges it.
//
//   status: open → submitted (PR open) → merged | rejected (PR closed) ; or withdrawn

import { FIELD_LABEL, githubEnabled, openProposalPr, prState } from './github.js'

export const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS proposals (id INTEGER PRIMARY KEY AUTOINCREMENT, record INTEGER NOT NULL, field TEXT NOT NULL, from_value TEXT, to_value TEXT NOT NULL, reason TEXT NOT NULL, evidence TEXT NOT NULL DEFAULT '[]', user_id TEXT NOT NULL, user_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', pr_number INTEGER, pr_url TEXT, pr_checked_at TEXT, discord_message_id TEXT, at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));",
  'CREATE INDEX IF NOT EXISTS proposals_record ON proposals(record);',
  'CREATE TABLE IF NOT EXISTS votes (proposal_id INTEGER NOT NULL, user_id TEXT NOT NULL, user_name TEXT NOT NULL, value INTEGER NOT NULL, at TEXT NOT NULL DEFAULT (strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\')), PRIMARY KEY (proposal_id, user_id));',
].join('\n')

let ready = false
async function ensureSchema(db) {
  if (ready) return
  await db.exec(SCHEMA)
  ready = true
}

export const FIELDS = new Set(Object.keys(FIELD_LABEL))
const LIST_FIELDS = new Set(['people', 'locations'])
const PR_RECHECK_MS = 2 * 60 * 1000

export function validateProposal(body) {
  const { field, to, reason, evidence } = body || {}
  if (!FIELDS.has(field)) return 'field'
  if (LIST_FIELDS.has(field)) {
    if (!Array.isArray(to) || to.length > 60 || to.some((x) => typeof x !== 'string' || !x.trim() || x.length > 200)) return 'to'
  } else if (field === 'year') {
    if (to !== null && (!Number.isInteger(to) || to < 1400 || to > 1900)) return 'to'
  } else if (typeof to !== 'string' || to.length > 4000) return 'to'
  if (typeof reason !== 'string' || reason.trim().length < 10 || reason.length > 2000) return 'reason'
  if (evidence != null && (!Array.isArray(evidence) || evidence.length > 20 || evidence.some((x) => typeof x !== 'string' || x.length > 500))) return 'evidence'
  return null
}

function parse(row) {
  if (!row) return row
  return {
    ...row,
    from_value: row.from_value == null ? null : JSON.parse(row.from_value),
    to_value: JSON.parse(row.to_value),
    evidence: JSON.parse(row.evidence || '[]'),
  }
}

async function voteCounts(db, ids) {
  if (!ids.length) return new Map()
  const placeholders = ids.map(() => '?').join(',')
  const { results } = await db
    .prepare(`SELECT proposal_id, SUM(CASE WHEN value > 0 THEN 1 ELSE 0 END) AS up, SUM(CASE WHEN value < 0 THEN 1 ELSE 0 END) AS down FROM votes WHERE proposal_id IN (${placeholders}) GROUP BY proposal_id`)
    .bind(...ids)
    .all()
  return new Map(results.map((r) => [r.proposal_id, { up: r.up, down: r.down }]))
}

/** Proposals of a record (newest first) with vote counts and the caller's vote; refreshes PR states lazily. */
export async function listProposals(env, record, user, ctx) {
  const db = env.DB
  await ensureSchema(db)
  const { results } = await db.prepare('SELECT * FROM proposals WHERE record = ? ORDER BY id DESC').bind(record).all()
  const rows = results.map(parse)
  const counts = await voteCounts(db, rows.map((r) => r.id))
  const mine = new Map()
  if (user) {
    const { results: mv } = await db
      .prepare(`SELECT proposal_id, value FROM votes WHERE user_id = ? AND proposal_id IN (${rows.map(() => '?').join(',') || 'NULL'})`)
      .bind(user.id, ...rows.map((r) => r.id))
      .all()
    for (const v of mv) mine.set(v.proposal_id, v.value)
  }
  // Lazily sync PR state for submitted proposals (at most every 2 minutes each).
  const stale = rows.filter((r) => r.status === 'submitted' && r.pr_number && (!r.pr_checked_at || Date.now() - Date.parse(r.pr_checked_at) > PR_RECHECK_MS))
  if (stale.length && githubEnabled(env)) {
    ctx.waitUntil(
      Promise.all(
        stale.map(async (r) => {
          try {
            const state = await prState(env, r.pr_number)
            const status = state === 'merged' ? 'merged' : state === 'closed' ? 'rejected' : 'submitted'
            await db.prepare("UPDATE proposals SET status = ?, pr_checked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").bind(status, r.id).run()
          } catch (err) {
            console.error('pr state', r.id, err)
          }
        }),
      ),
    )
  }
  return rows.map((r) => ({ ...r, votes: counts.get(r.id) || { up: 0, down: 0 }, myVote: mine.get(r.id) || 0, threshold: threshold(env) }))
}

export const threshold = (env) => Math.max(1, Number(env.PROPOSAL_VOTES) || 3)

export async function createProposal(env, user, record, body) {
  const db = env.DB
  await ensureSchema(db)
  const evidence = (body.evidence || []).map((s) => s.trim()).filter(Boolean)
  const to = LIST_FIELDS.has(body.field) ? body.to.map((s) => s.trim()) : typeof body.to === 'string' ? body.to.trim() : body.to
  const row = await db
    .prepare('INSERT INTO proposals (record, field, from_value, to_value, reason, evidence, user_id, user_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *')
    .bind(record, body.field, body.from === undefined ? null : JSON.stringify(body.from), JSON.stringify(to), body.reason.trim(), JSON.stringify(evidence), user.id, user.name)
    .first()
  // The author's own vote counts.
  await db.prepare('INSERT INTO votes (proposal_id, user_id, user_name, value) VALUES (?, ?, ?, 1)').bind(row.id, user.id, user.name).run()
  return parse(row)
}

export async function setDiscordMessage(db, id, messageId) {
  await db.prepare('UPDATE proposals SET discord_message_id = ? WHERE id = ?').bind(messageId, id).run()
}

/**
 * Record a vote (1, -1 or 0 to withdraw). If the proposal is open and the net
 * votes reach the threshold, open the PR. Returns { proposal, votes, submitted }.
 */
export async function vote(env, user, id, value, context) {
  const db = env.DB
  await ensureSchema(db)
  const row = parse(await db.prepare('SELECT * FROM proposals WHERE id = ?').bind(id).first())
  if (!row) return null
  // Votes only move an open proposal; a submitted or withdrawn one is frozen.
  if (row.status !== 'open') {
    const votes = (await voteCounts(db, [id])).get(id) || { up: 0, down: 0 }
    return { proposal: { ...row, votes, threshold: threshold(env) }, submitted: null, closed: true }
  }
  if (value === 0) await db.prepare('DELETE FROM votes WHERE proposal_id = ? AND user_id = ?').bind(id, user.id).run()
  else
    await db
      .prepare('INSERT INTO votes (proposal_id, user_id, user_name, value) VALUES (?, ?, ?, ?) ON CONFLICT(proposal_id, user_id) DO UPDATE SET value = excluded.value, at = excluded.at')
      .bind(id, user.id, user.name, value)
      .run()
  const votes = (await voteCounts(db, [id])).get(id) || { up: 0, down: 0 }
  let submitted = null
  if (row.status === 'open' && votes.up - votes.down >= threshold(env) && githubEnabled(env)) {
    try {
      const pr = await openProposalPr(env, row, votes, context)
      await db.prepare("UPDATE proposals SET status = 'submitted', pr_number = ?, pr_url = ?, pr_checked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").bind(pr.number, pr.url, id).run()
      submitted = pr
    } catch (err) {
      console.error('open PR failed', err)
    }
  }
  const fresh = parse(await db.prepare('SELECT * FROM proposals WHERE id = ?').bind(id).first())
  return { proposal: { ...fresh, votes, myVote: value, threshold: threshold(env) }, submitted }
}

export async function withdraw(env, user, id) {
  const db = env.DB
  await ensureSchema(db)
  const r = await db.prepare("UPDATE proposals SET status = 'withdrawn' WHERE id = ? AND user_id = ? AND status = 'open'").bind(id, user.id).run()
  return r.meta.changes > 0
}

/** Discord text announcing a proposal in the record's thread. */
export function describeProposal(p, recordUrl) {
  const fmt = (v) => (v == null ? '—' : Array.isArray(v) ? v.join(', ') : String(v))
  return [
    `📋 **Propuesta #${p.id}** · ${FIELD_LABEL[p.field] || p.field}`,
    `**Antes:** ${fmt(p.from_value).slice(0, 300)}`,
    `**Después:** ${fmt(p.to_value).slice(0, 300)}`,
    `**Motivo:** ${p.reason.slice(0, 400)}`,
    p.evidence?.length ? `**Evidencia:** ${p.evidence.join(' · ').slice(0, 400)}` : null,
    `Vote en la ficha del registro: ${recordUrl}`,
  ]
    .filter(Boolean)
    .join('\n')
}
