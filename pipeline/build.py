"""
Turns the raw LILA BLACK telemetry (one parquet file per player per match)
into a few small JSON files the web app can load directly.

    python pipeline/build.py --src data/player_data --out public

Writes:
    public/data/manifest.json        map config, days, dataset stats
    public/data/<Map>.json           every match on that map, with journeys
    public/minimaps/<Map>.webp       resized minimap images

Everything that needs judgement about the data (timestamps, bot detection,
duplicates) is decided here, once, so the frontend only has to draw.
"""

import argparse
import json
import re
from collections import Counter, defaultdict
from datetime import datetime
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


def folder_to_date(name):
    # "February_10" -> "2026-02-10". The year isn't in the folder name; the
    # timestamps put every row in Feb 2026.
    return datetime.strptime(f"{name} 2026", "%B_%d %Y").date().isoformat()


def decode(value):
    return value.decode("utf-8") if isinstance(value, bytes) else value


def read_journeys(src):
    """Yield one dict per parquet file (= one player in one match)."""
    day_dirs = sorted(
        (p for p in src.iterdir() if p.is_dir() and re.match(r"[A-Z][a-z]+_\d+$", p.name)),
        key=lambda p: folder_to_date(p.name),
    )
    for day_dir in day_dirs:
        day = folder_to_date(day_dir.name)
        for path in sorted(day_dir.iterdir()):
            try:
                table = pq.read_table(path)
            except Exception as err:  # a corrupt file shouldn't sink the whole build
                print(f"  skipping {path.name}: {err}")
                continue
            # `ts` is typed timestamp[ms], but the stored integers are really
            # Unix *seconds* (1770681535 = 2026-02-10). Read as ms they land in
            # Jan 1970, which is what the README sample shows. Casting to int64
            # gets the raw value back without any timezone guessing.
            table = table.set_column(table.schema.get_field_index("ts"), "ts", table["ts"].cast(pa.int64()))
            rows = table.to_pylist()
            if rows:
                yield day, rows


def is_bot(user_id, event_names):
    # The README says numeric ids are bots. That's true except for three ids
    # (1379, 1402, 1429) that emit Position/Loot - the human-only events - and
    # are the only player-controlled character in their matches. They look like
    # internal test accounts, so the event stream wins over the id format.
    if "Position" in event_names:
        return False
    if "BotPosition" in event_names:
        return True
    return user_id.isdigit()


def build(src, out):
    stats = defaultdict(int)
    matches = {}  # match_id -> {"map", "day", "rows": {user_id: Counter of rows}}

    for day, rows in read_journeys(src):
        stats["files"] += 1
        stats["rows"] += len(rows)
        user_id, match_id, map_id = rows[0]["user_id"], rows[0]["match_id"], rows[0]["map_id"]

        seen_positions = set()
        cleaned = Counter()
        for r in rows:
            row = (r["ts"], decode(r["event"]), r["x"], r["z"])
            if row[1] in MOVEMENT_EVENTS:
                if row in seen_positions:
                    stats["duplicatePositionsDropped"] += 1
                    continue
                seen_positions.add(row)
            # Duplicate Loot / BotKill rows are kept on purpose: timestamps are
            # whole seconds, so grabbing two items (or two kills) in the same
            # second at the same spot is normal.
            cleaned[row] += 1

        match = matches.setdefault(match_id, {"map": map_id, "day": day, "rows": {}})
        # One match crosses midnight. Its human's file exists in both day
        # folders: the Feb 10 copy is a partial snapshot of the Feb 11 one.
        # Union (max count per row) merges them without double counting, and
        # the match is filed under the earlier day.
        match["day"] = min(match["day"], day)
        if user_id in match["rows"]:
            stats["overlappingFilesMerged"] += 1
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
                "image": images[name],
                "matches": len(per_map.get(name, [])),
            }
            for name, cfg in MAPS.items()
        },
        "days": sorted({m["day"] for m in matches.values()}),
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
        "day": m["day"],
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
        paths[name] = f"minimaps/{name}.webp"
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
