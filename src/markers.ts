import type { Category } from './data'

// One place for the visual language so the map and the legend can't drift apart.
export const COLORS = {
  human: '#53d1f0',
  bot: '#f2a65a',
  kill: '#ffd23f',
  death: '#ff4d5a',
  storm: '#c48bff',
  loot: '#5be37d',
}

/**
 * Draws an event marker centred on (x, y) in screen pixels. Shape and colour both differ per category.
 * `quiet` thins the dark outline for the overview, where hundreds of markers overlap.
 */
export function drawMarker(ctx: CanvasRenderingContext2D, category: Category, x: number, y: number, size = 6, quiet = false) {
  const outline = quiet ? 0.6 : 1
  ctx.save()
  ctx.lineWidth = 2 * outline
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)'
  ctx.fillStyle = COLORS[category]
  ctx.beginPath()
  switch (category) {
    case 'kill': {
      // crosshair: ring + ticks
      ctx.arc(x, y, size * 0.8, 0, Math.PI * 2)
      ctx.lineWidth = 2 + 2 * outline
      ctx.stroke()
      ctx.strokeStyle = COLORS.kill
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(x - size * 1.3, y)
      ctx.lineTo(x + size * 1.3, y)
      ctx.moveTo(x, y - size * 1.3)
      ctx.lineTo(x, y + size * 1.3)
      ctx.stroke()
      break
    }
    case 'death': {
      // X
      const s = size * 0.95
      ctx.moveTo(x - s, y - s)
      ctx.lineTo(x + s, y + s)
      ctx.moveTo(x + s, y - s)
      ctx.lineTo(x - s, y + s)
      ctx.lineCap = 'round'
      ctx.lineWidth = 2.5 + 2.5 * outline
      ctx.stroke()
      ctx.strokeStyle = COLORS.death
      ctx.lineWidth = 2.5
      ctx.stroke()
      break
    }
    case 'storm': {
      // diamond
      ctx.moveTo(x, y - size * 1.2)
      ctx.lineTo(x + size, y)
      ctx.lineTo(x, y + size * 1.2)
      ctx.lineTo(x - size, y)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      break
    }
    case 'loot': {
      // small square
      const s = size * 0.55
      ctx.rect(x - s, y - s, s * 2, s * 2)
      ctx.fill()
      ctx.lineWidth = 1.5 * outline
      ctx.stroke()
      break
    }
  }
  ctx.restore()
}

/** Current position of a player during playback: humans are circles, bots are squares. */
export function drawHead(ctx: CanvasRenderingContext2D, bot: boolean, x: number, y: number) {
  ctx.save()
  ctx.beginPath()
  if (bot) ctx.rect(x - 4, y - 4, 8, 8)
  else ctx.arc(x, y, 6, 0, Math.PI * 2)
  ctx.fillStyle = bot ? COLORS.bot : COLORS.human
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 2
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}
