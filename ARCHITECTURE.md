# Architecture

## What I built it with

| Piece | Choice | Why |
|---|---|---|
| Data prep | Python + pyarrow (`pipeline/build.py`) | pyarrow reads the parquet files as-is, and the cleanup rules are easier to write and test in Python than in the browser. |
| Frontend | React + TypeScript + Vite | I can move fast with it. TypeScript keeps the JSON contract between the pipeline and the UI honest. |
| Rendering | Plain `<canvas>` 2D, no map or chart library | It's one image plus some lines and markers. Canvas handles ~90k points without trouble, and I control exactly how pan/zoom, playback and hit-testing work. |
| Hosting | Static site on Vercel | Nothing runs on a server. There are no cold starts like on Render's free tier, it rebuilds on every push, and it's free. |

## Data flow

```
player_data/February_XX/*.nakama-0   (1,243 parquet files, one per player per match)
        │  pipeline/build.py  (runs once, ~6 s)
        │   decode event bytes → fix timestamps → classify human/bot → drop duplicate
        │   positions → merge split files → group by match → world (x,z) → minimap px
        ▼
public/data/manifest.json             map config, days, cleanup stats
public/data/<Map>.json                matches → journeys → path [t,x,y,…] + events [t,type,x,y]
public/minimaps/<Map>.webp            minimaps resized to ≤3072px (from 9–12 MB to 0.2–0.35 MB)
        │  fetched by the browser (one map at a time, cached; 428 KB gzipped for the largest)
        ▼
React state (map, days, layers, selected match, time)
        ├─ heatmap.ts   bins the filtered matches into a 256×256 grid → blur → colour ramp → offscreen canvas
        └─ MapCanvas    draws minimap → heatmap → grid → paths → markers → player heads
```

All the judgement calls about the data happen in the pipeline. The frontend only filters and draws.

## Coordinate mapping

The README gives an origin and a scale per map. Together they define a square in world space (x, z) that the minimap covers from edge to edge:

```
u = (x - originX) / scale            v = (z - originZ) / scale
px = u * 1024                        py = (1 - v) * 1024     # image y grows downwards
```

- **`y` is ignored.** It's elevation, so for a top-down view I only use x and z.
- **The images aren't 1024 px.** The README says 1024×1024, but the files are 4320², 2160×2158 and 9000². I write every position in the README's 1024 space, and the canvas draws the image scaled into a 1024×1024 box. The mapping only depends on the 0–1 UV, so the resolution doesn't matter.
- **Grand Rift is 2160×2158.** I stretch it by 2 px to make it square instead of padding it, because the transform assumes the image spans the full square. The error is 0.09%, well under a pixel.
- **How I checked it.**
  1. `pipeline/test_build.py` asserts the README's worked example: (−301.45, −355.55) lands on pixel (78, 890).
  2. It also checks that the map corners land on the image corners.
  3. I plotted all 89k points on each minimap. Paths follow roads and bridges, loot clusters sit on buildings, and nothing lands in water or off the map. The extremes on every map fall within u, v ∈ [0.05, 0.95].
- **Hovering a marker shows world x/z.** The UI applies the inverse transform, so a designer can find the exact spot in the editor.

## Assumptions and data quirks

| What I found | What I did |
|---|---|
| `ts` is typed `timestamp[ms]`, but the values are Unix **seconds** (1770681535 = 10 Feb 2026). Read as ms, everything lands on 21 Jan 1970. | Cast the column to int64 and treat it as seconds. Match time = `ts − earliest ts in the match`. Samples are 5 s apart and matches last 1.5–15 min, which confirms the unit. |
| `event` is bytes. | Decoded as UTF-8 in the pipeline. |
| The README says numeric `user_id` = bot. Three numeric ids (1379, 1402, 1429, across 17 files) emit `Position`/`Loot`, which only humans emit. They are the only player-controlled character in their matches. | Classify by event stream (`Position` → human, `BotPosition` → bot) and fall back to the id format only when a file has no movement rows. They look like internal test accounts. |
| Match `ac049b28…` crosses midnight. Its human's file exists in **both** the Feb 10 and Feb 11 folders, and the first is a partial snapshot of the second (94 overlapping rows). | Merge rows per (match, player) with a multiset union, then file the match under the earlier day. |
| 147 exact duplicate position samples. | Dropped. Duplicate `Loot`/`BotKill` rows are **kept**: with 1 s timestamps, two pickups in the same second at the same spot are plausible. |
| Almost every match has only **one** human file, and bot files exist for only ~52 of 796 matches. | Match counts in the list are the human's events. The notes in the UI say bot-only aggregates aren't representative. PvP is nearly absent (3 kills in total) for this reason, not because players avoid each other. |
| There is no extraction event. | A journey with no death is labelled "Survived", not "Extracted". |
| Day folders roughly match UTC dates. Feb 14 is partial. | Date filter = folder date, labelled UTC. |
| In a bot's own file, `BotKill`/`BotKilled` are from the bot's point of view. | Every event is read from the journey owner's perspective. Kill = owner killed someone, Death = owner died. The tooltip spells out the raw event. |

## Trade-offs

| Decision | Considered | Picked, and why |
|---|---|---|
| When to parse parquet | DuckDB-WASM or parquet-wasm in the browser | **Pre-process at build time.** The dataset is fixed, and in-browser parsing would add a few MB of WASM and a slower first load just to redo the same work on every visit. The cost is a rebuild when new data lands, which is one command. |
| Rendering | deck.gl / Leaflet / SVG | **Canvas 2D.** Leaflet assumes geographic tiles, deck.gl is heavy for one image, and SVG slows down with 10k+ nodes. Canvas is fast and small (76 KB gzipped JS for the whole app). |
| Data granularity | One file per match / one big file | **One file per map.** Switching maps costs one request, and opening a match costs nothing. A file per match would mean ~800 tiny requests for the heatmaps. |
| Heatmap scaling | Linear by max | **sqrt, normalised to the 99.5th percentile**, so a single spawn hot spot doesn't wash out the rest of the map. |
| Bot detection | Trust the README's id rule | **Trust the event stream**, and document the 17 files where the two disagree. |
| Hosting | Render, Railway | **Vercel static.** There's no backend to host. Render's free web services sleep after 15 minutes, so a reviewer would wait about 50 s on first load. |

Not built on purpose: user accounts, any backend, annotations, and 3D or elevation views (the `y` axis is kept in the raw data if multi-floor buildings ever need it).
