import { useMemo, useState } from 'react'
import { api } from '../lib/community.js'
import { t } from '../lib/i18n.js'
import { citation, fetchIaMetadata, referenceLinks, refreshReferences, useReferences } from '../lib/references.js'
import { useSession } from '../lib/session.js'
import { fold } from '../lib/text.js'

/** Inline viewer for one reference (Internet Archive embed, PDF, or a link card). */
function Viewer({ work, reference, lang }) {
  const links = referenceLinks(work, reference)
  if (!links) return null
  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-white/10 bg-ink-950">
      <div className="flex items-center justify-between gap-2 border-b border-white/8 px-2.5 py-1.5 text-[11px]">
        <span className="truncate text-slate-400">{citation(work, reference, lang)}</span>
        <a href={links.open} target="_blank" rel="noopener" className="shrink-0 text-sky-300 hover:text-gold">
          {t(lang, work.kind === 'ia' ? 'sourceOpen' : 'openLink')} ↗
        </a>
      </div>
      {links.embed ? (
        <iframe src={links.embed} title={citation(work, reference, lang)} className="block h-[440px] w-full bg-ink-950" loading="lazy" allowFullScreen referrerPolicy="no-referrer-when-downgrade" />
      ) : (
        <p className="px-3 py-3 text-xs text-slate-400">{t(lang, 'noEmbed')}</p>
      )}
    </div>
  )
}

function WorkPicker({ lang, works, value, onChange, onCreate }) {
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState({ kind: 'ia', ia: '', url: '', title: '', author: '', year: '', publisher: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const shown = useMemo(() => {
    const q = fold(query.trim())
    const list = works.filter((w) => !q || fold(`${w.author || ''} ${w.title} ${w.year || ''}`).includes(q))
    return list.slice(0, 12)
  }, [works, query])

  const fill = async () => {
    setBusy(true)
    setError(null)
    try {
      const meta = await fetchIaMetadata(draft.ia)
      if (!meta) setError({ message: t(lang, 'iaNotFound') })
      else setDraft((d) => ({ ...d, ...meta }))
    } catch {
      setError({ message: t(lang, 'iaNotFound') })
    } finally {
      setBusy(false)
    }
  }

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const body = draft.kind === 'ia' ? { kind: 'ia', ia: draft.ia.trim(), title: draft.title, author: draft.author, year: draft.year, publisher: draft.publisher } : { kind: 'url', url: draft.url.trim(), title: draft.title, author: draft.author, year: draft.year, publisher: draft.publisher }
      const w = await onCreate(body)
      onChange(String(w.id))
      setCreating(false)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  if (creating) {
    return (
      <div className="rounded-md border border-white/10 p-2.5">
        <div className="flex gap-1">
          {['ia', 'url'].map((k) => (
            <button key={k} type="button" className="btn-ghost text-xs" aria-pressed={draft.kind === k} onClick={() => setDraft((d) => ({ ...d, kind: k }))}>
              {t(lang, k === 'ia' ? 'workKindIa' : 'workKindUrl')}
            </button>
          ))}
        </div>
        {draft.kind === 'ia' ? (
          <div className="mt-2 flex gap-2">
            <input value={draft.ia} onChange={(e) => setDraft((d) => ({ ...d, ia: e.target.value }))} placeholder={t(lang, 'iaIdPlaceholder')} className="field text-xs" />
            <button type="button" className="btn-ghost shrink-0 text-xs" disabled={busy || !draft.ia.trim()} onClick={fill}>
              {t(lang, 'iaFill')}
            </button>
          </div>
        ) : (
          <input value={draft.url} onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))} placeholder="https://…" className="field mt-2 text-xs" />
        )}
        <input value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} placeholder={t(lang, 'workTitle')} className="field mt-2 text-xs" maxLength={300} />
        <div className="mt-2 grid grid-cols-3 gap-2">
          <input value={draft.author} onChange={(e) => setDraft((d) => ({ ...d, author: e.target.value }))} placeholder={t(lang, 'workAuthor')} className="field col-span-2 text-xs" maxLength={300} />
          <input value={draft.year} onChange={(e) => setDraft((d) => ({ ...d, year: e.target.value }))} placeholder={t(lang, 'workYear')} className="field text-xs" maxLength={12} />
        </div>
        <div className="mt-2 flex items-center justify-end gap-2">
          {error && <span className="mr-auto text-xs text-rose-300">{error.message}</span>}
          <button type="button" className="btn-ghost text-xs" onClick={() => setCreating(false)}>
            {t(lang, 'cancel')}
          </button>
          <button type="button" className="btn-ghost border border-gold/50 text-xs text-gold-soft" disabled={busy || !draft.title.trim() || (draft.kind === 'ia' ? !draft.ia.trim() : !/^https?:\/\//.test(draft.url))} onClick={create}>
            {t(lang, 'saveWork')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t(lang, 'searchWork')} className="field text-xs" />
      <ul className="mt-1 max-h-40 overflow-y-auto rounded-md border border-white/8">
        {shown.map((w) => (
          <li key={w.id}>
            <button type="button" className={`block w-full px-2 py-1 text-left text-xs hover:bg-white/5 ${value === w.id ? 'bg-gold/10 text-gold-soft' : 'text-slate-300'}`} onClick={() => onChange(w.id)}>
              {w.author ? `${w.author}, ` : ''}
              {w.title}
              {w.year ? ` (${w.year})` : ''}
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="px-2 py-1 text-xs text-slate-500">{t(lang, 'noResults')}</li>}
      </ul>
      <button type="button" className="mt-1.5 text-xs text-sky-300 hover:text-gold" onClick={() => setCreating(true)}>
        + {t(lang, 'newWork')}
      </button>
    </div>
  )
}

function AddReference({ target, lang, onDone, onCancel }) {
  const refs = useReferences()
  const [workId, setWorkId] = useState('')
  const [locatorType, setLocatorType] = useState('page')
  const [locator, setLocator] = useState('')
  const [quote, setQuote] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const work = refs.work(workId)
  const types = work?.kind === 'ia' ? ['page', 'leaf', 'none'] : ['pdfpage', 'url', 'none']

  const submit = async (e) => {
    e.preventDefault()
    if (!workId) return
    setBusy(true)
    setError(null)
    try {
      await api.addRef({ target, work_id: workId, locator_type: locatorType, locator: locatorType === 'none' ? null : locator.trim(), quote: quote.trim(), note: note.trim() })
      await refreshReferences()
      onDone()
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-2 rounded-lg border border-gold/30 bg-gold/5 p-3 text-sm">
      <label className="block text-[11px] tracking-wide text-slate-400 uppercase">{t(lang, 'work')}</label>
      <div className="mt-1">
        <WorkPicker
          lang={lang}
          works={refs.allWorks()}
          value={workId}
          onChange={(id) => {
            setWorkId(id)
            const w = refs.work(id)
            setLocatorType(w?.kind === 'ia' ? 'page' : 'pdfpage')
          }}
          onCreate={async (body) => {
            const r = await api.addWork(body)
            await refreshReferences()
            return r.work
          }}
        />
      </div>
      {work && (
        <>
          <label className="mt-3 block text-[11px] tracking-wide text-slate-400 uppercase">{t(lang, 'locator')}</label>
          <div className="mt-1 flex flex-wrap gap-2">
            <div className="flex gap-1">
              {types.map((k) => (
                <button key={k} type="button" className="btn-ghost text-xs" aria-pressed={locatorType === k} onClick={() => setLocatorType(k)}>
                  {t(lang, `loc_${k}`)}
                </button>
              ))}
            </div>
            {locatorType !== 'none' && (
              <input value={locator} onChange={(e) => setLocator(e.target.value)} placeholder={locatorType === 'url' ? 'https://…' : t(lang, 'locatorPlaceholder')} className="field min-w-40 flex-1 text-xs" maxLength={500} />
            )}
          </div>
          <textarea value={quote} onChange={(e) => setQuote(e.target.value)} rows={2} maxLength={2000} placeholder={t(lang, 'quotePlaceholder')} className="field mt-3 resize-y text-xs" />
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder={t(lang, 'refNotePlaceholder')} className="field mt-2 text-xs" />
        </>
      )}
      <div className="mt-3 flex items-center justify-end gap-2">
        {error && <span className="mr-auto text-xs text-rose-300">{error.status === 401 ? t(lang, 'sessionExpired') : error.message}</span>}
        <button type="button" className="btn-ghost" onClick={onCancel}>
          {t(lang, 'cancel')}
        </button>
        <button type="submit" className="btn-ghost border border-gold/50 text-gold-soft hover:bg-gold/10 disabled:opacity-40" disabled={busy || !workId || (locatorType !== 'none' && !locator.trim())}>
          {t(lang, 'addReference')}
        </button>
      </div>
    </form>
  )
}

/**
 * References attached to a target (record, person or place): citation list with an
 * inline viewer per entry, and a form to add one. `compact` renders a one-line toggle
 * (used inside record cards); otherwise a full section (profiles, the Aportar panel).
 */
export default function References({ target, lang, compact = false, onSignInNeeded }) {
  const refs = useReferences()
  const { user, config } = useSession()
  const list = refs.refsFor(target)
  const [open, setOpen] = useState(!compact)
  const [adding, setAdding] = useState(false)
  const [viewing, setViewing] = useState(null)
  const [busy, setBusy] = useState(false)
  const enabled = config?.curation !== false

  const remove = async (id) => {
    setBusy(true)
    try {
      await api.undoRef(id)
      await refreshReferences()
    } finally {
      setBusy(false)
    }
  }

  if (compact && list.length === 0 && !user) return null
  if (!enabled) return null

  const addButton = (
    <button
      type="button"
      className="text-xs text-sky-300 hover:text-gold"
      onClick={() => {
        if (!user) return onSignInNeeded?.()
        setOpen(true)
        setAdding(true)
      }}
    >
      + {t(lang, 'addReference')}
    </button>
  )

  return (
    <section className={compact ? 'mt-2 text-[11px]' : 'rounded-lg border border-white/8 bg-ink-950/40 p-3'}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {compact ? (
          <button type="button" className="text-slate-500 hover:text-gold" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {t(lang, 'references')} ({list.length}) {open ? '▴' : '▾'}
          </button>
        ) : (
          <div>
            <h4 className="text-sm font-semibold text-slate-100">{t(lang, 'references')}</h4>
            <p className="mt-0.5 text-[11px] text-slate-500">{t(lang, 'referencesHelp')}</p>
          </div>
        )}
        {!adding && <span className={compact ? '' : 'ml-auto'}>{addButton}</span>}
      </div>

      {open && (
        <div className={compact ? 'mt-1' : 'mt-2'}>
          {list.length === 0 && !adding && <p className="text-xs text-slate-500">{t(lang, 'noReferences')}</p>}
          <ul className="space-y-1.5">
            {list.map((r) => {
              const work = refs.work(r.work_id)
              return (
                <li key={r.id} className="text-xs">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-slate-200">{citation(work, r, lang)}</span>
                    {work && referenceLinks(work, r) && (
                      <button type="button" className="text-sky-300 hover:text-gold" onClick={() => setViewing(viewing === r.id ? null : r.id)}>
                        {t(lang, viewing === r.id ? 'sourceHide' : 'sourceViewer')} {viewing === r.id ? '▴' : '▾'}
                      </button>
                    )}
                    <span className="text-slate-500">
                      {r.user_name} · {new Date(r.at).toLocaleDateString(lang === 'es' ? 'es-CR' : 'en-GB')}
                    </span>
                    {user && (
                      <button type="button" className="text-slate-500 hover:text-rose-300" disabled={busy} onClick={() => remove(r.id)}>
                        {t(lang, 'remove')}
                      </button>
                    )}
                  </div>
                  {r.quote && <blockquote className="mt-0.5 border-l-2 border-gold/40 pl-2 text-slate-300 italic">“{r.quote}”</blockquote>}
                  {r.note && <p className="mt-0.5 text-slate-400">{r.note}</p>}
                  {viewing === r.id && work && <Viewer work={work} reference={r} lang={lang} />}
                </li>
              )
            })}
          </ul>
          {adding && <AddReference target={target} lang={lang} onDone={() => setAdding(false)} onCancel={() => setAdding(false)} />}
        </div>
      )}
    </section>
  )
}
