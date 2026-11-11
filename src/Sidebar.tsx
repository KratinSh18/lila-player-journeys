import { memo, useMemo, useState } from 'react'
import {
  CATEGORY_LABEL,
  MAP_NAMES,
  type Category,
  type Manifest,
  type Match,
  formatClock,
  formatDay,
  formatStart,
} from './data'
import { HEAT_LAYERS, type HeatLayer } from './heatmap'
import { Glyph, PathSwatch } from './Legend'
import type { Layers } from './MapCanvas'

type SortKey = 'time' | 'duration' | 'kills' | 'loot'

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

const OUTCOME_LABEL = { killed: 'Died', storm: 'Storm', survived: 'Survived' }

export const Sidebar = memo(function Sidebar(p: Props) {
  const [sort, setSort] = useState<SortKey>('time')

  const sorted = useMemo(() => {
    const by: Record<SortKey, (m: Match) => number> = {
      time: (m) => -m.startedAt,
      duration: (m) => -m.duration,
      kills: (m) => -m.counts.kill,
      loot: (m) => -m.counts.loot,
    }
    return [...p.matches].sort((a, b) => by[sort](a) - by[sort](b))
  }, [p.matches, sort])

  const toggleDay = (day: string) => {
    const next = p.days.includes(day) ? p.days.filter((d) => d !== day) : [...p.days, day].sort()
    p.onDays(next.length ? next : p.manifest.days) // an empty filter would just show nothing
  }
  const setEvent = (c: Category, on: boolean) => p.onLayers({ ...p.layers, events: { ...p.layers.events, [c]: on } })
  const allDays = p.days.length === p.manifest.days.length

  return (
    <aside className="sidebar">
      <header className="brand">
        <h1>LILA BLACK</h1>
        <span>Player Journeys</span>
      </header>

      <section>
        <h2>Map</h2>
        <div className="segmented">
          {Object.entries(p.manifest.maps).map(([id, cfg]) => (
            <button key={id} className={id === p.mapId ? 'active' : ''} onClick={() => p.onMap(id)}>
              {MAP_NAMES[id] ?? id}
              <small>{cfg.matches}</small>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2>
          Dates <span className="muted">(UTC)</span>
          {!allDays && (
            <button className="link" onClick={() => p.onDays(p.manifest.days)}>
              all
            </button>
          )}
        </h2>
        <div className="chips">
          {p.manifest.days.map((day) => (
            <button
              key={day}
              className={allDays ? 'chip' : p.days.includes(day) ? 'chip active' : 'chip'}
              onClick={() => (allDays ? p.onDays([day]) : toggleDay(day))}
              title={allDays ? 'Show only this day' : 'Toggle this day'}
            >
              {formatDay(day)}
              <small>{p.dayCounts[day] ?? 0}</small>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2>Show</h2>
        <div className="toggles">
          <Toggle on={p.layers.humans} onChange={(humans) => p.onLayers({ ...p.layers, humans })}>
            <PathSwatch bot={false} /> Humans
          </Toggle>
          <Toggle on={p.layers.bots} onChange={(bots) => p.onLayers({ ...p.layers, bots })}>
            <PathSwatch bot /> Bots
          </Toggle>
          {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => (
            <Toggle key={c} on={p.layers.events[c]} onChange={(on) => setEvent(c, on)}>
              <Glyph category={c} /> {CATEGORY_LABEL[c]}
            </Toggle>
          ))}
          <Toggle on={p.layers.paths} onChange={(paths) => p.onLayers({ ...p.layers, paths })} disabled={!!p.selectedId}>
            All paths <span className="muted">(overview)</span>
          </Toggle>
          <Toggle on={p.layers.grid} onChange={(grid) => p.onLayers({ ...p.layers, grid })}>
            Grid A–J / 1–10
          </Toggle>
        </div>
      </section>

      <section>
        <h2>Heatmap</h2>
        <div className="segmented small">
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
          Matches <span className="muted">{p.loading ? 'loading…' : p.matches.length}</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort matches">
            <option value="time">Newest</option>
            <option value="duration">Longest</option>
            <option value="kills">Most kills</option>
            <option value="loot">Most loot</option>
          </select>
        </h2>
        {p.selectedId && (
          <button className="back" onClick={() => p.onSelect(null)}>
            ← Back to overview of all matches
          </button>
        )}
        <ul>
          {sorted.map((m) => {
            const human = m.journeys.find((j) => !j.bot)
            return (
              <li key={m.id}>
                <button className={m.id === p.selectedId ? 'match active' : 'match'} onClick={() => p.onSelect(m.id)}>
                  <div className="match-top">
                    <span>
                      {formatDay(m.day)} · {formatStart(m.startedAt)}
                    </span>
                    <span className="muted">{formatClock(m.duration)}</span>
                  </div>
                  <div className="match-bottom">
                    <span className="muted">
                      {m.humans}H{m.bots ? ` + ${m.bots}B` : ''}
                    </span>
                    <span>{m.counts.kill} kills</span>
                    <span>{m.counts.loot} loot</span>
                    {human && <span className={`badge ${human.outcome}`}>{OUTCOME_LABEL[human.outcome]}</span>}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      <details className="notes">
        <summary>About this data</summary>
        <ul>
          <li>{p.manifest.stats.files} files, {p.manifest.stats.rows.toLocaleString()} rows, {p.manifest.stats.matches} matches.</li>
          <li>Timestamps are stored as Unix seconds (typed as ms in parquet); playback time is seconds since the match's first event.</li>
          <li>{p.manifest.stats.reclassifiedJourneys} journeys with numeric ids are treated as humans because they emit human-only events.</li>
          <li>Most matches only include one human's file; bot journeys exist for a small subset of matches. Counts in the list are the human's events.</li>
          <li>"Survived" means no death was recorded; the data has no explicit extraction event.</li>
        </ul>
      </details>
    </aside>
  )
})

function Toggle({ on, onChange, disabled, children }: { on: boolean; onChange: (on: boolean) => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <label className={disabled ? 'toggle disabled' : 'toggle'}>
      <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  )
}
