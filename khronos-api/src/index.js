// khronos-api — bridge between the Khronos explorer (basetlabs.com/khronos)
// and the Discord server "Historia Documental Costa Rica".
//
//   GET  /health
//   GET  /config                         enabled sign-in providers, invite link
//   GET  /auth/:provider/start?record=N  begin sign-in (discord | google | facebook)
//   GET  /auth/:provider/callback        provider returns here; redirects to the site with ?auth=token
//   GET  /me                             the signed-in user (Bearer token)
//   GET  /records/:id/messages?after=M   thread of a record (public)
//   POST /records/:id/messages           multipart: content, title, summary, files[] (Bearer token)
//   GET  /files/:key                     copy of an uploaded file kept in R2 (when the bucket is bound)
//   GET  /curation                       shared decisions about people/places (merges, renames)
//   POST /curation                       {kind, action, subject, target, note}   (Bearer token)
//   POST /curation/:id/undo              revert a decision                        (Bearer token)
//   GET  /records/:id/proposals          proposed corrections to a record, with votes
//   POST /records/:id/proposals          {field, from, to, reason, evidence[]}    (Bearer token)
//   POST /proposals/:id/vote             {value: 1 | -1 | 0}; opens the GitHub PR at the threshold (Bearer token)
//   POST /proposals/:id/withdraw         author withdraws an open proposal         (Bearer token)
//   GET  /works · POST /works            bibliography catalog (Internet Archive items, URLs)
//   GET  /refs · POST /refs              references: work + page attached to r:<id>, p:<key>, l:<key>
//   POST /refs/:id/undo

import { enabledProviders, finishLogin, isEnabled, readSession, startLogin } from './auth.js'
import { addCuration, describe, listCuration, undoCuration, validate } from './curation.js'
import { createThread, findThread, postAsUser, postLog, readMessages, threadUrl } from './discord.js'
import { githubEnabled } from './github.js'
import { createProposal, describeProposal, listProposals, setDiscordMessage, threshold, validateProposal, vote, withdraw } from './proposals.js'
import { addRef, addWork, listRefs, listWorks, undoRef, validateRef, validateWork } from './references.js'

const MAX_CONTENT = 2000
const MAX_FILES = 4
const MAX_FILE_BYTES = 10 * 1024 * 1024 // Discord's limit for an unboosted server
const ALLOWED_TYPES = /^(image\/(jpeg|png|gif|webp|heic|tiff)|application\/pdf)$/
const RETURN_HASH = /^(r\/\d+|p\/[^\s#]{1,200}|l\/[^\s#]{1,200}|map|timeline|graph|people|places)$/

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const origin = request.headers.get('origin')
    const cors = corsHeaders(env, origin)

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

    try {
      // Copy: Response.redirect() returns immutable headers.
      const out = await route(request, env, ctx, url)
      const res = new Response(out.body, out)
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v)
      return res
    } catch (err) {
      console.error(err)
      return reply({ error: 'internal', detail: String(err.message || err) }, 500, cors)
    }
  },
}

async function route(request, env, ctx, url) {
  const path = url.pathname.replace(/\/+$/, '') || '/'
  const { method } = request

  if (path === '/health') return reply({ ok: true })

  if (path === '/config') {
    return reply({
      providers: enabledProviders(env),
      invite: env.DISCORD_INVITE || null,
      maxFileBytes: MAX_FILE_BYTES,
      maxFiles: MAX_FILES,
      curation: Boolean(env.DB),
      proposals: Boolean(env.DB),
      pullRequests: githubEnabled(env),
      voteThreshold: threshold(env),
      repo: env.GITHUB_REPO || null,
    })
  }

  let m
  if ((m = path.match(/^\/auth\/(discord|google|facebook)\/(start|callback)$/))) {
    const [, provider, step] = m
    if (!isEnabled(env, provider)) return reply({ error: 'provider not configured' }, 404)
    if (step === 'start') {
      // Where to land after sign-in: a record (`record=N`) or any app hash (`return=p/juan...`).
      const record = (url.searchParams.get('record') || '').replace(/\D/g, '')
      const ret = url.searchParams.get('return') || (record ? `r/${record}` : '')
      return startLogin(env, request.url, provider, RETURN_HASH.test(ret) ? ret : '')
    }
    return finishLogin(env, request.url, provider)
  }

  if (path === '/me') {
    const user = await readSession(env, request)
    return user ? reply({ user }) : reply({ error: 'unauthorized' }, 401)
  }

  if ((m = path.match(/^\/records\/(\d+)\/messages$/))) {
    const recordId = m[1]
    if (method === 'GET') return getMessages(env, recordId, url.searchParams.get('after'))
    if (method === 'POST') return postMessage(request, env, ctx, recordId)
    return reply({ error: 'method not allowed' }, 405)
  }

  if (path === '/curation') {
    if (!env.DB) return reply({ entries: [], disabled: true })
    if (method === 'GET') {
      const entries = await listCuration(env.DB)
      return reply({ entries }, 200, { 'cache-control': 'no-store' })
    }
    if (method === 'POST') {
      const user = await readSession(env, request)
      if (!user) return reply({ error: 'unauthorized' }, 401)
      const body = await request.json().catch(() => null)
      const bad = validate(body)
      if (bad) return reply({ error: `invalid ${bad}` }, 400)
      const row = await addCuration(env.DB, user, body)
      ctx.waitUntil(postLog(env, describe(row, user)))
      return reply({ entry: row }, 201)
    }
    return reply({ error: 'method not allowed' }, 405)
  }

  if ((m = path.match(/^\/curation\/(\d+)\/undo$/)) && method === 'POST') {
    if (!env.DB) return reply({ error: 'curation disabled' }, 404)
    const user = await readSession(env, request)
    if (!user) return reply({ error: 'unauthorized' }, 401)
    const row = await undoCuration(env.DB, user, Number(m[1]))
    if (!row) return reply({ error: 'not found' }, 404)
    ctx.waitUntil(postLog(env, describe(row, user, true)))
    return reply({ undone: row.id })
  }

  if ((m = path.match(/^\/records\/(\d+)\/proposals$/))) {
    if (!env.DB) return reply({ proposals: [], disabled: true })
    const record = Number(m[1])
    const user = await readSession(env, request)
    if (method === 'GET') return reply({ proposals: await listProposals(env, record, user, ctx) })
    if (method === 'POST') {
      if (!user) return reply({ error: 'unauthorized' }, 401)
      const body = await request.json().catch(() => null)
      const bad = validateProposal(body)
      if (bad) return reply({ error: `invalid ${bad}` }, 400)
      const proposal = await createProposal(env, user, record, body)
      // Announce it in the record's Discord thread so the conversation and the vote stay together.
      ctx.waitUntil(
        (async () => {
          try {
            let threadId = await findThread(env, record)
            if (!threadId) {
              const title = String(body.title || `Khronos · registro #${record}`).slice(0, 100)
              threadId = await createThread(env, record, { title, summary: String(body.summary || '').slice(0, 500), url: `${env.SITE_URL}#r/${record}` })
            }
            const msg = await postAsUser(env, threadId, user, describeProposal(proposal, `${env.SITE_URL}#r/${record}`))
            await setDiscordMessage(env.DB, proposal.id, msg.id)
          } catch (err) {
            console.error('proposal announce failed', err)
          }
        })(),
      )
      return reply({ proposal: { ...proposal, votes: { up: 1, down: 0 }, myVote: 1, threshold: threshold(env) } }, 201)
    }
    return reply({ error: 'method not allowed' }, 405)
  }

  if ((m = path.match(/^\/proposals\/(\d+)\/(vote|withdraw)$/)) && method === 'POST') {
    if (!env.DB) return reply({ error: 'proposals disabled' }, 404)
    const user = await readSession(env, request)
    if (!user) return reply({ error: 'unauthorized' }, 401)
    const id = Number(m[1])
    if (m[2] === 'withdraw') return (await withdraw(env, user, id)) ? reply({ withdrawn: id }) : reply({ error: 'not found' }, 404)
    const body = await request.json().catch(() => ({}))
    const value = body.value === 1 || body.value === -1 || body.value === 0 ? body.value : null
    if (value === null) return reply({ error: 'invalid value' }, 400)
    const recordOf = await env.DB.prepare('SELECT record FROM proposals WHERE id = ?').bind(id).first()
    if (!recordOf) return reply({ error: 'not found' }, 404)
    const threadId = await findThread(env, recordOf.record)
    const result = await vote(env, user, id, value, { recordUrl: `${env.SITE_URL}#r/${recordOf.record}`, threadUrl: threadId ? threadUrl(env, threadId) : null })
    if (result?.submitted) ctx.waitUntil(postLog(env, `🔀 Propuesta #${id} alcanzó el umbral de votos: PR ${result.submitted.url}`))
    return reply(result)
  }

  if (path === '/works' || path === '/refs') {
    if (!env.DB) return reply({ works: [], refs: [], disabled: true })
    const isWork = path === '/works'
    if (method === 'GET') return reply(isWork ? { works: await listWorks(env.DB) } : { refs: await listRefs(env.DB) }, 200, { 'cache-control': 'no-store' })
    if (method === 'POST') {
      const user = await readSession(env, request)
      if (!user) return reply({ error: 'unauthorized' }, 401)
      const body = await request.json().catch(() => null)
      const bad = isWork ? validateWork(body) : validateRef(body)
      if (bad) return reply({ error: `invalid ${bad}` }, 400)
      if (isWork) return reply({ work: await addWork(env.DB, user, body) }, 201)
      const ref = await addRef(env.DB, user, body)
      ctx.waitUntil(postLog(env, `📚 ${user.name} añadió una referencia a ${body.target}: obra ${body.work_id}${ref.locator ? ` · ${ref.locator_type} ${ref.locator}` : ''}`))
      return reply({ ref }, 201)
    }
    return reply({ error: 'method not allowed' }, 405)
  }

  if ((m = path.match(/^\/refs\/(\d+)\/undo$/)) && method === 'POST') {
    if (!env.DB) return reply({ error: 'disabled' }, 404)
    const user = await readSession(env, request)
    if (!user) return reply({ error: 'unauthorized' }, 401)
    const row = await undoRef(env.DB, user, Number(m[1]))
    if (!row) return reply({ error: 'not found' }, 404)
    ctx.waitUntil(postLog(env, `↩️ ${user.name} quitó la referencia #${row.id} de ${row.target}`))
    return reply({ undone: row.id })
  }

  if ((m = path.match(/^\/files\/(.+)$/))) {
    if (!env.UPLOADS) return reply({ error: 'not found' }, 404)
    const obj = await env.UPLOADS.get(decodeURIComponent(m[1]))
    if (!obj) return reply({ error: 'not found' }, 404)
    const headers = new Headers()
    obj.writeHttpMetadata(headers)
    headers.set('cache-control', 'public, max-age=31536000, immutable')
    return new Response(obj.body, { headers })
  }

  return reply({ error: 'not found' }, 404)
}

async function getMessages(env, recordId, after) {
  const threadId = await findThread(env, recordId)
  if (!threadId) return reply({ thread: null, messages: [] })
  const messages = await readMessages(env, threadId, after)
  return reply({ thread: { id: threadId, url: threadUrl(env, threadId) }, messages })
}

async function postMessage(request, env, ctx, recordId) {
  const user = await readSession(env, request)
  if (!user) return reply({ error: 'unauthorized' }, 401)

  // One message every 5 s per user; cheap protection against accidental floods.
  const rlKey = `rl:${user.id}`
  const last = Number(await env.KV.get(rlKey)) || 0
  if (Date.now() - last < 5000) return reply({ error: 'too fast' }, 429)
  await env.KV.put(rlKey, String(Date.now()), { expirationTtl: 60 })

  const form = await request.formData()
  const content = String(form.get('content') || '').trim().slice(0, MAX_CONTENT)
  const files = form.getAll('files').filter((f) => f instanceof File && f.size > 0)
  if (!content && files.length === 0) return reply({ error: 'empty' }, 400)
  if (files.length > MAX_FILES) return reply({ error: 'too many files' }, 400)
  for (const f of files) {
    if (f.size > MAX_FILE_BYTES) return reply({ error: 'file too large', file: f.name }, 413)
    if (!ALLOWED_TYPES.test(f.type)) return reply({ error: 'file type not allowed', file: f.name }, 415)
  }

  let threadId = await findThread(env, recordId)
  if (!threadId) {
    const title = String(form.get('title') || `Khronos · registro #${recordId}`).slice(0, 100)
    const summary = String(form.get('summary') || '').slice(0, 500)
    threadId = await createThread(env, recordId, { title, summary, url: `${env.SITE_URL}#r/${recordId}` })
  }

  const message = await postAsUser(env, threadId, user, content, files)

  // Keep our own copy of every file, with provenance, so the data outlives Discord (optional: needs the R2 binding).
  if (env.UPLOADS) ctx.waitUntil(
    Promise.all(
      files.map((f, i) =>
        env.UPLOADS.put(`records/${recordId}/${message.id}-${i}-${safeName(f.name)}`, f.stream(), {
          httpMetadata: { contentType: f.type },
          customMetadata: { record: recordId, thread: threadId, message: message.id, user: user.id, name: user.name, at: message.at },
        }),
      ),
    ),
  )

  return reply({ thread: { id: threadId, url: threadUrl(env, threadId) }, message }, 201)
}

function safeName(name) {
  return name.normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(0, 80)
}

function corsHeaders(env, origin) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim())
  const h = {
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
  }
  if (origin && allowed.includes(origin)) {
    h['access-control-allow-origin'] = origin
    h.vary = 'origin'
  }
  return h
}

function reply(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } })
}
