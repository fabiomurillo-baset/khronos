// Sign-in with Discord, Google or Facebook (OAuth 2.0 authorization code) and
// stateless sessions (HS256 tokens signed with SESSION_SECRET, 30 days).
//
// Every provider ends up as the same user shape:
//   { id: 'discord:1234', provider: 'discord', name: 'Ana Mora', avatar: 'https://…' | null }

const PROVIDERS = {
  discord: {
    label: 'Discord',
    env: ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET'],
    authorize: 'https://discord.com/oauth2/authorize',
    scope: 'identify',
    extra: { prompt: 'none' },
    async exchange(env, code, redirectUri) {
      const token = await postForm('https://discord.com/api/oauth2/token', {
        client_id: env.DISCORD_CLIENT_ID,
        client_secret: env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      })
      const u = await getJson('https://discord.com/api/users/@me', token.access_token)
      return {
        id: `discord:${u.id}`,
        provider: 'discord',
        name: u.global_name || u.username,
        avatar: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64` : null,
      }
    },
  },
  google: {
    label: 'Google',
    env: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    scope: 'openid profile',
    extra: {},
    async exchange(env, code, redirectUri) {
      const token = await postForm('https://oauth2.googleapis.com/token', {
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      })
      const u = await getJson('https://openidconnect.googleapis.com/v1/userinfo', token.access_token)
      return { id: `google:${u.sub}`, provider: 'google', name: u.name || 'Google user', avatar: u.picture || null }
    },
  },
  facebook: {
    label: 'Facebook',
    env: ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'],
    authorize: 'https://www.facebook.com/v21.0/dialog/oauth',
    scope: 'public_profile',
    extra: {},
    async exchange(env, code, redirectUri) {
      const tokenUrl = new URL('https://graph.facebook.com/v21.0/oauth/access_token')
      tokenUrl.search = new URLSearchParams({
        client_id: env.FACEBOOK_APP_ID,
        client_secret: env.FACEBOOK_APP_SECRET,
        redirect_uri: redirectUri,
        code,
      })
      const token = await (await fetch(tokenUrl)).json()
      if (!token.access_token) throw new Error('facebook token exchange failed')
      const meUrl = new URL('https://graph.facebook.com/v21.0/me')
      meUrl.search = new URLSearchParams({ fields: 'id,name,picture.type(small)', access_token: token.access_token })
      const u = await (await fetch(meUrl)).json()
      return { id: `facebook:${u.id}`, provider: 'facebook', name: u.name || 'Facebook user', avatar: u.picture?.data?.url || null }
    },
  },
}

function clientId(env, provider) {
  return env[PROVIDERS[provider].env[0]]
}

/** Providers whose credentials are configured; the panel shows one button per entry. */
export function enabledProviders(env) {
  return Object.entries(PROVIDERS)
    .filter(([, p]) => p.env.every((k) => env[k]))
    .map(([id, p]) => ({ id, label: p.label }))
}

export function isEnabled(env, provider) {
  return Boolean(PROVIDERS[provider] && PROVIDERS[provider].env.every((k) => env[k]))
}

export function redirectUri(requestUrl, provider) {
  const u = new URL(requestUrl)
  // Behind Cloudflare the Worker may see http://; providers are registered with https.
  const origin = u.hostname === 'localhost' ? u.origin : u.origin.replace(/^http:/, 'https:')
  return `${origin}/auth/${provider}/callback`
}

/** Step 1: remember where to come back to, send the browser to the provider. */
export async function startLogin(env, requestUrl, provider, returnHash) {
  const state = randomToken()
  await env.KV.put(`oauth:${state}`, JSON.stringify({ provider, returnHash }), { expirationTtl: 600 })
  const p = PROVIDERS[provider]
  const url = new URL(p.authorize)
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId(env, provider),
    redirect_uri: redirectUri(requestUrl, provider),
    scope: p.scope,
    state,
    ...p.extra,
  })
  return Response.redirect(url.toString(), 302)
}

/** Step 2: validate state, exchange the code, mint a session, return to the record. */
export async function finishLogin(env, requestUrl, provider) {
  const url = new URL(requestUrl)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const saved = state && (await env.KV.get(`oauth:${state}`, 'json'))
  if (!code || !saved || saved.provider !== provider) {
    return Response.redirect(`${env.SITE_URL}?auth=error`, 302)
  }
  await env.KV.delete(`oauth:${state}`)
  let user
  try {
    user = await PROVIDERS[provider].exchange(env, code, redirectUri(requestUrl, provider))
  } catch {
    return Response.redirect(`${env.SITE_URL}?auth=error`, 302)
  }
  const token = await signSession(env, user)
  const back = new URL(env.SITE_URL)
  back.searchParams.set('auth', token)
  if (saved.returnHash) back.hash = saved.returnHash
  return Response.redirect(back.toString(), 302)
}

// ---- sessions -------------------------------------------------------------

const SESSION_DAYS = 30

async function key(env) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

export async function signSession(env, user) {
  const payload = { ...user, exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400 }
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)))
  const sig = b64url(new Uint8Array(await crypto.subtle.sign('HMAC', await key(env), new TextEncoder().encode(body))))
  return `${body}.${sig}`
}

/** Returns the user for a `Bearer` token, or null. */
export async function readSession(env, request) {
  const header = request.headers.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token || !token.includes('.')) return null
  const [body, sig] = token.split('.')
  try {
    const ok = await crypto.subtle.verify('HMAC', await key(env), unb64url(sig), new TextEncoder().encode(body))
    if (!ok) return null
    const payload = JSON.parse(new TextDecoder().decode(unb64url(body)))
    if (!payload.exp || payload.exp < Date.now() / 1000) return null
    const { exp, ...user } = payload
    return user
  } catch {
    return null
  }
}

// ---- helpers --------------------------------------------------------------

async function postForm(url, fields) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  })
  const json = await res.json()
  if (!res.ok || !json.access_token) throw new Error(`token exchange failed: ${res.status}`)
  return json
}

async function getJson(url, bearer) {
  const res = await fetch(url, { headers: { authorization: `Bearer ${bearer}` } })
  if (!res.ok) throw new Error(`profile fetch failed: ${res.status}`)
  return res.json()
}

function randomToken() {
  return b64url(crypto.getRandomValues(new Uint8Array(24)))
}

function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function unb64url(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(b, (c) => c.charCodeAt(0))
}
