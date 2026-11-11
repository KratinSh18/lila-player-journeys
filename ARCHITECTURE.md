# Architecture

**Stack, and why.**
- Python + pyarrow: reads the parquet files directly, and the data rules are easy to test in Python.
- React + TypeScript + Vite: fast to build with, and the types keep the JSON contract explicit.
- Canvas 2D: draws one image plus ~90k points quickly, and gives full control over zoom, playback and hit-testing.
- Vercel: static hosting. No server, no cold starts, and it redeploys on every push.

**Data flow.** `pipeline/build.py` reads the 1,243 parquet files, decodes and cleans them, and decides human vs bot. It groups rows into matches, projects world (x, z) to minimap pixels, and writes one JSON per map plus a manifest and resized minimaps (`public/`). The browser loads one map's JSON (~435 KB compressed), filters by date and players, then `heatmap.ts` and `MapCanvas.tsx` draw it. All judgement calls about the data live in the pipeline.

## Coordinate mapping

The dataset README gives an origin and a scale per map. They define a square of world (x, z) that the minimap covers edge to edge:

```
u = (x - originX) / scale      v = (z - originZ) / scale
px = u * 1024                  py = (1 - v) * 1024        # image y grows downwards
```

`y` is height, so it's dropped. The README says the images are 1024², but they're 4320², 2160×2158 and 9000². Positions are kept in the README's 1024 space and the image is drawn scaled into a 1024 box, so the resolution doesn't matter. Grand Rift is stretched 2 px to make it square. Checks: `test_build.py` asserts the README's worked example ((−301.45, −355.55) → (78, 890)); all 89k points plotted on their minimaps stay on roads, buildings and river beds; the tooltip shows world x/z through the inverse transform.

## Assumptions and data quirks

| Found | Did |
|---|---|
| `ts` is typed as ms but holds Unix **seconds** (read as ms, it's Jan 1970). `event` is bytes. | Read `ts` as seconds; match time = ts − the match's first ts. Decode `event` as UTF-8. |
| 3 files are written twice back to back. 1 file is copied into two day folders. | Collapse the doubled files and merge per (match, player). ~1.2k other identical Loot rows are kept, since two pickups in one second are real. |
| Positions are only logged while a player moves (every 5 s). | Traffic heatmap weights each sample by time spent there (cap 30 s). Playback holds players still through gaps. |
| Numeric ids 1379/1402/1429 emit player-only events (`Position`, `Loot`) in 17 files. | Classify each file by its events; the id format is only a fallback. |
| 4 matches sit in the next day's folder. 14 Feb is partial. | A match's date is the UTC date of its first event. The notes flag 14 Feb. |
| Usually one human file per match, and bot files in only 52 of 796. No extraction event. | Counts in the list are the human's. The overview hides bots by default. No death means "Survived". |

## Trade-offs

| Decision | Considered | Picked |
|---|---|---|
| Parse parquet | DuckDB-WASM in the browser | At build time. The data is fixed, so there's no need to download MBs of WASM on every visit. |
| Rendering | Leaflet (CRS.Simple), deck.gl, SVG | Canvas. One image plus markers doesn't need a map library's layer model, and SVG slows down past ~10k nodes. |
| Data files | One per match / one big file | One per map. Heatmaps need every match on the map anyway. |
| Heatmap scale | Linear to the max | sqrt, scaled to the 99.5th percentile, so one hot spawn doesn't wash out the rest. |
| Hosting | Render, Railway | Vercel static. Render's free tier sleeps, so the first visit would wait about 50 s. |
