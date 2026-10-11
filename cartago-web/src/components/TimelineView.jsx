import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import EventDetail from './EventDetail.jsx'
import { getSummary, personKey, placeKey } from '../lib/data.js'
import { t } from '../lib/i18n.js'
import { fold, formatNumber } from '../lib/text.js'

const PAGE = 60

export default function TimelineView({ lang, dataset, focus, actions }) {
  const [query, setQuery] = useState(() => focus?.query ?? (focus?.eventId ? `#${focus.eventId}` : ''))
  const deferredQuery = useDeferredValue(query)
  const [decade, setDecade] = useState(null)
  const listRef = useRef(null)
  const sentinelRef = useRef(null)
  const [appliedFocus, setAppliedFocus] = useState(focus?.nonce ?? null)

  // Jump requested from another view while this one is mounted (state adjusted during render).
  if ((focus?.eventId || focus?.query) && focus.nonce !== appliedFocus) {
    setAppliedFocus(focus.nonce)
    setQuery(focus.query ?? `#${focus.eventId}`)
    setDecade(null)
  }

  // Paging is keyed by the active filter, so a new filter implicitly starts at the first page.
  const filterKey = `${deferredQuery}|${decade}`
  const [paging, setPaging] = useState({ key: filterKey, limit: PAGE })
  const limit = paging.key === filterKey ? paging.limit : PAGE
  const setLimit = useCallback(
    (next) =>
      setPaging((p) => {
        const current = p.key === filterKey ? p.limit : PAGE
        return { key: filterKey, limit: typeof next === 'function' ? next(current) : next }
      }),
    [filterKey],
  )

  // Folded haystack per record, built once per language (people + places + summary).
  const haystacks = useMemo(
    () => dataset.events.map((ev) => fold(`${ev.people.join(' ')} ${ev.locations.join(' ')} ${getSummary(ev, lang).text}`)),
    [dataset, lang],
  )

  const decades = useMemo(() => {
    const out = new window.Map()
    for (const ev of dataset.events) {
      if (ev.year == null) continue
      const d = Math.floor(ev.year / 10) * 10
      out.set(d, (out.get(d) || 0) + 1)
    }
    return [...out.entries()].sort((a, b) => a[0] - b[0])
  }, [dataset])
  const maxDecade = useMemo(() => Math.max(1, ...decades.map(([, n]) => n)), [decades])

  const results = useMemo(() => {
    const q = fold(deferredQuery.trim())
    const idMatch = /^#(\d+)$/.exec(q)
    return dataset.events.filter((ev, i) => {
      if (decade != null && (ev.year == null || Math.floor(ev.year / 10) * 10 !== decade)) return false
      if (idMatch) return ev.id === Number(idMatch[1])
      return !q || haystacks[i].includes(q)
    })
  }, [dataset, haystacks, deferredQuery, decade])

  // Back to the top whenever the filter changes.
  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 })
  }, [filterKey])

  // Infinite scroll: render the next page when the sentinel becomes visible.
  useEffect(() => {
    const sentinel = sentinelRef.current
    const root = listRef.current
    if (!sentinel || !root) return undefined
    const io = new IntersectionObserver(
      (entries) => entries[0].isIntersecting && setLimit((n) => Math.min(n + PAGE, results.length)),
      { root, rootMargin: '600px 0px' },
    )
    io.observe(sentinel)
    return () => io.disconnect()
  }, [results.length, setLimit])

  const shown = results.slice(0, limit)
  const highlight = /^#\d+$/.test(deferredQuery.trim()) ? '' : deferredQuery.trim()

  return (
    <div className="absolute inset-0 flex flex-col lg:flex-row">
      {/* Decade navigator */}
      <aside className="shrink-0 border-b border-white/8 bg-ink-950/60 lg:w-44 lg:overflow-y-auto lg:border-r lg:border-b-0">
        <div className="flex gap-1 overflow-x-auto px-3 py-2 lg:flex-col lg:px-3 lg:py-4">
          <button
            type="button"
            className="btn-ghost shrink-0 text-left"
            aria-pressed={decade == null}
            onClick={() => setDecade(null)}
          >
            {t(lang, 'allDecades')}
          </button>
          {decades.map(([d, n]) => (
            <button
              key={d}
              type="button"
              aria-pressed={decade === d}
              onClick={() => setDecade(decade === d ? null : d)}
              className="btn-ghost relative shrink-0 overflow-hidden text-left font-mono"
              title={`${formatNumber(n, lang)} ${t(lang, 'events')}`}
            >
              <span
                className="absolute inset-y-0 left-0 bg-gold/15"
                style={{ width: `${Math.round((n / maxDecade) * 100)}%` }}
                aria-hidden="true"
              />
              <span className="relative">{d}s</span>
              <span className="relative float-right hidden text-[10px] text-slate-500 lg:inline">{n}</span>
            </button>
          ))}
        </div>
      </aside>

      {/* List */}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 pb-16 sm:px-6">
          <div className="sticky top-0 z-10 -mx-4 bg-ink-900/90 px-4 pt-4 pb-3 backdrop-blur sm:-mx-6 sm:px-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-display text-xl font-semibold text-white">{t(lang, 'timelineTitle')}</h2>
                <p className="text-xs text-slate-400">{t(lang, 'timelineSubtitle')}</p>
              </div>
              <span className="text-xs text-slate-400 tabular-nums">{t(lang, 'results', formatNumber(results.length, lang))}</span>
            </div>
            <div className="relative mt-3">
              <input
                type="search"
                className="field pr-16"
                placeholder={t(lang, 'searchPlaceholder')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label={t(lang, 'searchPlaceholder')}
              />
              {query && (
                <button
                  type="button"
                  className="absolute top-1/2 right-2 -translate-y-1/2 text-xs text-slate-400 hover:text-white"
                  onClick={() => setQuery('')}
                >
                  {t(lang, 'clear')}
                </button>
              )}
            </div>
          </div>

          <ol className="mt-4 space-y-3">
            {shown.map((ev) => (
              <li key={ev.id}>
                <EventDetail
                  ev={ev}
                  lang={lang}
                  query={highlight}
                  onPerson={(name) => actions.openProfile('person', personKey(name))}
                  onPlace={(name) => actions.openProfile('place', placeKey(name))}
                  actions={{ showOnMap: actions.showOnMap, contribute: actions.contribute }}
                  active={deferredQuery.trim() === `#${ev.id}`}
                />
              </li>
            ))}
          </ol>

          {results.length === 0 && <p className="py-20 text-center text-slate-500">{t(lang, 'noResults')}</p>}

          <div ref={sentinelRef} className="h-px" />
          {limit < results.length && (
            <div className="py-6 text-center">
              <button type="button" className="btn-ghost" onClick={() => setLimit((n) => n + PAGE)}>
                {t(lang, 'loadMore')} ({formatNumber(results.length - limit, lang)})
              </button>
            </div>
          )}
          <p className="mt-10 text-center text-[11px] text-slate-600">{t(lang, 'footer')}</p>
        </div>
      </div>
    </div>
  )
}
