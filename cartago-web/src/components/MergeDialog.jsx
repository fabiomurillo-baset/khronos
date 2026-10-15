import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/community.js'
import { getSummary, yearSpan } from '../lib/data.js'
import { t } from '../lib/i18n.js'
import { formatNumber } from '../lib/text.js'
import { SignInButtons } from './SignIn.jsx'

function topCounts(entries, max = 3) {
  const counts = new Map()
  for (const x of entries) counts.set(x, (counts.get(x) || 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, max)
}

function Column({ entry, kind, lang, keep, onKeep, otherIds }) {
  const span = yearSpan(entry)
  const related = useMemo(() => {
    const all = []
    for (const ev of entry.events) {
      if (kind === 'person') for (const l of ev.locations) all.push(l)
      else for (const p of ev.people) all.push(p)
    }
    return topCounts(all)
  }, [entry, kind])
  const shared = entry.events.filter((ev) => otherIds.has(ev.id)).length
  const samples = entry.events.slice(0, 3)
  return (
    <div className={`flex-1 rounded-lg border p-4 ${keep ? 'border-rubric/60 bg-rubric/5' : 'border-rule'}`}>
      <label className="flex cursor-pointer items-start gap-2">
        <input type="radio" name="keep" checked={keep} onChange={onKeep} className="mt-1.5 accent-gold" />
        <span>
          <span className="block font-display text-lg leading-tight font-semibold text-rubric">{entry.name}</span>
          <span className="block text-[11px] text-label">{t(lang, 'keepName')}</span>
        </span>
      </label>
      <dl className="mt-3 space-y-1.5 text-sm">
        <div className="flex justify-between gap-2">
          <dt className="text-label">{t(lang, 'profileRecords')}</dt>
          <dd className="text-ink">{formatNumber(entry.events.length, lang)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-label">{t(lang, 'year')}</dt>
          <dd className="text-ink">{span ? t(lang, 'span', span[0], span[1]) : '—'}</dd>
        </div>
        {entry.aliases.size > 1 && (
          <div>
            <dt className="text-label">{t(lang, 'variants')}</dt>
            <dd className="text-xs text-ink-light">{[...entry.aliases.keys()].join(' · ')}</dd>
          </div>
        )}
        <div>
          <dt className="text-label">{t(lang, kind === 'person' ? 'relatedPlaces' : 'relatedPeople')}</dt>
          <dd className="text-xs text-ink-light">{related.map(([n, c]) => `${n} (${c})`).join(' · ') || '—'}</dd>
        </div>
        {shared > 0 && <div className="text-xs text-place">{t(lang, 'sharedRecords', shared)}</div>}
      </dl>
      <div className="mt-3">
        <div className="text-[11px] tracking-wide text-label uppercase">{t(lang, 'sampleRecords')}</div>
        <ul className="mt-1 space-y-1.5">
          {samples.map((ev) => (
            <li key={ev.id} className="text-xs leading-snug text-ink-light">
              <span className="font-mono text-label">#{ev.id}</span> <span className="text-rubric">{ev.year ?? '—'}</span> ·{' '}
              {getSummary(ev, lang).text.slice(0, 140)}
              {getSummary(ev, lang).text.length > 140 ? '…' : ''}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/**
 * Side-by-side comparison of two entries (FamilySearch-style "merge duplicates").
 * The chosen entry keeps its name; the other is merged into it. Requires sign-in.
 */
export default function MergeDialog({ kind, a, b, lang, session, returnHash, onClose, onMerged }) {
  const [keepA, setKeepA] = useState(a.events.length >= b.events.length)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const idsA = useMemo(() => new Set(a.events.map((e) => e.id)), [a])
  const idsB = useMemo(() => new Set(b.events.map((e) => e.id)), [b])
  // A single person rarely appears across more than ~90 years of records.
  const combined = useMemo(() => {
    const sa = yearSpan(a)
    const sb = yearSpan(b)
    if (!sa || !sb) return null
    return [Math.min(sa[0], sb[0]), Math.max(sa[1], sb[1])]
  }, [a, b])
  const implausible = kind === 'person' && combined && combined[1] - combined[0] > 90

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async () => {
    const keep = keepA ? a : b
    const drop = keepA ? b : a
    setBusy(true)
    setError(null)
    try {
      // Keys are canonical already; the API stores the folded keys.
      const subject = drop.key
      const target = keep.key
      await api.curate({ kind, action: 'merge', subject, target, note })
      await onMerged(target)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-3 -sm" onClick={onClose}>
      <div className="max-h-full w-full max-w-4xl overflow-y-auto rounded-xl border border-rule bg-paper-2 p-5 shadow-2xl" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-xl font-semibold text-ink">{t(lang, 'mergeTitle')}</h3>
            <p className="mt-1 text-sm text-label">{t(lang, 'mergeHelp')}</p>
          </div>
          <button type="button" className="btn-ghost" onClick={onClose} aria-label={t(lang, 'close')}>
            ✕
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <Column entry={a} kind={kind} lang={lang} keep={keepA} onKeep={() => setKeepA(true)} otherIds={idsB} />
          <Column entry={b} kind={kind} lang={lang} keep={!keepA} onKeep={() => setKeepA(false)} otherIds={idsA} />
        </div>

        {implausible && (
          <p className="mt-3 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-800">⚠ {t(lang, 'spanWarning', combined[0], combined[1])}</p>
        )}

        {session.user ? (
          <div className="mt-4">
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={t(lang, 'noteOptional')} className="field" />
            <div className="mt-3 flex items-center justify-end gap-2">
              {error && <span className="mr-auto text-xs text-rubric">{error.status === 401 ? t(lang, 'sessionExpired') : error.message}</span>}
              <span className="text-[11px] text-label">{session.user.name}</span>
              <button type="button" className="btn-ghost" onClick={onClose}>
                {t(lang, 'cancel')}
              </button>
              <button type="button" className="btn-ghost border border-rubric/50 text-rubric hover:bg-rubric/10 disabled:opacity-40" disabled={busy} onClick={submit}>
                {busy ? t(lang, 'merging') : t(lang, 'merge')} → {(keepA ? a : b).name}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4">
            <SignInButtons lang={lang} config={session.config} returnHash={returnHash} prompt={t(lang, 'signInToCurate')} />
          </div>
        )}
      </div>
    </div>
  )
}
