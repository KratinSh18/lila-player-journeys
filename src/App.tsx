import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  MAP_NAMES,
  type Manifest,
  type Match,
  formatClock,
  formatDay,
  formatStart,
  loadManifest,
  loadMatches,
  shortId,
} from './data'
import { buildHeatmap, type HeatLayer } from './heatmap'
import { Legend } from './Legend'
import { MapCanvas, type Layers } from './MapCanvas'
import { Sidebar } from './Sidebar'
import { Timeline } from './Timeline'

// Map, match and time live in the URL hash so a designer can paste a link to a specific moment.
const initialUrl = new URLSearchParams(window.location.hash.slice(1))

const DEFAULT_LAYERS: Layers = {
  humans: true,
  bots: true,
  // The traffic heatmap already shows where people go; 800 overlapping paths
  // are better as an opt-in. Same for loot, which is ~13k markers.
  paths: false,
  grid: false,
  events: { kill: true, death: true, storm: true, loot: false },
}

export default function App() {
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mapId, setMapId] = useState(initialUrl.get('map') ?? 'AmbroseValley')
  const [mapMatches, setMapMatches] = useState<{ mapId: string; matches: Match[] } | null>(null)
  const [days, setDays] = useState<string[]>([])
  const [layers, setLayers] = useState<Layers>(DEFAULT_LAYERS)
  // Separate heatmap choice for the overview and for a single match: under one
  // match's path a traffic heatmap is mostly noise, so it starts off there.
  const [heatByMode, setHeatByMode] = useState<{ overview: HeatLayer; match: HeatLayer }>({ overview: 'traffic', match: 'off' })
  const [heatOpacity, setHeatOpacity] = useState(0.65)
  const [selectedId, setSelectedId] = useState<string | null>(initialUrl.get('match'))
  const [time, setTime] = useState(Number(initialUrl.get('t')) || 0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(10)
  const timeRef = useRef(time)

  useEffect(() => {
    loadManifest()
      .then((m) => {
        if (!m.maps[mapId]) setMapId(Object.keys(m.maps)[0])
        setDays(m.days)
        setManifest(m)
      })
      .catch((e) => setError(String(e)))
  }, []) // once on startup; mapId here is only checked against the manifest

  useEffect(() => {
    let current = true
    loadMatches(mapId)
      .then((matches) => current && setMapMatches({ mapId, matches }))
      .catch((e) => current && setError(String(e)))
    return () => {
      current = false
    }
  }, [mapId])

  const allMatches = mapMatches?.mapId === mapId ? mapMatches.matches : []
  const loading = mapMatches?.mapId !== mapId
  const matches = useMemo(() => allMatches.filter((m) => days.includes(m.day)), [allMatches, days])
  const dayCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const m of allMatches) counts[m.day] = (counts[m.day] ?? 0) + 1
    return counts
  }, [allMatches])
  const match = useMemo(() => allMatches.find((m) => m.id === selectedId) ?? null, [allMatches, selectedId])
  const heatLayer = heatByMode[match ? 'match' : 'overview']
  const setHeatLayer = useCallback(
    (layer: HeatLayer) => setHeatByMode((prev) => ({ ...prev, [match ? 'match' : 'overview']: layer })),
    [match],
  )

  const heat = useMemo(() => {
    if (heatLayer === 'off' || !manifest) return null
    return buildHeatmap(matches, heatLayer, { humans: layers.humans, bots: layers.bots }, manifest.mapSize)
  }, [matches, heatLayer, layers.humans, layers.bots, manifest])

  const seek = useCallback((t: number) => {
    timeRef.current = t
    setTime(t)
  }, [])

  // A shared link without ?t= should open on the finished match, same as clicking it in the list.
  const pendingLinkMatch = useRef(selectedId !== null && !initialUrl.has('t'))
  useEffect(() => {
    if (match && pendingLinkMatch.current) {
      pendingLinkMatch.current = false
      seek(match.duration)
    }
  }, [match, seek])

  // Playback: advance match time by real time * speed on every animation frame.
  useEffect(() => {
    if (!playing || !match) return
    let last = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const next = Math.min(match.duration, timeRef.current + ((now - last) / 1000) * speed)
      last = now
      seek(next)
      if (next >= match.duration) setPlaying(false)
      else frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, speed, match, seek])

  const togglePlay = useCallback(() => {
    if (!match) return
    if (!playing && timeRef.current >= match.duration) seek(0)
    setPlaying(!playing)
  }, [match, playing, seek])

  const selectMatch = useCallback(
    (id: string | null) => {
      setSelectedId(id)
      setPlaying(false)
      // Open on the finished match so the whole story is visible; play rewinds to 0.
      const m = allMatches.find((x) => x.id === id)
      seek(m ? m.duration : 0)
    },
    [allMatches, seek],
  )

  const openEvent = useCallback(
    (id: string, t: number) => {
      if (id === selectedId) {
        setPlaying(false)
        seek(t)
        return
      }
      // From the overview: open that match a little before the event and let it play into it.
      setSelectedId(id)
      seek(Math.max(0, t - 20))
      setPlaying(true)
    },
    [selectedId, seek],
  )

  const changeMap = useCallback(
    (id: string) => {
      if (id === mapId) return
      setMapId(id)
      setSelectedId(null)
      setPlaying(false)
    },
    [mapId],
  )

  useEffect(() => {
    const params = new URLSearchParams({ map: mapId })
    if (match) {
      params.set('match', match.id)
      if (!playing) params.set('t', String(Math.round(time)))
    }
    if (!playing) window.history.replaceState(null, '', `#${params}`)
  }, [mapId, match, time, playing])

  // Keyboard: space = play/pause, arrows = step 5s, escape = back to overview
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!match || (e.target as HTMLElement).closest('input, select, textarea')) return
      if (e.key === ' ') {
        e.preventDefault()
        togglePlay()
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault()
        seek(Math.min(match.duration, Math.max(0, timeRef.current + (e.key === 'ArrowRight' ? 5 : -5))))
      } else if (e.key === 'Escape') {
        selectMatch(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [match, togglePlay, seek, selectMatch])

  if (error) return <div className="fatal">Couldn't load data: {error}</div>
  if (!manifest) return <div className="fatal">Loading…</div>

  const config = manifest.maps[mapId]
  const dayLabel =
    days.length === manifest.days.length
      ? 'all days'
      : days.length === 1
        ? formatDay(days[0])
        : `${days.length} days`
  const human = match?.journeys.find((j) => !j.bot)

  return (
    <div className="app">
      <Sidebar
        manifest={manifest}
        mapId={mapId}
        onMap={changeMap}
        days={days}
        dayCounts={dayCounts}
        onDays={setDays}
        layers={layers}
        onLayers={setLayers}
        heatLayer={heatLayer}
        onHeatLayer={setHeatLayer}
        heatOpacity={heatOpacity}
        onHeatOpacity={setHeatOpacity}
        matches={matches}
        loading={loading}
        selectedId={match?.id ?? null}
        onSelect={selectMatch}
      />

      <main>
        <div className="topbar">
          {match ? (
            <>
              <button className="back" onClick={() => selectMatch(null)} title="Back to overview (Esc)">
                ←
              </button>
              <div>
                <strong>Match {shortId(match.id)}</strong>
                <span className="muted">
                  {' '}
                  · {MAP_NAMES[mapId]} · {formatDay(match.day)} {formatStart(match.startedAt)} UTC · {formatClock(match.duration)} ·{' '}
                  {match.humans} human{match.humans === 1 ? '' : 's'}, {match.bots} bot journey{match.bots === 1 ? '' : 's'}
                  {human && ` · human ${human.outcome === 'survived' ? 'survived' : human.outcome === 'storm' ? 'died to storm' : 'was killed'}`}
                </span>
              </div>
              <button className="ghost" onClick={() => navigator.clipboard?.writeText(window.location.href)} title="Copy a link to this match and moment">
                Copy link
              </button>
            </>
          ) : (
            <div>
              <strong>{MAP_NAMES[mapId]}</strong>
              <span className="muted">
                {' '}
                · {matches.length} matches · {dayLabel} · hover a marker for details, click it to replay that match
              </span>
            </div>
          )}
        </div>

        <div className="stage">
          <MapCanvas
          config={config}
          mapSize={manifest.mapSize}
          matches={matches}
          match={match}
          time={time}
          layers={layers}
          heat={heat}
          heatOpacity={heatOpacity}
          onOpenEvent={openEvent}
        />

          <Legend events={layers.events} heatLayer={heatLayer} heatSamples={heat?.samples ?? null} scopeLabel={`${matches.length} matches, ${dayLabel}`} />
        </div>

        {match && (
          <Timeline
            match={match}
            time={time}
            playing={playing}
            speed={speed}
            onSeek={(t) => {
              setPlaying(false)
              seek(t)
            }}
            onTogglePlay={togglePlay}
            onSpeed={setSpeed}
          />
        )}
      </main>
    </div>
  )
}
