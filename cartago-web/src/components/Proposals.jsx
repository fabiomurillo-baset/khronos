import { useEffect, useState } from 'react'
import { api } from '../lib/community.js'
import { getDataset, getSummary, sourceLinks } from '../lib/data.js'
import { t } from '../lib/i18n.js'

const FIELDS = ['year', 'date', 'people', 'locations', 'summary_es', 'summary_en']
const FIELD_KEY = { year: 'fieldYear', date: 'fieldDate', people: 'fieldPeople', locations: 'fieldLocations', summary_es: 'fieldSummaryEs', summary_en: 'fieldSummaryEn' }
const STATUS_STYLE = {
  open: 'border-sky-400/40 text-place',
  submitted: 'border-amber-400/40 text-amber-800',
  merged: 'border-emerald-400/40 text-emerald-800',
  rejected: 'border-rose-400/40 text-rubric',
  withdrawn: 'border-rule text-label',
}

/** Current value of a field on the record, in the shape the API expects. */
function currentValue(ev, field) {
  switch (field) {
    case 'year':
      return ev.year
    case 'date':
      return ev.date || ''
    case 'people':
      return ev.people
    case 'locations':
      return ev.locations
    case 'summary_es':
    case 'summary_en': {
      const { text, fallback } = getSummary(ev, field.slice(-2))
      return fallback && field === 'summary_es' ? '' : text
    }
    default:
      return ''
  }
}

const fmt = (v) => (v == null || v === '' ? '—' : Array.isArray(v) ? v.join(', ') : String(v))
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

function ProposalForm({ ev, lang, onDone, onCancel }) {
  const [field, setField] = useState('year')
  const [value, setValue] = useState(() => editorText(currentValue(ev, "year")))
  const [reason, setReason] = useState('')
  const [evidence, setEvidence] = useState(() => sourceLinks(getDataset(), ev)?.viewer || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const pick = (f) => {
    setField(f)
    setValue(editorText(currentValue(ev, f)))
  }
  const from = currentValue(ev, field)
  const to = parseEditor(field, value)
  const unchanged = same(from, to)
  const isList = field === 'people' || field === 'locations'
  const isLong = field.startsWith('summary')

  const submit = async (e) => {
    e.preventDefault()
    if (busy || unchanged) return
    setBusy(true)
    setError(null)
    try {
      const r = await api.propose(ev, lang, {
        field,
        from,
        to,
        reason: reason.trim(),
        evidence: evidence.split('\n').map((s) => s.trim()).filter(Boolean),
      })
      onDone(r.proposal)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-rubric/30 bg-rubric/5 p-3 text-sm">
      <label className="block text-[11px] tracking-wide text-label uppercase">{t(lang, 'field')}</label>
      <div className="mt-1 flex flex-wrap gap-1">
        {FIELDS.map((f) => (
          <button key={f} type="button" className="btn-ghost text-xs" aria-pressed={field === f} onClick={() => pick(f)}>
            {t(lang, FIELD_KEY[f])}
          </button>
        ))}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <div className="text-[11px] tracking-wide text-label uppercase">{t(lang, 'currentValue')}</div>
          <div className="mt-1 max-h-32 overflow-y-auto rounded-md border border-rule bg-paper-2 px-2.5 py-1.5 text-xs whitespace-pre-wrap text-ink-light">{isList ? from.join('\n') : fmt(from)}</div>
        </div>
        <div>
          <label className="text-[11px] tracking-wide text-label uppercase">
            {t(lang, 'proposedValue')} {isList && <span className="normal-case">({t(lang, 'onePerLine')})</span>}
          </label>
          {field === 'year' ? (
            <input type="number" min="1400" max="1900" value={value} onChange={(e) => setValue(e.target.value)} className="field mt-1" />
          ) : isList || isLong ? (
            <textarea value={value} onChange={(e) => setValue(e.target.value)} rows={isLong ? 5 : 4} className="field mt-1 resize-y text-xs" />
          ) : (
            <input value={value} onChange={(e) => setValue(e.target.value)} className="field mt-1" maxLength={200} />
          )}
        </div>
      </div>

      <label className="mt-3 block text-[11px] tracking-wide text-label uppercase">{t(lang, 'reason')}</label>
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={2000} required minLength={10} placeholder={t(lang, 'reasonPlaceholder')} className="field mt-1 resize-y text-xs" />
      <label className="mt-3 block text-[11px] tracking-wide text-label uppercase">{t(lang, 'evidence')}</label>
      <textarea value={evidence} onChange={(e) => setEvidence(e.target.value)} rows={2} placeholder={t(lang, 'evidencePlaceholder')} className="field mt-1 resize-y text-xs" />

      <div className="mt-3 flex items-center justify-end gap-2">
        {unchanged && <span className="mr-auto text-xs text-label">{t(lang, 'noChange')}</span>}
        {error && <span className="mr-auto text-xs text-rubric">{error.status === 401 ? t(lang, 'sessionExpired') : error.message}</span>}
        <button type="button" className="btn-ghost" onClick={onCancel}>
          {t(lang, 'cancel')}
        </button>
        <button type="submit" className="btn-ghost border border-rubric/50 text-rubric hover:bg-rubric/10 disabled:opacity-40" disabled={busy || unchanged || reason.trim().length < 10}>
          {busy ? t(lang, 'submitting') : t(lang, 'submitProposal')}
        </button>
      </div>
    </form>
  )
}

function editorText(v) {
  return Array.isArray(v) ? v.join('\n') : v == null ? '' : String(v)
}

function parseEditor(field, text) {
  if (field === 'year') return text.trim() === '' ? null : Number(text)
  if (field === 'people' || field === 'locations') return text.split('\n').map((s) => s.trim()).filter(Boolean)
  return text.trim()
}

/** Proposed corrections of a record: list with votes and status, plus the form. Lives inside the Aportar panel. */
export default function Proposals({ ev, lang, user, config, onSignInNeeded }) {
  const [items, setItems] = useState(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState(null)
  const enabled = config?.proposals !== false
  const threshold = config?.voteThreshold ?? 3

  const load = () =>
    api
      .proposals(ev)
      .then((r) => setItems(r.proposals))
      .catch((e) => setError(e))
  useEffect(() => {
    let alive = true
    api
      .proposals(ev)
      .then((r) => alive && setItems(r.proposals))
      .catch((e) => alive && setError(e))
    const id = setInterval(() => {
      api
        .proposals(ev)
        .then((r) => alive && setItems(r.proposals))
        .catch(() => {})
    }, 15000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [ev])

  const castVote = async (p, value) => {
    if (!user) return onSignInNeeded?.()
    const next = p.myVote === value ? 0 : value
    try {
      const r = await api.vote(p.id, next)
      setItems((list) => list.map((x) => (x.id === p.id ? r.proposal : x)))
    } catch (e) {
      setError(e)
    }
  }

  const withdraw = async (p) => {
    try {
      await api.withdraw(p.id)
      load()
    } catch (e) {
      setError(e)
    }
  }

  if (!enabled) return null
  const active = (items || []).filter((p) => p.status !== 'withdrawn')

  return (
    <section className="rounded-lg border border-rule bg-paper-2 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-ink">{t(lang, 'proposals')}</h4>
          <p className="mt-0.5 text-[11px] text-label">{t(lang, 'proposalsHelp', threshold)}</p>
        </div>
        {!open && (
          <button type="button" className="chip shrink-0 border-rubric/40 text-rubric hover:bg-rubric/10" onClick={() => (user ? setOpen(true) : onSignInNeeded?.())}>
            {t(lang, 'propose')}
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3">
          <ProposalForm
            ev={ev}
            lang={lang}
            onCancel={() => setOpen(false)}
            onDone={(p) => {
              setOpen(false)
              setItems((list) => [p, ...(list || [])])
            }}
          />
        </div>
      )}

      {error && <p className="mt-2 text-xs text-rubric">{error.status === 401 ? t(lang, 'sessionExpired') : t(lang, 'communityOffline')}</p>}
      {items && active.length === 0 && !open && <p className="mt-2 text-xs text-label">{t(lang, 'noProposals')}</p>}

      <ul className="mt-3 space-y-2">
        {active.map((p) => {
          const net = p.votes.up - p.votes.down
          const votable = p.status === 'open'
          return (
            <li key={p.id} className="rounded-md border border-rule p-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-ink">{t(lang, FIELD_KEY[p.field] || 'field')}</span>
                <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase ${STATUS_STYLE[p.status] || ''}`}>{t(lang, `status${p.status[0].toUpperCase()}${p.status.slice(1)}`)}</span>
                <span className="ml-auto text-label">
                  {p.user_name} · {new Date(p.at).toLocaleDateString(lang === 'es' ? 'es-CR' : 'en-GB')}
                </span>
              </div>
              <div className="mt-1.5 grid gap-1 sm:grid-cols-2">
                <div>
                  <span className="text-label">{t(lang, 'before')}: </span>
                  <span className="text-ink-light line-through decoration-rose-400/50">{fmt(p.from_value).slice(0, 160)}</span>
                </div>
                <div>
                  <span className="text-label">{t(lang, 'after')}: </span>
                  <span className="text-emerald-800">{fmt(p.to_value).slice(0, 160)}</span>
                </div>
              </div>
              <p className="mt-1.5 text-ink-light">{p.reason}</p>
              {p.evidence?.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {p.evidence.map((e, i) => (
                    <li key={i} className="truncate">
                      {/^https?:\/\//.test(e) ? (
                        <a href={e} target="_blank" rel="noopener" className="text-place hover:text-rubric">
                          {e}
                        </a>
                      ) : (
                        <span className="text-label">{e}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  className={`chip ${p.myVote === 1 ? 'border-emerald-400/60 text-emerald-800' : 'text-ink-light'}`}
                  disabled={!votable}
                  onClick={() => castVote(p, 1)}
                  title={t(lang, 'voteUp')}
                >
                  ▲ {p.votes.up}
                </button>
                <button
                  type="button"
                  className={`chip ${p.myVote === -1 ? 'border-rose-400/60 text-rubric' : 'text-ink-light'}`}
                  disabled={!votable}
                  onClick={() => castVote(p, -1)}
                  title={t(lang, 'voteDown')}
                >
                  ▼ {p.votes.down}
                </button>
                {votable && (
                  <span className="text-label">
                    {t(lang, 'votesNet', net, p.threshold)}
                    <span className="ml-2 inline-block h-1 w-16 overflow-hidden rounded bg-ink/10 align-middle">
                      <span className="block h-full bg-rubric/70" style={{ width: `${Math.min(100, Math.max(0, (net / p.threshold) * 100))}%` }} />
                    </span>
                  </span>
                )}
                {p.pr_url && (
                  <a href={p.pr_url} target="_blank" rel="noopener" className="text-place hover:text-rubric">
                    {t(lang, 'viewPr')} #{p.pr_number} ↗
                  </a>
                )}
                {p.status === 'submitted' && <span className="text-label">{t(lang, 'prPending')}</span>}
                {votable && user && p.user_id === user.id && (
                  <button type="button" className="ml-auto text-label hover:text-rubric" onClick={() => withdraw(p)}>
                    {t(lang, 'withdraw')}
                  </button>
                )}
                {!user && votable && <span className="ml-auto text-label">{t(lang, 'signInToVote')}</span>}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
