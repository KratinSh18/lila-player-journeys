import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  CATEGORY,
  describeEvent,
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
  const [imageFailed, setImageFailed] = useState(false)
  const [hover, setHover] = useState<{ hit: Hit; x: number; y: number } | null>(null)

  useEffect(() => {
    const src = config.image
    const cached = imageCache.get(src)
    if (cached?.complete && cached.naturalWidth > 0) {
      setImage(cached)
      return
    }
    let live = true // ignore a slow load that finishes after the map was switched
    setImage(null)
    setImageFailed(false)
    const img = new Image()
    img.onload = () => live && setImage(img)
    img.onerror = () => {
      imageCache.delete(src)
      if (live) setImageFailed(true)
    }
    img.src = src
    imageCache.set(src, img)
    return () => {
      live = false
    }
  }, [config.image])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const { k, tx, ty } = view.current
    const p = latest.current
    // Scale from the actual backing store, so a DPR change between resizes can't skew the transform.
    const scale = canvas.clientWidth ? canvas.width / canvas.clientWidth : 1
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight)

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
    const marker = (matchId: string, journey: Journey, e: GameEvent, size: number, quiet = false) => {
      const category = CATEGORY[e[1]]
      if (!p.layers.events[category]) return
      const x = sx(e[2])
      const y = sy(e[3])
      // In the overview, bot events come from only a few dozen matches; keep them in the background.
      ctx.globalAlpha = journey.bot && !p.match ? 0.45 : 1
      drawMarker(ctx, category, x, y, size, quiet)
      ctx.globalAlpha = 1
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
        if (!j.path.length) continue
        // Stay on screen until the journey's last row (loot can come after the last
        // position), and step aside at the moment of death so the X marker shows.
        const lastSample = j.path[j.path.length - 3]
        const death = j.events.find((e) => CATEGORY[e[1]] === 'death' || CATEGORY[e[1]] === 'storm')
        const end = death ? death[0] - 0.01 : Math.max(lastSample, j.events.at(-1)?.[0] ?? 0)
        const pos = t <= end ? positionAt(j.path, Math.min(t, lastSample)) : null
        if (pos) drawHead(ctx, j.bot, sx(pos[0]), sy(pos[1]))
      }
    } else {
      if (p.layers.paths) {
        // Hundreds of journeys at once: keep each one faint so overlaps build up into corridors.
        for (const m of p.matches)
          for (const j of m.journeys)
            if (visible(j)) strokePath(ctx, j.path, sx, sy, Infinity, j.bot ? COLORS.bot : COLORS.human, j.bot ? 0.12 : 0.18, j.bot, 1)
      }
      for (const m of p.matches) for (const j of m.journeys) if (visible(j)) for (const e of j.events) marker(m.id, j, e, 4, true)
    }
    hits.current = nextHits
  }, [image])

  const wholeMapView = useCallback((): View => {
    const canvas = canvasRef.current
    const w = canvas?.clientWidth ?? 0
    const h = canvas?.clientHeight ?? 0
    const k = (Math.min(w, h) / mapSize) * 0.96
    return { k, tx: (w - mapSize * k) / 2, ty: (h - mapSize * k) / 2 }
  }, [mapSize])

  const fit = useCallback(() => {
    if (canvasRef.current) view.current = wholeMapView()
  }, [wholeMapView])

  /** Zoom to the area a match actually covers (a 30 s run is a speck on the full map). */
  const focusMatch = useCallback(
    (m: Match) => {
      const canvas = canvasRef.current
      if (!canvas || !canvas.clientWidth) return
      let x0 = Infinity
      let y0 = Infinity
      let x1 = -Infinity
      let y1 = -Infinity
      const take = (x: number, y: number) => {
        x0 = Math.min(x0, x)
        y0 = Math.min(y0, y)
        x1 = Math.max(x1, x)
        y1 = Math.max(y1, y)
      }
      for (const j of m.journeys) {
        for (let k = 0; k < j.path.length; k += 3) take(j.path[k + 1], j.path[k + 2])
        for (const e of j.events) take(e[2], e[3])
      }
      if (!Number.isFinite(x0)) return fit()
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      const pad = 90
      const whole = (Math.min(w, h) / mapSize) * 0.96
      const snug = Math.min((w - 2 * pad) / Math.max(x1 - x0, 1), (h - 2 * pad) / Math.max(y1 - y0, 1))
      const k = Math.min(Math.max(snug, whole), whole * 4) // never zoom out past the whole map, nor in past 4x
      view.current = { k, tx: w / 2 - ((x0 + x1) / 2) * k, ty: h / 2 - ((y0 + y1) / 2) * k }
    },
    [fit, mapSize],
  )

  const drawRef = useRef(draw)
  drawRef.current = draw
  const fitRef = useRef(fit)
  fitRef.current = () => (match ? focusMatch(match) : fit())

  // Keep the canvas backing store in sync with its CSS size. Only the first
  // real size fits the map; later resizes (timeline opening, window drags)
  // keep whatever zoom the user had.
  useLayoutEffect(() => {
    const wrap = wrapRef.current!
    const canvas = canvasRef.current!
    let sized = false
    const observer = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(wrap.clientWidth * dpr)
      canvas.height = Math.round(wrap.clientHeight * dpr)
      if (!sized && wrap.clientWidth > 0) {
        sized = true
        fitRef.current()
      }
      drawRef.current()
    })
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    fit()
  }, [config, fit])

  useEffect(() => {
    if (match) focusMatch(match)
    else fit()
    drawRef.current()
  }, [match, focusMatch, fit])

  useEffect(draw)

  // Drop the tooltip once its marker isn't drawn any more (new filter, other match, seeked back).
  useEffect(() => {
    if (hover && !hits.current.some((h) => h.event === hover.hit.event)) setHover(null)
  })

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

  // Zoom limits: from half the fitted size out to 15x in.
  const clampK = (k: number) => {
    const canvas = canvasRef.current!
    const minK = (Math.min(canvas.clientWidth, canvas.clientHeight) / mapSize) * 0.5
    return Math.min(Math.max(k, minK), minK * 30)
  }

  const anim = useRef(0)

  const zoomAt = (cx: number, cy: number, factor: number) => {
    cancelAnimationFrame(anim.current)
    const v = view.current
    const k = clampK(v.k * factor)
    view.current = { k, tx: cx - ((cx - v.tx) * k) / v.k, ty: cy - ((cy - v.ty) * k) / v.k }
    setHover(null)
    draw()
  }

  /** Glide to a new view over ~0.3 s, so a click-to-zoom is easy to follow. */
  const animateTo = (target: View) => {
    cancelAnimationFrame(anim.current)
    const from = { ...view.current }
    const start = performance.now()
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / 300)
      const ease = 1 - (1 - p) ** 3
      view.current = {
        k: from.k + (target.k - from.k) * ease,
        tx: from.tx + (target.tx - from.tx) * ease,
        ty: from.ty + (target.ty - from.ty) * ease,
      }
      drawRef.current()
      if (p < 1) anim.current = requestAnimationFrame(step)
    }
    anim.current = requestAnimationFrame(step)
  }

  /** Clicking empty map brings that spot to the centre and zooms in a step (Shift zooms out). */
  const zoomToward = (cx: number, cy: number, zoomOut: boolean) => {
    const canvas = canvasRef.current!
    const v = view.current
    const k = clampK(v.k * (zoomOut ? 1 / 1.6 : 1.6))
    const mapX = (cx - v.tx) / v.k
    const mapY = (cy - v.ty) / v.k
    animateTo({ k, tx: canvas.clientWidth / 2 - mapX * k, ty: canvas.clientHeight / 2 - mapY * k })
  }

  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    cancelAnimationFrame(anim.current)
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

  const onPointerUp = (e: React.PointerEvent) => {
    const wasClick = drag.current && !drag.current.moved
    drag.current = null
    if (!wasClick) return
    // Hit-test where the pointer was released: a touch tap has no hover beforehand.
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const hit = nearestHit(hits.current, x, y, e.pointerType === 'touch' ? 18 : 10)
    if (hit) props.onOpenEvent(hit.matchId, hit.event[0])
    else zoomToward(x, y, e.shiftKey)
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
        style={{ cursor: hover ? 'pointer' : drag.current?.moved ? 'grabbing' : 'zoom-in' }}
      />
      {!image && <div className="map-loading">{imageFailed ? "Couldn't load the minimap. Try reloading." : 'Loading minimap…'}</div>}

      <div className="zoom-controls">
        <button title="Zoom in" onClick={() => zoomAt(canvasRef.current!.clientWidth / 2, canvasRef.current!.clientHeight / 2, 1.5)}>+</button>
        <button title="Zoom out" onClick={() => zoomAt(canvasRef.current!.clientWidth / 2, canvasRef.current!.clientHeight / 2, 1 / 1.5)}>−</button>
        <button title="Show the whole map" onClick={() => animateTo(wholeMapView())}>⤢</button>
      </div>

      {hover && world && (
        <div className="tooltip" style={tooltipPlacement(hover.x, hover.y, wrapRef.current)}>
          <strong>{describeEvent(hover.hit.event[1], hover.hit.journey.bot)}</strong>
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

/** Keep the tooltip inside the map: flip it to the left/top of the cursor near the edges. */
function tooltipPlacement(x: number, y: number, wrap: HTMLDivElement | null): React.CSSProperties {
  const flipX = !!wrap && x + 290 > wrap.clientWidth
  const flipY = !!wrap && y + 130 > wrap.clientHeight
  return {
    left: flipX ? x - 14 : x + 14,
    top: flipY ? y - 14 : y + 14,
    transform: `translate(${flipX ? '-100%' : '0'}, ${flipY ? '-100%' : '0'})`,
  }
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
