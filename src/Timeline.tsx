import { CATEGORY, CATEGORY_LABEL, type Match, formatClock } from './data'
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
      <button className="play" onClick={onTogglePlay} title="Play / pause (space)" aria-label={playing ? 'Pause' : 'Play'}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
          {playing ? <path d="M3 2h3v10H3zM8 2h3v10H8z" fill="currentColor" /> : <path d="M3 1.5v11l9.5-5.5z" fill="currentColor" />}
        </svg>
      </button>
      <span className="clock">
        {formatClock(time)} <span className="muted">/ {formatClock(match.duration)}</span>
      </span>
      <div className="scrubber" style={{ '--progress': `${(Math.min(time, duration) / duration) * 100}%` } as React.CSSProperties}>
        <div className="ticks">
          {ticks.map((tick, i) => (
            <button
              key={i}
              className={tick.bot ? 'tick bot' : 'tick'}
              style={{ left: `${(tick.t / duration) * 100}%`, background: COLORS[tick.category] }}
              title={`${tick.bot ? 'Bot' : 'Human'}: ${CATEGORY_LABEL[tick.category].replace(/s$/, '').toLowerCase()} at ${formatClock(tick.t)}`}
              aria-label={`Jump to ${formatClock(tick.t)}`}
              onClick={() => onSeek(tick.t)}
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
