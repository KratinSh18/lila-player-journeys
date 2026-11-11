import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  CATEGORY_LABEL,
  MAP_NAMES,
  type Category,
  type Journey,
  type Manifest,
  type Match,
  formatClock,
  formatDay,
  formatStart,
  humanOutcome,
} from './data'
import { HEAT_LAYERS, type HeatLayer } from './heatmap'
import { Glyph, PathSwatch } from './Legend'
import type { Layers } from './MapCanvas'
import { COLORS } from './markers'

type SortKey = 'time' | 'longest' | 'shortest' | 'kills' | 'loot'
type OutcomeFilter = 'all' | Journey['outcome']

interface Props {
  manifest: Manifest
  mapId: string
  onMap: (id: string) => void
  days: string[]
  dayCounts: Record<string, number>
  onDays: (days: string[]) => void
  layers: Layers
  onLayers: (layers: Layers) => void
  heatLayer: HeatLayer
  onHeatLayer: (layer: HeatLayer) => void
  heatOpacity: number
  onHeatOpacity: (opacity: number) => void
  matches: Match[]
  loading: boolean
  selectedId: string | null
  onSelect: (id: string | null) => void
}

export const OUTCOME_LABEL = { killed: 'Died', storm: 'Storm', survived: 'Survived' }

export const Sidebar = memo(function Sidebar(p: Props) {
  const listRef = useRef<HTMLUListElement>(null)
  const [sort, setSort] = useState<SortKey>('time')
  const [outcome, setOutcome] = useState<OutcomeFilter>('all')

  const listed = useMemo(() => {
    const by: Record<SortKey, (m: Match) => number> = {
      time: (m) => -m.startedAt,
      longest: (m) => -m.duration,
      shortest: (m) => m.duration,
      kills: (m) => -m.counts.kill,
      loot: (m) => -m.counts.loot,
    }
    const shown = outcome === 'all' ? p.matches : p.matches.filter((m) => humanOutcome(m) === outcome)
    return [...shown].sort((a, b) => by[sort](a) - by[sort](b))
  }, [p.matches, sort, outcome])

  // Opening a match from the map or a shared link: bring its row into view.
  useEffect(() => {
    listRef.current?.querySelector('.match.active')?.scrollIntoView({ block: 'nearest' })
  }, [p.selectedId, listed])

  const allDays = p.days.length === p.manifest.days.length
  const clickDay = (day: string) => {
    if (allDays) return p.onDays([day]) // first click narrows to that day
    const next = p.days.includes(day) ? p.days.filter((d) => d !== day) : [...p.days, day].sort()
    p.onDays(next.length ? next : p.manifest.days) // an empty filter would just show nothing
  }
  const setEvent = (c: Category) => p.onLayers({ ...p.layers, events: { ...p.layers.events, [c]: !p.layers.events[c] } })

  return (
    <aside className="sidebar">
      <header className="brand">
        <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden>
          <rect width="32" height="32" rx="7" fill="#1c232b" />
          <path d="M6 24 L13 12 L19 18 L26 7" stroke="#53d1f0" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="26" cy="7" r="3" fill="#ff4d5a" />
        </svg>
        <div>
          <h1>LILA BLACK</h1>
          <span>Player Journeys</span>
        </div>
      </header>

      <section>
        <h2>Map</h2>
        <div className="map-picker">
          {Object.entries(p.manifest.maps).map(([id, cfg]) => (
            <button key={id} className={id === p.mapId ? 'map-card active' : 'map-card'} onClick={() => p.onMap(id)}>
              <img src={cfg.thumb} alt="" width={48} height={48} />
              <span>{MAP_NAMES[id] ?? id}</span>
              <small>{cfg.matches} matches</small>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2>
          Dates <span className="muted">UTC</span>
          {!allDays && (
            <button className="link" onClick={() => p.onDays(p.manifest.days)}>
              Show all
            </button>
          )}
        </h2>
        <div className="chips">
          {p.manifest.days.map((day) => (
            <button
              key={day}
              className={!allDays && p.days.includes(day) ? 'chip active' : 'chip'}
              aria-pressed={!allDays && p.days.includes(day)}
              disabled={!p.dayCounts[day]}
              onClick={() => clickDay(day)}
              title={!p.dayCounts[day] ? 'No matches on this map that day' : allDays ? 'Show only this day' : 'Add or remove this day'}
            >
              {formatDay(day)}
              <small>{p.dayCounts[day] ?? 0}</small>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2>Show</h2>
        <div className="pills">
          {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => (
            <Pill key={c} on={p.layers.events[c]} onClick={() => setEvent(c)} title={CATEGORY_LABEL[c]}>
              <Glyph category={c} size={15} /> {c === 'storm' ? 'Storm' : CATEGORY_LABEL[c]}
            </Pill>
          ))}
        </div>
        <div className="pills">
          <Pill on={p.layers.humans} onClick={() => p.onLayers({ ...p.layers, humans: !p.layers.humans })}>
            <PathSwatch bot={false} /> Humans
          </Pill>
          <Pill on={p.layers.bots} onClick={() => p.onLayers({ ...p.layers, bots: !p.layers.bots })}>
            <PathSwatch bot /> Bots
          </Pill>
          <Pill
            on={p.layers.paths && !p.selectedId}
            disabled={!!p.selectedId}
            onClick={() => p.onLayers({ ...p.layers, paths: !p.layers.paths })}
            title={p.selectedId ? 'Only in the overview' : 'Draw every journey that passes the filters'}
          >
            All paths
          </Pill>
          <Pill on={p.layers.grid} onClick={() => p.onLayers({ ...p.layers, grid: !p.layers.grid })} title="Grid A–J / 1–10 for referring to places">
            Grid
          </Pill>
        </div>
      </section>

      <section>
        <h2>Heatmap</h2>
        <div className="segmented">
          {HEAT_LAYERS.map((l) => (
            <button key={l.id} className={l.id === p.heatLayer ? 'active' : ''} onClick={() => p.onHeatLayer(l.id)}>
              {l.label}
            </button>
          ))}
        </div>
        {p.heatLayer !== 'off' && (
          <label className="slider">
            Opacity
            <input type="range" min={0.2} max={1} step={0.05} value={p.heatOpacity} onChange={(e) => p.onHeatOpacity(Number(e.target.value))} />
          </label>
        )}
      </section>

      <section className="matches">
        <h2>
          Matches <span className="count">{p.loading ? '…' : listed.length}</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort matches">
            <option value="time">Newest</option>
            <option value="longest">Longest</option>
            <option value="shortest">Shortest</option>
            <option value="kills">Most kills</option>
            <option value="loot">Most loot</option>
          </select>
        </h2>
        <div className="segmented outcome">
          {(['all', 'killed', 'storm', 'survived'] as const).map((o) => (
            <button key={o} className={o === outcome ? 'active' : ''} onClick={() => setOutcome(o)}>
              {o === 'all' ? 'All' : OUTCOME_LABEL[o]}
            </button>
          ))}
        </div>
        <ul ref={listRef}>
          {listed.map((m) => {
            const result = humanOutcome(m)
            return (
              <li key={m.id}>
                <button className={`match ${result ?? ''}${m.id === p.selectedId ? ' active' : ''}`} onClick={() => p.onSelect(m.id)}>
                  <span className="match-when">
                    {formatStart(m.startedAt)} <small>{formatDay(m.day)}</small>
                  </span>
                  <span className="match-len">{formatClock(m.duration)}</span>
                  <span className="match-stats">
                    <span title="Kills by the human">
                      <MiniIcon kind="kill" />
                      {m.counts.kill}
                    </span>
                    <span title="Loot picked up">
                      <MiniIcon kind="loot" />
                      {m.counts.loot}
                    </span>
                    {m.bots > 0 && <span className="muted">+{m.bots} bot paths</span>}
                  </span>
                  {result && <span className={`badge ${result}`}>{OUTCOME_LABEL[result]}</span>}
                </button>
              </li>
            )
          })}
          {!p.loading && listed.length === 0 && <li className="empty">No matches for these filters.</li>}
        </ul>
      </section>

      <details className="notes">
        <summary>About this data</summary>
        <ul>
          <li>
            {p.manifest.stats.files.toLocaleString()} files, {p.manifest.stats.rows.toLocaleString()} rows, {p.manifest.stats.matches} matches.
          </li>
          <li>Timestamps are Unix seconds (stored with a millisecond type). Playback time counts from the match's first event.</li>
          <li>{p.manifest.stats.reclassifiedJourneys} files with numeric (bot-style) ids are treated as humans because they move and loot like players. They may be test or autoplay accounts.</li>
          <li>Most matches only include one human's file, and bot paths exist for about 50 matches, so the overview hides bots until you turn them on. Counts in this list are the human's events.</li>
          <li>"Survived" means no death was recorded. There is no explicit extraction event in the data.</li>
          <li>14 Feb is a partial day (the data stops at 15:01 UTC), so its lower counts aren't a drop in play.</li>
        </ul>
      </details>
    </aside>
  )
})

/** Tiny static versions of the map markers, cheap enough for hundreds of list rows. */
function MiniIcon({ kind }: { kind: 'kill' | 'loot' }) {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden className="mini-icon">
      {kind === 'kill' ? (
        <g stroke={COLORS.kill} strokeWidth="1.6" fill="none">
          <circle cx="6" cy="6" r="3.4" />
          <path d="M6 0.5v3M6 8.5v3M0.5 6h3M8.5 6h3" />
        </g>
      ) : (
        <rect x="2.5" y="2.5" width="7" height="7" rx="1" fill={COLORS.loot} />
      )}
    </svg>
  )
}

function Pill(props: { on: boolean; onClick: () => void; disabled?: boolean; title?: string; children: React.ReactNode }) {
  return (
    <button type="button" className={props.on ? 'pill on' : 'pill'} aria-pressed={props.on} disabled={props.disabled} onClick={props.onClick} title={props.title}>
      {props.children}
    </button>
  )
}
