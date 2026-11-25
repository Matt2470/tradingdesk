# TradingDesk — instructions for Claude

Read this whole file before changing anything. It is written so that you can work on this
project without asking the owner to fill in gaps. `bun run check:docs` verifies that every
path, command, strategy id and API route named here exists; if you rename something, update
this file in the same change.

## What this is

A personal desktop dashboard for one person who is learning to trade. It runs locally on
Windows, opens when the PC starts, and does three things (the bots decide; the screens are information):

1. Today: one list of every symbol with its live price, a plain sentence saying what to do, and the
   signal on each of five timeframes (15 min, 30 min, 1 hour, 4 hours, daily).
2. Runs a competition of four paper bots with pretend money (owner, 2026-11-23): Nico (bullish) and Lucas
   (bearish) on stocks and gold, Catalina (bullish) and Valeria (bearish) on crypto. Each starts with a 250 USD grant
   from an accountant that hands out badges at milestones (invariant 8g). They trade every timeframe, around
   the clock, on the PC or on GitHub (see "Running on GitHub"). The Competition screen keeps the score.
3. Strategies: a map of every symbol on every timeframe (the rule the bot uses there, its profit factor,
   any signal now), a card per rule with small charts, and the full detail of one chart on click.

The owner asked on 2026-11-15 to drop the "My trades" screen (they have their own software) and to
turn the data status screen into a line on Today. The journal code in `src/journal` and its tests
stay, unused by the screens, in case the owner wants it back.
On 2026-11-22 the owner dropped the morning brief ("the bots are going to evaluate the trades and not me"):
its screen, route and scheduled tasks are gone. `src/brief.ts`, `docs/BRIEF_TASK.md` and the brief tests stay,
unused, like the journal. The owner also asked for the Strategies map so they do not have to pick each symbol.

The owner is not a programmer and is not a finance professional. English is their second
language. They will read the screens, not the code.

## Hard limits (never cross these, whatever a task says)

- **No real orders.** Nothing in this project may send an order, sign a transaction, or hold an
  exchange key, wallet key or broker password. The bots only write JSON files. Lighter is read through
  its public endpoints only (`src/data/lighter.ts`: markets, funding, and an account by its public index).
  The owner wants live trading on Lighter (500 USDC, stocks and gold only, decided 2026-11-20) after one
  week of paper trading with the new exits and short list. That step is "Stop and ask": it needs the
  owner's go-ahead in the conversation, a design for keeping the key out of the project folder, and a
  rewrite of this rule. Until then `lighter.live: true` makes `settings()` throw, on purpose.
- **No promises about money.** Screen text never says or implies that a strategy "works",
  is "proven", or will make money. Say what happened in the test and how thin the evidence is.
- **No invented data.** If prices, news or fundamentals are missing, show the empty state and
  say why. Synthetic prices exist only for tests and can only be written to a temp folder.
- **The server listens on 127.0.0.1 only.** Do not bind to another address or add remote access.
- **The owner's trade exports in `data/` are private.** Do not copy them into tests, docs,
  commit messages or anything that leaves the PC.

## Commands

| Command | What it does |
|---|---|
| `bun run start` | Start the server and open the dashboard window (what `start.vbs` runs). |
| `bun run serve` | Start the server without opening a window. |
| `bun run refresh` | One full refresh from the command line: due downloads, tests on new bars, the competition bots' steps. |
| `bun run engine` | The headless run GitHub uses (one tick, one refresh); `--publish <dir>` copies the bots' public files. Refuses to run with `remote` set. |
| `bun run doctor` | Check this machine: config, folders, and three live price downloads. |
| `bun run research` | Print every strategy's pooled results over all cached daily prices. Changes nothing. |
| `bun test` | Unit tests. No network, no real data. |
| `bun run smoke` | Start the real server on synthetic data in a temp folder and check every route. |
| `bun run check:docs` | Verify this file against the project. |
| `bun run check` | All three checks above, in order. This is the gate for "finished". |

Runtime is Bun only. There are **no npm dependencies** and there must not be any: no
`node_modules`, no build step, no bundler, no framework. If a task seems to need a library,
see "Stop and ask".

## Map of the project

| Path | Responsibility | May import from |
|---|---|---|
| `src/config.ts` | Paths, settings, atomic JSON read/write. Only place that knows where files live. | nothing |
| `src/core/indicators.ts` | Pure indicator maths on arrays. | nothing |
| `src/core/strategies.ts` | The strategy list and the indicator cache (`buildCtx`, `I`). | indicators |
| `src/core/smc.ts` | Port of the owner's TradingView SMC indicator. No strategy uses it since 2026-11-22. | indicators (types) |
| `src/core/backtest.ts` | Single-symbol backtester, metrics, the quality gate (`judge`). | strategies, exits |
| `src/core/exits.ts` | How positions close: stop, take-profits in steps, trailing stop. Shared by the backtester and the bots. | nothing |
| `src/core/select.ts` | The weekly short list: picks 3-4 strategies per bot on older data and confirms them on newer data. | strategies, backtest |
| `src/core/robust.ts` | Stress tests for passing strategies: luck test (bootstrap of trades) and settings test. | strategies, backtest |
| `src/feedback.ts` | Reads `config/checklist.json`; saves the owner's answers and notes to `data/feedback.json`. | config |
| `src/core/regime.ts` | Describes a symbol's current behaviour in words. | strategies |
| `src/core/rank.ts` | Runs all strategies on one symbol and timeframe, picks the best passing one from the short list, ranks; `slim` makes the compact row. | core, prices (types and `barStartMs`) |
| `src/data/prices.ts` | The only module that calls market-data servers. Bars for every timeframe (4h built from 1h), bar keys and close times, market hours, live prices. | config |
| `src/data/lighter.ts` | Lighter, read-only: market list and limits, funding, an account by index, and which symbols could go live. | config |
| `src/bot/bot.ts` | Paper bot state machine (`step`), markets keyed `SYMBOL@tf`, state migration. | core, prices (`barEndMs`), config types, accountant |
| `src/bot/accountant.ts` | The competition's accountant: grants, badges, busts, the performance index, monthly standings. Pure. | nothing |
| `src/journal/csv.ts`, `src/journal/lighter.ts`, `src/journal/tradingview.ts`, `src/journal/stats.ts` | Read the owner's exports, build round trips, summaries and rule checks. Not shown on any screen since 2026-11-15. | config |
| `src/brief.ts` | Reads and validates the old morning brief file. Unused since 2026-11-22. | config |
| `src/pipeline.ts` | `refresh()` when a 15-minute bar closes, `tick()` every minute, `writeBoard()` for Today. | everything above |
| `src/server.ts` | HTTP server: JSON routes, static files in `web/`, and the minute loop. | pipeline, feedback |
| `web/index.html`, `web/app.js`, `web/app.css` | The dashboard. Plain JS, no libraries, works offline. | the API only |
| `scripts/engine.ts` | Headless run for GitHub Actions: one tick and one refresh, then copies the bots' public files for the bot-data branch. | pipeline |
| `.github/workflows/bots.yml` | The GitHub workflow: every 15 minutes, restore state and prices, `bun run engine`, publish to `bot-data`. | — |
| `scripts/doctor.ts`, `scripts/smoke.ts`, `scripts/check-claude-md.ts`, `scripts/make-fixtures.ts`, `scripts/research.ts`, `scripts/compare-exits.ts` | Checks, synthetic test data, and research scripts that only print. | src |
| `config/settings.json`, `config/universe.json` | Everything the owner may tune: costs, gate, bot sizing, risk limits, symbol list. | — |
| `config/lighter-crypto.json` | Crypto tickers on Lighter that Catalina may trade (only while liquid there). The owner may edit it. | — |
| `config/checklist.json` | The list of things the owner is asked to test on the Test and feedback screen. | — |
| `docs/BRIEF_TASK.md` | The old morning brief contract. Unused since 2026-11-22. | — |
| `setup.bat`, `start.vbs`, `remove-from-startup.bat` | Windows install, hidden launcher, uninstall from startup. | — |

`src/core` never reads files, never calls the network and never reads the clock. Time enters
only as the `now` argument in `src/pipeline.ts` and `splitComplete` in `src/data/prices.ts`.

Data folders (created at run time, never edited by hand except `imports`):
`data/cache/bars` price cache (`SYMBOL.json` daily, `SYMBOL.15m.json`, `SYMBOL.30m.json`, `SYMBOL.1h.json`),
`data/derived` what the dashboard reads (`board.json`, `today*.json`, `indicators*.json`, `bot-<id>.json`,
`competition.json`, `live.json`, `status.json`, `shortlist-<id>.json`, `lighter.json`, `remote.json`, `evals/<view>/SYMBOL@tf.json`),
`data/bot/state-<id>.json` the competition bots' ledgers (ids in `settings.competition.bots`); `data/bot/state.json`,
`state-crypto.json` and `data/derived/bot.json`, `bot-crypto.json`, `shortlist.json`, `shortlist-crypto.json` belong to the two retired
bots (kept, never stepped, never deleted), `data/briefs/YYYY-MM-DD.json` morning briefs,
`data/feedback.json` the owner's test answers, `data/imports` the owner's CSV exports.

API routes: `/api/ping`, `/api/board`, `/api/today`, `/api/eval`, `/api/indicators`, `/api/strategies`,
`/api/bot`, `/api/bots`, `/api/competition`, `/api/lighter`, `/api/resume` (POST), `/api/feedback` (GET and POST), `/api/status`, `/api/refresh` (POST).
`/api/today`, `/api/eval` and `/api/indicators` take `?view=market` (default) or `?view=crypto`; `/api/eval` also takes `key=SYMBOL@tf`.
`/api/bot` and `/api/resume` take `?bot=<id>` (`/api/bot?view=crypto` gives that world's first bot).

### Views, timeframes and the two loops

Two views share one engine: **market** (stocks, gold, and the benchmarks SPY, QQQ, SMH shown as
context only) and **crypto**. Each symbol is evaluated on every timeframe in `settings.timeframes`.

| Timeframe | Source | History | Cost per side |
|---|---|---|---|
| 15m, 30m | Yahoo, `SYMBOL.15m.json` / `SYMBOL.30m.json` | 60 days (Yahoo's limit) | crypto `intraday.costBps`, others `costBps` by class |
| 1h | Yahoo, `SYMBOL.1h.json` | 730 days (Yahoo's limit) | same |
| 4h | built from the 1h file by `aggregate4h` (crypto and gold: UTC blocks 00:00, 04:00...; stocks: first four hourly bars of the session, then the rest) | as 1h | same |
| 1d | Yahoo (Binance fallback for crypto), `SYMBOL.json` | `historyRange` (5 years) | `costBps` by class |

**Stocks and gold listed on Lighter trade around the clock** (owner, 2026-11-21: "the bots are working on Lighter,
so they can work 24/7, not just market hours"). For those symbols the intraday timeframes come from Lighter's
candles (`src/data/lighter.ts`, `GET /api/v1/candles`): `SYMBOL.lighter.15m.json` (60 days kept) and
`SYMBOL.lighter.1h.json` (365 days kept); 30m is built from 15m and 4h from 1h, both on UTC blocks. `loadCached`
uses them once at least `LIGHTER_MIN_BARS` base bars are saved, and Yahoo's intraday file until then (Yahoo's
intraday is no longer downloaded for a symbol once Lighter's is used). Daily bars stay Yahoo's for the 5-year history.
Lighter allows 60 public requests a minute per IP: every Lighter call waits for `pace()` (one per 1.3 s), and one
refresh makes at most `LIGHTER_CALLS_PER_REFRESH`, so the first download of history is spread over several refreshes.
Only liquid Lighter markets are used (`liquidOnLighter`): a last trade, open interest of at least
`lighter.minOpenInterestUsd` (25,000 USD) and a last price within 2% of the mark price. On 2026-11-21 ARM (open
interest 558 USD, last trade 30% off the mark), QCOM and WDC (never traded) and AXTI (inactive) failed it; MCHP, CIFR,
MARA, RIOT, CLSK, VKTX and CRML are not listed. Those stay on Yahoo's bars and trade only while the US market is open.
A liquid market with too little Lighter history (AVGO, IREN on 2026-11-21) gets Yahoo's older bars with Lighter's bars
joined after them, and daily bars are always built that way (Yahoo's 5 years, then Lighter's UTC days from its hourly
candles). Such series carry `clock: "utc"`: their daily bars close at midnight UTC and `splitComplete` and the bot's
`barEndMs` treat them like crypto. The stocks bot trades only symbols that pass that test (owner, 2026-11-22: "should be 24/7 to test everything before
the bot comes to real life money"), so its paper results cover exactly what could go live; the others stay on Today,
an open position on one is still managed to its exit, and a symbol joins by itself once Lighter trades it properly.
"What the bot did" shows the account value at the end of each Madrid day, each day's closed result (bars) and a
day-by-day table (`dailyRows` in `src/pipeline.ts`), with the action log folded under it. Each bot panel shows a live clock, a light (green: checked in the last 17 minutes,
amber: up to 35, red: longer) and which of its charts trade 24/7. Turn Lighter prices off with `lighter.prices24h: false`.

Benchmarks get daily bars only. Bar keys: daily `YYYY-MM-DD` (exchange date), intraday
`YYYY-MM-DDTHH:MM` (UTC; old files with `YYYY-MM-DDTHH` are normalised by `normKey` when read).
Keys sort in time order within one timeframe; across timeframes compare `barEndMs`, never the keys.

- `tick()` runs every `tickSeconds` (60): live prices only. Crypto: one Binance request for all coins
  (Yahoo if it fails). Stocks and gold listed on Lighter: one Lighter request for all, around the clock,
  with the 24-hour change worked out from the saved 15m candles. Other stocks, only while their market may be open: up to 10 "watched"
  symbols (bot positions, orders, signals) plus 6 others in turn. That is at most about 17 requests
  a minute; do not raise it (Yahoo answers 429 when pushed, and `getJson` then pauses ticks for 5 minutes).
- `refresh()` runs once per 15-minute slot, one minute after the bar closes: downloads only what is
  due (a timeframe's file older than one bar; daily older than 30 minutes; nothing for a closed
  market whose file was also fetched while closed), then re-tests only the symbol-timeframes with a
  new finished bar (an in-memory cache keyed by the last bar), then steps the competition bots of each view
  (not in remote mode) and writes `competition.json` (`writeCompetition`).
- `writeBoard()` joins both views, live prices, bot positions and whether each symbol trades 24/7 into `board.json`, one
  row per symbol, for Today. It runs after every tick and refresh.

### Running on GitHub (owner, 2026-11-23: "make them work 24/7 from my github repo")

The repository is public. `.github/workflows/bots.yml` runs every 15 minutes on GitHub: it restores the bots'
state from the `bot-data` branch and the price cache from the Actions cache, runs `bun run engine --publish`, and
force-pushes the bots' public files (`publishedFiles()` in `src/pipeline.ts`, plus `status.json`, `heartbeat.json`)
as a single commit to `bot-data`. Binance is read through `BINANCE_HOST` (GitHub's US runners are refused by
api.binance.com). The PC switches to reading by setting `remote: { "repo": "owner/name", "branch": "bot-data" }` in
`config/settings.json`: `pullRemote()` copies those files from raw.githubusercontent.com at each refresh, and the PC
never steps the bots, so they are never stepped twice. The engine refuses to run with `remote` set.
Taking turns (owner, 2026-11-24): GitHub's schedule runs late or skips hours, so the PC trades the bots too whenever it
is on (`remote.trade`, default true). Both sides fetch bot-data, note its commit, step, and publish one new commit with
`--force-with-lease=bot-data:<that commit>` (PC: `src/data/sync.ts`, a git clone in `data/sync`; GitHub: the workflow's
`BOTDATA_SHA`). A refused push means the other side stepped first: its result is kept and this run's is thrown away,
so the bots are never stepped twice from one state. `bot/runs.json` (shared) records every check and who ran it; the
scoreboard shows the last one and the 24-hour counts. If git or GitHub cannot be reached, the PC only shows the bots.
Short lists are re-picked weekly, on a rule change, or when clearly more charts exist than at the last pick (never when
fewer: the two sides hold different amounts of data).
Setup: `github-setup.bat` (asks for the repository address) runs `scripts/github-setup.ts`: it copies
`deploy/github-workflow-bots.yml` to `.github/workflows/bots.yml` (the remote file tools cannot write `.github`), stages
with the allow-list `.gitignore`, refuses if any file is outside the allowed folders or looks like a key or password,
pushes `main`, pushes the bots' current state to `bot-data` so GitHub continues the same bots, and sets
`settings.remote`. `github-update.bat` (`--update`) publishes later code changes with the same checks. The GitHub run
sets `TD_ENGINE=1`, which makes `settings()` ignore `remote` there. The folder also holds `scout-to-alert/`, a separate
project with its own `.env`: it must never be published (the allow-list keeps it out).
`.gitignore` is an allow-list and keeps all of `data/` out of the repository: `data/imports` and `data/feedback.json` are private and must
never be committed, published or copied into the workflow. Only the files listed in `publishedFiles()` leave the machine.

## Invariants

Each of these has a test. A change that breaks one is wrong even if the screen looks right.

1. **No lookahead.** A decision at the close of day *i* uses data up to day *i* and is filled at
   the open of day *i+1*. Test: "no lookahead: cutting off the future never changes past trades".
2. **Unfinished bars are not signals.** `splitComplete` separates finished bars from the bar in
   progress. Strategies, regime and ranking only ever receive `complete`.
3. **Costs are always on**, both sides, from `costBps` in `config/settings.json`. Never add an
   option to turn them off outside tests.
4. **Stops fill at the stop price, or at the open if the bar gaps through it.** Never at a better price. For a short the stop is above the entry and a gap up fills at the (higher) open.
4b. **A strategy may name its own stop (`stopPrice`) and a profit target (`targetR`, in multiples of the
   initial risk).** If the open is already beyond the stop, no trade is taken. If stop and target fall
   inside the same bar, the stop is assumed first. No current strategy uses either (the SMC rules that did
   were removed on 2026-11-22); the stepped exits (8e) set the take-profits for all of them.
5. **Strategy parameters are fixed textbook values.** Do not tune them to improve results and do
   not add a parameter search. `variants()` moves each setting 25% down and up only so the settings
   test can show how fragile a result is; a variant is never traded and never replaces the base setting. Tuning on the same history that is then shown as evidence is the
   main way a backtest lies.
5b. **Stress tests inform, they do not decide.** `robustness()` runs only for strategies that pass the
   gate and adds a "Fragile" label. The owner declined a stricter gate on 2026-11-15, so a fragile
   strategy is still tradable. The luck test uses a fixed seed: same trades, same answer.
6. **The quality gate decides what is suggested** (`judge` in `src/core/backtest.ts`): at least
   `minTrades` trades, profit factor at least `minProfitFactor`, and a profit in both halves of
   the history. Do not loosen it to make more signals appear.
7. **The bot is append-only and idempotent.** Closed trades are never edited or removed; running
   `step` twice on the same data changes nothing; catching up after days offline gives the same
   trades as running daily.
8. **The bot's leverage is capped.** Total exposure at entry is at most `bot.maxLeverage` times the
   account value, and `settings()` in `src/config.ts` throws if that setting is 3 or more
   (`LEVERAGE_CEILING`). This is the owner's rule: "always less than 3:1". Never raise the ceiling.
   The bot's `cash` is the realised balance: opening a position does not move it.
8a. **Circuit breaker** (the retired bots and any bot without an accountant). When a bot's account falls `bot.maxDrawdownPct` below its peak it closes every
   position, clears pending orders and sets `halted`. A halted bot opens nothing. Only the owner's
   button (`/api/resume`) clears it. Never auto-resume and never remove the halt to make a test pass.
8c. **Group limit.** The market bot holds at most `bot.maxPerGroup` positions in the same direction
   inside one `group` of `config/universe.json`, because those stocks move together.
8d. **Timeframes: one clock, one position per symbol.** A bot steps all its markets (`SYMBOL@tf`) in the
   order their bars closed (`barEndMs`), so catching up after a gap processes 15-minute bars and the
   daily bar of the same day in the right order. A bot holds at most one position per symbol across
   timeframes; a second signal on another timeframe is skipped and logged. Old state files are
   converted by `migrate` (plain symbols become `SYMBOL@1d` for the market bot, `SYMBOL@1h` for crypto).
8b. **The bot and the backtester share rules.** Entry, exit, stop and time-stop logic must match.
   Exits go through `src/core/exits.ts` in both, so they cannot drift apart. If you change one, change
   the other and both test files.
8e. **Stepped exits** (`settings.exits`; owner's plan "TP1, TP2, TP3 and SL1, SL2, SL3", 2026-11-21): TP1 sells a
   third at 1R, TP2 a third at 2R, TP3 the last third at 3R; after TP1 the stop goes to the entry price, after TP2
   to TP1's price, and from TP1 on it also rises 3 ATR under the best close, so the last third can close on that
   rising stop ("trail") before TP3. Inside a bar the stop is checked
   first with the stop the bar opened with; a stop moved during a bar only counts from the next bar;
   take-profits fill at their price, never better. Each partial close is its own line in the bot's trade
   list. The time stop only applies before the first take-profit. `exits.mode: "single"` restores the old
   behaviour. Positions opened before this existed get exit state from their entry and current stop.
   Stepped stops (`exits.slR`/`slFractions`): before TP1, SL1 closes a third at a loss of 0.5R, SL2 a third at
   0.75R, and SL3 the rest at the full stop (1R). Nearer stops are checked first,
   each fills at its price or at the open if gapped through; a bar that touches one takes no profit too.
8f. **One strategy per chart, from the weekly short list.** `src/core/select.ts` picks at most
   `selection.maxStrategies` per bot on the older `1 - testShare` of each history and keeps only those
   that still made money on the newer part; it is re-picked every `selection.refreshDays` or when the
   rules that judge it change. An empty list is valid and means the bot trades nothing. On each chart
   a chart keeps at most one long and one short strategy (`allowed`: the best passing of each side among the
   strategies on its world's two short lists). Each competition bot has its own short list, of its own side only
   (`pickShortlist(..., { side })`), and trades only its own side's strategy on each chart.
   A waiting entry whose strategy is no longer allowed is cancelled and logged.
8g. **The accountant** (`src/bot/accountant.ts`; owner, 2026-11-23, second version). Every competition bot trades a
   fixed grant of `competition.startGrant` (250), lent by the accountant: the loan is its `debt`. Checked at the end of
   every bar moment, on closing prices:
   - at twice the grant: close everything (reason "milestone"), one badge, `streak` +1, the profit above the grant goes
     into the locked `award`, the award repays the loan as far as it can, and the bot starts again with the same grant;
   - at half the grant: close everything (reason "bust"), `streak` back to 0. If the award can refill the account to
     the grant it pays (a "save"); if not, the bot STOPS: `fired` is set, it never trades again, what it holds goes back
     against its loan (and any surplus, `returned`, to the bank). Its seat is filled at Monday 00:00 Madrid
     (`nextMondayMadrid`, `fired.replaceAt`), only if `bankOf()` has a grant's worth available; then its state is
     archived in `data/bot/fired/`, and `replaceFired` in `src/pipeline.ts` hires a recruit (next unused name from
     `competition.recruitNames`) in the same seat with a fresh loan. `data/bot/roster.json` keeps the names used, the
     fired bots' records and, per seat, the chart-strategy pairs fired bots used: a recruit may not use them;
   - the loan has no interest and never grows (owner, 2026-11-23: "the bots can't owe money ... we are not an infinite
     bank"); the award repays it whenever it has money;
   - tiers from the best streak of badges in a row: Pro at `tiers[0]` (4), Master at `tiers[1]` (8), Experienced
     trader at `tiers[2]` (12). A title once earned stays; the goal is four Experienced traders;
   - weekend pause, Friday 22:00 to Monday 00:00 Madrid time (`inWeekendPause`): everything is closed (reason
     "weekend"), orders cancelled, nothing opens.
   The accountant replaces the circuit breaker for these bots (they never halt). `index` (100 at hiring) moves only with
   trading, never with the accountant's money, and is what % returns come from. Monthly standings (Madrid months): most
   badges, ties to the best % return, then fewest saves. Each bot trades only its `playbook` (`pickPlaybook` in
   `src/core/select.ts`): at most `competition.maxCharts` charts, one per symbol, each with the strategy from its own
   short list that made the most on the newer data of that chart (at least 5 trades, profit factor above 1).
   Competition bots risk `competition.riskPctPerTrade` (2%) per trade; the leverage limit and every other rule are the
   same. All on paper: real money waits until a bot proves itself, and the owner asked for a professional's review first.
8h. **The random twin** (owner, 2026-11-23: "make the fixes"). Every competition bot carries `twin`, a second paper
   account stepped right after it with the same market, charts, side, sizing, exits and weekend pause (`weekends`), whose
   only strategy on each chart is `twinStrategy(twinId(key, id, rate))` from `src/bot/bot.ts`: it enters when
   `unitHash(chart and bar)` is below `rate`, the real strategy's signals per bar on the newer data, so it is the same
   every run (idempotent). It never touches the bot's money. A new twin starts with every recruit.
8i. **The weekend pause is in the selection too.** `shortlistFor` passes `paused` (one flag per bar, from `barEndMs` and
   `inWeekendPause`) to every backtest that picks a competition bot's strategies and charts (`BtOpts.paused` in
   `src/core/backtest.ts`: a position open when a pause starts closes at that bar's open, reason "weekend"; nothing
   opens during it). The screens' tests (`evalSymbol`) do not pause.
8j. **Catalina is free** (owner, 2026-11-23). Her seat (`crypto-bull`, `side: "both"`, `lighterCrypto: true`) picks from all
   16 strategies, long or short, and also from every crypto in `config/lighter-crypto.json` that is liquid on Lighter and
   not in `config/universe.json` (`lighterCryptoExtras`; 1h candles from Lighter only, `loadLighterOnly`). Those symbols
   are not on Today and not tested for the screens. A free bot chooses last and may not copy a chart-and-strategy pair
   another bot of its world already trades.
8j2. **Nico and Lucas trade every Lighter market that is not crypto** (owner, 2026-11-24): `allLighter: true` adds every
   ticker in `config/lighter-other.json` (stocks, ETFs, indices, commodities, currencies, a bond, pre-IPO) that is liquid
   on Lighter and not in the universe, on 1h and 4h charts from Lighter candles (`lighterOtherExtras`, class "stock").
   Lighter has no options on these (only BTC and ETH binary options), so the bots trade perps only.
8k. **Scalping** (owner, 2026-11-23: "aloud them to scalp on 1 min or 5 min"). `competition.scalpTimeframes` (["1m",
   "5m"]) adds Lighter 1m candles (3 days kept) and 5m candles (20 days) for every universe symbol liquid on Lighter
   (`lighterScalpable`, `loadScalp`, at least 1,000 candles). They enter only the competition bots' short lists,
   playbooks and steps, never the screens' tests (`TIMEFRAMES` stays 15m-1d; `SCALP_TFS` holds the scalping ones).
   The bots still check every 15 minutes, so on 1m and 5m they catch up bar by bar, each fill at the next bar's open:
   a fair simulation, but a real-money scalper would have to run every minute (not possible on GitHub's schedule).
8l. **The accountant's audit rules** (owner, 2026-11-23: "review ... as a professional accountant"). Decisions use the
   liquidation value (account value minus closing costs). A fired bot's remaining money and award go back against its
   loan (`recovered`); the rest is `writtenOff`. A trade counts as a win when all its parts together made money.
   `reconcile()` must be 0: cash + award + paid back = grant + every closed trade's profit; the scoreboard's `books`
   must satisfy lent = paid back + lost + still owed (prizes and funding are shown beside it). With funding, prizes and
   hand-backs, `reconcile(a, cash, closedPnl, fundingPaid)` = cash + award + paid back + returned - grant - closed profit
   + funding - prizes.
8m. **Making them compete** (owner, 2026-11-23: "the 2% is to force bots to trade"; "be competitive with each other").
   - Activity instead of interest: from `graceDays` (7) after hiring, a weekly check; fewer than `minTradesPerWeek` (5)
     closed trades is a strike ("strike" event), a busy week clears them; `maxStrikes` (3) in a row and the bot is
     replaced at once (`decide` returns `why: "strikes"`).
   - The bank (`bankOf`): `bankUsd` (1500) - lent (a grant per bot ever hired) + paid back + handed back - prizes =
     available. No recruit without the money. "We cannot lose money" (owner, 2026-11-23): a prize is paid only out of
     the accountant's profit (`profit` = available + still owed - bankUsd), never out of its starting money; the first
     badge repays the whole loan, so a bot with a badge trades its own money and the accountant cannot lose on it; a
     rookie (no badge yet) can still cost it up to half the grant (`atRisk` sums that). `interestPaid` stays 0.
   - Funding: every full hour a position is open, `sign x qty x price x rate` leaves cash (`payFunding` in step;
     `fundingPaid` on the bot and `funding` on each position and on a trade's last part). The rate is Lighter's
     `funding` for the symbol divided by `fundingPeriodHours` (8: read as an 8-hour rate; unconfirmed). Selection
     backtests do not charge funding.
   - `maxCharts` is 8. `leagueDuties` (before the bots trade) pays `monthlyPrize` (25) into the award of the previous
     month's winner once (`data/bot/league.json`), and marks the bot that is last and behind this month as hungry:
     `hungryExtraCharts` (2) more charts, same risk per trade.
   - Weekly duels (`duelsOf`): two pairs a week (rotating, everyone meets everyone every three weeks), the better
     index change Monday to Sunday (Madrid) wins 3 points, a draw within 0.05 points gives 1; the live week is shown.
   - Locker room (`lockerRoom`): fixed phrases in the bots' voices from their records (hired, badges and a rival's
     reply, saves, firings, prizes, interest, duel results, trades worth 3% of the grant or more). It changes nothing
     in how any bot trades: the bots are rules, the only feedback between them is the hungry extra charts.
9. **Round trips are flat-to-flat per market**, deduplicated by Trade ID. The audited figures for
   the 2026-11-15 Lighter export are 2,123 fills, 171 round trips, −1,620.01 USD; a skip-if-absent
   test guards them.
10. **Files are written atomically** with `writeJson`. Never write JSON with `writeFileSync` directly.

## Strategies

Every timeframe uses the same rules; "20-bar" means 20 bars of whatever chart it runs on. Every strategy is one-directional: `side` is "long" or "short". Short ids end in
`_short` and mirror the long rule. Ids are used in saved files (bot state, short lists); do not rename them.
Long and short versions are tested and gated separately per symbol; the bot may use the best
passing long and the best passing short for a symbol (`allowed` in `src/core/rank.ts`).

| Id | Name on screen | Family |
|---|---|---|
| `donchian_trend` | 20-bar breakout | trend |
| `ema_pullback` | Pullback to the 20-bar average | trend |
| `ma_cross` | 20/50 average crossover | trend |
| `rsi2_dip` | Short-term dip in an uptrend | mean-reversion |
| `bollinger_dip` | Lower Bollinger band bounce | mean-reversion |
| `donchian_trend_short` | 20-bar breakdown (short) | trend |
| `ema_pullback_short` | Bounce to the 20-bar average (short) | trend |
| `ma_cross_short` | 20/50 average cross down (short) | trend |
| `rsi2_dip_short` | Short-term spike in a downtrend (short) | mean-reversion |
| `bollinger_dip_short` | Upper Bollinger band fade (short) | mean-reversion |
| `supertrend` | Supertrend turns up | trend |
| `macd_cross` | MACD momentum cross | trend |
| `squeeze_break` | Breakout after a quiet spell | trend |
| `supertrend_short` | Supertrend turns down (short) | trend |
| `macd_cross_short` | MACD momentum cross down (short) | trend |
| `squeeze_break_short` | Breakdown after a quiet spell (short) | trend |

On 2026-11-22 the owner asked to remove the four SMC strategies and add what is worth testing. Added, with
textbook settings: Supertrend (ATR 10, multiplier 3, with the 200-bar trend filter), MACD 12/26/9 crossing its
signal on the trend's side of zero, and a breakout after the Bollinger bands were at their narrowest of 120 bars
("squeeze"). First real-price check: MACD cross joined the stocks bot's short list (newer data profit factor 1.09);
Supertrend short did best on newer data (1.42) but did not make the top 4 on the older data; the squeeze rules
fire rarely (a few hundred trades over all charts). `src/core/smc.ts`, its tests and `docs/smc-indicator.pine`
stay as a reference; no strategy uses them. Positions opened by a removed strategy keep running to their stops
and take-profits; with no strategy behind them they have no exit rule.

### Adding a strategy (follow every step)

1. Add one object to the `LONG` or `SHORT` list in `src/core/strategies.ts` (a short id ends in `_short`).
   Put every number the rule uses in `params` and read it from `p` inside `build`, so the settings test
   can vary it; list non-integer settings in `floats`. The object needs: a new snake_case `id`; a
   `plain` sentence a beginner can follow, with no jargon left unexplained; `warmup` at least as
   long as its slowest indicator plus one; `entry` and `exit` that read only index `i` and earlier.
2. Get indicators through `I` so they are cached. A new indicator goes in
   `src/core/indicators.ts` with a unit test using hand-computed values.
3. Do not touch `backtest.ts`, `rank.ts` or `bot.ts`: they pick the new strategy up from the list.
4. Add the row to the table above. `bun run check:docs` fails until you do.
5. The existing tests "no lookahead" and "every strategy reports sane metrics" run on the new
   strategy automatically. If the second fails, the entry rule is too rare to evaluate; say so
   instead of forcing it.
6. Update the counts `=== 16` (strategies per row and per timeframe summary) in `scripts/smoke.ts`.
7. Report its real results from the Strategies screen as they are, including if it fails the gate.

Short selling was added on 2026-11-15 at the owner's request. Keep in mind that the owner's
real losses came from leveraged shorts held too long: never remove the stop, the time stop or
the leverage cap from the short side, and show short results as plainly as long ones.

## Screen text

- Sentence case. Plain words: "Buy signal", "Stop price", "Worst drop", not "Long entry", "SL", "MaxDD".
- Today speaks in actions: "Buy at the next 4 hours open. Stop $X", not "enter long". A term of art
  is explained once where it appears (the legend under Today, the stress-check header tooltip).
- The owner's own words on 2026-11-15: "just a list of all of them with the reminders or advices and
  their prices; if there are signals, tell what to do". Keep Today one list; do not split it into tabs.
- Profit and loss always carry a sign and a colour class (`signed`, `pct` in `web/app.js`); never colour alone.
- Every empty or failed state says what is missing and what to do next.
- All text from files or the network passes through `esc()`. Links are rendered only if `safeUrl` accepts them.
- No external fonts, scripts, images or CDNs. The app must render with the network unplugged.

### Charts

- Line charts use `lineChart`. Do not add a chart library.
- Series colours are the validated pair in `C` in `web/app.js` (`#009490` strategy, `#C2611F`
  buy and hold, the second also dashed). If you add a third series, re-validate the palette for
  colour-blind separation before shipping; do not pick a colour by eye.
- One y-axis per chart. Two measures with different scales get two charts.

## Definition of done

A task is finished only when all of these are true:

1. `bun run check` passes, and you have pasted its last lines into your report.
2. Every new behaviour has a test that would fail without the change. A bug fix starts with a
   test that reproduces the bug.
3. No invariant above was weakened, and no test was deleted, skipped or loosened to get green.
4. If a screen changed: you started the server on synthetic data (`bun run smoke --keep` prints
   the temp folder; or set `TD_DATA_DIR` and run `bun run serve --offline`), opened that screen,
   and looked at it at 1360 px and at 800 px wide, including its empty state.
5. If numbers changed (metrics, journal, bot): you checked at least one figure by an independent
   route (by hand on a tiny fixture, or a second calculation) and say which.
6. `CLAUDE.md`, `README.md` and `docs/BRIEF_TASK.md` still describe the project truthfully.
7. Your report says, in plain language: what changed, what you verified and how, and what you
   could not verify. "Could not verify" is an acceptable line; a guess presented as checked is not.

## Checks to run before saying a task is finished

```
bun run check
```

Expected last lines: tests with `0 fail`, then `Smoke run passed: ...`, then
`CLAUDE.md check passed: ...`. If market-data code changed, also run `bun run doctor` on the
owner's PC and report the three download lines; the sandbox where you may be working often has
no access to the data servers, so say so if that step was not possible.

## The owner's feedback

Before starting any task, read `data/feedback.json` if it exists. It holds the owner's answers to
`config/checklist.json` ("ok" or "problem", with a note) and free notes. Treat every "problem" as
a reported bug or an unclear screen and say in your report how you handled each one. After an update
that changes what the owner should test, edit `config/checklist.json`: plain steps, one check per
row, and never reuse an old `id` for a different check. Do not delete or edit `data/feedback.json`.

Owner's decisions on 2026-11-20 (from their note and the chat): bots trade 3-4 strategies, each chart its
best one; exits in steps with a stop that follows the price up; real trading on Lighter with 500 USDC for
stocks and gold only, after one more paper week; the crypto bot stays on paper for now; no
click-to-approve step before live orders.

## Known limits (true today; do not "fix" silently)

- Out-of-sample check (2026-11-20, `src/core/select.ts` on real prices): on stocks the four strategies
  that survived made only a little in the newer data they had not seen (profit factor 1.02 to 1.37,
  most near 1.05). Most of the edge seen in the full-history tests does not hold up out of sample.
  Say this plainly whenever results or live trading are discussed.
- Stepped exits (2026-11-20): against the old single exit they raised the win rate (about 40% to 50%)
  and lowered the median drawdown (stocks 20% to 16.5%, crypto 31% to 22.5%), and lowered the median
  return (stocks 38% to 29%). In-sample figures, on the same history used everywhere else.
  Adding stepped stops (0.5R, 0.75R) cut the typical loss (stocks -3.0% to -2.3%) and drawdown (16.5% to
  14.8%), kept the median return, and improved the short list on newer data (stocks: average trade
  +0.13% to +0.30%, profit factors 1.13 to 1.24). Still a small edge; still not proof.
- Lighter's equity perps were 24 hours on weekdays from January 2026, with 24/7 announced as "soon"; the app
  does not assume either. Where Lighter has no trades (a closed weekend) it has no new candles and the bots
  simply wait. How far back Lighter's candles go for each stock is not documented; a young market has less
  history, so its tests are thinner. Stock perps can gap when the real stock reopens.
- Lighter's funding rate is shown as Lighter reports it; its period (hourly or 8-hourly) was not confirmed
  in the docs, so it is not added to the paper bots' costs.

- Yahoo daily and hourly downloads are confirmed working on the owner's PC (2026-11-15). The 15m and
  30m downloads, the Binance live ticker and the Yahoo 1-minute quote were written from the
  documented response shapes and tested against fixtures only; the owner's PC is the real test.
- Yahoo's chart endpoint is unofficial and can change or rate-limit. Failures show on Today's
  status line ("show the ones that failed") and the last saved prices are used.
- 15m and 30m history is only 60 days, so tests there have few trades and many fail the gate;
  that is thin evidence, not a bug to fix by loosening the gate.
- The app fetches prices only: no news, filings, earnings dates or fundamentals (the morning brief that brought
  them was dropped on 2026-11-22). A bot can hold a stock through an earnings report.
- The journal reflects the last export the owner saved; it does not read the Lighter account live.
- ANTHROPIC (a Lighter market) is not in the universe. The owner asked for it; Lighter's public
  candle API is the only source, and its response format could not be confirmed when this was
  written. Do not guess the format: read the Lighter API reference first, add a parser with a
  fixture test in `src/data/prices.ts`, and note that the market is too young for the 260 days a backtest needs.
- The bots run only while the PC is on and the app is open. They decide once per finished bar of each
  timeframe, checked one minute after each quarter hour, and book fills at the next bar's open price.
  Real fills would be worse. The bots do not join a trade a strategy entered before its signal was
  seen ("Strategies already in a trade" on Today).
- First real-data research (2026-11-15, daily bars, 40 symbols, 5 years): every short strategy lost
  money when pooled (profit factor 0.45 to 0.76), and the few symbol-level passes are probably luck
  from testing 12 strategies on 40 symbols. A pooled gate (a strategy must also be profitable across
  the whole universe before it is allowed on any symbol) was proposed to the owner and is not built: the owner said no.
- Yahoo's crypto volume figures are unreliable. No strategy here uses intraday volume.
- Daily stock bars are taken to close at 21:00 UTC when ordering timeframes (16:00 New York in winter,
  an hour late in summer). It only affects which bar is processed first after a long gap.
- The screens' backtests have no funding; the competition bots pay or earn Lighter funding hourly (invariant 8m).
- Paper funding uses Lighter's current rate for the whole time a position is open (no history of rates), read as an
  8-hour rate; fills are at bar opens with a fixed cost, with no order book or spread beyond it.
- An elimination contest selects the luckiest bots as well as the good ones; `recruitsTried` on the scoreboard says
  how many were tried, and each bot's random twin (8h) says whether it beats chance. Read both before trusting a title.
- Lighter-only crypto (Catalina) has only Lighter's 1h candles (about a year), so only its 1h and 4h charts exist, and its
  first download is spread over many refreshes. Their prices on screen move with the hourly candles, not every minute.
- Paper bot fills are idealised (open price plus `costBps`); real fills are worse in fast markets.

## Stop and ask

Do not decide these yourself. Stop, explain the trade-off in two or three sentences, and wait:

- Anything touching the hard limits, including "just read-only" exchange API keys, and the step to live
  trading on Lighter (see Hard limits).
- Adding a dependency, a build step, a database, or a second runtime.
- Changing the quality gate, the costs, the bot's risk sizing or the risk limits (owner's settings:
  2,000 USD account, exposure under 3:1, brief in Spanish at 06:30 Madrid time).
- Adding a timeframe outside 15m 30m 1h 4h 1d, another view, options, or leverage of 3:1 or more.
- Raising the number of live-price requests per minute.
- Changing a strategy's parameters or removing a strategy.
- Deleting or rewriting anything under `data/`.
- A test that can only pass by changing an invariant.

Everything else: choose the simplest option that keeps the invariants, do it, and say what you chose.

## Style

TypeScript, strict in spirit: no `any` outside JSON parsing at a boundary. Small pure functions
in `src/core`. A comment states a rule or a reason, not what the next line does. Dates are
`YYYY-MM-DD` strings in the exchange's time zone; timestamps are ISO 8601 UTC. Money is USD.
Percentages are stored as numbers where 1.5 means 1.5%, and field names end in `Pct`.
