# Unified payloads: people, clubs, seasons

Contract between the build (`scripts/build_site_all.py` `build_unified()`, which drives
`oddsmarkets/football/analytics/unified.py`) and the front end (`docs/site/index.html`,
`docs/site/assets/**`). Written 2 October 2026 for the redesign. Everything listed
under "Existing" keeps working unchanged; everything under "New" is additive.

All paths are relative to `docs/site/data/`. All JSON is UTF-8, compact. Ids are
**strings** in JSON keys and **numbers or strings** in values exactly as noted.
Absent keys mean "unknown"; nulls are avoided.

---

## 0. Vocabulary

| Term | Meaning |
|---|---|
| `pid` | Sofascore player id (string). One person = one pid, everywhere. |
| `tid` | Sofascore team id (string in keys, int in values). One club or national team = one tid, everywhere. |
| `slug` | Competition slug (`premier-league`, `fa-cup`, `world-cup`, `liga-argentina`, ...). |
| `sid` | Sofascore season id of one edition of one competition (int). Unique per competition-season; **the season key in every URL and directory**. Exception: `liga-argentina`, whose store holds a calendar year split into two torneos, uses strings `"2026-clausura"`, `"2026-apertura"`. |
| `season` | The edition's display label as Sofascore names it, shortened: `"26/27"`, `"2026"`, `"Apertura 2026"`, `"Clausura 2026"`. |
| `era` | A cross-competition grouping key for "single season" filters on person and club pages: `"2026/27"` for a split-year season, `"2026"` for a calendar-year one. Derived from `season`: `"26/27"` -> `"2026/27"`; `"2026"` -> `"2026"`; Liga MX / Argentina halves -> their calendar year. |
| `kind` | Competition kind, one of `league`, `domestic_cup`, `super_cup`, `continental_club`, `international`. |
| `scope` | `club` (every kind except `international`) or `international`. Present on every row so "Club only / International only" is a one-key filter. |

Kind of each competition: the 12 leagues and `liga-argentina` are `league`; cup
family `domestic` -> `domestic_cup`; `super` -> `super_cup`; `cup` (UCL, UEL, UECL,
Libertadores, Sudamericana, AFC/CAF/CONCACAF club cups, Leagues Cup, Club World Cup,
Intercontinental Cup) -> `continental_club`; `international` -> `international`.
`competitions.json` carries `kind_u` (this value) and `scope` on every entry.

---

## 1. Season dimension

### 1.1 `competitions.json` (existing file, new keys per entry)

```jsonc
{
  "slug": "premier-league", ...existing keys...,
  "kind_u": "league", "scope": "club",
  "current_season": {"sid": 96668, "season": "26/27", "era": "2026/27",
                     "status": "current" | "last_edition"},
  "seasons": [ {"sid": 96668, "season": "26/27", "era": "2026/27", "source": "live"},
               {"sid": 76986, "season": "25/26", "era": "2025/26", "source": "store"},
               {"sid": 61627, "season": "24/25", "era": "2024/25", "source": "archive"}, ... ]
}
```

- Newest first. `source`:
  - `live` - the current edition; its payloads are the existing ones in `data/<slug>/`.
  - `store` - a past edition whose matches are in the competition's store: full
    results, a table computed from them (or the official one from the archive when
    present), and player/club lines where match detail exists.
  - `archive` - an older edition known only from the archive: official standings
    and the season's top players by category. No match list.
- `status: "last_edition"` means the competition has no edition in progress or
  scheduled (Euro 2024 until the 2028 cycle, Copa América 2024, Gold Cup 2025, AFCON
  2025, ...). The UI should label it "Last edition: <season>" and not "current".
  Odds, simulations and market tabs are absent for such a competition (they are
  already absent for internationals).

### 1.2 `data/<slug>/seasons.json` (new)

Same list as above with more detail, for the season picker of one competition:

```jsonc
{
  "slug": "premier-league", "current": 96668,
  "seasons": [
    {"sid": 96668, "season": "26/27", "era": "2026/27", "name": "Premier League 26/27",
     "source": "live", "path": "",                      // "" = the existing payloads in data/<slug>/
     "matches": 380, "finished": 50, "detail": 50},
    {"sid": 76986, "season": "25/26", "era": "2025/26", "name": "Premier League 25/26",
     "source": "store", "path": "s/76986/",
     "matches": 380, "finished": 380, "detail": 6,
     "champion": {"team": "Arsenal", "tid": 42}},        // when known
    {"sid": 61627, "season": "24/25", "era": "2024/25", "name": "Premier League 24/25",
     "source": "archive", "path": "s/61627/", "champion": {...}}
  ],
  "updated_at": "..."
}
```

### 1.3 `data/<slug>/s/<sid>/season.json` (new; one file per past season)

```jsonc
{
  "slug": "premier-league", "sid": 76986, "season": "25/26", "era": "2025/26",
  "name": "Premier League 25/26", "source": "store" | "archive",
  "standings": [                // same row shape as table.json "standings" rows, minus model columns
     {"pos": 1, "team": "Arsenal", "tid": 42, "played": 38, "w": 26, "d": 8, "l": 4,
      "gf": 80, "ga": 30, "gd": 50, "pts": 86, "group": null, "note": "Champions League"}
  ],
  "standings_source": "official" | "computed",   // archive table, or computed from results
  "groups": ["A", "B", ...],                       // cups with groups; standings rows carry "group"
  "fixtures": [                 // store seasons only; same row shape as fixtures.json "matches" (no "model")
     {"id": "12345", "date": "...", "round": 1, "stage": "league", "status": "finished",
      "home": "Arsenal", "away": "Chelsea", "home_id": 42, "away_id": 38, "hs": 2, "as": 1,
      "xg": [1.8, 0.9], "detail": true, "agg_winner": null, "winner": null}
  ],
  "bracket": [ {"round": "final", "home": ..., "away": ..., "hs": ..., "as": ..., "winner": ...} ],  // knockout ties, when any
  "players": [ ...players_live.json rows (same keys, percentiles within this season)... ],   // store seasons with detail only
  "metrics": [...],             // present when "players" is
  "leaders": {"goals": [{"id": "839956", "name": "...", "team": "...", "tid": 17, "value": 27}], "assists": [...], "rating": [...], ...},
  "detail_matches": 6,          // how many matches the player lines come from: say so in the UI when small
  "updated_at": "..."
}
```

- Archive seasons have `standings` (official) and `leaders` (Sofascore's top players
  of that season, by category) only.
- Match pages for past-season matches with detail are written to the existing
  `data/<slug>/matches/<id>.json` shard, so `#/match/...` links keep working.
- `history/<slug>.json` (existing, built from the archive) is kept for the old UI
  and is superseded by `seasons.json` + `s/<sid>/season.json`.

---

## 2. People registry

### 2.1 `data/people_index.json` (new; one row per person, deduplicated)

Column-oriented for size:

```jsonc
{
  "fields": ["id", "name", "pos", "nat", "dob", "club_tid", "club", "nt_tid", "nt",
             "comps", "min", "last"],
  "rows": [
    ["839956", "Erling Haaland", "F", "NOR", "2000-07-21", 17, "Manchester City", 4705, "Norway",
     ["premier-league", "champions-league", "wc-qual-uefa"], 1234, "2026-09-27"]
  ],
  "updated_at": "..."
}
```

- `club_tid`/`club` - the **current club** (section 2.3). `nt_tid`/`nt` - the national
  team he last played for (absent if none).
- `comps` - slugs he has appearances in, current era first. `min` - minutes in the
  current era across all competitions. `last` - date of his latest appearance.
- Sorted by `min` descending. Search should use this file instead of `search.json`'s
  player list (which has one row per player per competition).

### 2.2 `data/people/<pid>.json` (new; one file per person)

```jsonc
{
  "id": "82474", "name": "Ander Herrera", "short_name": "A. Herrera", "slug": "ander-herrera",
  "pos": "M", "nat": "ESP", "dob": "1989-08-14", "age": 37, "height": 182, "shirt": "21",
  "current_club": {"tid": 3202, "name": "Boca Juniors", "source": "roster" | "appearances" | "profile",
                   "as_of": "2026-10-02"},      // absent when unknown (e.g. retired / free agent)
  "national_team": {"tid": 4698, "name": "Spain"},
  "comps": {                                   // lookup for the rows below
     "liga-argentina": {"name": "Liga Argentina", "kind": "league", "scope": "club"},
     "libertadores":   {"name": "Libertadores", "kind": "continental_club", "scope": "club"}
  },
  "teams": {"3202": {"name": "Boca Juniors", "national": false, "crest": "assets/crests/3202.png"}},
  "apps_fields": ["date", "gid", "comp", "sid", "tid", "opp_tid", "opp", "home", "res", "start",
                  "min", "g", "a", "xg", "xa", "rt", "sh", "kp", "yc", "rc"],
  "apps": [                                     // every appearance in every store, newest first
     ["2026-05-29", "13981234", "libertadores", 87760, 3202, 4567, "Universidad Catolica", 1, "W 2-0", 0,
      45, 0, 0, 0.02, 0.10, 6.8, 0, 1, 0, 0]
  ],
  "seasons": [                                  // one row per (competition, season, team)
     {"comp": "liga-argentina", "kind": "league", "scope": "club", "sid": 87913, "season": "Apertura 2026",
      "era": "2026", "tid": 3202, "team": "Boca Juniors", "source": "store",
      "apps": 12, "starts": 9, "min": 550, "g": 1, "a": 2, "xg": 0.9, "xa": 1.1, "rt": 6.9,
      "line": { ...the full players_live.json row for that competition-season when it exists... }}
  ],
  "archive": [                                  // careers from the archive (older seasons, Sofascore's season totals)
     {"comp": "la-liga", "tournament": "LaLiga", "kind": "league", "scope": "club", "season": "18/19",
      "era": "2018/19", "team": "Athletic Club", "apps": 30, "min": 2300, "g": 3, "a": 4, "rt": 7.0, "source": "archive"}
  ],
  "transfers": [ {"date": "2026-07-01", "from_tid": 3202, "from": "Boca Juniors", "to_tid": ..., "to": "...", "type": "free"} ],  // when fetched
  "updated_at": "..."
}
```

Filtering in the UI: All = every row; Club only = `scope == "club"`; International
only = `scope == "international"`; one competition = `comp == slug`; one season =
`era == X`. `seasons` is the pre-aggregated table; `apps` is the match log for
charts and for any custom aggregate (e.g. a calendar window). `archive` rows are
season totals only (no match log) and never overlap a `seasons` row for the same
competition-season (the store wins).

### 2.3 What "current club" means

In order of preference:

1. `roster` - the club whose current Sofascore squad (`/team/{tid}/players`, fetched
   on a rotation into `data/squads/store.json`) lists him. If two rosters list him (a
   loan, or a stale roster), the more recently fetched wins.
2. `profile` - `player_details` (`/player/{pid}`, in the archive) names a club and
   that profile is newer than his last appearance.
3. `appearances` - the club of his latest club appearance across **all** stores.
   Only used when no roster covers any of his candidate clubs.

A player listed by no fetched roster whose latest-appearance club **has** a fetched
roster is treated as having left: no `current_club` (or the `profile` club), and he
is not in that club's squad.

---

## 3. Club registry

### 3.1 `data/clubs_index.json` (new; one row per club or national team)

```jsonc
{
  "fields": ["id", "name", "slug", "country", "national", "crest", "home", "comps"],
  "rows": [[17, "Manchester City", "manchester-city", "ENG", 0, "assets/crests/17.png",
            "premier-league", ["premier-league", "champions-league", "efl-cup", "fa-cup"]]],
  "updated_at": "..."
}
```

`home` - the club's domestic league slug (or `null` if it plays in no followed
league); `national` - 1 for a national team. Replaces `search.json`'s team list
(which has PSG seven times).

### 3.2 `data/clubs/<tid>.json` (new; one file per club or national team)

```jsonc
{
  "id": 17, "name": "Manchester City", "slug": "manchester-city", "country": "ENG",
  "national": false, "crest": "assets/crests/17.png", "home": "premier-league",
  "names": {"premier-league": "Manchester City", "champions-league": "Man City"},   // name per competition, for routing into existing pages
  "squad": {
    "source": "roster" | "appearances", "as_of": "2026-09-30",
    "players": [ {"id": "839956", "name": "Erling Haaland", "pos": "F", "shirt": "9",
                  "nat": "NOR", "dob": "2000-07-21", "age": 26, "height": 195,
                  "min": 450, "apps": 5, "g": 5, "a": 0, "rt": 7.6} ]           // current-era club minutes and totals
  },
  "seasons": [   // one row per (competition, season)
    {"comp": "premier-league", "kind": "league", "scope": "club", "sid": 96668, "season": "26/27",
     "era": "2026/27", "source": "live",
     "pos": 1, "played": 6, "w": 5, "d": 1, "l": 0, "gf": 15, "ga": 4, "pts": 16,     // league / group position when any
     "stage": "league" | "r16" | "final" | "winner" | ...,                         // how far it went in a cup
     "rating": {"attack": 1.62, "defence": 0.71, "elo": 1712}                     // the model's strength, current seasons
    }
  ],
  "matches": [   // every match in every store, newest first (all seasons in the stores)
    {"id": "12345", "comp": "premier-league", "sid": 96668, "date": "...", "home": 1, "opp_tid": 38,
     "opp": "Chelsea", "status": "finished", "gf": 2, "ga": 1, "xg": [1.8, 0.9], "detail": true,
     "model": {"h": 0.55, "d": 0.24, "a": 0.21}}
  ],
  "pool": {"rating": 1.23, "rank": 3},          // pooled cross-league strength (clubs only), when fitted
  "updated_at": "..."
}
```

- National teams (`national: true`) have the same shape: `squad.source` is
  `appearances` (the latest call-up: players who appeared in its last
  international window), `seasons` are their tournament/qualifier editions.

---

## 4. Squads store (fetcher output; never loaded by the page)

`data/squads/store.json`, written by `scripts/fetch_sofascore_squads.py`, committed by
the hourly task with the other stores:

```jsonc
{"teams": {"3202": {"name": "Boca Juniors", "fetched_at": "2026-10-02T05:01:00Z",
                    "players": [{"id": "...", "n": "...", "pos": "M", "no": "21",
                                 "dob": 619056000, "c": "ARG", "h": 182}]}},
 "meta": {"updated_at": "..."}}
```

---

## 5. Removed

- `data/ballon-dor/` and the `#/ballon-dor` page's data. The build no longer writes
  it. The front end should drop the nav entry and the route (`core.js` nav,
  `global.js` page) and any Ballon d'Or text in the methodology/glossary.
- `glossary.json` loses its Ballon d'Or entries.

---

## 6. Backwards compatibility

Unchanged: `competitions.json` (new keys only), `hub.json`, `search.json`,
`season_index.json`, `players_global.json`, `players_lab*.json`, `pool.json`,
`nations.json`, `careers/`, `history/`, and every `data/<slug>/*.json` current-season
payload. They can be retired by the front end once it reads the new files; tell the
backend and they will be dropped from the build.

---

## 7. Front-end changes requested (for the front-end agent)

1. Season picker on every competition page, from `competitions.json` `seasons`
   (or `data/<slug>/seasons.json`); a past season renders from
   `data/<slug>/s/<sid>/season.json` (table, results, bracket, players, leaders) and
   hides model tabs (probs, power, market, history).
2. `status: "last_edition"` competitions: label "Last edition" instead of current.
3. Person page `#/player/<pid>` from `data/people/<pid>.json`, with an
   All / Club / International / competition / season filter over `seasons` and `apps`,
   showing `current_club`.
4. Club page by team id (e.g. `#/club/<tid>`) from `data/clubs/<tid>.json`, with the
   same filters over `seasons` and `matches`; the squad from `squad.players`. Existing
   `#/<slug>/team/<club>` links can redirect via `names`.
5. Search from `people_index.json` and `clubs_index.json` (one row per entity).
6. Remove the Ballon d'Or nav entry, route and copy.
7. Club squad lists in competition pages (`pages.js` around line 317, which filters
   `players_live` by latest club in that store) should read `clubs/<tid>.json`
   `squad.players` instead, so a player who left is not listed.

---

## 8. Front-end requests

From the front-end agent, 2 October 2026. The front end (core.js, seasons.js, people.js)
is built against sections 1-3 as written; these are the points it relies on or would
like settled. Nothing here blocks: each has a fallback in the page.

1. **Standings rows carry `tid`, archive seasons included.** Archive tables spell clubs
   differently from the stores ("Liverpool FC", "Brighton & Hove Albion"); without a
   `tid` the page folds names to find the club, and some still miss. Same for
   `leaders` rows (`tid` beside `team`) and `bracket` ties (`home_id`, `away_id`).
2. **`champion` only when the winner is known.** For a cup, an archive season's
   standings are its league or group phase; the top row is not the winner. Please set
   `seasons.json` `champion` for cups only from a final (or leave it out). The page
   labels a cup's top row "Top of the league phase", never "Champion".
3. **`clubs/<tid>.json` `matches[].model`**: the page reads `h/d/a` as the fixture's
   home / draw / away (as in `fixtures.json`), not from the club's side. Please keep it
   that way, or say so if it is the club's perspective.
4. **`people/<pid>.json` `apps[].res`** is read as "W 2-0" from the player's side
   (first letter W/D/L, then goals for-against). `apps[].tid` should match a key of
   `teams` so the "For" column can name the team.
5. **Every `ok` competition has `current_season.sid`** (the season picker's value for
   the live edition, and `?s=` routing compares against it). Liga Argentina and the
   Liga MX halves need it too.
6. **Keep `history/<slug>.json` until `s/<sid>/season.json` exists for every archive
   season**: the page falls back to it when a season file is missing (it reads
   `seasons[].season_id`, `year`, `standings`, `leaders`). Likewise `careers/` and
   `season_index.json` are now read only as fallbacks when `people/<pid>.json` is
   missing; `search.json` only when `people_index.json` / `clubs_index.json` are
   missing. All four can be retired once the new files are complete. `search.json`
   is still read by the Compare page's pickers (they need a competition per player),
   so keep it until that page moves to the people index.
7. **`people_index.json` `nt_tid` / `nt` and `club_tid` / `club`** are what the club
   page uses to flag internationals in a squad (and clubs in a national team's
   call-up). Please fill them for every person who has them.
8. **Section 7 item 7 (club squads in competition pages)**: the competition dossier on
   the club page is now titled "Players in <competition>" and lists this season's lines
   in that competition (a player who left still has his minutes there); the current
   squad shown on the club page is `clubs/<tid>.json` `squad.players` only.
9. **Last edition**: the page hides the Probabilities, Market and History tabs for a
   `last_edition` competition even if `tabs` lists them, and shows the final's winner
   from `fixtures.json` (`round == "final"`). A `winner` on the competition entry would
   be cleaner.

---

## 9. As built (2 October 2026): settled details and answers to section 8

Where this section and sections 1-4 differ, this section is what the build writes.

- **No timestamps in shards.** `people/<pid>.json`, `clubs/<tid>.json` and
  `s/<sid>/season.json` carry no `updated_at`, so an unchanged rebuild leaves them
  byte-identical; the two indexes and `seasons.json` do carry one.
- **Team ids everywhere (8.1).** Standings rows, `leaders` rows (`tid` beside `team`)
  and `bracket` rows (`home_id`, `away_id`) carry ids. Archive spellings are matched
  to the stores' clubs ("Liverpool FC" -> Liverpool, "Brighton & Hove Albion" ->
  Brighton): exact name, then without club affixes (FC, AFC, CF, SC, ...), then the
  single club whose words contain the name's; never a guess between two. About 88% of
  archive standings rows match today; the rest are clubs no store has seen (old cup
  entrants) and fill as the past-results backfill and the archive's new `team_id`
  arrive.
- **Champions (8.2).** A cup's `champion` comes only from a decided final. A league's
  comes from the top of a single official or computed table of a finished season.
  Last-edition competitions carry `winner` {team, tid} on their `competitions.json`
  entry and in `seasons.json` (8.9).
- **Season `source` on person and club rows.** `live` only while the competition's
  current edition is in progress; a finished edition (World Cup 2026, Club World Cup
  2025, Euro 2024) is `store` on those rows. `seasons.json` keeps `source: "live"` on
  the newest row (its payloads are the existing ones) with `status` beside it.
- **Archive season rows** in `people/<pid>.json` use the same keys as `seasons` rows:
  `apps`, `starts`, `min`, `g`, `a`, `xg`, `xa`, `rt`, plus `comp` (null when the
  tournament is not one the site follows), `tournament`, `kind`, `scope`, `season`,
  `era`, `team`, `source: "archive"`.
- **`current` flags (follow-up 5).** Each `seasons` row of a person has `current`:
  true when the row's team is his current club (club rows) or his national team
  (international rows). Every row of every club competition's `players_live.json` has
  `current`: false when the player's current club is not the club the row is for (he
  has left; his minutes there stay).
- **`line`** (the competition's full season line) is on a `seasons` row only above 90
  minutes, without the identity keys already on the person (`player_id`, `name`,
  `team`, `position`, ...).
- **Results.** `apps[].res` and `clubs/<tid>.json` `matches[].res` are from the
  player's / club's side, the score after extra time; a shoot-out is appended:
  `"D 2-2, lost 2-4 pens"` (or `"won on pens"` when the shoot-out score is not yet
  stored). Club `matches[]` also carry `gf`, `ga`, `pens` (club's side first) and
  `through` (1/0) for knockout matches. W/D/L and points never count a shoot-out.
  Note: France 4-6 England (World Cup 3rd place, 18 Jul 2026) is the real score after
  90 minutes (Sofascore event 12813003: normal time 4-6, no penalties).
- **`matches[].model`** on club pages is the fixture's `{h, d, a}` from the fixture's
  home side, exactly as `fixtures.json` (8.3); it is present only for matches still to
  play.
- **`current_club`** follows 2.3. `profile` comes from the squads fetcher's departure
  lookups (`squads/store.json` `people`) or the archive's player details, whichever is
  newer than his last appearance. Herrera (82474): Boca's roster no longer lists him;
  his profile (Real Zaragoza) is recorded by the next hourly squads run.
- **Squads store** also holds `people` {pid: {team_id, team, name, fetched_at}} (where a
  departed player went) and `pending` (departures still to look up).
- **Past seasons with results but no archive table** have `source: "archive"`, a
  `fixtures` list and a computed table.

---

## 10. Audit (2 October 2026): what changed for a reader

- **Season labels follow the name.** `season` is the season the competition's name
  states ("UEFA Super Cup 2026", "Euro 2020", "Super Cup 22/23"), not Sofascore's
  `year` field; a qualifying competition is labelled by the tournament it leads to
  ("World Cup Qualification, CONMEBOL" -> "2026"). `era` still comes from the year.
  Two editions with one label (two Trophees des Champions named "2026") fall back to
  their years; if still alike, the older one reads "<label> (earlier)".
- **Champions.** A league's `champion` is the top of its table (a split league's
  championship round); a league "final" is a relegation or promotion play-off and
  crowns no one, except in Liga MX, MLS and the Argentine torneos, whose title is
  decided in a play-off. A final in a qualifying stage (the Club World Cup play-in)
  crowns no one.
- **`status: "last_edition"`** once nothing is left to play and the edition is
  decided: its final played, a super cup's one tie done; otherwise (no final in the
  store) after 30 days for a league or a qualifying competition and 120 days for a
  knockout cup, which can sit between rounds for months.
- **Club season rows.** A league row's `played`/`w`/`d`/`l`/`gf`/`ga` are its league
  phase (play-offs and relegation ties apart); an archive row has the table's
  `played` and no record. `stage` values add `runner-up`, `qualified` and `po-final`
  (a qualifying competition's play-off final), `r1`..`r8` (a national cup's numbered
  rounds), `q1`..`q4` (continental qualifying rounds) and `prelim`. Friendlies carry
  no position or points. A club in several blocks of an official table takes its
  position from its own zone or table, never from an aggregate (annual table,
  relegation averages).
- **`clubs/<tid>.json` `matches[].xg`** (the club's side first) from the store's team
  statistics; `squad.as_of` is the latest *played* match.
- **Past seasons.** A postponed or cancelled copy of a fixture played under another
  id is dropped; an official table gains W, D, L and goals when the season's results
  account for every club's games; an archive season with nothing to show (no table,
  results or leaders) is not listed.
- **People.** `current_club.name` is the registry's spelling; a season row carries the
  competition's `line` only when the line's minutes are that row's (a mid-season
  transfer has one line for two clubs); archive rows carry `tid` when one club matches
  the archive's spelling; shirt numbers come from club competitions only; every player
  a competition's `players_live.json` lists has a person file.
