import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Map, Source, Layer, Popup, NavigationControl, ScaleControl } from '@vis.gl/react-maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import TimeControls from './TimeControls.jsx'
import EventDetail from './EventDetail.jsx'
import { personKey, placeKey } from '../lib/data.js'
import { t } from '../lib/i18n.js'
import { formatNumber } from '../lib/text.js'

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
const DEFAULT_VIEW = { longitude: -84.6, latitude: 10.4, zoom: 6.2 }
const SOURCE_ID = 'places'
const CONTROLS_HEIGHT = 240 // space reserved at the bottom for the time controls

/** Ease the camera so `lngLat` sits just above the time controls, leaving room for the popup above it. */
function panToPlace(map, lngLat, zoom) {
  const h = map.getContainer().clientHeight
  map.easeTo({ center: lngLat, zoom, offset: [0, Math.max(0, h / 2 - CONTROLS_HEIGHT)], duration: 600 })
}

// Circle radius grows with the square root of the record count, so area ~ count.
const radiusExpr = (prop) => ['interpolate', ['linear'], ['sqrt', ['get', prop]], 1, 5, 5, 10, 15, 20, 45, 38]

const clusterLayer = {
  id: 'clusters',
  type: 'circle',
  filter: ['has', 'point_count'],
  paint: {
    'circle-color': '#d4574f',
    'circle-opacity': 0.55,
    'circle-radius': radiusExpr('sum'),
    'circle-stroke-width': 1.5,
    'circle-stroke-color': '#ffd9d6',
  },
}

const placeLayer = {
  id: 'place-points',
  type: 'circle',
  filter: ['!', ['has', 'point_count']],
  paint: {
    'circle-color': ['case', ['boolean', ['get', 'selected'], false], '#ffd9d6', '#d4574f'],
    'circle-opacity': 0.8,
    'circle-radius': radiusExpr('count'),
    'circle-stroke-width': ['case', ['boolean', ['get', 'selected'], false], 3, 1.5],
    'circle-stroke-color': ['case', ['boolean', ['get', 'selected'], false], '#ffffff', 'rgba(255,255,255,0.7)'],
  },
}

export default function MapView({ lang, dataset, time, onTimeChange, focus, actions }) {
  const mapRef = useRef(null)
  const [fontStack, setFontStack] = useState(null)
  const [cursor, setCursor] = useState('grab')
  const [selectedPlace, setSelectedPlace] = useState(null)
  const [highlightId, setHighlightId] = useState(null)
  const [appliedFocus, setAppliedFocus] = useState(null)

  // ---- filtering -------------------------------------------------------------------
  const visible = useMemo(() => {
    const { year, window: win, includeInferred } = time
    return dataset.events.filter((ev) => {
      if (ev.year == null) return false
      if (!includeInferred && ev.inferred) return false
      return win === 'all' || Math.abs(ev.year - year) <= win
    })
  }, [dataset, time])

  // One feature per place, with its records attached for the popup.
  const places = useMemo(() => {
    const byPlace = new window.Map()
    for (const ev of visible) {
      if (ev.lat == null) continue
      let entry = byPlace.get(ev.place)
      if (!entry) {
        entry = { name: ev.place, lat: ev.lat, lng: ev.lng, events: [] }
        byPlace.set(ev.place, entry)
      }
      entry.events.push(ev)
    }
    return byPlace
  }, [visible])

  const geojson = useMemo(
    () => ({
      type: 'FeatureCollection',
      features: [...places.values()].map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: { name: p.name, count: p.events.length, selected: p.name === selectedPlace },
      })),
    }),
    [places, selectedPlace],
  )

  const locatedCount = useMemo(() => [...places.values()].reduce((n, p) => n + p.events.length, 0), [places])
  const stats = { located: locatedCount, unlocated: visible.length - locatedCount }
  const selected = selectedPlace ? places.get(selectedPlace) : null

  // ---- cross-view focus ("show on map") -------------------------------------------
  const focusEvent = focus?.eventId ? dataset.byId.get(focus.eventId) : null
  const initialView = useMemo(() => {
    if (focusEvent?.lat != null) return { longitude: focusEvent.lng, latitude: focusEvent.lat, zoom: 9 }
    return DEFAULT_VIEW
    // Only the first render matters for initialViewState.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Select the focused event's place (state adjusted during render, once per focus request).
  if (focus && focus.nonce !== appliedFocus) {
    setAppliedFocus(focus.nonce)
    if (focusEvent?.lat != null) {
      setSelectedPlace(focusEvent.place)
      setHighlightId(focusEvent.id)
    }
  }

  // ...and move the camera there if the map is already up (on first mount initialView handles it).
  useEffect(() => {
    if (!focusEvent || focusEvent.lat == null) return
    const map = mapRef.current?.getMap?.()
    if (map && map.loaded()) {
      panToPlace(map, [focusEvent.lng, focusEvent.lat], Math.max(map.getZoom(), 9))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce])

  useEffect(() => {
    if (!highlightId || !selected) return
    const el = document.getElementById(`event-${highlightId}`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [highlightId, selected])

  // ---- keyboard: ← → step through years -------------------------------------------
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        const step = e.key === 'ArrowLeft' ? -1 : 1
        onTimeChange((prev) => ({
          ...prev,
          year: Math.min(dataset.maxYear, Math.max(dataset.minYear, prev.year + step)),
        }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onTimeChange, dataset.minYear, dataset.maxYear])

  // ---- map events ------------------------------------------------------------------
  const onLoad = useCallback(
    (evt) => {
      const map = evt.target
      const styled = map.getStyle()?.layers?.find((l) => l.layout && l.layout['text-font'])
      const font = styled?.layout['text-font']
      setFontStack(Array.isArray(font) ? font : null)
      // Mounted because of a "show on map" request: make room for the popup above the controls.
      if (focusEvent?.lat != null) panToPlace(map, [focusEvent.lng, focusEvent.lat], 9)
    },
    [focusEvent],
  )

  const onClick = useCallback((evt) => {
    const feature = evt.features?.[0]
    if (!feature) {
      setSelectedPlace(null)
      setHighlightId(null)
      return
    }
    const map = evt.target
    if (feature.properties.cluster) {
      const source = map.getSource(SOURCE_ID)
      Promise.resolve(source.getClusterExpansionZoom(feature.properties.cluster_id)).then((zoom) => {
        // Always move at least 1.5 levels so nearby places (Cartago, Taras, Cot…) split in one or two clicks.
        const target = Math.min(Math.max(zoom + 0.3, map.getZoom() + 1.5), 12)
        map.easeTo({ center: feature.geometry.coordinates, zoom: target, duration: 500 })
      })
      return
    }
    setHighlightId(null)
    setSelectedPlace(feature.properties.name)
    panToPlace(map, feature.geometry.coordinates, map.getZoom())
  }, [])

  const labelLayers = fontStack
    ? [
        {
          id: 'cluster-count',
          type: 'symbol',
          filter: ['has', 'point_count'],
          layout: {
            'text-field': ['to-string', ['get', 'sum']],
            'text-font': fontStack,
            'text-size': 12,
            'text-allow-overlap': true,
          },
          paint: { 'text-color': '#0f172a' },
        },
        {
          id: 'place-labels',
          type: 'symbol',
          filter: ['!', ['has', 'point_count']],
          minzoom: 5.5,
          layout: {
            'text-field': ['concat', ['get', 'name'], '  ', ['to-string', ['get', 'count']]],
            'text-font': fontStack,
            'text-size': 11,
            'text-anchor': 'top',
            'text-offset': [0, 0.9],
            'text-optional': true,
          },
          paint: {
            'text-color': '#f8fafc',
            'text-halo-color': '#0f172a',
            'text-halo-width': 1.4,
          },
        },
      ]
    : []

  return (
    <div className="absolute inset-0 overflow-hidden bg-paper">
      <Map
        ref={mapRef}
        initialViewState={initialView}
        mapStyle={MAP_STYLE}
        style={{ width: '100%', height: '100%' }}
        maxZoom={14}
        minZoom={2}
        cursor={cursor}
        interactiveLayerIds={['clusters', 'place-points']}
        onLoad={onLoad}
        onClick={onClick}
        onMouseEnter={() => setCursor('pointer')}
        onMouseLeave={() => setCursor('grab')}
        attributionControl={{ compact: true }}
      >
        <NavigationControl position="top-right" showCompass={false} />
        <ScaleControl position="bottom-right" />

        <Source
          id={SOURCE_ID}
          type="geojson"
          data={geojson}
          cluster
          clusterRadius={34}
          clusterMaxZoom={8}
          clusterProperties={{ sum: ['+', ['get', 'count']] }}
        >
          <Layer {...clusterLayer} />
          <Layer {...placeLayer} />
          {labelLayers.map((layer) => (
            <Layer key={layer.id} {...layer} />
          ))}
        </Source>

        {selected && (
          <Popup
            longitude={selected.lng}
            latitude={selected.lat}
            anchor="bottom"
            offset={14}
            maxWidth="min(420px, calc(100vw - 2rem))"
            closeOnClick={false}
            onClose={() => {
              setSelectedPlace(null)
              setHighlightId(null)
            }}
          >
            <div className="w-[min(400px,calc(100vw-3rem))]">
              <header className="border-b border-rule px-4 py-3 pr-10">
                <h3 className="font-display text-lg leading-tight font-semibold text-ink">{selected.name}</h3>
                <p className="mt-0.5 text-xs text-label">
                  {t(lang, 'eventsHere', formatNumber(selected.events.length, lang))} ·{' '}
                  {time.window === 'all' ? t(lang, 'windowAll') : `${time.year} ${time.window ? `± ${time.window}` : ''}`}
                </p>
              </header>
              <div className="max-h-[38vh] divide-y divide-rule overflow-y-auto px-4">
                {selected.events.map((ev) => (
                  <EventDetail
                    key={ev.id}
                    ev={ev}
                    lang={lang}
                    compact
                    active={ev.id === highlightId}
                    onPerson={(name) => actions.openProfile('person', personKey(name))}
                    onPlace={(name) => actions.openProfile('place', placeKey(name))}
                    actions={{ showInTimeline: actions.showInTimeline, contribute: actions.contribute }}
                  />
                ))}
              </div>
              <footer className="px-4 py-2 text-[10px] text-label">{t(lang, 'approxLocation')}</footer>
            </div>
          </Popup>
        )}
      </Map>

      {/* HUD */}
      <div className="pointer-events-none absolute top-3 left-3 z-10 max-w-[260px]">
        <div className="glass-panel px-4 py-3">
          <h2 className="font-display text-base font-semibold text-ink">{t(lang, 'mapTitle')}</h2>
          <p className="mt-1 text-xs text-label">
            {formatNumber(visible.length, lang)} {t(lang, 'events')} ·{' '}
            {time.window === 'all' ? t(lang, 'windowAll') : time.window === 0 ? time.year : `${time.year - time.window}–${time.year + time.window}`}
          </p>
          <div className="mt-2 flex items-center gap-2 text-[11px] text-label">
            <span className="inline-block h-2 w-2 rounded-full bg-gold" />
            <span className="inline-block h-3.5 w-3.5 rounded-full bg-rubric/70" />
            <span className="inline-block h-5 w-5 rounded-full bg-rubric/50" />
            <span>= {t(lang, 'events')}</span>
          </div>
        </div>
      </div>

      {/* Time controls */}
      <div className="absolute bottom-6 left-1/2 z-10 w-[min(920px,calc(100%-1.5rem))] -translate-x-1/2">
        <TimeControls dataset={dataset} lang={lang} time={time} onChange={onTimeChange} stats={stats} />
      </div>
    </div>
  )
}
