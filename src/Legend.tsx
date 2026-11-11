import { useEffect, useRef } from 'react'
import { CATEGORY_LABEL, type Category } from './data'
import type { HeatLayer } from './heatmap'
import { COLORS, drawHead, drawMarker } from './markers'

/** Tiny canvas that renders a marker with the exact same code the map uses. */
export function Glyph({ category, bot, size = 18 }: { category?: Category; bot?: boolean; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current!
    const dpr = window.devicePixelRatio || 1
    canvas.width = size * dpr
    canvas.height = size * dpr
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    const c = size / 2
    if (category) drawMarker(ctx, category, c, c, size * 0.27)
    else drawHead(ctx, !!bot, c, c)
  }, [category, bot, size])
  return <canvas ref={ref} className="glyph" style={{ width: size, height: size }} />
}

export function PathSwatch({ bot }: { bot: boolean }) {
  return (
    <svg width="22" height="10" className="glyph" aria-hidden>
      <line x1="1" y1="5" x2="21" y2="5" stroke={bot ? COLORS.bot : COLORS.human} strokeWidth="2.5" strokeDasharray={bot ? '5 4' : undefined} />
    </svg>
  )
}

interface Props {
  events: Record<Category, boolean>
  playback: boolean
  heatLayer: HeatLayer
  heatSamples: number | null
  scopeLabel: string
}

export function Legend({ events, playback, heatLayer, heatSamples, scopeLabel }: Props) {
  const shown = (Object.keys(events) as Category[]).filter((c) => events[c])
  return (
    <div className="legend">
      <div className="legend-row">
        <span>
          {playback && <Glyph />}
          <PathSwatch bot={false} /> Human
        </span>
        <span>
          {playback && <Glyph bot />}
          <PathSwatch bot /> Bot
        </span>
      </div>
      {shown.length > 0 && (
        <div className="legend-row">
          {shown.map((c) => (
            <span key={c}>
              <Glyph category={c} /> {CATEGORY_LABEL[c]}
            </span>
          ))}
        </div>
      )}
      {heatLayer !== 'off' && (
        <div className="legend-heat">
          <span>{heatLayer === 'traffic' ? 'Time spent' : CATEGORY_LABEL[heatLayer]} heatmap</span>
          <div className="heat-ramp" />
          <span className="ramp-ends muted">
            <span>low</span>
            <span>high (relative to this selection)</span>
          </span>
          <span className="muted">
            {(heatSamples ?? 0).toLocaleString()} {heatLayer === 'traffic' ? 'position samples' : 'events'} · {scopeLabel}
          </span>
        </div>
      )}
    </div>
  )
}
