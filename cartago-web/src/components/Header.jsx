import { useEffect, useState } from 'react'
import { api } from '../lib/community.js'
import { t } from '../lib/i18n.js'
import { formatNumber } from '../lib/text.js'

const CHAT_ICON = (
  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M3.5 5.5A2 2 0 0 1 5.5 3.5h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-3.8 2.8a.4.4 0 0 1-.7-.3v-2.5h-.5a2 2 0 0 1-2-2z" strokeLinejoin="round" />
    <path d="M7 7.5h6M7 10.5h4" strokeLinecap="round" />
  </svg>
)

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
  people: (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="7.5" cy="7" r="2.5" />
      <circle cx="13.5" cy="8" r="2" />
      <path d="M3 16c0-2.5 2-4.2 4.5-4.2S12 13.5 12 16M11.5 15.5c0-2 1.3-3.3 3-3.3s2.8 1.3 2.8 3.3" strokeLinecap="round" />
    </svg>
  ),
  places: (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M10 17.5s5-4.6 5-9a5 5 0 0 0-10 0c0 4.4 5 9 5 9z" strokeLinejoin="round" />
      <circle cx="10" cy="8.5" r="1.8" />
    </svg>
  ),
}

export default function Header({ lang, onLangChange, view, onViewChange, dataset }) {
  const views = ['map', 'timeline', 'graph', 'people', 'places']
  const activeTab = view === 'person' ? 'people' : view === 'place' ? 'places' : view
  // Discord invite comes from the API; until it answers, the link goes to the write-up's "Participa" section.
  const [invite, setInvite] = useState(null)
  useEffect(() => {
    api.config().then((c) => c.invite && setInvite(c.invite)).catch(() => {})
  }, [])
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
            aria-selected={activeTab === v}
            onClick={() => onViewChange(v)}
            className="btn-ghost flex flex-1 items-center justify-center gap-1.5 sm:flex-none"
          >
            {ICONS[v]}
            {t(lang, { map: 'viewMap', timeline: 'viewTimeline', graph: 'viewGraph', people: 'viewPeople', places: 'viewPlaces' }[v])}
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
          href={invite || `${t(lang, 'aboutUrl')}#participa`}
          target="_blank"
          rel="noopener"
          className="btn-ghost flex items-center gap-1.5 text-gold-soft"
          title={t(lang, 'communityTitle')}
        >
          {CHAT_ICON}
          <span className="hidden sm:inline">{t(lang, 'community')}</span>
        </a>
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
