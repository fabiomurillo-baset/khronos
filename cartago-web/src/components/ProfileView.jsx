import { useMemo, useState } from 'react'
import { api } from '../lib/community.js'
import { curationFor, getPeopleIndex, getPlacesIndex, personKey, placeKey, yearSpan } from '../lib/data.js'
import { t } from '../lib/i18n.js'
import { findSimilar } from '../lib/similar.js'
import { fold, formatNumber } from '../lib/text.js'
import EventDetail from './EventDetail.jsx'
import MergeDialog from './MergeDialog.jsx'
import { SignInButtons } from './SignIn.jsx'

const PAGE = 20

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

function Decades({ entry, lang }) {
  const bars = useMemo(() => {
    const counts = new Map()
    for (const ev of entry.events) if (ev.year != null) counts.set(Math.floor(ev.year / 10) * 10, (counts.get(Math.floor(ev.year / 10) * 10) || 0) + 1)
    const decades = [...counts.keys()].sort((a, b) => a - b)
    if (!decades.length) return []
    const out = []
    for (let d = decades[0]; d <= decades[decades.length - 1]; d += 10) out.push([d, counts.get(d) || 0])
    return out
  }, [entry])
  if (bars.length < 2) return null
  const max = Math.max(...bars.map(([, c]) => c))
  return (
    <div>
      <div className="text-[11px] tracking-wide text-slate-500 uppercase">{t(lang, 'byDecade')}</div>
      <div className="mt-2 flex h-16 items-end gap-px">
        {bars.map(([d, c]) => (
          <div key={d} className="flex-1" title={`${d}s · ${c}`}>
            <div className="w-full rounded-t-sm bg-gold/70" style={{ height: `${Math.max(2, (c / max) * 56)}px` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-500">
        <span>{bars[0][0]}</span>
        <span>{bars[bars.length - 1][0] + 9}</span>
      </div>
    </div>
  )
}

function Section({ title, help, children, aside }) {
  return (
    <section className="glass-panel p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-base font-semibold text-slate-100">{title}</h3>
        {aside}
      </div>
      {help && <p className="mt-1 text-xs text-slate-500">{help}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

/**
 * Profile of one person or place (FamilySearch-style): summary, records timeline,
 * related entries, name variants, possible duplicates (merge), and the change log.
 */
export default function ProfileView({ kind, entityKey, lang, dataset, session, actions, onOpen, onCurationChanged }) {
  const isPerson = kind === 'person'
  const index = useMemo(() => (isPerson ? getPeopleIndex(dataset) : getPlacesIndex(dataset)), [isPerson, dataset])
  const canonical = isPerson ? personKey(entityKey) : placeKey(entityKey)
  const entry = index.get(canonical)
  const [limit, setLimit] = useState(PAGE)
  const [compare, setCompare] = useState(null)
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const similar = useMemo(() => (entry ? findSimilar(entry, index.values(), { limit: 8 }) : []), [entry, index])
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
      places: topCounts(places.filter((k) => !(!isPerson && k === entry.key)), 12).map(([k, c]) => [placesIdx.get(k), c]).filter(([e]) => e),
      people: topCounts(people, 12).map(([k, c]) => [peopleIdx.get(k), c]).filter(([e]) => e),
    }
  }, [entry, dataset, isPerson])

  if (!entry) {
    return (
      <div className="mx-auto max-w-3xl p-8 text-center text-slate-300">
        <p>{t(lang, 'notFound')}</p>
        <button type="button" className="btn-ghost mt-4" onClick={() => onOpen(isPerson ? 'people' : 'places')}>
          {t(lang, 'backToList')}
        </button>
      </div>
    )
  }

  const span = yearSpan(entry)
  const returnHash = `${isPerson ? 'p' : 'l'}/${entry.key}`
  const summary = isPerson
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

  // Readable label for a folded key in the change log: the raw spelling it came from, or the current entry name.
  const label = (key) => {
    for (const raw of entry.aliases.keys()) if (fold(raw) === key) return raw
    return index.get(key)?.name ?? key
  }

  const chip = (e, c, k) => (
    <button key={e.key} type="button" className={`chip ${k === 'person' ? 'text-gold-soft' : 'text-sky-300'}`} onClick={() => onOpen(k, e.key)} title={t(lang, 'viewProfile')}>
      <span aria-hidden="true" className="text-[10px] opacity-70">
        {k === 'person' ? '●' : '▲'}
      </span>
      {e.name} <span className="text-slate-500">{c}</span>
    </button>
  )

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        {/* header */}
        <div className="glass-panel p-5">
          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] tracking-wide text-slate-500 uppercase">{t(lang, isPerson ? 'person' : 'place')}</div>
              {renaming ? (
                <form
                  className="mt-1 flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    rename()
                  }}
                >
                  <input value={newName} onChange={(e) => setNewName(e.target.value)} className="field max-w-md" maxLength={200} autoFocus placeholder={t(lang, 'renameHelp')} />
                  <button type="submit" className="btn-ghost border border-gold/50 text-gold-soft" disabled={busy}>
                    {t(lang, 'save')}
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => setRenaming(false)}>
                    {t(lang, 'cancel')}
                  </button>
                </form>
              ) : (
                <h2 className="font-display text-3xl leading-tight font-semibold text-gold">{entry.name}</h2>
              )}
              {entry.aliases.size > 1 && (
                <div className="mt-2">
                  <div className="text-[11px] text-slate-500">
                    {t(lang, 'variants')} · <span className="text-slate-600">{t(lang, 'variantsHelp')}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {[...entry.aliases.entries()]
                      .sort((a, b) => b[1] - a[1])
                      .map(([raw, c]) => (
                        <span key={raw} className="chip text-slate-300">
                          {raw} <span className="text-slate-500">{c}</span>
                        </span>
                      ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              {isPerson && (
                <button type="button" className="btn-ghost" onClick={() => actions.showInGraph(entry.name)}>
                  {t(lang, 'showInGraph')} →
                </button>
              )}
              {firstLocated && (
                <button type="button" className="btn-ghost" onClick={() => actions.showOnMap(firstLocated)}>
                  {t(lang, 'showOnMap')} →
                </button>
              )}
              <button type="button" className="btn-ghost" onClick={() => actions.searchTimeline(entry.name)}>
                {t(lang, 'searchInTimeline')} →
              </button>
              {session.user && !renaming && (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setNewName(entry.name)
                    setRenaming(true)
                  }}
                >
                  {t(lang, 'rename')}
                </button>
              )}
            </div>
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              [t(lang, 'profileRecords'), formatNumber(entry.events.length, lang)],
              [t(lang, 'firstMention'), span ? span[0] : '—'],
              [t(lang, 'lastMention'), span ? span[1] : '—'],
              [t(lang, isPerson ? 'relatedPlaces' : 'relatedPeople'), formatNumber(isPerson ? related.places.length : related.people.length, lang)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-white/8 bg-ink-950/40 px-3 py-2">
                <dt className="text-[11px] tracking-wide text-slate-500 uppercase">{k}</dt>
                <dd className="font-display text-xl text-slate-100">{v}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-4 text-[15px] leading-relaxed text-slate-200">{summary}</p>
          <p className="mt-1 text-[11px] text-slate-500">{t(lang, 'aiCaveat')}</p>
          {error && <p className="mt-2 text-xs text-rose-300">{error.status === 401 ? t(lang, 'sessionExpired') : error.message}</p>}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {/* records */}
          <div className="space-y-4 lg:col-span-2">
            <Section title={t(lang, 'profileRecords')} aside={<span className="text-xs text-slate-500">{formatNumber(entry.events.length, lang)}</span>}>
              <Decades entry={entry} lang={lang} />
              <ol className="mt-3 divide-y divide-white/6">
                {entry.events.slice(0, limit).map((ev) => (
                  <li key={ev.id}>
                    <EventDetail
                      ev={ev}
                      lang={lang}
                      compact
                      onPerson={(name) => onOpen('person', personKey(name))}
                      onPlace={(name) => onOpen('place', placeKey(name))}
                      actions={{ showOnMap: actions.showOnMap, showInTimeline: actions.showInTimeline, contribute: actions.contribute }}
                    />
                  </li>
                ))}
              </ol>
              {entry.events.length > limit && (
                <div className="mt-3 text-center">
                  <button type="button" className="btn-ghost" onClick={() => setLimit((n) => n + PAGE)}>
                    {t(lang, 'loadMore')} ({formatNumber(entry.events.length - limit, lang)})
                  </button>
                </div>
              )}
            </Section>
          </div>

          {/* sidebar */}
          <div className="space-y-4">
            {related.people.length > 0 && (
              <Section title={t(lang, 'relatedPeople')}>
                <div className="flex flex-wrap gap-1.5">{related.people.map(([e, c]) => chip(e, c, 'person'))}</div>
              </Section>
            )}
            {related.places.length > 0 && (
              <Section title={t(lang, 'relatedPlaces')}>
                <div className="flex flex-wrap gap-1.5">{related.places.map(([e, c]) => chip(e, c, 'place'))}</div>
              </Section>
            )}

            <Section title={t(lang, 'possibleDuplicates')} help={t(lang, 'duplicatesHelp')}>
              {similar.length === 0 ? (
                <p className="text-xs text-slate-500">{t(lang, 'noDuplicates')}</p>
              ) : (
                <ul className="space-y-2">
                  {similar.map(({ entry: e, score }) => (
                    <li key={e.key} className="flex items-center gap-2">
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(kind, e.key)} title={t(lang, 'viewProfile')}>
                        <span className="block truncate text-sm text-slate-200">{e.name}</span>
                        <span className="flex items-center gap-2 text-[11px] text-slate-500">
                          <span className="h-1 w-16 overflow-hidden rounded bg-white/10">
                            <span className="block h-full bg-gold/70" style={{ width: `${Math.round(score * 100)}%` }} />
                          </span>
                          {Math.round(score * 100)}% · {e.events.length === 1 ? t(lang, 'recordsOne') : t(lang, 'records', e.events.length)}
                        </span>
                      </button>
                      <button type="button" className="chip border-gold/40 text-gold-soft hover:bg-gold/10" onClick={() => setCompare(e)}>
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
            </Section>

            <Section title={t(lang, 'changes')}>
              {changes.length === 0 ? (
                <p className="text-xs text-slate-500">{t(lang, 'noChanges')}</p>
              ) : (
                <ul className="space-y-2 text-xs">
                  {changes.map((c) => (
                    <li key={c.id} className="flex items-start gap-2">
                      <span className="min-w-0 flex-1">
                        <span className="block text-slate-200">{c.action === 'merge' ? t(lang, 'mergedInto', label(c.subject), label(c.target)) : t(lang, 'renamedTo', label(c.subject), c.target)}</span>
                        {c.note && <span className="block text-slate-400 italic">{c.note}</span>}
                        <span className="block text-slate-500">{t(lang, 'curatedBy', c.user_name, new Date(c.at).toLocaleDateString(lang === 'es' ? 'es-CR' : 'en-GB'))}</span>
                      </span>
                      {session.user && (
                        <button type="button" className="text-slate-500 hover:text-rose-300" disabled={busy} onClick={() => undo(c.id)}>
                          {t(lang, 'undo')}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
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

