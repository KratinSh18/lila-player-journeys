import { CATEGORY, type Category, type Match } from './data'

export type HeatLayer = 'off' | 'traffic' | Category

export const HEAT_LAYERS: { id: HeatLayer; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'traffic', label: 'Traffic' },
  { id: 'kill', label: 'Kills' },
  { id: 'death', label: 'Deaths' },
  { id: 'storm', label: 'Storm' },
  { id: 'loot', label: 'Loot' },
]

// 256 bins over the 1024px map = 4px per bin, roughly 3.5 world units on Ambrose Valley.
const BINS = 256

export interface Heatmap {
  canvas: HTMLCanvasElement
  /** how many points went in, so the UI can say "based on N deaths" */
  samples: number
}

export function buildHeatmap(
  matches: Match[],
  layer: Exclude<HeatLayer, 'off'>,
  include: { humans: boolean; bots: boolean },
  mapSize: number,
): Heatmap {
  const grid = new Float32Array(BINS * BINS)
  const toBin = BINS / mapSize
  let samples = 0
  const add = (x: number, y: number, weight = 1) => {
    const i = Math.floor(x * toBin)
    const j = Math.floor(y * toBin)
    if (i < 0 || j < 0 || i >= BINS || j >= BINS) return
    grid[j * BINS + i] += weight
    samples++
  }

  for (const match of matches) {
    for (const journey of match.journeys) {
      if (journey.bot ? !include.bots : !include.humans) continue
      if (layer === 'traffic') {
        // Weight each sample by how long the player stayed before the next one.
        // Samples stop while someone stands still, so a plain count would
        // under-weight camping and looting spots. Capped so one AFK player
        // can't light up a corner of the map.
        const p = journey.path
        for (let k = 0; k < p.length; k += 3) {
          const stay = k + 3 < p.length ? p[k + 3] - p[k] : 5
          add(p[k + 1], p[k + 2], Math.min(stay, 30) / 5)
        }
      } else {
        for (const e of journey.events) if (CATEGORY[e[1]] === layer) add(e[2], e[3])
      }
    }
  }

  // Sparse layers (a few dozen storm deaths) need a wider blur to read as zones at all.
  blur(grid, layer === 'traffic' ? 2 : layer === 'loot' ? 3 : 5)
  return { canvas: colorize(grid), samples }
}

/** Three box-blur passes per axis, which is a cheap stand-in for a gaussian. */
function blur(grid: Float32Array, radius: number) {
  const tmp = new Float32Array(grid.length)
  for (let pass = 0; pass < 3; pass++) {
    boxBlur(grid, tmp, radius, 1, BINS) // horizontal
    boxBlur(tmp, grid, radius, BINS, 1) // vertical
  }
}

function boxBlur(src: Float32Array, dst: Float32Array, r: number, step: number, lineStride: number) {
  const width = 2 * r + 1
  for (let line = 0; line < BINS; line++) {
    const base = line * lineStride
    let sum = 0
    for (let k = -r; k <= r; k++) sum += k >= 0 && k < BINS ? src[base + k * step] : 0
    for (let k = 0; k < BINS; k++) {
      dst[base + k * step] = sum / width
      const out = k - r
      const inn = k + r + 1
      if (out >= 0) sum -= src[base + out * step]
      if (inn < BINS) sum += src[base + inn * step]
    }
  }
}

let palette: Uint8ClampedArray | null = null

// 256-entry colour ramp, transparent at zero. Built once from a canvas gradient.
function getPalette() {
  if (palette) return palette
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 1
  const ctx = c.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 256, 0)
  g.addColorStop(0, 'rgba(40, 60, 255, 0)')
  g.addColorStop(0.15, 'rgba(40, 90, 255, 0.55)')
  g.addColorStop(0.4, 'rgba(0, 220, 200, 0.75)')
  g.addColorStop(0.65, 'rgba(255, 230, 0, 0.85)')
  g.addColorStop(1, 'rgba(255, 40, 30, 0.95)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 256, 1)
  palette = ctx.getImageData(0, 0, 256, 1).data
  return palette
}

function colorize(grid: Float32Array) {
  // Normalise to the 99.5th percentile instead of the max so a single hot spot
  // (e.g. a spawn point) doesn't wash everything else out, then sqrt to lift
  // the long tail of low-density areas into view.
  const nonZero = Array.from(grid).filter((v) => v > 1e-6).sort((a, b) => a - b)
  const peak = nonZero.length ? nonZero[Math.floor((nonZero.length - 1) * 0.995)] : 1
  const colors = getPalette()

  const canvas = document.createElement('canvas')
  canvas.width = BINS
  canvas.height = BINS
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(BINS, BINS)
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] <= 1e-6) continue
    const level = Math.min(255, Math.round(Math.sqrt(grid[i] / peak) * 255))
    img.data.set(colors.subarray(level * 4, level * 4 + 4), i * 4)
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}
