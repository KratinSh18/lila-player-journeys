"""Run with `python pipeline/test_build.py` (or pytest)."""

from build import MAPS, collapse_double_write, is_bot, outcome, world_to_map


def test_readme_worked_example():
    # The dataset README walks through this exact point: it should land on (78, 890).
    px, py = world_to_map(-301.45, -355.55, MAPS["AmbroseValley"])
    assert (round(px), round(py)) == (78, 890)


def test_map_corners():
    cfg = MAPS["Lockdown"]
    assert world_to_map(cfg["originX"], cfg["originZ"], cfg) == (0, 1024)  # origin is bottom-left
    assert world_to_map(cfg["originX"] + cfg["scale"], cfg["originZ"] + cfg["scale"], cfg) == (1024, 0)


def test_bot_detection_trusts_events_over_id():
    assert is_bot("1440", {"BotPosition", "BotKill"})
    assert not is_bot("f4e072fa-b7af-4761-b567-1d95b7ad0108", {"Position", "Loot"})
    assert not is_bot("1429", {"Position", "Loot"})  # numeric id, but player-controlled
    assert is_bot("382", {"BotKilled"})  # no movement rows: fall back to the id


def test_double_written_file_is_collapsed():
    rows = [{"ts": 1, "event": b"Loot"}, {"ts": 2, "event": b"BotKill"}]
    assert collapse_double_write(rows + rows) == rows
    assert collapse_double_write(rows) == rows
    # two genuine loot pickups in the same second must survive
    same_second = [{"ts": 1, "event": b"Loot"}, {"ts": 1, "event": b"Loot"}, {"ts": 2, "event": b"Position"}]
    assert collapse_double_write(same_second) == same_second


def test_outcome():
    assert outcome(["Loot", "KilledByStorm"]) == "storm"
    assert outcome(["BotKill", "BotKilled"]) == "killed"
    assert outcome(["Loot"]) == "survived"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
    print("ok")
