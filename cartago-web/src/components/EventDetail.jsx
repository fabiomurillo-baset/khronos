import { getSummary } from '../lib/data.js'
import { t } from '../lib/i18n.js'
import { highlightSegments } from '../lib/text.js'

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

        {(actions.showOnMap || actions.showInGraph || actions.showInTimeline) && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
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
          </div>
        )}
      </div>
    </article>
  )
}
