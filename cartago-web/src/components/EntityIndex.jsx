import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { api } from '../lib/community.js'
import { getPeopleIndex, getPlacesIndex, sortedEntries, yearSpan, loadResolution, pendingSpellingMerges, curationVersion } from '../lib/data.js'
import { t } from '../lib/i18n.js'
import { fold, formatNumber } from '../lib/text.js'
import { SignInButtons } from './SignIn.jsx'

const PAGE = 100
const BULK = 200

/**
 * "N spelling variants with compatible lives": the merges resolve_people.py is sure about, accepted
 * in batches of 200 through /curation/bulk. Each is an ordinary merge entry afterwards (undoable one
 * by one from the profiles) and the batch is named in the note.
 */
function BulkSpelling({ lang, index, session, onChanged }) {
  const [resolution, setResolution] = useState(null)
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    let alive = true
    loadResolution()
      .then((r) => alive && setResolution(r))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pending = useMemo(() => pendingSpellingMerges(resolution, index), [resolution, index, curationVersion()])
  if (!resolution || pending.length === 0) return null

  const run = async () => {
    setError(null)
    const note = `lote grafías ${new Date().toISOString().slice(0, 10)}`
    const entries = pending.map((p) => ({ kind: 'person', action: 'merge', subject: p.subject, target: p.target, note }))
    try {
      for (let i = 0; i < entries.length; i += BULK) {
        setProgress([Math.min(i + BULK, entries.length), entries.length])
        await api.curateBulk(entries.slice(i, i + BULK))
      }
      await onChanged?.()
    } catch (err) {
      setError(err)
    } finally {
      setProgress(null)
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-rubric/30 bg-rubric/5 p-3 text-sm">
      <p className="text-ink">{t(lang, 'bulkSpelling', formatNumber(pending.length, lang))}</p>
      <p className="mt-0.5 text-[11px] text-label">{t(lang, 'bulkSpellingHelp')}</p>
      <p className="mt-1 text-xs text-label">
        {pending
          .slice(0, 3)
          .map((p) => `${p.proposal.a.name} = ${p.proposal.b.name}`)
          .join(' · ')}
        {pending.length > 3 ? ' · …' : ''}
      </p>
      {session?.user ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" className="btn-ghost border border-rubric/50 text-xs text-rubric hover:bg-rubric/10" disabled={Boolean(progress)} onClick={run}>
            {progress ? t(lang, 'bulkProgress', progress[0], progress[1]) : t(lang, 'bulkAccept')}
          </button>
          {error && <span className="text-xs text-rubric">{error.status === 401 ? t(lang, 'sessionExpired') : error.message}</span>}
        </div>
      ) : (
        session?.user === null && (
          <div className="mt-2">
            <SignInButtons lang={lang} config={session.config} returnHash="people" prompt={t(lang, 'signInToCurate')} />
          </div>
        )
      )}
    </div>
  )
}

/** Browsable list of people or places: search, sorted by number of records, "load more". */
export default function EntityIndex({ kind, lang, dataset, onOpen, session, onCurationChanged }) {
  const index = useMemo(() => (kind === 'person' ? getPeopleIndex(dataset) : getPlacesIndex(dataset)), [kind, dataset])
  const all = useMemo(() => sortedEntries(index), [index])
  const [query, setQuery] = useState('')
  const deferred = useDeferredValue(query)
  const [limit, setLimit] = useState(PAGE)

  const shown = useMemo(() => {
    const q = fold(deferred.trim())
    if (!q) return all
    const terms = q.split(/\s+/)
    return all.filter((e) => {
      const hay = fold([e.name, ...e.aliases.keys()].join(' '))
      return terms.every((term) => hay.includes(term))
    })
  }, [all, deferred])

  const isPerson = kind === 'person'
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-semibold text-ink">{t(lang, isPerson ? 'peopleTitle' : 'placesTitle')}</h2>
            <p className="text-sm text-label">{t(lang, isPerson ? 'peopleSubtitle' : 'placesSubtitle')}</p>
          </div>
          <span className="text-xs text-label">{t(lang, 'entries', formatNumber(shown.length, lang))}</span>
        </div>

        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setLimit(PAGE)
          }}
          placeholder={t(lang, isPerson ? 'searchPeople' : 'searchPlaces')}
          className="field mt-4"
          autoFocus
        />

        {isPerson && <BulkSpelling lang={lang} index={index} session={session} onChanged={onCurationChanged} />}

        <ol className="mt-4 divide-y divide-rule overflow-hidden rounded-xl border border-rule bg-paper-2">
          {shown.slice(0, limit).map((e) => {
            const span = yearSpan(e)
            return (
              <li key={e.key}>
                <button
                  type="button"
                  onClick={() => onOpen(kind, e.key)}
                  className="flex w-full items-center gap-4 px-4 py-2.5 text-left hover:bg-ink/10"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] text-ink">{e.name}</span>
                    {e.aliases.size > 1 && <span className="block truncate text-xs text-label">{t(lang, 'mergedBadge', e.aliases.size)}</span>}
                  </span>
                  {!isPerson && e.lat != null && <span className="hidden text-[11px] text-place sm:inline">▲ {t(lang, 'onMap')}</span>}
                  <span className="w-20 shrink-0 text-right font-mono text-xs text-label">{span ? t(lang, 'span', span[0], span[1]) : '—'}</span>
                  <span className="w-16 shrink-0 text-right font-display text-lg text-rubric">{formatNumber(e.events.length, lang)}</span>
                </button>
              </li>
            )
          })}
        </ol>
        {shown.length === 0 && <p className="mt-4 text-sm text-label">{t(lang, 'noResults')}</p>}
        {shown.length > limit && (
          <div className="mt-4 text-center">
            <button type="button" className="btn-ghost" onClick={() => setLimit((n) => n + PAGE)}>
              {t(lang, 'loadMore')} ({formatNumber(shown.length - limit, lang)})
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
