# LILA BLACK · Player Journeys

A browser tool for level designers to see how players actually move through LILA BLACK's maps: where they go, where they fight, where they die, and which parts of the map nobody uses.

**Live:** https://lila-player-journeys.vercel.app

![overview](docs/overview.png)

## What you can do with it

- **Pick a map and dates.** Ambrose Valley, Grand Rift or Lockdown, across Feb 10–14. Click a date chip to isolate one day, then click more chips to add them.
- **Heatmaps** for time spent (traffic), kills, deaths, storm deaths or loot, built from whatever matches pass the filters. You can show humans, bots or both.
- **Event markers**, each with its own shape and colour: kills (crosshair), deaths (X), storm deaths (diamond), loot (square). Hover one to see who, when, and the world x/z.
- **Click any marker to replay its match.** The match opens 20 s before the event and plays into it.
- **Match playback.** Play/pause, scrub, 1–40× speed. Ticks on the timeline mark every fight. Humans are solid cyan lines with round heads; bots are dashed orange lines with square heads.
- **Grid overlay (A–J / 1–10)**, so people can say "the bridge at F6" and mean the same spot.
- **Shareable links.** The URL holds the map, the match and the playback time.

Keyboard, when a match is open: `space` play/pause, `←`/`→` step 5 s, `esc` back to the overview. Scroll to zoom, drag to pan, double-click to reset.

## Tech stack

- **Data pipeline:** Python 3.10+, pyarrow, Pillow
- **Frontend:** React 19, TypeScript, Vite, and plain canvas for rendering (no map or chart library)
- **Hosting:** Vercel, as a static site

Why I picked these, how the coordinates are mapped, and what I assumed about the data are all in [ARCHITECTURE.md](ARCHITECTURE.md). What I learned from the data is in [INSIGHTS.md](INSIGHTS.md).

## Running it locally

```bash
npm install
npm run dev          # http://localhost:5173
```

The processed data is committed under `public/data`, so this works without the raw files.

### Rebuilding the data from `player_data.zip`

```bash
unzip player_data.zip -d data/          # gives data/player_data/February_10/... and minimaps/
python3 -m venv .venv && source .venv/bin/activate
pip install -r pipeline/requirements.txt
npm run data                            # writes public/data/*.json and public/minimaps/*.webp
python pipeline/test_build.py           # checks the coordinate transform against the README example
```

The raw files are gitignored, since it's production telemetry and the tool only needs the processed output.

### Environment variables

None. The app is static, and the pipeline takes `--src` and `--out` flags (defaults: `data/player_data` and `public`).

## Deploying

The repo is set up as a Vercel project with the Vite preset (build command `npm run build`, output directory `dist`). Every push to `main` redeploys. Any static host works too: run `npm run build` and serve `dist/`.

## Layout

```
pipeline/build.py        parquet → cleaned JSON + resized minimaps
pipeline/test_build.py   coordinate / bot-detection checks
src/data.ts              data types, loading, time + coordinate helpers
src/heatmap.ts           binning, blur and colour ramp for heatmaps
src/MapCanvas.tsx        the map: pan/zoom, paths, markers, hover + click
src/Sidebar.tsx          map / date / layer filters and the match list
src/Timeline.tsx         playback controls
src/markers.ts           colours and marker shapes (shared by map and legend)
```
