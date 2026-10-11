import { useDeferredValue, useMemo, useState } from 'react'
import { getPeopleIndex, getPlacesIndex, sortedEntries, yearSpan } from '../lib/data.js'
import { t } from '../lib/i18n.js'
import { fold, formatNumber } from '../lib/text.js'

const PAGE = 100

/** Browsable list of people or places: search, sorted by number of records, "load more". */
export default function EntityIndex({ kind, lang, dataset, onOpen }) {
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
            <h2 className="font-display text-2xl font-semibold text-slate-100">{t(lang, isPerson ? 'peopleTitle' : 'placesTitle')}</h2>
            <p className="text-sm text-slate-400">{t(lang, isPerson ? 'peopleSubtitle' : 'placesSubtitle')}</p>
          </div>
          <span className="text-xs text-slate-400">{t(lang, 'entries', formatNumber(shown.length, lang))}</span>
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

        <ol className="mt-4 divide-y divide-white/6 overflow-hidden rounded-xl border border-white/8 bg-ink-950/40">
          {shown.slice(0, limit).map((e) => {
            const span = yearSpan(e)
            return (
              <li key={e.key}>
                <button
                  type="button"
                  onClick={() => onOpen(kind, e.key)}
                  className="flex w-full items-center gap-4 px-4 py-2.5 text-left hover:bg-white/4"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] text-slate-100">{e.name}</span>
                    {e.aliases.size > 1 && <span className="block truncate text-xs text-slate-500">{t(lang, 'mergedBadge', e.aliases.size)}</span>}
                  </span>
                  {!isPerson && e.lat != null && <span className="hidden text-[11px] text-sky-300 sm:inline">▲ {t(lang, 'onMap')}</span>}
                  <span className="w-20 shrink-0 text-right font-mono text-xs text-slate-400">{span ? t(lang, 'span', span[0], span[1]) : '—'}</span>
                  <span className="w-16 shrink-0 text-right font-display text-lg text-gold">{formatNumber(e.events.length, lang)}</span>
                </button>
              </li>
            )
          })}
        </ol>
        {shown.length === 0 && <p className="mt-4 text-sm text-slate-400">{t(lang, 'noResults')}</p>}
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
