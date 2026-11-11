import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MAP_NAMES, type Manifest, type Match, formatDay, loadManifest, loadMatches } from './data'
import { buildHeatmap, type HeatLayer } from './heatmap'
import { Legend } from './Legend'
import { MapCanvas, type Layers } from './MapCanvas'
import { Sidebar } from './Sidebar'
import { Timeline } from './Timeline'
import { TopBar } from './TopBar'

// Map, match and time live in the URL hash so a designer can paste a link to a specific moment.
const initialUrl = new URLSearchParams(window.location.hash.slice(1))

const DEFAULT_LAYERS: Omit<Layers, 'bots'> = {
  humans: true,
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
  const [baseLayers, setBaseLayers] = useState(DEFAULT_LAYERS)
  // Two settings differ between the overview and a single match, so each mode
  // keeps its own. Bot paths exist for only ~50 of 796 matches, which would
  // skew the overview's heatmaps, so bots start hidden there and shown in a
  // match. A traffic heatmap under one match's path is mostly noise, so it
  // starts off in a match.
  const [botsByMode, setBotsByMode] = useState({ overview: false, match: true })
  const [heatByMode, setHeatByMode] = useState<{ overview: HeatLayer; match: HeatLayer }>({ overview: 'traffic', match: 'off' })
  const [heatOpacity, setHeatOpacity] = useState(0.65)
  const [selectedId, setSelectedId] = useState<string | null>(initialUrl.get('match'))
  const [time, setTime] = useState(Number(initialUrl.get('t')) || 0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(10)
  const timeRef = useRef(time)
  const stopAt = useRef<number | null>(null) // set when replaying up to a clicked event

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
  const mode = match ? 'match' : 'overview'
  const layers: Layers = useMemo(() => ({ ...baseLayers, bots: botsByMode[mode] }), [baseLayers, botsByMode, mode])
  const setLayers = useCallback(
    ({ bots, ...rest }: Layers) => {
      setBaseLayers(rest)
      setBotsByMode((prev) => ({ ...prev, [mode]: bots }))
    },
    [mode],
  )
  const heatLayer = heatByMode[mode]
  const setHeatLayer = useCallback((layer: HeatLayer) => setHeatByMode((prev) => ({ ...prev, [mode]: layer })), [mode])

  const heat = useMemo(() => {
    if (heatLayer === 'off' || !manifest) return null
    return buildHeatmap(matches, heatLayer, { humans: layers.humans, bots: layers.bots }, manifest.mapSize)
  }, [matches, heatLayer, layers.humans, layers.bots, manifest])

  const setClock = useCallback((t: number) => {
    timeRef.current = t
    setTime(t)
  }, [])
  // A user-driven jump. It cancels any "stop at the clicked event".
  const seek = useCallback(
    (t: number) => {
      stopAt.current = null
      setClock(t)
    },
    [setClock],
  )

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
      const end = Math.min(match.duration, stopAt.current ?? Infinity)
      const next = Math.min(end, timeRef.current + ((now - last) / 1000) * speed)
      last = now
      setClock(next)
      if (next >= end) {
        stopAt.current = null
        setPlaying(false)
      } else frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, speed, match, setClock])

  const togglePlay = useCallback(() => {
    if (!match) return
    stopAt.current = null
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
      pendingLinkMatch.current = false
      if (id === selectedId) {
        setPlaying(false)
        seek(t)
        return
      }
      // From the overview: open that match 20 s before the event, play up to it and pause there.
      setSelectedId(id)
      seek(Math.max(0, t - 20))
      stopAt.current = t
      setPlaying(true)
    },
    [selectedId, seek],
  )

  const changeMap = useCallback(
    (id: string) => {
      if (id === mapId) return
      pendingLinkMatch.current = false
      setMapId(id)
      setSelectedId(null)
      setPlaying(false)
    },
    [mapId],
  )

  const shareUrl = useMemo(() => {
    const params = new URLSearchParams({ map: mapId })
    if (selectedId) {
      params.set('match', selectedId)
      params.set('t', String(Math.round(time)))
    }
    return `#${params}`
  }, [mapId, selectedId, time])

  // Mirror state into the address bar, but not 60 times a second during playback.
  useEffect(() => {
    if (!playing && window.location.hash !== shareUrl) window.history.replaceState(null, '', shareUrl)
  }, [shareUrl, playing])

  // Keyboard: space = play/pause, arrows = step 5s, escape = back to overview
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      // The timeline's own slider and speed menu keep focus after use; the shortcuts should still work there.
      if (!match || (el.closest('input, select, textarea') && !el.closest('.timeline'))) return
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
      ? `${formatDay(manifest.days[0])} – ${formatDay(manifest.days[manifest.days.length - 1])}`
      : days.map(formatDay).join(', ')
  const scope = `${dayLabel} · ${layers.humans && layers.bots ? 'humans and bots' : layers.humans ? 'humans only' : layers.bots ? 'bots only' : 'no players shown'}`

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
        <TopBar
          mapName={MAP_NAMES[mapId] ?? mapId}
          scope={scope}
          matches={matches}
          match={match}
          shareUrl={window.location.origin + window.location.pathname + shareUrl}
          onBack={() => selectMatch(null)}
        />

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
          <Legend
            events={layers.events}
            playback={!!match}
            heatLayer={heatLayer}
            heatSamples={heat?.samples ?? null}
            scopeLabel={`${matches.length} matches, ${dayLabel}, ${layers.humans && layers.bots ? 'humans + bots' : layers.bots ? 'bots' : 'humans'}`}
          />
          {!match && <FirstRunTip />}
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

const TIP_KEY = 'lila-journeys-tip-dismissed'

/** A short "how to use this" card, shown until someone closes it. */
function FirstRunTip() {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(TIP_KEY) !== '1'
    } catch {
      return true
    }
  })
  if (!open) return null
  const close = () => {
    setOpen(false)
    try {
      localStorage.setItem(TIP_KEY, '1')
    } catch {
      // private mode etc. The tip just comes back next visit.
    }
  }
  return (
    <div className="tip">
      <strong>Reading the map</strong>
      <ol>
        <li>The heatmap shows where players spend their time. Switch it to Kills or Deaths on the left.</li>
        <li>Hover any marker to see who, when and where. Click it to replay that match from just before.</li>
        <li>Pick a match from the list to watch it play out. Scroll to zoom, drag to pan.</li>
      </ol>
      <button onClick={close}>Got it</button>
    </div>
  )
}
