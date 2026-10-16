import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import ContributePanel from './components/ContributePanel.jsx'
import Header from './components/Header.jsx'
import StatusScreen from './components/StatusScreen.jsx'
import { api, consumeAuthFromUrl } from './lib/community.js'
import { setCuration, useDataset } from './lib/data.js'
import { loadReferences } from './lib/references.js'
import { useSession } from './lib/session.js'
import { detectLanguage, persistLanguage, t } from './lib/i18n.js'

// Each view is its own chunk: MapLibre (~1 MB) and the force-graph engine load only when needed.
const MapView = lazy(() => import('./components/MapView.jsx'))
const TimelineView = lazy(() => import('./components/TimelineView.jsx'))
const GraphView = lazy(() => import('./components/GraphView.jsx'))
const EntityIndex = lazy(() => import('./components/EntityIndex.jsx'))
const ProfileView = lazy(() => import('./components/ProfileView.jsx'))

const VIEWS = ['map', 'timeline', 'graph', 'people', 'places']

/**
 * Routes live in the hash: `#map` `#timeline` `#graph` `#people` `#places` select a view;
 * `#r/123` opens the timeline on a record; `#p/<name>` and `#l/<name>` open a person or
 * place profile (keys are folded names, URL-encoded).
 */
function readHash() {
  const hash = decodeURIComponent(window.location.hash.replace(/^#\/?/, ''))
  let m
  if ((m = /^r\/(\d+)$/.exec(hash))) return { view: 'timeline', eventId: Number(m[1]), entityKey: null }
  if ((m = /^p\/(.+)$/.exec(hash))) return { view: 'person', eventId: null, entityKey: m[1] }
  if ((m = /^l\/(.+)$/.exec(hash))) return { view: 'place', eventId: null, entityKey: m[1] }
  return { view: VIEWS.includes(hash) ? hash : 'map', eventId: null, entityKey: null }
}

function hashFor(view, entityKey) {
  if (view === 'person') return `#p/${encodeURIComponent(entityKey)}`
  if (view === 'place') return `#l/${encodeURIComponent(entityKey)}`
  return `#${view}`
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
  const [route, setRoute] = useState(() => {
    const { view, entityKey } = readHash()
    return { view, entityKey }
  })
  const view = route.view
  const { dataset, textReady, error, retry } = useDataset(lang)
  const session = useSession()

  // Shared curation (merges / renames). `cv` bumps whenever it changes so views rebuild their indexes.
  const [cv, setCv] = useState(0)
  const refreshCuration = useCallback(async () => {
    try {
      const r = await api.curation()
      setCuration(r.entries)
    } catch {
      setCuration([])
    }
    setCv((n) => n + 1)
  }, [])
  const [curationStarted, setCurationStarted] = useState(false)
  if (!curationStarted) {
    setCurationStarted(true)
    refreshCuration()
    loadReferences()
  }

  // Shared time window used by the map (and respected by cross-view jumps).
  const [time, setTime] = useState({ year: null, window: 5, includeInferred: true })
  // Cross-view navigation target: { eventId } for the map/timeline, { person } for the graph.
  const [focus, setFocus] = useState(() => {
    const { eventId } = readHash()
    return eventId ? { eventId, nonce: Date.now() } : null
  })
  // Record open in the contribution panel. Coming back from sign-in (?auth=…#r/N) reopens it.
  const [contributing, setContributing] = useState(() => {
    const auth = consumeAuthFromUrl()
    return auth?.ok ? readHash().eventId : null
  })

  useEffect(() => {
    document.documentElement.lang = lang
    document.title = `${t(lang, 'appTitle')} · ${t(lang, 'appSubtitle').split(' · ')[0]}`
    persistLanguage(lang)
  }, [lang])

  useEffect(() => {
    const onHash = () => {
      const { view: nextView, eventId, entityKey } = readHash()
      setRoute({ view: nextView, entityKey })
      if (eventId) setFocus({ eventId, nonce: Date.now() })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // First frame: pick the busiest year once the data is in (state adjusted during render).
  if (dataset && time.year == null) {
    setTime((prev) => (prev.year == null ? { ...prev, year: busiestYear(dataset) } : prev))
  }

  const goTo = useCallback((nextView, entityKey = null) => {
    setRoute({ view: nextView, entityKey })
    const hash = hashFor(nextView, entityKey)
    if (window.location.hash !== hash) {
      // Profiles get a history entry (back button returns to the previous one); view switches do not.
      if (entityKey) window.history.pushState(null, '', hash)
      else window.history.replaceState(null, '', hash)
    }
  }, [])

  /** Open a person or place profile, or a list ('people' / 'places'). */
  const openProfile = useCallback((kind, key) => goTo(kind, key ?? null), [goTo])

  const searchTimeline = useCallback(
    (query) => {
      setFocus({ query, nonce: Date.now() })
      goTo('timeline')
    },
    [goTo],
  )

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

  const contribute = useCallback((ev) => setContributing(ev.id), [])
  const closeContribute = useCallback(() => setContributing(null), [])

  const actions = useMemo(
    () => ({ showOnMap, showInGraph, showInTimeline, contribute, openProfile, searchTimeline }),
    [showOnMap, showInGraph, showInTimeline, contribute, openProfile, searchTimeline],
  )

  const ready = dataset && textReady && time.year != null

  return (
    <div className="flex h-dvh w-full flex-col bg-paper text-ink">
      <Header lang={lang} onLangChange={setLang} view={view} onViewChange={goTo} dataset={dataset} />

      <main className="relative min-h-0 flex-1">
        {error ? (
          <StatusScreen lang={lang} error={error} onRetry={retry} />
        ) : !ready ? (
          <StatusScreen lang={lang} message={t(lang, dataset ? 'loadingText' : 'loading')} />
        ) : (
          <Suspense fallback={<StatusScreen lang={lang} message={t(lang, 'loading')} />}>
            {view === 'map' && (
              <MapView key={cv} lang={lang} dataset={dataset} time={time} onTimeChange={setTime} focus={focus} actions={actions} />
            )}
            {view === 'timeline' && <TimelineView key={cv} lang={lang} dataset={dataset} focus={focus} actions={actions} />}
            {view === 'graph' && <GraphView key={cv} lang={lang} dataset={dataset} focus={focus} actions={actions} />}
            {(view === 'people' || view === 'places') && (
              <EntityIndex key={`${view}-${cv}`} kind={view === 'people' ? 'person' : 'place'} lang={lang} dataset={dataset} onOpen={openProfile} session={session} onCurationChanged={refreshCuration} />
            )}
            {(view === 'person' || view === 'place') && (
              <ProfileView
                key={`${view}-${route.entityKey}-${cv}`}
                kind={view}
                entityKey={route.entityKey}
                lang={lang}
                dataset={dataset}
                session={session}
                actions={actions}
                onOpen={openProfile}
                onCurationChanged={refreshCuration}
              />
            )}
          </Suspense>
        )}
      </main>

      {ready && contributing != null && dataset.byId.get(contributing) && (
        <ContributePanel ev={dataset.byId.get(contributing)} lang={lang} onClose={closeContribute} />
      )}
    </div>
  )
}
