import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { personKey } from '../lib/data.js'

// Order and labels of the biographical fields shown on a person's profile.
export const FACT_FIELDS = ['born', 'bapt', 'origin', 'parents', 'spouse', 'marr', 'children', 'siblings', 'roles', 'residence', 'will', 'dead', 'deathPlace']

const EDITABLE = new Set(FACT_FIELDS)

function Evidence({ ids }) {
  if (!ids || ids.length === 0) return null
  return (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
      {ids.slice(0, 4).map((id) => (
        <a key={id} href={`#r/${id}`} className="rounded bg-white/5 px-1 font-mono text-[10px] text-slate-400 hover:text-gold-soft" title={`#r/${id}`}>
          #{id}
        </a>
      ))}
      {ids.length > 4 && <span className="text-[10px] text-slate-500">+{ids.length - 4}</span>}
    </span>
  )
}

/** Values of one field as the facts file carries them: names with record ids, or years with one id. */
function DerivedValue({ field, value, onOpen }) {
  if (!value) return null
  if (field === 'roles') return <span className="text-slate-200">{value.map(([role]) => role).join(' · ')}</span>
  if (field === 'age') return <span className="text-slate-200">{value.map(([hint]) => hint).join(' · ')}</span>
  if (['spouse', 'parents', 'children', 'siblings'].includes(field)) {
    return (
      <span className="flex flex-wrap gap-x-2 gap-y-1">
        {value.map(([name, ids]) => (
          <span key={name} className="text-slate-200">
            <button type="button" className="hover:text-gold-soft hover:underline" onClick={() => onOpen('person', personKey(name))}>
              {name}
            </button>
            <Evidence ids={ids} />
          </span>
        ))}
      </span>
    )
  }
  if (['origin', 'residence'].includes(field)) {
    return (
      <span className="flex flex-wrap gap-x-2 gap-y-1">
        {value.map(([place, ids]) => (
          <span key={place} className="text-slate-200">
            {place}
            <Evidence ids={ids} />
          </span>
        ))}
      </span>
    )
  }
  // year-based: born [year, id, phrase] · bapt/marr/will/dead [year, id]
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-1">
      {value.map(([year, id, phrase]) => (
        <span key={`${year}-${id}`} className="text-slate-200">
          {field === 'born' ? '≈ ' : field === 'dead' ? '≤ ' : ''}
          {year}
          {phrase && <span className="text-slate-500"> ({phrase})</span>}
          <Evidence ids={id != null ? [id] : []} />
        </span>
      ))}
    </span>
  )
}

/**
 * "Datos personales": biographical facts of a person. Derived facts come from the records
 * (people.json, each with the ids of the records it was read from); community facts are
 * curation entries of action 'fact' and are shown first, with who added them.
 */
export default function PersonFacts({ entry, lang, derived, community, session, actions, onOpen, onChanged }) {
  const [editing, setEditing] = useState(null) // field being edited
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const rows = FACT_FIELDS.map((field) => ({ field, derived: derived?.[field], community: community?.[field] })).filter(
    (r) => r.derived || r.community || editing === r.field,
  )
  const hasAnything = rows.length > 0 || derived?.age

  async function save(field) {
    setBusy(true)
    setError(null)
    try {
      await actions.curate({ kind: 'person', action: 'fact', subject: entry.key, target: JSON.stringify({ field, value: value.trim() }), note: note.trim() || null })
      setEditing(null)
      setValue('')
      setNote('')
      onChanged?.()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="glass-panel p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-base font-semibold text-slate-100">{t(lang, 'facts')}</h3>
        {session.user && !editing && (
          <select
            className="field max-w-[14rem] py-1 text-xs"
            value=""
            onChange={(e) => {
              if (e.target.value) {
                setEditing(e.target.value)
                setValue('')
              }
            }}
            aria-label={t(lang, 'addFact')}
          >
            <option value="">{t(lang, 'addFact')}</option>
            {FACT_FIELDS.filter((f) => EDITABLE.has(f)).map((f) => (
              <option key={f} value={f}>
                {t(lang, `fact_${f}`)}
              </option>
            ))}
          </select>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500">{t(lang, 'factsHelp')}</p>

      {!hasAnything && <p className="mt-3 text-sm text-slate-500">{t(lang, 'noFacts')}</p>}

      <dl className="mt-3 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
        {rows.map(({ field, derived: d, community: c }) => (
          <div key={field} className="contents">
            <dt className="text-[11px] tracking-wide text-slate-500 uppercase sm:pt-0.5">{t(lang, `fact_${field}`)}</dt>
            <dd className="min-w-0">
              {c && (
                <div className="text-slate-100">
                  {c.value}
                  <span className="ml-2 text-[11px] text-slate-500">
                    {t(lang, 'curatedBy', c.user)}
                    {c.note ? ` · ${c.note}` : ''}
                  </span>
                </div>
              )}
              {d && (
                <div className={c ? 'mt-1 text-xs text-slate-400' : ''}>
                  {c && <span className="mr-1 text-[11px] text-slate-500">{t(lang, 'derivedLabel')}:</span>}
                  <DerivedValue field={field} value={d} onOpen={onOpen} />
                </div>
              )}
              {editing === field && (
                <form
                  className="mt-2 flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (value.trim()) save(field)
                  }}
                >
                  <input value={value} onChange={(e) => setValue(e.target.value)} className="field max-w-xs" maxLength={160} autoFocus placeholder={t(lang, 'factValue')} />
                  <input value={note} onChange={(e) => setNote(e.target.value)} className="field max-w-xs" maxLength={200} placeholder={t(lang, 'factNote')} />
                  <button type="submit" className="btn-ghost border border-gold/50 text-gold-soft" disabled={busy || !value.trim()}>
                    {t(lang, 'save')}
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>
                    {t(lang, 'cancel')}
                  </button>
                </form>
              )}
            </dd>
          </div>
        ))}
        {derived?.age && !rows.some((r) => r.field === 'age') && (
          <div className="contents">
            <dt className="text-[11px] tracking-wide text-slate-500 uppercase">{t(lang, 'fact_age')}</dt>
            <dd>
              <DerivedValue field="age" value={derived.age} onOpen={onOpen} />
            </dd>
          </div>
        )}
      </dl>
      {error && <p className="mt-2 text-xs text-rose-300">{error.status === 401 ? t(lang, 'sessionExpired') : error.message}</p>}
    </section>
  )
}
