import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  CATEGORY,
  EVENT_DESCRIPTION,
  type Category,
  type GameEvent,
  type Journey,
  type MapConfig,
  type Match,
  formatClock,
  mapToWorld,
  positionAt,
  shortId,
} from './data'
import type { Heatmap } from './heatmap'
import { COLORS, drawHead, drawMarker } from './markers'

export interface Layers {
  humans: boolean
  bots: boolean
  paths: boolean
  grid: boolean
  events: Record<Category, boolean>
}

interface Props {
  config: MapConfig
  mapSize: number
  /** everything that passes the filters; drawn when no single match is open */
  matches: Match[]
  match: Match | null
  time: number
  layers: Layers
  heat: Heatmap | null
  heatOpacity: number
  onOpenEvent: (matchId: string, t: number) => void
}

interface Hit {
  x: number
  y: number
  matchId: string
  journey: Journey
  event: GameEvent
}

interface View {
  k: number
  tx: number
  ty: number
}

const imageCache = new Map<string, HTMLImageElement>()

export function MapCanvas(props: Props) {
  const { config, mapSize, match } = props
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const view = useRef<View>({ k: 1, tx: 0, ty: 0 })
  const hits = useRef<Hit[]>([])
  const latest = useRef(props)
  latest.current = props
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [hover, setHover] = useState<{ hit: Hit; x: number; y: number } | null>(null)

  useEffect(() => {
    const src = config.image
    const cached = imageCache.get(src)
    if (cached?.complete) return setImage(cached)
    setImage(null)
    const img = cached ?? new Image()
    img.onload = () => setImage(img)
    img.src = src
    imageCache.set(src, img)
  }, [config.image])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const { k, tx, ty } = view.current
    const p = latest.current
    const dpr = window.devicePixelRatio || 1
    const w = canvas.width / dpr
    const h = canvas.height / dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    // Map-space layers: image, heatmap, grid
    ctx.save()
    ctx.translate(tx, ty)
    ctx.scale(k, k)
    if (image) ctx.drawImage(image, 0, 0, p.mapSize, p.mapSize)
    if (p.heat) {
      ctx.globalAlpha = p.heatOpacity
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(p.heat.canvas, 0, 0, p.mapSize, p.mapSize)
      ctx.globalAlpha = 1
    }
    ctx.restore()
    if (p.layers.grid) drawGrid(ctx, view.current, p.mapSize)

    // Screen-space layers: paths and markers keep a constant on-screen size while zooming
    const sx = (x: number) => tx + x * k
    const sy = (y: number) => ty + y * k
    const visible = (j: Journey) => (j.bot ? p.layers.bots : p.layers.humans)
    const nextHits: Hit[] = []
    const marker = (matchId: string, journey: Journey, e: GameEvent, size: number) => {
      const category = CATEGORY[e[1]]
      if (!p.layers.events[category]) return
      const x = sx(e[2])
      const y = sy(e[3])
      drawMarker(ctx, category, x, y, size)
      nextHits.push({ x, y, matchId, journey, event: e })
    }

    if (p.match) {
      const t = p.time
      const journeys = p.match.journeys.filter(visible)
      for (const j of journeys) {
        const color = j.bot ? COLORS.bot : COLORS.human
        // faint full route, then the part already travelled on top
        strokePath(ctx, j.path, sx, sy, Infinity, color, 0.45, j.bot, 2)
        strokePath(ctx, j.path, sx, sy, t, '#000', 0.55, false, j.bot ? 4 : 5) // dark casing so it reads over any heatmap
        strokePath(ctx, j.path, sx, sy, t, color, 1, j.bot, j.bot ? 2 : 2.5)
      }
      for (const j of journeys) for (const e of j.events) if (e[0] <= t) marker(p.match.id, j, e, 7)
      for (const j of journeys) {
        const pos = positionAt(j.path, t)
        if (pos) drawHead(ctx, j.bot, sx(pos[0]), sy(pos[1]))
      }
    } else {
      if (p.layers.paths) {
        // Hundreds of journeys at once: keep each one faint so overlaps build up into corridors.
        for (const m of p.matches)
          for (const j of m.journeys)
            if (visible(j)) strokePath(ctx, j.path, sx, sy, Infinity, j.bot ? COLORS.bot : COLORS.human, j.bot ? 0.12 : 0.18, false, 1)
      }
      for (const m of p.matches) for (const j of m.journeys) if (visible(j)) for (const e of j.events) marker(m.id, j, e, 3.5)
    }
    hits.current = nextHits
  }, [image])

  const fit = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const w = canvas.width / dpr
    const h = canvas.height / dpr
    const k = (Math.min(w, h) / mapSize) * 0.96
    view.current = { k, tx: (w - mapSize * k) / 2, ty: (h - mapSize * k) / 2 }
  }, [mapSize])

  // Keep the canvas backing store in sync with its CSS size.
  useLayoutEffect(() => {
    const wrap = wrapRef.current!
    const canvas = canvasRef.current!
    const observer = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(wrap.clientWidth * dpr)
      canvas.height = Math.round(wrap.clientHeight * dpr)
      fit()
      draw()
    })
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [fit, draw])

  useEffect(() => {
    fit()
  }, [config, fit])

  // A tooltip from the previous match/filter would point at a marker that's gone.
  useEffect(() => setHover(null), [match, props.matches])

  useEffect(draw)

  // Wheel zoom has to be a non-passive listener so it can stop the page from scrolling.
  useEffect(() => {
    const canvas = canvasRef.current!
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0015))
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  })

  const zoomAt = (cx: number, cy: number, factor: number) => {
    const v = view.current
    const canvas = canvasRef.current!
    const minK = (Math.min(canvas.clientWidth, canvas.clientHeight) / mapSize) * 0.5
    const k = Math.min(Math.max(v.k * factor, minK), minK * 30)
    view.current = { k, tx: cx - ((cx - v.tx) * k) / v.k, ty: cy - ((cy - v.ty) * k) / v.k }
    setHover(null)
    draw()
  }

  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const d = drag.current
    if (d) {
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      if (d.moved || Math.abs(dx) + Math.abs(dy) > 4) {
        d.moved = true
        view.current.tx += dx
        view.current.ty += dy
        d.x = e.clientX
        d.y = e.clientY
        setHover(null)
        draw()
        return
      }
    }
    const hit = nearestHit(hits.current, x, y, 10)
    setHover((prev) => (hit === prev?.hit ? prev : hit ? { hit, x, y } : null))
  }

  const onPointerUp = () => {
    const wasClick = drag.current && !drag.current.moved
    drag.current = null
    if (wasClick && hover) props.onOpenEvent(hover.hit.matchId, hover.hit.event[0])
  }

  const world = hover ? mapToWorld(hover.hit.event[2], hover.hit.event[3], config, mapSize) : null

  return (
    <div className="map" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={() => {
          fit()
          draw()
        }}
        style={{ cursor: hover ? 'pointer' : drag.current?.moved ? 'grabbing' : 'grab' }}
      />
      {!image && <div className="map-loading">Loading minimap…</div>}

      <div className="zoom-controls">
        <button title="Zoom in" onClick={() => zoomAt(canvasRef.current!.clientWidth / 2, canvasRef.current!.clientHeight / 2, 1.5)}>+</button>
        <button title="Zoom out" onClick={() => zoomAt(canvasRef.current!.clientWidth / 2, canvasRef.current!.clientHeight / 2, 1 / 1.5)}>−</button>
        <button title="Fit map (double-click)" onClick={() => { fit(); draw() }}>⤢</button>
      </div>

      {hover && world && (
        <div className="tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <strong>{EVENT_DESCRIPTION[hover.hit.event[1]]}</strong>
          <div>
            {hover.hit.journey.bot ? 'Bot' : 'Human'} {shortId(hover.hit.journey.player)} at {formatClock(hover.hit.event[0])}
          </div>
          <div className="muted">
            world x {world.x.toFixed(1)}, z {world.z.toFixed(1)}
          </div>
          {!match && <div className="hint">Click to replay this match from here</div>}
          {match && <div className="hint">Click to jump here in the timeline</div>}
        </div>
      )}
    </div>
  )
}

function strokePath(
  ctx: CanvasRenderingContext2D,
  path: number[],
  sx: (x: number) => number,
  sy: (y: number) => number,
  until: number,
  color: string,
  alpha: number,
  dashed: boolean,
  width: number,
) {
  if (path.length < 6 || path[0] > until) return
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  if (dashed) ctx.setLineDash([5, 4])
  ctx.beginPath()
  ctx.moveTo(sx(path[1]), sy(path[2]))
  let i = 3
  for (; i < path.length && path[i] <= until; i += 3) ctx.lineTo(sx(path[i + 1]), sy(path[i + 2]))
  // end exactly where the player is right now, between two samples
  if (i < path.length && Number.isFinite(until)) {
    const pos = positionAt(path, until)
    if (pos) ctx.lineTo(sx(pos[0]), sy(pos[1]))
  }
  ctx.stroke()
  ctx.restore()
}

function drawGrid(ctx: CanvasRenderingContext2D, { k, tx, ty }: View, mapSize: number) {
  const cell = mapSize / 10
  ctx.save()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 0; i <= 10; i++) {
    const x = Math.round(tx + i * cell * k) + 0.5
    const y = Math.round(ty + i * cell * k) + 0.5
    ctx.moveTo(x, ty)
    ctx.lineTo(x, ty + mapSize * k)
    ctx.moveTo(tx, y)
    ctx.lineTo(tx + mapSize * k, y)
  }
  ctx.stroke()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
  ctx.font = '600 11px system-ui, sans-serif'
  for (let i = 0; i < 10; i++) {
    ctx.fillText('ABCDEFGHIJ'[i], tx + (i + 0.5) * cell * k - 3, ty + 13)
    ctx.fillText(String(i + 1), tx + 4, ty + (i + 0.5) * cell * k + 4)
  }
  ctx.restore()
}

function nearestHit(hits: Hit[], x: number, y: number, radius: number) {
  let best: Hit | null = null
  let bestD = radius * radius
  // iterate backwards so the marker drawn on top wins ties
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i]
    const d = (h.x - x) ** 2 + (h.y - y) ** 2
    if (d < bestD) {
      bestD = d
      best = h
    }
  }
  return best
}
