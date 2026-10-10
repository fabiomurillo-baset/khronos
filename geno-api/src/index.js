// geno-api — bridge between the Geno explorer (basetlabs.com/costaricahist1500-1800)
// and the Discord server "Historia Documental Costa Rica".
//
//   GET  /health
//   GET  /config                         enabled sign-in providers, invite link
//   GET  /auth/:provider/start?record=N  begin sign-in (discord | google | facebook)
//   GET  /auth/:provider/callback        provider returns here; redirects to the site with ?auth=token
//   GET  /me                             the signed-in user (Bearer token)
//   GET  /records/:id/messages?after=M   thread of a record (public)
//   POST /records/:id/messages           multipart: content, title, summary, files[] (Bearer token)
//   GET  /files/:key                     copy of an uploaded file kept in R2

import { enabledProviders, finishLogin, isEnabled, readSession, startLogin } from './auth.js'
import { createThread, findThread, postAsUser, readMessages, threadUrl } from './discord.js'

const MAX_CONTENT = 2000
const MAX_FILES = 4
const MAX_FILE_BYTES = 10 * 1024 * 1024 // Discord's limit for an unboosted server
const ALLOWED_TYPES = /^(image\/(jpeg|png|gif|webp|heic|tiff)|application\/pdf)$/

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
    return reply({ providers: enabledProviders(env), invite: env.DISCORD_INVITE || null, maxFileBytes: MAX_FILE_BYTES, maxFiles: MAX_FILES })
  }

  let m
  if ((m = path.match(/^\/auth\/(discord|google|facebook)\/(start|callback)$/))) {
    const [, provider, step] = m
    if (!isEnabled(env, provider)) return reply({ error: 'provider not configured' }, 404)
    if (step === 'start') {
      const record = (url.searchParams.get('record') || '').replace(/\D/g, '')
      return startLogin(env, request.url, provider, record)
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

  if ((m = path.match(/^\/files\/(.+)$/))) {
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
    const title = String(form.get('title') || `Geno · registro #${recordId}`).slice(0, 100)
    const summary = String(form.get('summary') || '').slice(0, 500)
    threadId = await createThread(env, recordId, { title, summary, url: `${env.SITE_URL}#r/${recordId}` })
  }

  const message = await postAsUser(env, threadId, user, content, files)

  // Keep our own copy of every file, with provenance, so the data outlives Discord.
  ctx.waitUntil(
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
