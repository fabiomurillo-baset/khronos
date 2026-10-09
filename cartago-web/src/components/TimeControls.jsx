import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from '../lib/i18n.js'
import { formatNumber } from '../lib/text.js'

const WINDOWS = [0, 2, 5, 10, 25, 'all']
const HIST_HEIGHT = 36

export default function TimeControls({ dataset, lang, time, onChange, stats }) {
  const { minYear, maxYear, histogram } = dataset
  const [playing, setPlaying] = useState(false)
  const svgRef = useRef(null)

  useEffect(() => {
    if (!playing) return undefined
    const id = window.setInterval(() => {
      onChange((prev) => ({ ...prev, year: prev.year >= maxYear ? minYear : prev.year + 1 }))
    }, 350)
    return () => window.clearInterval(id)
  }, [playing, onChange, minYear, maxYear])

  const bars = useMemo(() => {
    const out = []
    let max = 1
    for (let y = minYear; y <= maxYear; y++) {
      const c = histogram.get(y) || 0
      if (c > max) max = c
      out.push([y, c])
    }
    return out.map(([y, c]) => [y, Math.sqrt(c / max) * HIST_HEIGHT])
  }, [histogram, minYear, maxYear])

  const inWindow = (y) => time.window === 'all' || Math.abs(y - time.year) <= time.window

  const pickYearFromPointer = (evt) => {
    const rect = svgRef.current.getBoundingClientRect()
    const ratio = Math.min(Math.max((evt.clientX - rect.left) / rect.width, 0), 0.9999)
    const year = minYear + Math.floor(ratio * bars.length)
    onChange((prev) => ({ ...prev, year }))
  }

  return (
    <div className="glass-panel flex flex-col gap-3 px-4 py-3 sm:px-6">
      <div className="flex items-end justify-between font-mono text-xs text-slate-400">
        <span>{minYear}</span>
        <span className="font-display text-3xl leading-none font-semibold text-gold tabular-nums" aria-live="polite">
          {time.year}
        </span>
        <span>{maxYear}</span>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${bars.length} ${HIST_HEIGHT}`}
        preserveAspectRatio="none"
        className="h-9 w-full cursor-pointer"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          pickYearFromPointer(e)
        }}
        onPointerMove={(e) => e.buttons === 1 && pickYearFromPointer(e)}
        aria-hidden="true"
      >
        {bars.map(([y, h], i) =>
          h > 0 ? (
            <rect
              key={y}
              x={i + 0.1}
              y={HIST_HEIGHT - h}
              width={0.8}
              height={h}
              fill={y === time.year ? '#fff3c4' : inWindow(y) ? '#d4af37' : '#475569'}
              opacity={inWindow(y) ? 1 : 0.7}
            />
          ) : null,
        )}
      </svg>

      <input
        type="range"
        min={minYear}
        max={maxYear}
        step={1}
        value={time.year}
        aria-label={t(lang, 'year')}
        onChange={(e) => onChange((prev) => ({ ...prev, year: Number(e.target.value) }))}
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-300">
        <button
          type="button"
          className="btn-ghost"
          aria-pressed={playing}
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? '❚❚ ' + t(lang, 'pause') : '▶ ' + t(lang, 'play')}
        </button>

        <label className="flex items-center gap-2">
          <span className="text-slate-400">{t(lang, 'windowLabel')}</span>
          <select
            className="field w-auto py-1"
            value={String(time.window)}
            onChange={(e) =>
              onChange((prev) => ({ ...prev, window: e.target.value === 'all' ? 'all' : Number(e.target.value) }))
            }
          >
            {WINDOWS.map((w) => (
              <option key={w} value={String(w)}>
                {w === 'all' ? t(lang, 'windowAll') : w === 0 ? t(lang, 'windowExact') : t(lang, 'windowYears', w)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="accent-gold"
            checked={time.includeInferred}
            onChange={(e) => onChange((prev) => ({ ...prev, includeInferred: e.target.checked }))}
          />
          <span className="text-slate-400">{t(lang, 'includeInferred')}</span>
        </label>

        {stats && (
          <span className="ml-auto text-slate-400">
            <span className="text-gold-soft">{formatNumber(stats.located, lang)}</span> {t(lang, 'located')}
            {stats.unlocated > 0 && (
              <>
                {' · '}
                {formatNumber(stats.unlocated, lang)} {t(lang, 'unlocated')}
              </>
            )}
          </span>
        )}
      </div>
      <p className="hidden text-[11px] text-slate-500 sm:block">{t(lang, 'sliderHelp')}</p>
    </div>
  )
}
