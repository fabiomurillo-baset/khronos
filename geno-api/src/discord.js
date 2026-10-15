// Discord REST helpers. Discord is the source of truth: each Khronos record that
// receives a contribution becomes one post (thread) in the #aportes forum, and
// the panel on the site reads and writes that thread.

// DISCORD_API_BASE is only overridden in tests (a mock server).
const api = (env) => env.DISCORD_API_BASE || 'https://discord.com/api/v10'

async function bot(env, path, init = {}) {
  const res = await fetch(`${api(env)}${path}`, {
    ...init,
    headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, ...(init.headers || {}) },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`discord ${init.method || 'GET'} ${path} → ${res.status} ${text.slice(0, 200)}`)
  }
  return res.status === 204 ? null : res.json()
}

function json(body, method = 'POST') {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

/** Thread id for a record, if a post already exists. */
export async function findThread(env, recordId) {
  return env.KV.get(`thread:${recordId}`)
}

/**
 * Create the forum post for a record. `ref` is the human reference
 * ({ title, summary, url }) that becomes the post name and starter message.
 */
export async function createThread(env, recordId, ref) {
  const name = ref.title.slice(0, 100)
  const thread = await bot(
    env,
    `/channels/${env.DISCORD_FORUM_CHANNEL_ID}/threads`,
    json({
      name,
      auto_archive_duration: 10080,
      message: { content: `**${ref.title}**\n> ${ref.summary}\n${ref.url}`, allowed_mentions: { parse: [] } },
    }),
  )
  await env.KV.put(`thread:${recordId}`, thread.id)
  return thread.id
}

/** Webhook on the forum channel, created on first use and remembered in KV. */
async function webhook(env) {
  const saved = await env.KV.get('webhook', 'json')
  if (saved) return saved
  const created = await bot(env, `/channels/${env.DISCORD_FORUM_CHANNEL_ID}/webhooks`, json({ name: 'Geno (web)' }))
  const hook = { id: created.id, token: created.token }
  await env.KV.put('webhook', JSON.stringify(hook))
  return hook
}

/**
 * Post in a thread on behalf of a site user. Webhooks let the message carry the
 * contributor's own name and avatar instead of the bot's. `files` are File objects.
 */
export async function postAsUser(env, threadId, user, content, files = []) {
  const hook = await webhook(env)
  const form = new FormData()
  form.set(
    'payload_json',
    JSON.stringify({
      content,
      username: displayName(user).slice(0, 80),
      avatar_url: user.avatar || undefined,
      allowed_mentions: { parse: [] },
    }),
  )
  files.forEach((f, i) => form.set(`files[${i}]`, f, f.name))
  const res = await fetch(`${api(env)}/webhooks/${hook.id}/${hook.token}?wait=true&thread_id=${threadId}`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`discord webhook → ${res.status} ${(await res.text()).slice(0, 200)}`)
  return normalize(await res.json())
}

/** Messages of a thread, oldest first. `after` is a message id for incremental polling. */
export async function readMessages(env, threadId, after) {
  const qs = new URLSearchParams({ limit: '100' })
  if (after) qs.set('after', after)
  const list = await bot(env, `/channels/${threadId}/messages?${qs}`)
  return list.reverse().map(normalize)
}

export function threadUrl(env, threadId) {
  return `https://discord.com/channels/${env.DISCORD_GUILD_ID}/${threadId}`
}

function displayName(user) {
  return user.provider === 'discord' ? user.name : `${user.name} (${user.provider === 'google' ? 'Google' : 'Facebook'})`
}

/** The subset of a Discord message the panel renders. */
function normalize(m) {
  const a = m.author || {}
  const viaWeb = Boolean(m.webhook_id)
  return {
    id: m.id,
    at: m.timestamp,
    content: m.content || '',
    author: {
      name: viaWeb ? a.username : a.global_name || a.username || '—',
      // Works for webhook messages too (author.id is the webhook id, avatar the override hash).
      avatar: a.avatar ? `https://cdn.discordapp.com/avatars/${a.id}/${a.avatar}.png?size=64` : null,
      viaWeb,
      bot: Boolean(a.bot) && !viaWeb,
    },
    attachments: (m.attachments || []).map((x) => ({
      id: x.id,
      name: x.filename,
      url: x.url,
      type: x.content_type || '',
      size: x.size,
      width: x.width,
      height: x.height,
    })),
  }
}

/** One line in the curation log channel (optional: needs DISCORD_CURATION_CHANNEL_ID). */
export async function postLog(env, content) {
  if (!env.DISCORD_CURATION_CHANNEL_ID) return
  try {
    await bot(env, `/channels/${env.DISCORD_CURATION_CHANNEL_ID}/messages`, json({ content, allowed_mentions: { parse: [] } }))
  } catch (err) {
    console.error('curation log failed', err)
  }
}
