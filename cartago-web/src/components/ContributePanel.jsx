import { useCallback, useEffect, useRef, useState } from 'react'
import { api, copyText, getSession, loginUrl, recordReference, recordSummary, recordTitle, recordUrl, setSession } from '../lib/community.js'
import { t } from '../lib/i18n.js'
import Proposals from './Proposals.jsx'

const POLL_MS = 5000
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

function Avatar({ author }) {
  const initial = (author.name || '?').trim().charAt(0).toUpperCase()
  return author.avatar ? (
    <img src={author.avatar} alt="" className="h-7 w-7 shrink-0 rounded-full bg-slate-800 object-cover" loading="lazy" />
  ) : (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-700 text-xs font-semibold text-slate-200">
      {initial}
    </span>
  )
}

function Attachment({ a }) {
  if (a.type.startsWith('image/')) {
    return (
      <a href={a.url} target="_blank" rel="noopener" className="block">
        <img src={a.url} alt={a.name} className="max-h-56 rounded-md border border-white/10 object-contain" loading="lazy" />
      </a>
    )
  }
  return (
    <a href={a.url} target="_blank" rel="noopener" className="chip text-sky-300">
      📄 {a.name} <span className="text-slate-500">{(a.size / 1024).toFixed(0)} KB</span>
    </a>
  )
}

/** Minimal Discord markdown: **bold**, bare URLs as links. */
function Rich({ text }) {
  const parts = text.split(/(\*\*[^*]+\*\*|https?:\/\/[^\s)]+)/g)
  return parts.map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i} className="font-semibold text-slate-100">{part.slice(2, -2)}</strong>
    if (/^https?:\/\//.test(part))
      return (
        <a key={i} href={part} target="_blank" rel="noopener" className="text-sky-300 break-all hover:text-gold">
          {part}
        </a>
      )
    return part
  })
}

function formatTime(iso, lang) {
  const d = new Date(iso)
  return d.toLocaleString(lang === 'es' ? 'es-CR' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/**
 * Side drawer where a record is discussed and enriched. Discord is the source of
 * truth: messages come from the record's forum post and new ones are posted there.
 */
export default function ContributePanel({ ev, lang, onClose }) {
  const [config, setConfig] = useState(null)
  const [user, setUser] = useState(undefined) // undefined = unknown yet, null = signed out
  const [thread, setThread] = useState(null)
  const [messages, setMessages] = useState([])
  const [loadError, setLoadError] = useState(null)
  const [content, setContent] = useState('')
  const [files, setFiles] = useState([])
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [copied, setCopied] = useState(false)
  const [needSignIn, setNeedSignIn] = useState(false)
  const listRef = useRef(null)
  const lastId = useRef(null)

  // Config and session, once per open.
  useEffect(() => {
    api.config().then(setConfig).catch(() => setConfig({ providers: [], invite: null }))
    if (!getSession()) setUser(null)
    else
      api
        .me()
        .then((r) => setUser(r.user))
        .catch(() => {
          setSession(null)
          setUser(null)
        })
  }, [])

  // Messages: full load, then incremental polling while the panel is open.
  const load = useCallback(
    async (incremental) => {
      try {
        const r = await api.messages(ev, incremental ? lastId.current : null)
        setThread(r.thread)
        if (r.messages.length) {
          lastId.current = r.messages[r.messages.length - 1].id
          setMessages((prev) => (incremental ? [...prev, ...r.messages] : r.messages))
        } else if (!incremental) setMessages([])
        setLoadError(null)
      } catch (err) {
        setLoadError(err)
      }
    },
    [ev],
  )

  useEffect(() => {
    lastId.current = null
    setMessages([])
    setThread(null)
    load(false)
    const id = setInterval(() => load(true), POLL_MS)
    return () => clearInterval(id)
  }, [load])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages.length])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const addFiles = (list) => {
    const max = config?.maxFiles ?? 4
    const maxBytes = config?.maxFileBytes ?? 10 * 1024 * 1024
    const next = [...files]
    for (const f of list) {
      if (next.length >= max) break
      if (f.size > maxBytes) {
        setSendError({ message: t(lang, 'fileTooLarge', f.name) })
        continue
      }
      if (!/^(image\/|application\/pdf)/.test(f.type)) {
        setSendError({ message: t(lang, 'fileTypeNotAllowed', f.name) })
        continue
      }
      next.push(f)
    }
    setFiles(next)
  }

  const send = async (e) => {
    e?.preventDefault()
    if (sending || (!content.trim() && files.length === 0)) return
    setSending(true)
    setSendError(null)
    try {
      const r = await api.post(ev, lang, { content: content.trim(), files })
      setThread(r.thread)
      setMessages((prev) => [...prev, r.message])
      lastId.current = r.message.id
      setContent('')
      setFiles([])
    } catch (err) {
      if (err.status === 401) {
        setSession(null)
        setUser(null)
      }
      setSendError(err)
    } finally {
      setSending(false)
    }
  }

  const copyRef = () => copyText(recordReference(ev, lang)).then((ok) => ok && (setCopied(true), setTimeout(() => setCopied(false), 2000)))

  const providers = config?.providers ?? []
  // The bot only writes the starter post (the record reference); people see it in Discord, not here.
  const visible = messages.filter((m) => !m.author.bot)

  return (
    <aside
      className="fixed inset-y-0 right-0 z-30 flex w-full max-w-md flex-col border-l border-white/10 bg-ink-950 shadow-[0_8px_40px_rgba(0,0,0,0.6)] sm:inset-y-3 sm:right-3 sm:rounded-xl sm:border"
      role="dialog"
      aria-label={t(lang, 'contributeTitle')}
      onDragOver={(e) => {
        e.preventDefault()
        if (user) setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        if (user) addFiles(e.dataTransfer.files)
      }}
    >
      {/* header */}
      <div className="flex items-start gap-3 border-b border-white/8 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] tracking-wide text-slate-400 uppercase">{t(lang, 'contributeHeading')}</div>
          <div className="font-display text-lg leading-tight font-semibold text-gold">{recordTitle(ev, lang)}</div>
          <p className="mt-1 line-clamp-2 text-xs text-slate-400">{recordSummary(ev, lang, 160)}</p>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
            <button type="button" className="text-slate-500 hover:text-gold" onClick={copyRef}>
              {copied ? t(lang, 'copied') : t(lang, 'copyReference')}
            </button>
            <a href={recordUrl(ev)} className="text-slate-500 hover:text-gold" onClick={(e) => (e.preventDefault(), copyText(recordUrl(ev)))}>
              {t(lang, 'copyLink')}
            </a>
            {thread && (
              <a href={thread.url} target="_blank" rel="noopener" className="text-sky-300 hover:text-gold">
                {t(lang, 'openInDiscord')} ↗
              </a>
            )}
          </div>
        </div>
        <button type="button" className="btn-ghost -mr-2 text-slate-400" onClick={onClose} aria-label={t(lang, 'close')}>
          ✕
        </button>
      </div>

      {/* proposals + messages */}
      <div ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <Proposals ev={ev} lang={lang} user={user ?? null} config={config} onSignInNeeded={() => setNeedSignIn(true)} />
        {loadError && !messages.length && <p className="text-xs text-rose-300">{t(lang, 'communityOffline')}</p>}
        {!loadError && !visible.length && (
          <div className="rounded-lg border border-dashed border-white/10 p-4 text-sm text-slate-400">
            <p>{t(lang, 'noMessagesYet')}</p>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">
              <li>{t(lang, 'ideaCorrect')}</li>
              <li>{t(lang, 'ideaDocument')}</li>
              <li>{t(lang, 'ideaContext')}</li>
            </ul>
          </div>
        )}
        {visible.map((m) => (
          <div key={m.id} className="flex gap-2.5">
            <Avatar author={m.author} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 text-xs">
                <span className="font-medium text-slate-200">{m.author.name}</span>
                {m.author.bot && <span className="text-[10px] text-slate-500 uppercase">bot</span>}
                {!m.author.viaWeb && !m.author.bot && <span className="text-[10px] text-slate-500">Discord</span>}
                <time className="text-slate-500" dateTime={m.at}>
                  {formatTime(m.at, lang)}
                </time>
              </div>
              {m.content && (
                <p className="mt-0.5 text-sm whitespace-pre-wrap text-slate-200">
                  <Rich text={m.content} />
                </p>
              )}
              {m.attachments.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {m.attachments.map((a) => (
                    <Attachment key={a.id} a={a} />
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* composer */}
      <div className={`border-t border-white/8 px-4 py-3 ${dragging ? 'bg-gold/10' : ''} ${needSignIn && user === null ? 'ring-1 ring-gold/60' : ''}`}>
        {user === undefined ? null : user === null ? (
          <div>
            <p className="text-sm text-slate-300">{t(lang, 'signInToContribute')}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {providers.map((p) => (
                <a key={p.id} href={loginUrl(p.id, `r/${ev.id}`)} className="btn-ghost flex items-center gap-2 border border-white/10 bg-ink-950/60">
                  {PROVIDER_ICONS[p.id]}
                  {p.label}
                </a>
              ))}
              {config && providers.length === 0 && <span className="text-xs text-slate-500">{t(lang, 'signInUnavailable')}</span>}
            </div>
            <p className="mt-2 text-[11px] text-slate-500">{t(lang, 'signInNote')}</p>
          </div>
        ) : (
          <form onSubmit={send}>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && send(e)}
              rows={3}
              maxLength={2000}
              placeholder={t(lang, 'composerPlaceholder')}
              className="w-full resize-none rounded-md border border-white/10 bg-ink-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-gold/60 focus:outline-none"
            />
            {files.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {files.map((f, i) => (
                  <span key={`${f.name}-${i}`} className="chip text-slate-200">
                    {f.type.startsWith('image/') ? '🖼' : '📄'} {f.name}
                    <button type="button" className="ml-1 text-slate-500 hover:text-rose-300" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={t(lang, 'remove')}>
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="mt-2 flex items-center gap-2">
              <label className="btn-ghost inline-flex cursor-pointer items-center gap-1 whitespace-nowrap text-slate-300">
                📎 {t(lang, 'attach')}
                <input
                  type="file"
                  multiple
                  accept="image/*,application/pdf"
                  className="sr-only"
                  onChange={(e) => {
                    addFiles(e.target.files)
                    e.target.value = ''
                  }}
                />
              </label>
              <span className="hidden text-[11px] text-slate-500 sm:inline">{t(lang, 'dropHint')}</span>
              <span className="ml-auto flex items-center gap-2">
                <span className="max-w-[9rem] truncate text-[11px] text-slate-500" title={user.name}>
                  {user.name}
                </span>
                <button
                  type="button"
                  className="text-[11px] text-slate-500 hover:text-gold"
                  onClick={() => {
                    setSession(null)
                    setUser(null)
                  }}
                >
                  {t(lang, 'signOut')}
                </button>
                <button
                  type="submit"
                  disabled={sending || (!content.trim() && files.length === 0)}
                  className="btn-ghost border border-gold/50 text-gold-soft hover:bg-gold/10 disabled:opacity-40"
                >
                  {sending ? t(lang, 'sending') : t(lang, 'send')}
                </button>
              </span>
            </div>
            {sendError && (
              <p className="mt-2 text-xs text-rose-300">
                {sendError.message === 'too fast'
                  ? t(lang, 'tooFast')
                  : sendError.status === 401
                    ? t(lang, 'sessionExpired')
                    : sendError.message || t(lang, 'sendFailed')}
              </p>
            )}
          </form>
        )}
      </div>
    </aside>
  )
}
