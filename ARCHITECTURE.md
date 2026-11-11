# Architecture

## Stack

- **Python + pyarrow** (`pipeline/build.py`) reads the parquet and makes every call about what the data means, once, at build time.
- **React + TypeScript + Vite** for the UI, which is what I'm fastest in. `src/data.ts` mirrors the JSON that `build.py` writes.
- **Canvas 2D** for the map: one image plus lines and markers, with pan/zoom, playback and hit-testing in my own code. No map or chart library.
- **Vercel, static.** There's no server.

## Data flow

```
1,243 parquet files ──► pipeline/build.py ──► public/data/<Map>.json  (matches → journeys → path + events)
 (one per player         decode bytes, fix ts,     public/data/manifest.json  (maps, days, cleanup stats)
  per match)             clean, classify,          public/minimaps/*.webp  (3072 px, 0.18–0.35 MB each)
                         project to minimap px
                                   │
browser: fetch one map's JSON (≤428 KB gzipped) ──► filter by date/players ──► heatmap.ts (256² grid → blur → colour)
                                                                          └─► MapCanvas: minimap, heatmap, paths, markers
```

## Coordinate mapping

The dataset README gives an origin and a scale per map. Together they define a square in world (x, z) that the minimap covers edge to edge:

```
u = (x - originX) / scale      v = (z - originZ) / scale
px = u * 1024                  py = (1 - v) * 1024        # image y grows downwards
```

- `y` is height, so it's dropped for a top-down view.
- The README says the images are 1024², but they're actually 4320², 2160×2158 and 9000². Positions are stored in the README's 1024 space and the image is drawn scaled into a 1024 box, so the resolution doesn't matter. Grand Rift is stretched 2 px to make it square (0.09%, under a pixel).
- Checked three ways: `pipeline/test_build.py` asserts the README's worked example ((−301.45, −355.55) → (78, 890)) and the map corners; every one of the 89k points plotted on its minimap follows roads and buildings, with none in water; and the tooltip shows the inverse transform (world x/z), so a designer can find the spot in the editor.

## Assumptions and data quirks

| Found | Did |
|---|---|
| `ts` is typed as ms, but the values are Unix seconds (read as ms, the dates land in Jan 1970). | Cast to int, treat as seconds. Match time = ts − the match's first ts. |
| `event` is bytes. | Decoded as UTF-8. |
| 3 files contain their content twice, back to back, doubling those players' loot and kills. They account for every duplicate row. | Collapsed to one copy. |
| One file is copied into both the Feb 10 and Feb 11 folders. | Merged per (match, player), so it counts once. |
| Positions are logged every 5 s while moving and not at all while standing still. Over longer gaps players barely move. | The traffic heatmap weights samples by time spent there (capped at 30 s). Playback holds players in place through a gap. |
| Numeric `user_id` should mean bot, but ids 1379/1402/1429 emit `Position` and `Loot` (player-only events) in 17 files. 1429 is a normal bot in 3 other matches. | Each file is classified by its events, with the id format as a fallback. They look like test or autoplay slots, and the in-app notes say so. |
| 4 matches start just before midnight and are filed in the next day's folder. | Date = UTC date of a match's first event. That's why there's a "9 Feb" chip with one match. |
| Nearly every match has one human file. Bot files exist for 52 of 796 matches. | List counts are the human's. The overview hides bots by default so 52 matches don't skew the heatmaps. |
| The 3 `Kill` rows each match a `Killed` row in the same file (same second, same spot). | Shown as they are. There's no confirmed PvP in the data. |
| There's no extraction event. | A run with no death shows as "Survived". |
| In a bot's file, `BotKill`/`BotKilled` are from the bot's side. | Events are read from the file owner's side (kill = owner killed, death = owner died). |

## Trade-offs

| Decision | Considered | Picked |
|---|---|---|
| Where to parse parquet | DuckDB-WASM in the browser | **At build time.** The dataset is fixed. Parsing in the browser costs MBs of WASM and a slower first load to redo the same work on every visit. New data means re-running one command. |
| Rendering | Leaflet, deck.gl, SVG | **Canvas.** Leaflet expects geographic tiles, deck.gl is heavy for one image, and SVG slows down past ~10k nodes. The whole app is 78 KB gzipped. |
| Data files | Per match / one big file | **Per map.** Heatmaps need every match on a map at once anyway, and opening a match costs nothing after that. |
| Heatmap scale | Linear to max | **Square root, scaled to the 99.5th percentile**, so one spawn hot spot doesn't wash out everything else. The legend says the scale is relative. |
| Hosting | Render, Railway | **Vercel static.** Render's free tier sleeps after 15 minutes, so a reviewer's first visit would wait about 50 s. |
