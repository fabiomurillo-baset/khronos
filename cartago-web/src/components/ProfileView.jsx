import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/community.js'
import { compareByDate, curationFor, getPeopleIndex, getPlacesIndex, personKey, placeKey, yearSpan, loadPeopleFacts, derivedFacts, communityFacts, curationVersion, getSummary, getDataset, sourceLinks } from '../lib/data.js'
import { t } from '../lib/i18n.js'
import { findSimilar } from '../lib/similar.js'
import { fold, formatNumber, foldPerson } from '../lib/text.js'
import PersonFacts from './PersonFacts.jsx'
import LifeLine from './LifeLine.jsx'
import EventDetail from './EventDetail.jsx'
import MergeDialog from './MergeDialog.jsx'
import References from './References.jsx'
import { SignInButtons } from './SignIn.jsx'

const PAGE = 25

function topCounts(values, max) {
  const counts = new Map()
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, max)
}

function joinNames(names, lang) {
  if (names.length <= 1) return names.join('')
  const and = lang === 'es' ? ' y ' : ' and '
  return `${names.slice(0, -1).join(', ')}${and}${names[names.length - 1]}`
}

const MONTHS = { es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'], en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] }
const EN_INDEX = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11, ene: 0, en: 0, abr: 3, ago: 7, set: 8, dic: 11 }

/** "22 jun 1618", "≈ 1629", "s. f." — the date as the margin of the records list shows it. */
function recordDate(ev, lang) {
  const year = ev.year == null ? t(lang, 'undated') : `${ev.inferred ? '≈ ' : ''}${ev.year}`
  const s = String(ev.date || '').trim()
  const m = /^([A-Za-zÁÉÍÓÚáéíóú]+)\.?\s*(\d{1,2})?/.exec(s)
  if (m && EN_INDEX[m[1].slice(0, 3).toLowerCase()] != null) {
    const mon = MONTHS[lang === 'es' ? 'es' : 'en'][EN_INDEX[m[1].slice(0, 3).toLowerCase()]]
    return `${m[2] ? `${m[2]} ` : ''}${mon} ${year}`
  }
  return s ? `${s} ${year}` : year
}

/** One sentence that says who the person was, from the facts; empty when there are none. */
function bioSentence(lang, derived, community) {
  if (!derived && !community) return ''
  const first = (field) => community?.[field]?.value || (derived?.[field] || []).map((x) => x[0])[0]
  const year = (field) => {
    if (community?.[field]?.value) return community[field].value
    const ys = (derived?.[field] || []).map((x) => x[0]).filter((y) => Number.isFinite(y)).sort((a, b) => a - b)
    return ys[0]
  }
  const roles = [...new Set((derived?.roles || []).map(([r]) => r.toLowerCase().replace(/,? ?\(?deceased\)?|,? ?\(?difunt[oa]\)?|,? ?\(?finad[oa]\)?/g, '').trim()).filter(Boolean))].slice(0, 2)
  const parts = []
  if (roles.length) parts.push(roles.map((r) => r.charAt(0).toUpperCase() + r.slice(1)).join(lang === 'es' ? ' y ' : ' and ') + '.')
  const origin = first('origin')
  const residence = first('residence')
  const place = []
  if (origin) place.push(t(lang, 'bioOrigin', origin))
  if (residence && residence !== origin) place.push(t(lang, 'bioResidence', residence, null))
  if (place.length) parts.push(place.join(', ') + '.')
  const spouse = first('spouse')
  const children = community?.children?.value ? null : (derived?.children || []).length
  const family = []
  if (spouse) family.push(t(lang, 'bioSpouse', spouse))
  if (children) family.push(t(lang, 'bioChildren', children))
  if (family.length) parts.push(family[0] + (family[1] ? `, ${family[1]}` : '') + '.')
  const born = year('born')
  const will = year('will')
  const dead = year('dead')
  const life = []
  if (born && !will && !dead) life.push(t(lang, 'bioBorn', born))
  if (will) life.push(t(lang, 'bioWill', will))
  if (dead) life.push(t(lang, 'bioDead', dead))
  if (life.length) parts.push((life.length === 2 ? `${life[0]}; ${life[1]}` : life[0]) + '.')
  return parts.join(' ')
}

/** One record as a row of the chronology: date in the margin, two lines of summary, meta; opens in place. */
function RecordRow({ ev, lang, open, onToggle, onOpen, actions }) {
  const { text } = getSummary(ev, lang)
  const ds = getDataset()
  const src = sourceLinks(ds, ev)
  const coll = ev.collection > 0 ? ds?.collections?.[ev.collection]?.label : lang === 'es' ? 'Protocolos de Cartago' : 'Cartago protocols'
  const where = src ? (src.kind === 'index' ? t(lang, 'sourceRef', src.tomo, src.printed, src.page) : t(lang, 'sourceLeaf', src.label, src.page, src.printed, src.side)) : ''
  return (
    <li id={`event-${ev.id}`} className="relative grid grid-cols-[6.5rem_1fr] gap-3 py-2.5 pl-4 sm:grid-cols-[7.5rem_1fr]">
      <span aria-hidden="true" className={`absolute top-4 -left-[4px] h-[7px] w-[7px] rounded-full ${open ? 'bg-rubric' : 'bg-rule'}`} />
      <time className="pt-0.5 font-mono text-xs text-ink-light">{recordDate(ev, lang)}</time>
      <div className="min-w-0">
        {open ? (
          <div className="-mt-2">
            <EventDetail ev={ev} lang={lang} compact onPerson={(n) => onOpen('person', personKey(n))} onPlace={(n) => onOpen('place', placeKey(n))} actions={actions} />
            <button type="button" className="text-xs text-label hover:text-rubric" onClick={onToggle}>
              {t(lang, 'hideRecord')} ▴
            </button>
          </div>
        ) : (
          <>
            <p className="line-clamp-2 text-sm leading-snug text-ink">{text}</p>
            <div className="mt-0.5 text-[11px] text-label">
              {coll}
              {where ? ` · ${where}` : ''} · <span className="font-mono">#{ev.id}</span> ·{' '}
              <button type="button" className="hover:text-rubric" onClick={onToggle}>
                {t(lang, 'showRecord')} ▾
              </button>
            </div>
          </>
        )}
      </div>
    </li>
  )
}

/**
 * Profile of one person or place: name, one sentence, a life line, then the chronology on the
 * left and the facts, spellings, related entries and curation on the right.
 */
export default function ProfileView({ kind, entityKey, lang, dataset, session, actions, onOpen, onCurationChanged }) {
  const isPerson = kind === 'person'
  const index = useMemo(() => (isPerson ? getPeopleIndex(dataset) : getPlacesIndex(dataset)), [isPerson, dataset])
  const canonical = isPerson ? personKey(entityKey) : placeKey(entityKey)
  const entry = index.get(canonical)
  const [limit, setLimit] = useState(PAGE)
  const [openId, setOpenId] = useState(null)
  const [compare, setCompare] = useState(null)
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const similar = useMemo(() => (entry ? findSimilar(entry, index.values(), { limit: 8 }) : []), [entry, index])
  const records = useMemo(() => (entry ? [...entry.events].sort(compareByDate) : []), [entry])
  const [peopleFacts, setPeopleFacts] = useState(null)
  useEffect(() => {
    if (!isPerson) return
    let alive = true
    loadPeopleFacts()
      .then((f) => alive && setPeopleFacts(f))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [isPerson])
  const derived = useMemo(() => (isPerson && entry ? derivedFacts(entry, peopleFacts) : null), [isPerson, entry, peopleFacts])
  const community = useMemo(
    () => (isPerson && entry ? communityFacts('person', entry.key, [...entry.aliases.keys()].map(foldPerson)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isPerson, entry, curationVersion()],
  )
  const changes = useMemo(() => (entry ? curationFor(kind, entry.key).slice().reverse() : []), [kind, entry])

  const related = useMemo(() => {
    if (!entry) return { places: [], people: [] }
    const places = []
    const people = []
    for (const ev of entry.events) {
      for (const l of ev.locations) places.push(placeKey(l))
      for (const p of ev.people) {
        const k = personKey(p)
        if (k !== entry.key) people.push(k)
      }
    }
    const placesIdx = getPlacesIndex(dataset)
    const peopleIdx = getPeopleIndex(dataset)
    return {
      places: topCounts(places.filter((k) => !(!isPerson && k === entry.key)), 10).map(([k, c]) => [placesIdx.get(k), c]).filter(([e]) => e),
      people: topCounts(people, 10).map(([k, c]) => [peopleIdx.get(k), c]).filter(([e]) => e),
    }
  }, [entry, dataset, isPerson])

  if (!entry) {
    return (
      <div className="mx-auto max-w-3xl p-8 text-center text-ink-light">
        <p>{t(lang, 'notFound')}</p>
        <button type="button" className="btn-ghost mt-4" onClick={() => onOpen(isPerson ? 'people' : 'places')}>
          {t(lang, 'backToList')}
        </button>
      </div>
    )
  }

  const span = yearSpan(entry)
  const returnHash = `${isPerson ? 'p' : 'l'}/${entry.key}`
  const sentence = isPerson ? bioSentence(lang, derived, community) : ''
  const fallbackSummary = isPerson
    ? t(lang, 'summaryPerson', entry.name, formatNumber(entry.events.length, lang), span?.[0], span?.[1], related.places[0]?.[0]?.name, joinNames(related.people.slice(0, 3).map(([e]) => e.name), lang))
    : t(lang, 'summaryPlace', entry.name, formatNumber(entry.events.length, lang), span?.[0], span?.[1], joinNames(related.people.slice(0, 3).map(([e]) => e.name), lang))
  const firstLocated = entry.events.find((ev) => ev.lat != null)

  const rename = async () => {
    const name = newName.trim()
    if (!name || name === entry.name) return setRenaming(false)
    setBusy(true)
    setError(null)
    try {
      await api.curate({ kind, action: 'rename', subject: entry.key, target: name })
      await onCurationChanged()
      setRenaming(false)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  const undo = async (id) => {
    setBusy(true)
    setError(null)
    try {
      await api.undo(id)
      await onCurationChanged()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  const label = (key) => {
    for (const raw of entry.aliases.keys()) if ((entry.kind === 'person' ? foldPerson : fold)(raw) === key) return raw
    return index.get(key)?.name ?? key
  }

  const link = (e, k) => (
    <button key={e.key} type="button" className="hover:text-rubric hover:underline" onClick={() => onOpen(k, e.key)} title={t(lang, 'viewProfile')}>
      {e.name}
    </button>
  )

  const rowActions = { showOnMap: actions.showOnMap, showInTimeline: actions.showInTimeline, contribute: actions.contribute }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-4 py-7 sm:px-6">
        {/* header */}
        <div className="flex items-baseline justify-between gap-3 text-[11px] tracking-wide text-label uppercase">
          <button type="button" className="hover:text-rubric" onClick={() => onOpen(isPerson ? 'people' : 'places')}>
            ← {t(lang, isPerson ? 'viewPeople' : 'viewPlaces')}
          </button>
          <span>{span ? `${span[0]} – ${span[1]}` : ''}</span>
        </div>
        {renaming ? (
          <form
            className="mt-2 flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              rename()
            }}
          >
            <input value={newName} onChange={(e) => setNewName(e.target.value)} className="field max-w-md" maxLength={200} autoFocus placeholder={t(lang, 'renameHelp')} />
            <button type="submit" className="btn-primary" disabled={busy}>
              {t(lang, 'save')}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setRenaming(false)}>
              {t(lang, 'cancel')}
            </button>
          </form>
        ) : (
          <h2 className="mt-2 font-display text-4xl leading-[1.08] text-ink sm:text-5xl" style={{ textWrap: 'balance' }}>
            {entry.name}
          </h2>
        )}
        <p className="mt-3 max-w-3xl text-[17px] leading-relaxed text-ink-light">{sentence || fallbackSummary}</p>
        {isPerson && (
          <div className="mt-4 max-w-4xl">
            <LifeLine records={records} derived={derived} lang={lang} />
          </div>
        )}
        {error && <p className="mt-2 text-xs text-rubric">{error.status === 401 ? t(lang, 'sessionExpired') : error.message}</p>}

        <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          {/* chronology */}
          <section>
            <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-label uppercase">
              {t(lang, 'profileRecords')} · {formatNumber(entry.events.length, lang)}
            </h3>
            <ol className="border-l border-rule">
              {records.slice(0, limit).map((ev) => (
                <RecordRow key={ev.id} ev={ev} lang={lang} open={openId === ev.id} onToggle={() => setOpenId(openId === ev.id ? null : ev.id)} onOpen={onOpen} actions={rowActions} />
              ))}
            </ol>
            {records.length > limit && (
              <button type="button" className="mt-3 ml-4 text-sm text-label hover:text-rubric" onClick={() => setLimit((n) => n + PAGE)}>
                {t(lang, 'loadMore')} ({formatNumber(records.length - limit, lang)})
              </button>
            )}
            <div className="mt-6 ml-4 flex flex-wrap gap-2">
              {actions.contribute && records[0] && (
                <button type="button" className="btn-primary" onClick={() => actions.contribute(records[0])} title={t(lang, 'contributeTitle')}>
                  {t(lang, 'contribute')}
                </button>
              )}
              {isPerson && (
                <button type="button" className="btn-ghost" onClick={() => actions.showInGraph(entry.name)}>
                  {t(lang, 'showInGraph')}
                </button>
              )}
              {firstLocated && (
                <button type="button" className="btn-ghost" onClick={() => actions.showOnMap(firstLocated)}>
                  {t(lang, 'showOnMap')}
                </button>
              )}
              <button type="button" className="btn-ghost" onClick={() => actions.searchTimeline(entry.name)}>
                {t(lang, 'searchInTimeline')}
              </button>
            </div>
          </section>

          {/* facts and curation */}
          <aside className="min-w-0 space-y-7">
            {isPerson && (
              <section>
                <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-label uppercase">{t(lang, 'details')}</h3>
                <PersonFacts entry={entry} lang={lang} derived={derived} community={community} session={session} actions={{ ...actions, curate: api.curate }} onOpen={onOpen} onChanged={onCurationChanged} />
                <p className="mt-1 text-[11px] text-label">{t(lang, 'factsHelp')}</p>
              </section>
            )}

            <section className="text-sm text-ink-light">
              <span className="text-label">{t(lang, 'gathered')}: </span>
              {[...entry.aliases.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([raw, c], i) => (
                  <span key={raw}>
                    {i > 0 && ' · '}
                    {raw} <span className="text-label">({c})</span>
                  </span>
                ))}
              {session.user && !renaming && (
                <>
                  {' · '}
                  <button
                    type="button"
                    className="text-rubric hover:underline"
                    onClick={() => {
                      setNewName(entry.name)
                      setRenaming(true)
                    }}
                  >
                    {t(lang, 'correct')}
                  </button>
                </>
              )}
            </section>

            {related.people.length > 0 && (
              <section className="text-sm text-ink-light">
                <span className="text-label">{t(lang, 'relatedPeople')}: </span>
                {related.people.map(([e, c], i) => (
                  <span key={e.key}>
                    {i > 0 && ', '}
                    {link(e, 'person')} <span className="text-label">({c})</span>
                  </span>
                ))}
              </section>
            )}
            {related.places.length > 0 && (
              <section className="text-sm text-ink-light">
                <span className="text-label">{t(lang, 'relatedPlaces')}: </span>
                {related.places.map(([e, c], i) => (
                  <span key={e.key}>
                    {i > 0 && ', '}
                    {link(e, 'place')} <span className="text-label">({c})</span>
                  </span>
                ))}
              </section>
            )}

            <References target={`${isPerson ? 'p' : 'l'}:${entry.key}`} lang={lang} />

            <details className="text-sm">
              <summary className="cursor-pointer text-[11px] font-semibold tracking-wide text-label uppercase hover:text-rubric">
                {t(lang, 'possibleDuplicates')} ({similar.length})
              </summary>
              <p className="mt-1 text-xs text-label">{t(lang, 'duplicatesHelp')}</p>
              {similar.length === 0 ? (
                <p className="mt-2 text-xs text-label">{t(lang, 'noDuplicates')}</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {similar.map(({ entry: e, score }) => (
                    <li key={e.key} className="flex items-center gap-2">
                      <button type="button" className="min-w-0 flex-1 truncate text-left text-ink hover:text-rubric" onClick={() => onOpen(kind, e.key)} title={t(lang, 'viewProfile')}>
                        {e.name} <span className="text-label">· {Math.round(score * 100)}% · {e.events.length === 1 ? t(lang, 'recordsOne') : t(lang, 'records', e.events.length)}</span>
                      </button>
                      <button type="button" className="text-xs text-rubric hover:underline" onClick={() => setCompare(e)}>
                        {t(lang, 'compare')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {session.user === null && similar.length > 0 && (
                <div className="mt-3">
                  <SignInButtons lang={lang} config={session.config} returnHash={returnHash} prompt={t(lang, 'signInToCurate')} />
                </div>
              )}
            </details>

            <details className="text-sm">
              <summary className="cursor-pointer text-[11px] font-semibold tracking-wide text-label uppercase hover:text-rubric">
                {t(lang, 'changes')} ({changes.length})
              </summary>
              {changes.length === 0 ? (
                <p className="mt-2 text-xs text-label">{t(lang, 'noChanges')}</p>
              ) : (
                <ul className="mt-2 space-y-2 text-xs">
                  {changes.map((c) => (
                    <li key={c.id} className="flex items-start gap-2">
                      <span className="min-w-0 flex-1">
                        <span className="block text-ink">
                          {c.action === 'merge' ? t(lang, 'mergedInto', label(c.subject), label(c.target)) : c.action === 'rename' ? t(lang, 'renamedTo', label(c.subject), c.target) : `${t(lang, 'facts')}: ${c.target}`}
                        </span>
                        {c.note && <span className="block text-label italic">{c.note}</span>}
                        <span className="block text-label">{t(lang, 'curatedBy', c.user_name, new Date(c.at).toLocaleDateString(lang === 'es' ? 'es-CR' : 'en-GB'))}</span>
                      </span>
                      {session.user && (
                        <button type="button" className="text-label hover:text-rubric" disabled={busy} onClick={() => undo(c.id)}>
                          {t(lang, 'undo')}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </details>
          </aside>
        </div>
      </div>

      {compare && (
        <MergeDialog
          kind={kind}
          a={entry}
          b={compare}
          lang={lang}
          session={session}
          returnHash={returnHash}
          onClose={() => setCompare(null)}
          onMerged={async (target) => {
            setCompare(null)
            await onCurationChanged()
            onOpen(kind, target)
          }}
        />
      )}
    </div>
  )
}
