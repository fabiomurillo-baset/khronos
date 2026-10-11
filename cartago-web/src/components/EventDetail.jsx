import { useState } from 'react'
import { getDataset, getSummary, sourceLinks } from '../lib/data.js'
import { t } from '../lib/i18n.js'
import { highlightSegments } from '../lib/text.js'
import References from './References.jsx'

function Highlight({ text, query }) {
  if (!query) return text
  const segments = highlightSegments(text, query)
  return segments.map((seg, i) => (i % 2 === 1 ? <mark key={i}>{seg}</mark> : seg))
}

/**
 * One notarial record. Used by the map popup, the timeline list and the graph side panel.
 * `actions` carries the cross-view callbacks from App; any of them may be omitted.
 */
export default function EventDetail({ ev, lang, query, onPerson, onPlace, actions = {}, compact = false, active = false }) {
  const { text, fallback } = getSummary(ev, lang)
  const src = sourceLinks(getDataset(), ev)
  const [showSource, setShowSource] = useState(false)
  const yearLabel = ev.year == null ? t(lang, 'undated') : `${ev.inferred ? '≈ ' : ''}${ev.year}`

  return (
    <article
      id={`event-${ev.id}`}
      className={`flex gap-4 ${compact ? 'py-3' : 'glass-panel p-5'} ${active ? 'ring-1 ring-gold/70' : ''}`}
    >
      <div className={`shrink-0 ${compact ? 'w-14' : 'w-20'}`}>
        <div
          className={`font-display leading-none font-semibold text-gold ${compact ? 'text-lg' : 'text-2xl'}`}
          title={ev.inferred ? t(lang, 'inferredYear') : undefined}
        >
          {yearLabel}
        </div>
        {ev.date && <div className="mt-1 text-xs text-slate-400">{ev.date}</div>}
        <div className="mt-1 font-mono text-[10px] text-slate-600">#{ev.id}</div>
        {ev.collection > 0 && getDataset()?.collections?.[ev.collection] && (
          <div className="mt-1 text-[10px] leading-tight text-sky-300/90" title={t(lang, 'collection')}>
            {getDataset().collections[ev.collection].label}
          </div>
        )}
        {ev.corrected && (
          <div className="mt-1 text-[10px] leading-tight text-emerald-300" title={t(lang, 'correctedBadge')}>
            ✓ {t(lang, 'correctedBadge')}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className={`leading-relaxed text-slate-200 ${compact ? 'text-sm' : 'text-[15px]'}`}>
          <Highlight text={text} query={query} />
        </p>
        {fallback && <p className="mt-1 text-xs text-slate-500 italic">{t(lang, 'noTranslation')}</p>}

        {ev.people.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {ev.people.map((person) => (
              <button
                key={person}
                type="button"
                className="chip text-gold-soft"
                onClick={() => onPerson?.(person)}
                title={t(lang, 'showInGraph')}
              >
                <span aria-hidden="true" className="text-[10px] opacity-70">
                  ●
                </span>
                <Highlight text={person} query={query} />
              </button>
            ))}
          </div>
        )}

        {ev.locations.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ev.locations.map((loc) => (
              <button
                key={loc}
                type="button"
                className="chip text-sky-300"
                onClick={() => onPlace?.(loc)}
              >
                <span aria-hidden="true" className="text-[10px] opacity-70">
                  ▲
                </span>
                <Highlight text={loc} query={query} />
              </button>
            ))}
          </div>
        )}

        {src && (
          <div className="mt-2 text-[11px] text-slate-500">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5" title={t(lang, 'sourceTitle')}>
              <span>
                {t(lang, 'source')}: {src.kind === 'index' ? t(lang, 'sourceRef', src.tomo, src.printed, src.page) : t(lang, 'sourceLeaf', src.label, src.page, src.printed, src.side)}
                {src.kind === 'index' && src.conf < 0.3 && (
                  <span className="text-amber-300/80" title={t(lang, 'sourceApprox')}>
                    {' '}
                    ≈
                  </span>
                )}
                {src.kind !== 'index' && (
                  <span className="text-amber-300/80" title={`${t(lang, 'transcriptionCaveat')} ${Math.round(src.conf * 100)}%`}>
                    {' '}
                    ✎ {Math.round(src.conf * 100)}%
                  </span>
                )}
              </span>
              <button type="button" className="text-sky-300 hover:text-gold" aria-expanded={showSource} onClick={() => setShowSource((v) => !v)}>
                {t(lang, showSource ? 'sourceHide' : 'sourceViewer')} {showSource ? '▴' : '▾'}
              </button>
            </div>
            {showSource && (
              <div className="mt-2 overflow-hidden rounded-lg border border-white/10 bg-ink-950">
                <div className="flex items-center justify-between gap-2 border-b border-white/8 px-2.5 py-1.5">
                  <span className="text-slate-400">{src.kind === 'index' ? `Índice de los Protocolos de Cartago · ${t(lang, 'sourceRef', src.tomo, src.printed, src.page)}` : t(lang, 'sourceLeaf', src.label, src.page, src.printed, src.side)}</span>
                  <a href={src.viewer} target="_blank" rel="noopener" className="text-sky-300 hover:text-gold">
                    {t(lang, 'sourceOpen')} ↗
                  </a>
                </div>
                <iframe
                  src={src.embed}
                  title={`${t(lang, 'source')} · #${ev.id}`}
                  className="block h-[440px] w-full bg-ink-950"
                  loading="lazy"
                  allowFullScreen
                  referrerPolicy="no-referrer-when-downgrade"
                />
              </div>
            )}
          </div>
        )}

        <References target={`r:${ev.id}`} lang={lang} compact onSignInNeeded={() => actions.contribute?.(ev)} />

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          {actions.showOnMap && ev.lat != null && (
            <button className="text-slate-400 hover:text-gold" onClick={() => actions.showOnMap(ev)}>
              {t(lang, 'showOnMap')} →
            </button>
          )}
          {actions.showInTimeline && (
            <button className="text-slate-400 hover:text-gold" onClick={() => actions.showInTimeline(ev)}>
              {t(lang, 'viewTimeline')} →
            </button>
          )}
          {actions.contribute && (
            <button
              type="button"
              className="chip ml-auto border-gold/40 text-gold-soft hover:bg-gold/10"
              onClick={() => actions.contribute(ev)}
              title={t(lang, 'contributeTitle')}
            >
              {t(lang, 'contribute')}
            </button>
          )}
        </div>
      </div>
    </article>
  )
}
