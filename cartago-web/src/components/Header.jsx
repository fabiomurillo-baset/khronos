import { t } from '../lib/i18n.js'
import { formatNumber } from '../lib/text.js'

const ICONS = {
  map: (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M3 5.5 7.5 3.5l5 2 4.5-2v11l-4.5 2-5-2-4.5 2z" strokeLinejoin="round" />
      <path d="M7.5 3.5v11M12.5 5.5v11" />
    </svg>
  ),
  timeline: (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M4 4v12M4 6h7M4 10h10M4 14h6" strokeLinecap="round" />
    </svg>
  ),
  graph: (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="5" cy="15" r="2" />
      <circle cx="15" cy="15" r="2" />
      <circle cx="10" cy="5" r="2" />
      <path d="M8.8 6.8 6.2 13.2M11.2 6.8l2.6 6.4M7 15h6" />
    </svg>
  ),
}

export default function Header({ lang, onLangChange, view, onViewChange, dataset }) {
  const views = ['map', 'timeline', 'graph']
  return (
    <header className="z-20 flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-b border-white/8 bg-ink-950/80 px-4 py-2.5 backdrop-blur sm:px-6">
      <div className="flex min-w-0 items-baseline gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-[0.25em] text-gold uppercase">
          {t(lang, 'appTitle')}
        </h1>
        <span className="hidden truncate text-xs tracking-wide text-slate-400 uppercase md:inline">
          {t(lang, 'appSubtitle')}
        </span>
      </div>

      <nav role="tablist" aria-label="Views" className="order-3 flex w-full gap-1 sm:order-none sm:w-auto">
        {views.map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            onClick={() => onViewChange(v)}
            className="btn-ghost flex flex-1 items-center justify-center gap-1.5 sm:flex-none"
          >
            {ICONS[v]}
            {t(lang, v === 'map' ? 'viewMap' : v === 'timeline' ? 'viewTimeline' : 'viewGraph')}
          </button>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-3">
        {dataset && (
          <span className="hidden text-xs text-slate-400 sm:inline" title={dataset.generated}>
            {formatNumber(dataset.events.length, lang)} {t(lang, 'events')}
          </span>
        )}
        <a
          href={t(lang, 'aboutUrl')}
          target="_blank"
          rel="noopener"
          className="btn-ghost text-slate-300"
          title={t(lang, 'about')}
        >
          {t(lang, 'about')}
        </a>
        <button
          onClick={() => onLangChange(lang === 'es' ? 'en' : 'es')}
          className="btn-ghost"
          lang={lang === 'es' ? 'en' : 'es'}
          aria-label={t(lang, 'switchLang')}
        >
          {t(lang, 'switchLang')}
        </button>
      </div>
    </header>
  )
}
