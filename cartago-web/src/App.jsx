import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Header from './components/Header.jsx'
import StatusScreen from './components/StatusScreen.jsx'
import { useDataset } from './lib/data.js'
import { detectLanguage, persistLanguage, t } from './lib/i18n.js'

// Each view is its own chunk: MapLibre (~1 MB) and the force-graph engine load only when needed.
const MapView = lazy(() => import('./components/MapView.jsx'))
const TimelineView = lazy(() => import('./components/TimelineView.jsx'))
const GraphView = lazy(() => import('./components/GraphView.jsx'))

const VIEWS = ['map', 'timeline', 'graph']

/**
 * `#map`, `#timeline`, `#graph` select a view; `#r/123` is a permalink to one
 * record (shared from the community) and opens the timeline focused on it.
 */
function readHash() {
  const hash = window.location.hash.replace(/^#\/?/, '')
  const record = /^r\/(\d+)$/.exec(hash)
  if (record) return { view: 'timeline', eventId: Number(record[1]) }
  return { view: VIEWS.includes(hash) ? hash : 'map', eventId: null }
}

/** Year with the most records: a data-rich first frame for the map. */
function busiestYear(dataset) {
  let best = null
  let bestCount = -1
  for (const [year, count] of dataset.histogram) {
    if (count > bestCount) {
      best = year
      bestCount = count
    }
  }
  return best ?? dataset.minYear
}

export default function App() {
  const [lang, setLang] = useState(detectLanguage)
  const [view, setView] = useState(() => readHash().view)
  const { dataset, textReady, error, retry } = useDataset(lang)

  // Shared time window used by the map (and respected by cross-view jumps).
  const [time, setTime] = useState({ year: null, window: 5, includeInferred: true })
  // Cross-view navigation target: { eventId } for the map/timeline, { person } for the graph.
  const [focus, setFocus] = useState(() => {
    const { eventId } = readHash()
    return eventId ? { eventId, nonce: Date.now() } : null
  })

  useEffect(() => {
    document.documentElement.lang = lang
    document.title = `${t(lang, 'appTitle')} · ${t(lang, 'appSubtitle').split(' · ')[0]}`
    persistLanguage(lang)
  }, [lang])

  useEffect(() => {
    const onHash = () => {
      const { view: nextView, eventId } = readHash()
      setView(nextView)
      if (eventId) setFocus({ eventId, nonce: Date.now() })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // First frame: pick the busiest year once the data is in (state adjusted during render).
  if (dataset && time.year == null) {
    setTime((prev) => (prev.year == null ? { ...prev, year: busiestYear(dataset) } : prev))
  }

  const goTo = useCallback((nextView) => {
    setView(nextView)
    if (window.location.hash !== `#${nextView}`) {
      window.history.replaceState(null, '', `#${nextView}`)
    }
  }, [])

  const showOnMap = useCallback(
    (ev) => {
      if (ev.year != null) setTime((prev) => ({ ...prev, year: ev.year }))
      setFocus({ eventId: ev.id, nonce: Date.now() })
      goTo('map')
    },
    [goTo],
  )

  const showInGraph = useCallback(
    (person) => {
      setFocus({ person, nonce: Date.now() })
      goTo('graph')
    },
    [goTo],
  )

  const showInTimeline = useCallback(
    (ev) => {
      setFocus({ eventId: ev.id, nonce: Date.now() })
      goTo('timeline')
    },
    [goTo],
  )

  const actions = useMemo(
    () => ({ showOnMap, showInGraph, showInTimeline }),
    [showOnMap, showInGraph, showInTimeline],
  )

  const ready = dataset && textReady && time.year != null

  return (
    <div className="flex h-dvh w-full flex-col bg-ink-900 text-slate-100">
      <Header lang={lang} onLangChange={setLang} view={view} onViewChange={goTo} dataset={dataset} />

      <main className="relative min-h-0 flex-1">
        {error ? (
          <StatusScreen lang={lang} error={error} onRetry={retry} />
        ) : !ready ? (
          <StatusScreen lang={lang} message={t(lang, dataset ? 'loadingText' : 'loading')} />
        ) : (
          <Suspense fallback={<StatusScreen lang={lang} message={t(lang, 'loading')} />}>
            {view === 'map' && (
              <MapView lang={lang} dataset={dataset} time={time} onTimeChange={setTime} focus={focus} actions={actions} />
            )}
            {view === 'timeline' && <TimelineView lang={lang} dataset={dataset} focus={focus} actions={actions} />}
            {view === 'graph' && <GraphView lang={lang} dataset={dataset} focus={focus} actions={actions} />}
          </Suspense>
        )}
      </main>
    </div>
  )
}
