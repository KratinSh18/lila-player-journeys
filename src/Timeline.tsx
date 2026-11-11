import { CATEGORY, type Match, formatClock } from './data'
import { COLORS } from './markers'

export const SPEEDS = [1, 5, 10, 20, 40]

interface Props {
  match: Match
  time: number
  playing: boolean
  speed: number
  onSeek: (t: number) => void
  onTogglePlay: () => void
  onSpeed: (speed: number) => void
}

export function Timeline({ match, time, playing, speed, onSeek, onTogglePlay, onSpeed }: Props) {
  const duration = Math.max(match.duration, 1)
  // Ticks above the scrubber so you can jump straight to the fights.
  const ticks = match.journeys.flatMap((j) =>
    j.events.filter((e) => CATEGORY[e[1]] !== 'loot').map((e) => ({ t: e[0], category: CATEGORY[e[1]], bot: j.bot })),
  )

  return (
    <div className="timeline">
      <button className="play" onClick={onTogglePlay} title="Play / pause (space)">
        {playing ? '❚❚' : '▶'}
      </button>
      <span className="clock">
        {formatClock(time)} <span className="muted">/ {formatClock(match.duration)}</span>
      </span>
      <div className="scrubber">
        <div className="ticks">
          {ticks.map((tick, i) => (
            <span
              key={i}
              className={tick.bot ? 'tick bot' : 'tick'}
              style={{ left: `${(tick.t / duration) * 100}%`, background: COLORS[tick.category] }}
              title={`${tick.category} at ${formatClock(tick.t)}`}
            />
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={duration}
          step={0.1}
          value={Math.min(time, duration)}
          onChange={(e) => onSeek(Number(e.target.value))}
          aria-label="Match time"
        />
      </div>
      <select value={speed} onChange={(e) => onSpeed(Number(e.target.value))} title="Playback speed">
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>
    </div>
  )
}
