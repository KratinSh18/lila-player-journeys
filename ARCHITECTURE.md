# Architecture

**What I used and why.** Python and pyarrow for the pipeline, since they read parquet directly and the rules are easy to test. React, TypeScript and Vite for the app, quick to build with typed JSON. Canvas 2D for the map, fast with ~60k points. Vercel for static hosting with no server.

**Data flow.** `pipeline/build.py` runs once at build time. It reads the 1,243 parquet files, cleans them, decides human vs bot, groups rows into matches, converts world (x, z) to minimap pixels and writes one JSON per map. The browser loads the selected map's JSON (up to ~435 KB compressed), filters it by date and player type, and `MapCanvas.tsx` draws it.

**Coordinate mapping.** Each map's origin and scale (from the dataset README) mark out the square of world space the minimap covers:

```
u = (x - originX) / scale      v = (z - originZ) / scale
px = u * 1024                  py = (1 - v) * 1024    # image y grows downwards
```

`y` is height, so I drop it. The minimaps are really 4320, 2160x2158 and 9000 px wide, so positions stay in 1024 space and each image is drawn into a 1024 box. `test_build.py` checks that the README example (-301.45, -355.55) lands on (78, 890), and plotting all 89k points puts them on roads and buildings.

**Assumptions.**

- `ts` is typed ms but holds seconds, and `event` is bytes. I read seconds and decode UTF-8.
- 3 files are written twice and 1 sits in two day folders. I keep one copy of each.
- Positions only come while a player moves, so traffic is weighted by time spent (max 30 s).
- Numeric ids 1379, 1402, 1429 act like players, so events, not ids, decide human vs bot.
- A match's day is the UTC day of its first event (one is 9 Feb, 23:58). 14 Feb is partial.
- Only 52 of 796 matches have bot files, so bots start hidden in the overview.
- There is no extraction event, so a run with no death is called "Survived".

**Trade-offs.**

| Decision | Considered | Chose |
|---|---|---|
| Parse parquet | DuckDB-WASM in the browser | Build time, no WASM per visit |
| Rendering | Leaflet, deck.gl, SVG | Canvas, SVG slows past ~10k nodes |
| Data files | One per match | One per map, heatmaps need all |
| Heatmap scale | Linear to the max | Square root, 99.5th percentile |
| Hosting | Render | Vercel, Render's free tier sleeps |
