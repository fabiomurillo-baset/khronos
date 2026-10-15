import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { personKey } from '../lib/data.js'

// Order of the biographical fields on a person's profile.
export const FACT_FIELDS = ['born', 'bapt', 'origin', 'parents', 'spouse', 'marr', 'children', 'siblings', 'roles', 'residence', 'will', 'dead', 'deathPlace']

const PENCIL = (
  <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M4 14.5 13.5 5l2 2L6 16.5H4z" strokeLinejoin="round" />
  </svg>
)

function Evidence({ ids }) {
  if (!ids || ids.length === 0) return null
  return (
    <>
      {ids.slice(0, 3).map((id) => (
        <a key={id} href={`#r/${id}`} className="evidence" title={`#r/${id}`}>
          {id}
        </a>
      ))}
      {ids.length > 3 && <span className="evidence">+{ids.length - 3}</span>}
    </>
  )
}

/** One derived field as the facts file carries it: names with record ids, or years with one id. */
function Derived({ field, value, onOpen }) {
  if (!value) return null
  if (field === 'roles') return <span>{value.map(([role]) => role).join(' · ')}</span>
  if (field === 'age') return <span>{value.map(([hint]) => hint).join(' · ')}</span>
  if (['spouse', 'parents', 'children', 'siblings'].includes(field)) {
    return (
      <span>
        {value.map(([name, ids], i) => (
          <span key={name}>
            {i > 0 && <span className="text-label">, </span>}
            <button type="button" className="hover:text-rubric hover:underline" onClick={() => onOpen('person', personKey(name))} title={name}>
              {name.replace(/\s*\([^)]*\)\s*/g, ' ').trim()}
            </button>
            <Evidence ids={ids} />
          </span>
        ))}
      </span>
    )
  }
  if (['origin', 'residence'].includes(field)) {
    return (
      <span>
        {value.map(([place, ids], i) => (
          <span key={place}>
            {i > 0 && <span className="text-label">, </span>}
            {place}
            <Evidence ids={ids} />
          </span>
        ))}
      </span>
    )
  }
  return (
    <span>
      {value.map(([year, id, phrase], i) => (
        <span key={`${year}-${id}`}>
          {i > 0 && <span className="text-label">, </span>}
          {field === 'born' ? '≈ ' : field === 'dead' ? '≤ ' : ''}
          {year}
          {phrase && <span className="text-label"> ({phrase})</span>}
          <Evidence ids={id != null ? [id] : []} />
        </span>
      ))}
    </span>
  )
}

/**
 * "Datos": the biographical facts of a person as a key-value list. Derived facts come from
 * people.json with the ids of the records they were read from, shown as superscripts;
 * community facts (curation action 'fact') show first, with who added them. Signed-in users
 * get a pencil on each row and an "add" control at the end.
 */
export default function PersonFacts({ entry, lang, derived, community, session, actions, onOpen, onChanged }) {
  const [editing, setEditing] = useState(null)
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const rows = FACT_FIELDS.filter((f) => derived?.[f] || community?.[f] || editing === f)
  const canEdit = Boolean(session.user)

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

  const form = (field) => (
    <form
      className="mt-1.5 flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (value.trim()) save(field)
      }}
    >
      <input value={value} onChange={(e) => setValue(e.target.value)} className="field max-w-xs" maxLength={160} autoFocus placeholder={t(lang, 'factValue')} />
      <input value={note} onChange={(e) => setNote(e.target.value)} className="field max-w-xs" maxLength={200} placeholder={t(lang, 'factNote')} />
      <button type="submit" className="btn-primary" disabled={busy || !value.trim()}>
        {t(lang, 'save')}
      </button>
      <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>
        {t(lang, 'cancel')}
      </button>
    </form>
  )

  return (
    <div>
      {rows.length === 0 && !derived?.age && <p className="text-sm text-label">{t(lang, 'noFacts')}</p>}
      <dl className="text-[15px]">
        {rows.map((field) => {
          const c = community?.[field]
          const d = derived?.[field]
          return (
            <div key={field} className="group grid grid-cols-[7.5rem_1fr] gap-3 border-b border-rule py-2">
              <dt className="pt-0.5 text-[11px] tracking-wide text-label uppercase">{t(lang, `fact_${field}`)}</dt>
              <dd className="min-w-0 text-ink">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    {c && (
                      <div>
                        {c.value}
                        <span className="ml-2 text-[11px] text-label">
                          {t(lang, 'curatedBy', c.user)}
                          {c.note ? ` · ${c.note}` : ''}
                        </span>
                      </div>
                    )}
                    {d && (
                      <div className={c ? 'mt-0.5 text-xs text-label' : ''}>
                        {c && <span className="mr-1">{t(lang, 'derivedLabel')}:</span>}
                        <Derived field={field} value={d} onOpen={onOpen} />
                      </div>
                    )}
                  </div>
                  {canEdit && editing !== field && (
                    <button
                      type="button"
                      className="shrink-0 text-label opacity-0 transition hover:text-rubric focus:opacity-100 group-hover:opacity-100"
                      onClick={() => {
                        setEditing(field)
                        setValue(c?.value || '')
                      }}
                      aria-label={t(lang, 'editFact')}
                      title={t(lang, 'editFact')}
                    >
                      {PENCIL}
                    </button>
                  )}
                </div>
                {editing === field && form(field)}
              </dd>
            </div>
          )
        })}
        {derived?.age && (
          <div className="grid grid-cols-[7.5rem_1fr] gap-3 border-b border-rule py-2">
            <dt className="pt-0.5 text-[11px] tracking-wide text-label uppercase">{t(lang, 'fact_age')}</dt>
            <dd className="text-sm text-ink-light">
              <Derived field="age" value={derived.age} onOpen={onOpen} />
            </dd>
          </div>
        )}
      </dl>
      {canEdit && !editing && (
        <div className="mt-2">
          <select
            className="field max-w-[16rem] py-1 text-xs"
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
            {FACT_FIELDS.filter((f) => !rows.includes(f)).map((f) => (
              <option key={f} value={f}>
                {t(lang, `fact_${f}`)}
              </option>
            ))}
          </select>
        </div>
      )}
      {editing && !rows.includes(editing) && form(editing)}
      {error && <p className="mt-2 text-xs text-rubric">{error.status === 401 ? t(lang, 'sessionExpired') : error.message}</p>}
    </div>
  )
}
