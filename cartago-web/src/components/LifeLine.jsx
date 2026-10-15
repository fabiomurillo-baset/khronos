import { useMemo } from 'react'

/**
 * A person's life as one line: a tick per record year and a labelled dot per milestone.
 * Milestones come from the derived facts (first record, marriage/dowry, will, death); a person
 * with one record shows one tick, which is the honest picture.
 */
export default function LifeLine({ records, derived, lang }) {
  const model = useMemo(() => {
    const years = records.map((ev) => ev.year).filter((y) => y != null)
    if (years.length === 0) return null
    const milestones = []
    const add = (year, label) => {
      if (year == null || milestones.some((m) => m.year === year)) return
      milestones.push({ year, label })
    }
    const first = (field) => (derived?.[field] || []).map((x) => x[0]).filter((y) => Number.isFinite(y)).sort((a, b) => a - b)[0]
    add(first('born'), lang === 'es' ? 'nace' : 'born')
    add(first('marr'), lang === 'es' ? 'dote' : 'dowry')
    add(first('will'), lang === 'es' ? 'testamento' : 'will')
    add(first('dead'), lang === 'es' ? 'difunto' : 'deceased')
    const all = [...years, ...milestones.map((m) => m.year)]
    const y0 = Math.min(...all) - 2
    const y1 = Math.max(...all) + 2
    const span = Math.max(1, y1 - y0)
    const X = (y) => 32 + ((y - y0) / span) * 736
    return { years: [...new Set(years)], milestones: milestones.sort((a, b) => a.year - b.year), X, y0: Math.min(...all), y1: Math.max(...all) }
  }, [records, derived, lang])
  if (!model) return null
  const { years, milestones, X, y0, y1 } = model
  return (
    <svg viewBox="0 0 800 76" className="block h-auto w-full" role="img" aria-label={`${y0} – ${y1}`}>
      <line x1="32" y1="40" x2="768" y2="40" stroke="var(--color-rule)" strokeWidth="2" />
      {years.map((y) => (
        <line key={y} x1={X(y)} y1="34" x2={X(y)} y2="46" stroke="var(--color-rubric)" strokeWidth="2">
          <title>{y}</title>
        </line>
      ))}
      {milestones.map((m, i) => (
        <g key={m.year}>
          <circle cx={X(m.year)} cy="40" r="5" fill="var(--color-rubric)" />
          <text x={X(m.year)} y={i % 2 === 0 ? 22 : 66} textAnchor="middle" fontSize="11" fontFamily="var(--font-mono)" fill="var(--color-ink-light)">
            {m.label} · {m.year}
          </text>
        </g>
      ))}
      <text x="32" y="74" fontSize="11" fontFamily="var(--font-mono)" fill="var(--color-label)">
        {y0}
      </text>
      <text x="768" y="74" fontSize="11" fontFamily="var(--font-mono)" fill="var(--color-label)" textAnchor="end">
        {y1}
      </text>
    </svg>
  )
}
