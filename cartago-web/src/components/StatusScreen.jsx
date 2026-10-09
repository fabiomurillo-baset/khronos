import { t } from '../lib/i18n.js'

export default function StatusScreen({ lang, message, error, onRetry }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6" role="status" aria-live="polite">
      <div className="glass-panel flex max-w-sm flex-col items-center gap-4 px-8 py-7 text-center">
        {error ? (
          <>
            <p className="text-sm text-slate-200">{t(lang, 'loadError')}</p>
            <p className="font-mono text-xs break-all text-slate-500">{String(error.message || error)}</p>
            <button className="btn-ghost" onClick={onRetry}>
              {t(lang, 'retry')}
            </button>
          </>
        ) : (
          <>
            <div className="spinner" aria-hidden="true" />
            <p className="text-sm text-slate-300">{message}</p>
          </>
        )}
      </div>
    </div>
  )
}
