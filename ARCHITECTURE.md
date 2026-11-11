# Architecture

## Stack

| Piece | Choice | Why |
|---|---|---|
| Data prep | Python + pyarrow (`pipeline/build.py`) | Reads the parquet files as they are, and the cleanup rules are easy to write and test in Python. |
| Frontend | React + TypeScript + Vite | It's what I'm fastest in. The types in `src/data.ts` mirror what `build.py` writes. Nothing checks that at runtime, so a format change has to touch both files. |
| Rendering | Canvas 2D, no map or chart library | It's one image with lines and markers on top. Canvas also gives me full control over pan/zoom, playback and hit-testing. |
| Hosting | Vercel, static | Nothing runs on a server. |

What I considered instead is in the trade-offs table at the end.

## Data flow

```
player_data/February_XX/*.nakama-0     1,243 parquet files, one per player per match
        │  pipeline/build.py           runs once, ~6 s
        │   decode event bytes → read ts as seconds → collapse double-written files
        │   → merge repeated files → classify human/bot → group by match
        │   → world (x, z) to minimap px → summary counts per match
        ▼
public/data/manifest.json              map config, list of days, cleanup stats
public/data/<Map>.json                 matches → journeys → path [t,x,y,…] + events [t,type,x,y]
public/minimaps/<Map>.webp             ≤3072 px (2.9–11.8 MB originals become 0.18–0.35 MB), plus thumbnails
        │  fetched one map at a time and cached (the largest is 428 KB gzipped)
        ▼
React state: map, days, layers, open match, playback time (map/match/time also go in the URL hash)
        ├─ heatmap.ts   bins the filtered journeys into a 256×256 grid → blur → colour ramp
        └─ MapCanvas    minimap → heatmap → grid → paths → markers → player positions
```

Every call about what the data means is made in the pipeline. The browser only filters and draws.

## Coordinate mapping

The dataset's README (inside `player_data.zip`) gives an origin and a scale for each map. Together they define a square in world space (x, z) that the minimap covers from edge to edge:

```
u = (x - originX) / scale            v = (z - originZ) / scale
px = u * 1024                        py = (1 - v) * 1024     # image y grows downwards
```

- **`y` is height, not a map axis.** It's dropped for the top-down view.
- **The images aren't 1024 px.** The dataset README says 1024×1024, but the files are 4320², 2160×2158 and 9000². All positions are written in the README's 1024 space, and the canvas draws the image scaled into a 1024×1024 box. The mapping only depends on u and v, so the image resolution doesn't matter.
- **Grand Rift is 2160×2158.** I stretch it 2 px to square rather than pad it, since the transform assumes the image covers the full square. The error is 0.09%, under a pixel.
- **How I checked it.** `pipeline/test_build.py` asserts the dataset README's worked example, (−301.45, −355.55) → pixel (78, 890), and checks that the map corners land on the image corners. I also plotted all 89k points over each minimap. Paths follow roads and bridges, loot clusters sit on buildings, and nothing lands in water or off the map.
- **The tooltip shows world x/z.** It applies the inverse transform, so a designer can find the same spot in the editor.

## What the data actually looks like

| Found | Handled |
|---|---|
| `ts` is typed `timestamp[ms]`, but the values are Unix seconds (1770681535 is 10 Feb 2026). Read as ms, everything lands on 21 Jan 1970. | Cast to int64 and treat as seconds. Match time is `ts` minus the match's first `ts`. |
| `event` is stored as bytes. | Decoded as UTF-8. |
| 3 files contain their whole content twice, back to back. These were the source of every exact-duplicate row (149), and they doubled those players' loot and kills. | Collapsed to one copy. Any identical rows that remain are kept: with 1 s timestamps, two pickups in the same second is normal. |
| One file is copied verbatim into both the Feb 10 and Feb 11 folders. | Rows are merged per (match, player) with a multiset union, so a repeated file counts once. |
| Positions are logged every 5 s while a player moves and not at all while they stand still. Over gaps of 15 s or more players barely move (median 0.2–0.4 units/s, against 2.8 between normal 5 s samples). | The traffic heatmap weights each sample by how long the player stayed, capped at 30 s. Playback holds a player in place through a gap instead of sliding them. |
| The dataset README says numeric `user_id` means bot. Three numeric ids (1379, 1402, 1429) emit `Position` and `Loot` in 17 files, which only player characters do. 16 of those matches have no UUID player at all, and 1429 is an ordinary bot in 3 other matches. | Each file is classified by its events (`Position` → human, `BotPosition` → bot). The id format is only a fallback for files with no movement. These look like per-session slots, maybe test or autoplay accounts, and the in-app notes say so. |
| Day folders mostly match the UTC date, but 4 matches start in the last minutes before midnight and sit in the next day's folder. One starts at 23:58 on 9 Feb. | A match's date is the UTC date of its first event. That's why there's a "9 Feb" chip holding one match. |
| Almost every match has exactly one human file, and bot files exist for only 52 of 796 matches. | List counts are the human's events. The overview starts with bots hidden so ~50 matches don't skew the heatmaps; a single match shows bots by default. |
| All 3 `Kill` rows share the second and exact position of a `Killed` row in the same file. | Shown as they are. This means there's no confirmed PvP kill in the data (trades or a logging quirk). |
| There's no extraction event. | A run with no death is labelled "Survived", not "Extracted". |
| A match's length is only what was recorded: first to last event across its files, usually one player's time in it (13 s to 14:50). | Labelled as such in the tooltip. |
| In a bot's own file, `BotKill` / `BotKilled` are from the bot's point of view. | Every event is read from the file owner's side: kill = owner killed someone, death = owner died. The tooltip spells it out. |

## Trade-offs

| Decision | Considered | Went with |
|---|---|---|
| Where parquet gets parsed | DuckDB-WASM / parquet-wasm in the browser | **Once, at build time.** The dataset is fixed. Parsing in the browser would add a few MB of WASM and a slower first load just to redo the same work on every visit. The cost: new data needs `npm run data` and a push. |
| Rendering | deck.gl, Leaflet, SVG | **Canvas 2D.** Leaflet expects geographic tiles, deck.gl is heavy for a single image, and SVG struggles past ~10k nodes. The whole app is about 78 KB gzipped. |
| Data files | One per match / one for everything | **One per map.** Heatmaps need every match on a map at once, so one request per map. Opening a match is then free. |
| Heatmap scale | Linear to the max | **Square root, normalised to the 99.5th percentile.** One spawn hot spot would otherwise wash out the rest. The colours are relative to the current selection, and the legend says so. |
| Hosting | Render, Railway, Netlify | **Vercel static.** There's no backend to run. Render's free web services sleep after 15 minutes idle, so the first visit would wait about 50 s. Netlify would have worked just as well. |

Left out on purpose: accounts, any backend, annotations, and a 3D/height view (the pipeline drops `y`, but it's one line to keep if multi-floor buildings need it).
