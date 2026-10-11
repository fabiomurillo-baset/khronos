// GitHub: open one pull request per accepted proposal, appending a line to
// scripts/data/corrections.jsonl on a branch, and read a PR's state back.
// Needs GITHUB_TOKEN (fine-grained PAT: Contents + Pull requests, read/write,
// on the geno repository) and GITHUB_REPO ("owner/name").

const CORRECTIONS_PATH = 'scripts/data/corrections.jsonl'

const api = (env) => env.GITHUB_API_BASE || 'https://api.github.com'

async function gh(env, path, init = {}) {
  const res = await fetch(`${api(env)}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'geno-api',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  })
  if (res.status === 404 && init.allow404) return null
  if (!res.ok) throw new Error(`github ${init.method || 'GET'} ${path} → ${res.status} ${(await res.text()).slice(0, 300)}`)
  return res.status === 204 ? null : res.json()
}

const json = (body, method = 'POST') => ({ method, body: JSON.stringify(body) })

function toBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

function fromBase64Utf8(b64) {
  const bin = atob(b64.replace(/\n/g, ''))
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

export const githubEnabled = (env) => Boolean(env.GITHUB_TOKEN && env.GITHUB_REPO)

function fmt(v) {
  return v == null ? '—' : Array.isArray(v) ? v.join(', ') : String(v)
}

/**
 * Create branch `proposal-<id>`, append the correction line, open the PR.
 * Returns { number, url }.
 */
export async function openProposalPr(env, proposal, votes, context) {
  const repo = env.GITHUB_REPO
  const base = env.GITHUB_BASE_BRANCH || 'main'
  const branch = `proposal-${proposal.id}`

  const ref = await gh(env, `/repos/${repo}/git/ref/heads/${base}`)
  const baseSha = ref.object.sha
  const existing = await gh(env, `/repos/${repo}/git/ref/heads/${branch}`, { allow404: true })
  if (!existing) await gh(env, `/repos/${repo}/git/refs`, json({ ref: `refs/heads/${branch}`, sha: baseSha }))

  const file = await gh(env, `/repos/${repo}/contents/${CORRECTIONS_PATH}?ref=${branch}`, { allow404: true })
  const current = file ? fromBase64Utf8(file.content) : ''
  const line = JSON.stringify({
    id: proposal.id,
    record: proposal.record,
    field: proposal.field,
    from: proposal.from_value,
    to: proposal.to_value,
    reason: proposal.reason,
    evidence: proposal.evidence,
    by: proposal.user_name,
    at: proposal.at,
  })
  const next = `${current.replace(/\n*$/, '')}${current.trim() ? '\n' : ''}${line}\n`
  const title = `Registro #${proposal.record}: ${FIELD_LABEL[proposal.field] || proposal.field} (propuesta #${proposal.id})`
  await gh(
    env,
    `/repos/${repo}/contents/${CORRECTIONS_PATH}`,
    json(
      {
        message: `${title}\n\nPropuesto por ${proposal.user_name} y aprobado por la comunidad (${votes.up} a favor, ${votes.down} en contra).`,
        content: toBase64Utf8(next),
        branch,
        ...(file ? { sha: file.sha } : {}),
      },
      'PUT',
    ),
  )

  const body = [
    `## Corrección al registro #${proposal.record}`,
    '',
    `**Campo:** ${FIELD_LABEL[proposal.field] || proposal.field}`,
    '',
    '| | |',
    '|---|---|',
    `| Antes | ${fmt(proposal.from_value).replace(/\|/g, '\\|')} |`,
    `| Después | ${fmt(proposal.to_value).replace(/\|/g, '\\|')} |`,
    '',
    `**Motivo:** ${proposal.reason}`,
    '',
    proposal.evidence?.length ? `**Evidencia:**\n${proposal.evidence.map((e) => `- ${e}`).join('\n')}` : '**Evidencia:** no se adjuntó.',
    '',
    `**Propuesto por:** ${proposal.user_name} · **Votos:** 👍 ${votes.up} · 👎 ${votes.down}`,
    '',
    `Registro en Geno: ${context.recordUrl}${context.threadUrl ? `\nConversación en Discord: ${context.threadUrl}` : ''}`,
    '',
    '---',
    `Al aprobar y fusionar este PR, la línea añadida a \`${CORRECTIONS_PATH}\` pasa a ser parte de los datos: la aplicación la lee desde \`${base}\` y el pipeline la aplica al regenerar las vistas.`,
    '',
    '🤖 PR abierto automáticamente por geno-api al alcanzarse el umbral de votos.',
  ].join('\n')

  const pr = await gh(env, `/repos/${repo}/pulls`, json({ title, head: branch, base, body, maintainer_can_modify: true }))
  return { number: pr.number, url: pr.html_url }
}

/** 'open' | 'merged' | 'closed' */
export async function prState(env, number) {
  const pr = await gh(env, `/repos/${env.GITHUB_REPO}/pulls/${number}`)
  return pr.merged ? 'merged' : pr.state === 'open' ? 'open' : 'closed'
}

export const FIELD_LABEL = {
  year: 'Año',
  date: 'Fecha',
  people: 'Personas',
  locations: 'Lugares',
  summary_es: 'Resumen (es)',
  summary_en: 'Resumen (en)',
}
