import { loginUrl } from '../lib/community.js'
import { t } from '../lib/i18n.js'

const PROVIDER_ICONS = {
  discord: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      <path d="M19.6 5.3A17 17 0 0 0 15.4 4l-.2.4a15 15 0 0 1 3.8 1.9 14 14 0 0 0-14 0A15 15 0 0 1 8.8 4.4L8.6 4a17 17 0 0 0-4.2 1.3C1.7 9.3 1 13.2 1.4 17a17 17 0 0 0 5.2 2.6l1.1-1.8a11 11 0 0 1-1.7-.8l.4-.3a12 12 0 0 0 11.2 0l.4.3a11 11 0 0 1-1.7.8l1.1 1.8a17 17 0 0 0 5.2-2.6c.5-4.4-.8-8.3-3-11.7ZM8.7 14.7c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1Zm6.6 0c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1Z" />
    </svg>
  ),
  google: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4Z" />
      <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.4 14a6 6 0 0 1 0-3.9V7.4H3.1a10 10 0 0 0 0 9l3.3-2.5Z" />
      <path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 3.1 7.4L6.4 10c.8-2.3 3-4 5.6-4Z" />
    </svg>
  ),
  facebook: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="#1877F2" aria-hidden="true">
      <path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7A10 10 0 0 0 22 12Z" />
    </svg>
  ),
}

/** One button per provider; `returnHash` is where the person lands afterwards. */
export function SignInButtons({ lang, config, returnHash, prompt }) {
  const providers = config?.providers ?? []
  return (
    <div>
      {prompt && <p className="text-sm text-slate-300">{prompt}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {providers.map((p) => (
          <a key={p.id} href={loginUrl(p.id, returnHash)} className="btn-ghost flex items-center gap-2 border border-white/10 bg-ink-950/60">
            {PROVIDER_ICONS[p.id]}
            {p.label}
          </a>
        ))}
        {config && providers.length === 0 && <span className="text-xs text-slate-500">{t(lang, 'signInUnavailable')}</span>}
      </div>
    </div>
  )
}
