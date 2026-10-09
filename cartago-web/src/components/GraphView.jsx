import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import EventDetail from './EventDetail.jsx'
import { getGraph, getPeopleIndex } from '../lib/data.js'
import { t } from '../lib/i18n.js'
import { fold, formatNumber } from '../lib/text.js'

const TOP_N = 120
const EGO_CAP = 150

export default function GraphView({ lang, dataset, focus, actions }) {
  const graph = useMemo(() => getGraph(dataset), [dataset])
  const people = useMemo(() => getPeopleIndex(dataset), [dataset])

  const [center, setCenter] = useState(() => (focus?.person ? fold(focus.person) : null))
  const [selectedKey, setSelectedKey] = useState(() => (focus?.person ? fold(focus.person) : null))
  const [hoverKey, setHoverKey] = useState(null)
  const [query, setQuery] = useState('')
  const [size, setSize] = useState({ width: 800, height: 600 })
  const wrapRef = useRef(null)
  const fgRef = useRef(null)
  const [appliedFocus, setAppliedFocus] = useState(focus?.nonce ?? null)

  // A new "show in network" request arrived while mounted (state adjusted during render).
  if (focus?.person && focus.nonce !== appliedFocus) {
    setAppliedFocus(focus.nonce)
    const key = fold(focus.person)
    setCenter(key)
    setSelectedKey(key)
  }

  // Canvas follows its container.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return undefined
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width && height) setSize({ width, height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Sub-graph to render: the most connected people, or the ego network of `center`.
  const data = useMemo(() => {
    let keys
    if (center && graph.nodes.has(center)) {
      const c = graph.nodes.get(center)
      const neighbors = [...c.neighbors]
        .map((k) => graph.nodes.get(k))
        .sort((a, b) => b.degree - a.degree)
        .slice(0, EGO_CAP)
      keys = new Set([center, ...neighbors.map((n) => n.id)])
    } else {
      keys = new Set(graph.nodeList.slice(0, TOP_N).map((n) => n.id))
    }
    const links = []
    const linked = new Set()
    for (const l of graph.links.values()) {
      if (keys.has(l.source) && keys.has(l.target)) {
        links.push({ source: l.source, target: l.target, weight: l.weight })
        linked.add(l.source)
        linked.add(l.target)
      }
    }
    // In the top-N view drop people whose connections all fall outside the subset (they would float away).
    const nodes = [...keys]
      .filter((k) => center || linked.has(k))
      .map((k) => {
        const n = graph.nodes.get(k)
        return { id: n.id, name: n.name, degree: n.degree, records: n.records }
      })
    return { nodes, links }
  }, [graph, center])

  // Fit the viewport once the simulation settles after each data change.
  const needsFit = useRef(true)
  useEffect(() => {
    needsFit.current = true
    const timer = window.setTimeout(() => fgRef.current?.zoomToFit(500, 60), 1500)
    return () => window.clearTimeout(timer)
  }, [data])
  const onEngineStop = useCallback(() => {
    if (needsFit.current) {
      needsFit.current = false
      fgRef.current?.zoomToFit(500, 60)
    }
  }, [])

  const suggestions = useMemo(() => {
    const q = fold(query.trim())
    if (q.length < 2) return []
    const out = []
    for (const n of graph.nodeList) {
      if (n.id.includes(q)) {
        out.push(n)
        if (out.length >= 8) break
      }
    }
    return out
  }, [graph, query])

  const selected = selectedKey ? graph.nodes.get(selectedKey) : null
  const selectedEvents = useMemo(() => {
    if (!selectedKey) return []
    const entry = people.get(selectedKey)
    return entry ? [...entry.events].sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || a.id - b.id) : []
  }, [people, selectedKey])

  const maxDegree = data.nodes.reduce((m, n) => Math.max(m, n.degree), 1)

  // Radius in graph units that renders as a constant number of screen pixels at any zoom.
  const nodeRadius = useCallback(
    (node, scale) => (3 + Math.sqrt(node.degree / maxDegree) * 11) / Math.max(scale, 0.4),
    [maxDegree],
  )

  const paintPointerArea = useCallback(
    (node, color, ctx, scale) => {
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(node.x, node.y, nodeRadius(node, scale) + 2 / scale, 0, 2 * Math.PI)
      ctx.fill()
    },
    [nodeRadius],
  )

  const paintNode = useCallback(
    (node, ctx, scale) => {
      const r = nodeRadius(node, scale)
      const isCenter = node.id === center
      const isSelected = node.id === selectedKey
      const isHover = node.id === hoverKey
      ctx.beginPath()
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI)
      ctx.fillStyle = isSelected || isCenter ? '#fff3c4' : '#d4af37'
      ctx.globalAlpha = isHover || isSelected || isCenter ? 1 : 0.85
      ctx.fill()
      ctx.globalAlpha = 1
      if (isSelected || isCenter) {
        ctx.lineWidth = 1.5 / scale
        ctx.strokeStyle = '#ffffff'
        ctx.stroke()
      }
      const showLabel = isCenter || isSelected || isHover || scale > 1.6 || node.degree > maxDegree * 0.5
      if (showLabel) {
        const fontSize = Math.max(10 / scale, 2.5)
        ctx.font = `${isCenter || isSelected ? '600 ' : ''}${fontSize}px Inter, system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillStyle = 'rgba(15,23,42,0.85)'
        const w = ctx.measureText(node.name).width
        ctx.fillRect(node.x - w / 2 - 2 / scale, node.y + r + 1 / scale, w + 4 / scale, fontSize + 2 / scale)
        ctx.fillStyle = isCenter || isSelected ? '#fff3c4' : '#e2e8f0'
        ctx.fillText(node.name, node.x, node.y + r + 2 / scale)
      }
    },
    [center, selectedKey, hoverKey, nodeRadius, maxDegree],
  )

  const onNodeClick = useCallback((node) => {
    setSelectedKey(node.id)
    fgRef.current?.centerAt(node.x, node.y, 600)
  }, [])

  const title = center && graph.nodes.has(center)
    ? t(lang, 'graphEgo', graph.nodes.get(center).name, formatNumber(data.nodes.length, lang))
    : t(lang, 'graphTop', TOP_N)

  return (
    <div className="absolute inset-0 flex flex-col lg:flex-row">
      <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-hidden">
        <ForceGraph2D
          ref={fgRef}
          width={size.width}
          height={size.height}
          graphData={data}
          backgroundColor="rgba(0,0,0,0)"
          nodeId="id"
          nodeLabel={() => ''}
          nodeCanvasObject={paintNode}
          nodeCanvasObjectMode={() => 'replace'}
          nodePointerAreaPaint={paintPointerArea}
          nodeRelSize={6}
          linkColor={(l) => (hoverKey && (l.source.id === hoverKey || l.target.id === hoverKey) ? 'rgba(212,175,55,0.8)' : 'rgba(255,255,255,0.14)')}
          linkWidth={(l) => Math.min(0.6 + l.weight * 0.6, 4)}
          onNodeClick={onNodeClick}
          onNodeHover={(n) => setHoverKey(n ? n.id : null)}
          onBackgroundClick={() => setSelectedKey(null)}
          onEngineStop={onEngineStop}
          d3VelocityDecay={0.35}
          cooldownTicks={150}
          warmupTicks={40}
        />

        <div className="pointer-events-none absolute top-3 left-3 z-10 max-w-[320px] space-y-2">
          <div className="glass-panel pointer-events-auto px-4 py-3">
            <h2 className="font-display text-base font-semibold text-white">{t(lang, 'graphTitle')}</h2>
            <p className="text-xs text-slate-400">{t(lang, 'graphSubtitle')}</p>
            <div className="relative mt-3">
              <input
                type="search"
                className="field"
                placeholder={t(lang, 'graphSearch')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label={t(lang, 'graphSearch')}
              />
              {suggestions.length > 0 && (
                <ul className="glass-panel absolute right-0 left-0 z-20 mt-1 max-h-64 overflow-y-auto py-1 text-sm">
                  {suggestions.map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-white/5"
                        onClick={() => {
                          setCenter(n.id)
                          setSelectedKey(n.id)
                          setQuery('')
                        }}
                      >
                        <span className="truncate">{n.name}</span>
                        <span className="shrink-0 font-mono text-[10px] text-slate-500">{n.degree}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="mt-2 text-xs text-gold-soft">{title}</p>
            {center && (
              <button type="button" className="btn-ghost mt-2" onClick={() => setCenter(null)}>
                {t(lang, 'reset')}
              </button>
            )}
            <p className="mt-2 text-[11px] text-slate-500">{t(lang, 'graphHint')}</p>
          </div>
        </div>
      </div>

      {selected && (
        <aside className="max-h-[45%] shrink-0 overflow-y-auto border-t border-white/8 bg-ink-950/70 lg:max-h-none lg:w-[400px] lg:border-t-0 lg:border-l">
          <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-white/8 bg-ink-950/90 px-5 py-4 backdrop-blur">
            <div className="min-w-0">
              <h3 className="font-display text-lg leading-tight font-semibold text-white">{selected.name}</h3>
              <p className="mt-1 text-xs text-slate-400">
                {selected.degree} {t(lang, 'connections').toLowerCase()} · {t(lang, 'appearsIn', formatNumber(selected.records, lang))}
              </p>
              {center !== selected.id && (
                <button type="button" className="btn-ghost mt-2" onClick={() => setCenter(selected.id)}>
                  {t(lang, 'showInGraph')}
                </button>
              )}
            </div>
            <button
              type="button"
              className="text-slate-400 hover:text-white"
              onClick={() => setSelectedKey(null)}
              aria-label={t(lang, 'close')}
            >
              ✕
            </button>
          </div>
          <div className="divide-y divide-white/6 px-5">
            {selectedEvents.map((ev) => (
              <EventDetail
                key={ev.id}
                ev={ev}
                lang={lang}
                compact
                onPerson={(name) => {
                  const key = fold(name)
                  setSelectedKey(key)
                  if (!graph.nodes.get(center)?.neighbors.has(key) && key !== center) setCenter(key)
                }}
                actions={{ showOnMap: actions.showOnMap, showInTimeline: actions.showInTimeline, contribute: actions.contribute }}
              />
            ))}
          </div>
        </aside>
      )}
    </div>
  )
}
