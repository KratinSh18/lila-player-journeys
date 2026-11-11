# Three things I learned from the data

All numbers come from the processed data in `public/data` (human journeys only unless I say otherwise). The links open the live tool on the right map or match. Grid references (like `E6`) use the tool's A–J / 1–10 grid. Turn it on with the Grid toggle under Show.

---

## 1. Grand Rift: the Mine Pit has a fifth of the traffic and three quarters of the deaths

**What caught my eye.** On Grand Rift I flipped the heatmap from Traffic to Deaths, expecting roughly the same picture. Instead, the deaths collapse into one spot, the Mine Pit in the middle of the map. The two "Quarters" compounds get just as much foot traffic and almost no one dies there.

**Evidence** ([open Grand Rift](https://lila-player-journeys-one.vercel.app/#map=GrandRift), turn on Grid, switch the heatmap between Traffic and Deaths)

| Area | Share of time spent | Combat deaths |
|---|---|---|
| Mine Pit (E5–E7, F5–F7) | 22% | **19 of 25 (76%)** |
| Labour + Engineer's Quarters (B5–C6, H6–I7) | 23% | **0** |

- 43 of the 59 Grand Rift runs pass through the pit, and 19 of those 43 players (44%) die inside it.
- The pit is packed with bots. Humans get 90 bot kills per 1,000 samples there, against 48 map-wide. Players win most of those fights (74 kills to 19 deaths), but 19 of the 34 players who fight in the pit die there.
- Ambrose Valley has a milder version: cells C5–E6 hold about half of all deaths on less than a quarter of the traffic.

**Actionable.**
- Make the pit floor survivable: add cover and a second way out of E5–E7, or cut the number of bots placed inside it.
- If the Quarters are meant to carry some risk, move a bot patrol or better loot there. Leave Labour Quarters (B5) alone, because 16 of the 59 runs spawn there, and danger next to a spawn turns into spawn camping.
- Metrics that should move: the pit's share of deaths (76% now), the share of pit visitors who die there (44%), and Grand Rift's combat death rate (25 of 59 runs).

**Why a level designer should care.** One room decides most Grand Rift matches, and the rest of the map has no risk at all. Both causes, the geometry and where bots are placed, belong to the level team.

---

## 2. Ambrose Valley: one spawn point loses 28% of its players in the first two minutes

**What caught my eye.** I sorted Ambrose Valley's deaths by how early they happened. A lot of the really short runs started in the same place: the west road at C7.

**Evidence** ([open Ambrose Valley](https://lila-player-journeys-one.vercel.app/#map=AmbroseValley), filter the match list to **Died** and sort by **Shortest**, then play a few)

| Spawn | Killed within 120 s |
|---|---|
| C7 (west road) | **21 of 75 runs (28%)** |
| The other 8 spawns combined | 20 of 493 runs (4%) |

- The early deaths land just north and east of the spawn: C6 (7), C7 (5), D6 (5), E6 (2), D7 and F6 (1 each). That's the cluster of houses south of the walled compound.
- 10 of those 21 players hadn't picked up a single item before dying.
- Overall survival from C7 isn't much worse than from other spawns. The difference is that C7 players who die, die immediately.
- An example to watch: [match 8e942dbd](https://lila-player-journeys-one.vercel.app/#map=AmbroseValley&match=8e942dbd-50e4-45b4-850f-d74de6224341&t=0). Press play. The player is dead by 1:55.

**Actionable.**
- Move the C7 spawn further south or west, away from the C6/D6 houses, or keep bots out of C6/D6 for the first two minutes.
- Metric that should move: C7's early-death rate, from 28% down toward the 0–9% that every other spawn already has. Also watch zero-loot deaths from C7 and session length for players who spawn there.

**Why a level designer should care.** A player can't avoid a bad spawn. One in four people who start at C7 lose before they've made a real decision, which is the kind of match that makes someone close the game. The fix is one spawn point or one bot placement.

---

## 3. Lockdown: in the last few minutes only the storm kills, and it kills half the players who stay

**What caught my eye.** On Lockdown the match list was full of long runs ending in a purple "Storm" badge. Ambrose Valley mostly shows green "Survived" at the same lengths.

**Evidence** ([open Lockdown](https://lila-player-journeys-one.vercel.app/#map=Lockdown), filter the match list to **Storm** and sort by **Longest**)

| Players still alive at 10:50 (650 s) | Died to storm | Killed | Survived |
|---|---|---|---|
| Lockdown | **17 of 35 (49%)** | 0 | 18 |
| Ambrose Valley | 17 of 94 (18%) | 9 | 68 |

- After about 10:40, no one on Lockdown is killed by a bot. Every late death is the storm.
- One player accounts for 6 of the 17 storm deaths. Even without them it's 11 of 29 (38%), still double Ambrose Valley.
- Players pick up loot more slowly on Lockdown (1.7 items per minute against 2.7 on Ambrose Valley). People who stay late are likely trying to fill their bags, and they run out of time.
- An example: [match 18c1b2c6](https://lila-player-journeys-one.vercel.app/#map=Lockdown&match=18c1b2c6-4f87-4200-9816-68fa448de33b&t=760). The player reaches the east edge (I5) at 13:34 and dies to the storm in I4 at 13:44.

**Actionable.**
- Try the cheap fixes first: a clearer storm or extraction warning before 10:30, and more loot on Lockdown so bags fill sooner.
- If the storm share doesn't drop, delay or slow the final storm phase by 60–90 s, or add an extraction point closer to where late players end up.
- Metrics that should move: storm deaths as a share of players alive at 650 s (49% now, Ambrose Valley sits at 18%), and Lockdown loot per minute.

**Why a level designer should care.** A storm death throws away everything the player collected. On Lockdown it hits exactly the players who commit to a full match. With no bot threat late in the match, the outcome comes down to loot pace and distance to an exit, and both are level design decisions.

---

### Caveats

- The data almost always has one human file per match, so there's no real PvP in it. The only 3 `Kill` rows each sit at the same second and spot as that player's own death. These findings are about bots, geometry and timing, not about players fighting each other.
- "Survived" means no death was recorded. The data has no explicit extraction event.
- Samples get small in places: Grand Rift has 59 runs, and the Lockdown late-game table has 35. I picked the cut-offs (120 s, 650 s) after looking at the data, so treat the exact numbers as directional. The gaps are large enough that a different cut-off doesn't change the conclusion.
