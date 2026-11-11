// Shapes of the JSON written by pipeline/build.py, plus small helpers around them.

export type RawEvent = 'Kill' | 'Killed' | 'BotKill' | 'BotKilled' | 'KilledByStorm' | 'Loot'
export type Category = 'kill' | 'death' | 'storm' | 'loot'

/** [seconds since match start, event, x, y] with x/y in 1024px minimap space */
export type GameEvent = [number, RawEvent, number, number]

export interface Journey {
  player: string
  bot: boolean
  outcome: 'killed' | 'storm' | 'survived'
  /** flat [t, x, y, t, x, y, ...] */
  path: number[]
  events: GameEvent[]
}

export interface Match {
  id: string
  day: string
  startedAt: number
  duration: number
  humans: number
  bots: number
  counts: Record<Category, number>
  journeys: Journey[]
}

export interface MapConfig {
  scale: number
  originX: number
  originZ: number
  image: string
  thumb: string
  matches: number
}

export interface Manifest {
  mapSize: number
  maps: Record<string, MapConfig>
  days: string[]
  stats: Record<string, number>
}

export const CATEGORY: Record<RawEvent, Category> = {
  Kill: 'kill',
  BotKill: 'kill',
  Killed: 'death',
  BotKilled: 'death',
  KilledByStorm: 'storm',
  Loot: 'loot',
}

export const CATEGORY_LABEL: Record<Category, string> = {
  kill: 'Kills',
  death: 'Deaths',
  storm: 'Storm deaths',
  loot: 'Loot',
}

// Spelled out for the tooltip, from the point of view of the journey's owner.
export const EVENT_DESCRIPTION: Record<RawEvent, string> = {
  Kill: 'Killed a player',
  Killed: 'Killed by a player',
  BotKill: 'Killed a bot',
  BotKilled: 'Killed by a bot',
  KilledByStorm: 'Died to the storm',
  Loot: 'Picked up loot',
}

/** Bot files use the same event names, but from the bot's side. */
export function describeEvent(name: RawEvent, bot: boolean) {
  if (bot && name === 'BotKill') return 'Bot got a kill'
  if (bot && name === 'BotKilled') return 'Bot was killed'
  return EVENT_DESCRIPTION[name]
}

export const MAP_NAMES: Record<string, string> = {
  AmbroseValley: 'Ambrose Valley',
  GrandRift: 'Grand Rift',
  Lockdown: 'Lockdown',
}

export async function loadManifest(): Promise<Manifest> {
  const res = await fetch('data/manifest.json')
  if (!res.ok) throw new Error(`manifest.json: ${res.status}`)
  return res.json()
}

const mapCache = new Map<string, Promise<Match[]>>()

export function loadMatches(mapId: string): Promise<Match[]> {
  let pending = mapCache.get(mapId)
  if (!pending) {
    pending = fetch(`data/${mapId}.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`${mapId}.json: ${res.status}`)
        return res.json()
      })
      .then((data: { matches: Match[] }) => data.matches)
    pending.catch(() => mapCache.delete(mapId)) // allow a retry after a failed fetch
    mapCache.set(mapId, pending)
  }
  return pending
}

/** Inverse of the pipeline's world -> minimap transform, for showing world coords on hover. */
export function mapToWorld(x: number, y: number, cfg: MapConfig, mapSize: number) {
  return {
    x: (x / mapSize) * cfg.scale + cfg.originX,
    z: (1 - y / mapSize) * cfg.scale + cfg.originZ,
  }
}

export function formatClock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function formatDay(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

export function formatStart(unixSeconds: number) {
  return new Date(unixSeconds * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
}

export const shortId = (id: string) => (/^\d+$/.test(id) ? id : id.slice(0, 8))

/** How the human's run ended. With two humans, a death wins over "survived". */
export function humanOutcome(match: Match): Journey['outcome'] | null {
  const humans = match.journeys.filter((j) => !j.bot)
  return humans.find((j) => j.outcome !== 'survived')?.outcome ?? humans[0]?.outcome ?? null
}

// Positions are logged every 5 s while a player moves and not at all while
// they stand still, so a longer gap between samples means "waited, then moved".
const SAMPLE_SECONDS = 5

/** Position of a journey at time t, between its first and last sample. null outside that range. */
export function positionAt(path: number[], t: number): [number, number] | null {
  const n = path.length / 3
  if (n === 0 || t < path[0] || t > path[(n - 1) * 3]) return null
  // binary search for the last sample at or before t
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (path[mid * 3] <= t) lo = mid
    else hi = mid - 1
  }
  const i = lo * 3
  if (lo === n - 1) return [path[i + 1], path[i + 2]]
  const t0 = path[i]
  const t1 = path[i + 3]
  const moveFrom = Math.max(t0, t1 - SAMPLE_SECONDS) // hold still through a long gap
  const f = t <= moveFrom ? 0 : (t - moveFrom) / (t1 - moveFrom)
  return [path[i + 1] + (path[i + 4] - path[i + 1]) * f, path[i + 2] + (path[i + 5] - path[i + 2]) * f]
}
