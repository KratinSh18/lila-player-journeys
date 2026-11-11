"""
Turns the raw LILA BLACK telemetry (one parquet file per player per match)
into a few small JSON files the web app can load directly.

    python pipeline/build.py --src data/player_data --out public

Writes:
    public/data/manifest.json        map config, days, dataset stats
    public/data/<Map>.json           every match on that map, with journeys
    public/minimaps/<Map>.webp       resized minimaps (+ small thumbnails)

Everything that needs judgement about the data (timestamps, bot detection,
duplicates) is decided here, once, so the frontend only has to draw.
"""

import argparse
import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
from PIL import Image

# From the dataset README. Origin + scale define a square in world space
# (x, z) that the minimap image covers edge to edge.
MAPS = {
    "AmbroseValley": {"scale": 900, "originX": -370, "originZ": -473, "source": "AmbroseValley_Minimap.png"},
    "GrandRift": {"scale": 581, "originX": -290, "originZ": -290, "source": "GrandRift_Minimap.png"},
    "Lockdown": {"scale": 1000, "originX": -500, "originZ": -500, "source": "Lockdown_Minimap.jpg"},
}

# All positions are written in the README's 1024px minimap space. The images
# we ship are bigger; the frontend scales them down to this size.
MAP_PX = 1024
MAX_IMAGE_PX = 3072

MOVEMENT_EVENTS = {"Position", "BotPosition"}


def world_to_map(x, z, cfg):
    """World (x, z) -> minimap pixel in 1024 space. Image y grows downwards, hence 1 - v."""
    u = (x - cfg["originX"]) / cfg["scale"]
    v = (z - cfg["originZ"]) / cfg["scale"]
    return u * MAP_PX, (1 - v) * MAP_PX


def decode(value):
    return value.decode("utf-8") if isinstance(value, bytes) else value


def read_files(src):
    """Yield the rows of each parquet file (= one player in one match)."""
    # Day folders are February_10 .. February_14. They're only a delivery
    # partition: a match's date comes from its timestamps (see shape_match).
    day_dirs = sorted(p for p in src.iterdir() if p.is_dir() and re.match(r"[A-Z][a-z]+_\d+$", p.name))
    for day_dir in day_dirs:
        for path in sorted(day_dir.iterdir()):
            try:
                table = pq.read_table(path)
            except Exception as err:  # a corrupt file shouldn't sink the whole build
                print(f"  skipping {path.name}: {err}")
                continue
            # `ts` is typed timestamp[ms], but the stored integers are really
            # Unix *seconds* (1770727161 = 2026-02-10 12:39 UTC). Read as ms they land in
            # Jan 1970, which is what the README sample shows. Casting to int64
            # gets the raw value back without any timezone guessing.
            table = table.set_column(table.schema.get_field_index("ts"), "ts", table["ts"].cast(pa.int64()))
            rows = table.to_pylist()
            if rows:
                yield rows


def is_bot(user_id, event_names):
    # The dataset README says numeric ids are bots. Three numeric ids (1379,
    # 1402, 1429) break that in 17 files: they emit Position and Loot, which
    # only player characters do. 1429 is also an ordinary BotPosition bot in
    # three other matches, so these ids look like per-session slots rather than
    # accounts. Each file is judged by what it emits, and the id format is only
    # a fallback for files with no movement rows.
    if "Position" in event_names:
        return False
    if "BotPosition" in event_names:
        return True
    return user_id.isdigit()


def collapse_double_write(rows):
    """Three files contain their whole content twice, back to back. Keep one copy."""
    half = len(rows) // 2
    if half and len(rows) % 2 == 0 and rows[:half] == rows[half:]:
        return rows[:half]
    return rows


def build(src, out):
    stats = defaultdict(int)
    matches = {}  # match_id -> {"map", "rows": {user_id: Counter of rows}}

    for rows in read_files(src):
        stats["files"] += 1
        stats["rows"] += len(rows)
        user_id, match_id, map_id = rows[0]["user_id"], rows[0]["match_id"], rows[0]["map_id"]

        single = collapse_double_write(rows)
        if len(single) < len(rows):
            stats["doubledFilesCollapsed"] += 1
            rows = single

        # Identical rows that remain are real: timestamps are whole seconds,
        # so two loot pickups in the same second at the same spot happen.
        cleaned = Counter((r["ts"], decode(r["event"]), r["x"], r["z"]) for r in rows)

        match = matches.setdefault(match_id, {"map": map_id, "rows": {}})
        # One file (cfa03e9f.._ac049b28..) is copied verbatim into both the
        # Feb 10 and Feb 11 folders. A Counter union (max count per row) folds
        # a repeated file into one journey without double counting.
        if user_id in match["rows"]:
            stats["repeatedFilesMerged"] += 1
        match["rows"][user_id] = match["rows"].get(user_id, Counter()) | cleaned

    per_map = defaultdict(list)
    for match_id, m in matches.items():
        journeys = []
        for user_id, counter in m["rows"].items():
            rows = sorted(counter.elements(), key=lambda row: row[0])
            bot = is_bot(user_id, {row[1] for row in rows})
            if bot != user_id.isdigit():
                stats["reclassifiedJourneys"] += 1
            journeys.append({"player": user_id, "bot": bot, "rows": rows})
        per_map[m["map"]].append(shape_match(match_id, {**m, "journeys": journeys}))

    data_dir = out / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    for map_id, items in per_map.items():
        items.sort(key=lambda m: m["startedAt"])
        write_json(data_dir / f"{map_id}.json", {"map": map_id, "matches": items})

    images = export_minimaps(src / "minimaps", out / "minimaps")
    manifest = {
        "mapSize": MAP_PX,
        "maps": {
            name: {
                **{k: v for k, v in cfg.items() if k != "source"},
                **images[name],
                "matches": len(per_map.get(name, [])),
            }
            for name, cfg in MAPS.items()
        },
        "days": sorted({m["day"] for items in per_map.values() for m in items}),
        "stats": {**stats, "matches": len(matches)},
    }
    write_json(data_dir / "manifest.json", manifest, indent=2)
    print(json.dumps(manifest["stats"], indent=2))


def shape_match(match_id, m):
    cfg = MAPS[m["map"]]
    start = min(j["rows"][0][0] for j in m["journeys"])
    end = max(j["rows"][-1][0] for j in m["journeys"])
    counts = {"kill": 0, "death": 0, "storm": 0, "loot": 0}

    journeys = []
    for j in sorted(m["journeys"], key=lambda j: (j["bot"], j["player"])):
        path, events = [], []
        for t, event, x, z in j["rows"]:
            px, py = world_to_map(x, z, cfg)
            point = [t - start, round(px, 1), round(py, 1)]
            if event in MOVEMENT_EVENTS:
                path.extend(point)
            else:
                events.append([point[0], event, point[1], point[2]])
                if not j["bot"]:  # match summary counts what the humans did
                    counts[CATEGORY[event]] += 1
        journeys.append({
            "player": j["player"],
            "bot": j["bot"],
            "outcome": outcome(e[1] for e in events),
            "path": path,
            "events": events,
        })

    return {
        "id": match_id.removesuffix(".nakama-0"),
        # UTC date of the first event. The day folders mostly agree, but four
        # matches that start just before midnight sit in the next day's folder.
        "day": datetime.fromtimestamp(start, timezone.utc).date().isoformat(),
        "startedAt": start,
        "duration": end - start,
        "humans": sum(not j["bot"] for j in journeys),
        "bots": sum(j["bot"] for j in journeys),
        "counts": counts,
        "journeys": journeys,
    }


CATEGORY = {
    "Kill": "kill", "BotKill": "kill",
    "Killed": "death", "BotKilled": "death",
    "KilledByStorm": "storm",
    "Loot": "loot",
}


def outcome(event_names):
    names = set(event_names)
    if "KilledByStorm" in names:
        return "storm"
    if names & {"Killed", "BotKilled"}:
        return "killed"
    # No death recorded. Most likely an extraction, but the data has no
    # explicit extract event, so the UI calls this "survived".
    return "survived"


def export_minimaps(src_dir, out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    Image.MAX_IMAGE_PIXELS = None  # Lockdown is 9000x9000
    paths = {}
    for name, cfg in MAPS.items():
        img = Image.open(src_dir / cfg["source"]).convert("RGB")
        # GrandRift is 2160x2158, not square. The world->map transform assumes
        # the image spans the full square, so stretch the 2px rather than pad.
        size = min(max(img.size), MAX_IMAGE_PX)
        img = img.resize((size, size), Image.LANCZOS)
        img.save(out_dir / f"{name}.webp", quality=82, method=6)
        # small copy for the map picker
        img.resize((160, 160), Image.LANCZOS).save(out_dir / f"{name}_thumb.webp", quality=80)
        paths[name] = {"image": f"minimaps/{name}.webp", "thumb": f"minimaps/{name}_thumb.webp"}
    return paths


def write_json(path, payload, indent=None):
    separators = None if indent else (",", ":")
    path.write_text(json.dumps(payload, indent=indent, separators=separators))
    print(f"  wrote {path} ({path.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--src", type=Path, default=Path("data/player_data"))
    parser.add_argument("--out", type=Path, default=Path("public"))
    args = parser.parse_args()
    build(args.src, args.out)
