// The app's two loops.
//   refresh(): when a 15-minute bar closes. Download the bars that are due, test every strategy on every symbol and
//              timeframe that has a new bar, step the four competition bots, and write what the screens read into data/derived.
//   tick():    every settings.tickSeconds. Update live prices, then the board and the bots' open profit. No testing.
// Two views share one engine:
//   "market": stocks, gold and the benchmarks, traded by the stocks bots (stocks and gold only, bullish and bearish)
//   "crypto": crypto, traded by the crypto bots (bullish and bearish), around the clock
// The bot competition (owner, 2026-11-23): four paper bots, $250 grant each, with an accountant (src/bot/accountant.ts).
// The first two bots (state.json, state-crypto.json) are retired; their files are kept and no longer stepped.
// Each view is evaluated on every timeframe in settings.timeframes ("15m" "30m" "1h" "4h" "1d").
import { join } from "node:path";
import { P, settings, universe, readJson, writeJson, type Settings, type Sym, type CompetitionBot } from "./config";
import { newAccountant, standings, madridMonth, madridDay, monthReturnPct, reconcile, addBonus, tierOf, tierName, toNextTier, inWeekendPause, TIER_NAMES, type Accountant, type AccountantRules } from "./bot/accountant";
import { pickPlaybook, type PlaybookPair } from "./core/select";
import { refreshPrices, loadCached, splitComplete, tickPrices, loadLive, TIMEFRAMES, type FetchStatus, type Timeframe } from "./data/prices";
import { evalSymbol, rankToday, aggregate, slim, type SymbolEval, type SlimRow } from "./core/rank";
import { step, newState, equityOf, exposureOf, resume, migrate, underlying, tfOf, type BotState, type MarketView } from "./bot/bot";
import { pickShortlist, type Shortlist } from "./core/select";
import { STRATEGIES } from "./core/strategies";
import { barsPerYear } from "./core/rank";
import { DEFAULT_EXITS } from "./core/exits";
import { refreshLighter } from "./data/lighter";
import { lighterIds, lighterCryptoExtras, lighterOtherExtras, loadLighterOnly, barEndMs, lighterScalpable, loadScalp } from "./data/prices";
import { twinStrategy, twinId, unitHash } from "./bot/bot";
import { syncPull, syncPush } from "./data/sync";
import { newDesk, deskCheck, correlation, correlationBlock, tierBps, type DeskState } from "./bot/desk";
import { readApprovals, mergeAnswers, ask, weeklyReports, dailyReports, APPROVALS, type Approval, type ReportBot } from "./bot/office";
import { lighterFile, type LighterSnapshot } from "./data/lighter";

export type View = "market" | "crypto";
export const viewOf = (v: string | null): View => (v === "crypto" ? "crypto" : "market");
export const files = (v: View) => ({
  today: join(P.derived, v === "crypto" ? "today-crypto.json" : "today.json"),
  indicators: join(P.derived, v === "crypto" ? "indicators-crypto.json" : "indicators.json"),
  bot: join(P.derived, v === "crypto" ? "bot-crypto.json" : "bot.json"),
  state: join(P.bot, v === "crypto" ? "state-crypto.json" : "state.json"),
  evalDir: join(P.derived, "evals", v),
  shortlist: join(P.derived, v === "crypto" ? "shortlist-crypto.json" : "shortlist.json"),
});
/** Files of one competition bot. */
export const botFiles = (id: string) => ({ state: join(P.bot, `state-${id}.json`), view: join(P.derived, `bot-${id}.json`), shortlist: join(P.derived, `shortlist-${id}.json`) });
export const COMPETITION = () => join(P.derived, "competition.json");
export const competitors = (st: Settings = settings()) => st.competition.bots;
export const botById = (id: string | null, st: Settings = settings()) => competitors(st).find(b => b.id === id) ?? competitors(st)[0];
/** Files the GitHub run publishes on its data branch, by path on that branch -> local path. */
export function publishedFiles(st: Settings = settings()): [string, string][] {
  return [...competitors(st).flatMap(b => [[`bot/state-${b.id}.json`, botFiles(b.id).state], [`derived/bot-${b.id}.json`, botFiles(b.id).view], [`derived/shortlist-${b.id}.json`, botFiles(b.id).shortlist]] as [string, string][]),
    ["derived/competition.json", COMPETITION()], ["bot/roster.json", ROSTER()], ["bot/league.json", LEAGUE()], ["bot/runs.json", RUNS()], ["bot/desk.json", DESK()], ["bot/approvals.json", APPROVALS()]];
}
/** Who checked the bots, when: the newest 200 checks (GitHub's runs and the PC's), shared through bot-data. */
export const RUNS = () => join(P.bot, "runs.json");
export function logRun(by: string, tookMs: number, symbols: number, failed: number) {
  const runs = readJson<{ at: string; by: string; tookMs: number; symbols: number; failed: number }[]>(RUNS(), []);
  runs.push({ at: new Date().toISOString(), by, tookMs, symbols, failed }); writeJson(RUNS(), runs.slice(-200));
}
/** Remote mode: copy the bots' state from the public repo's data branch. A file that fails to download keeps its last copy. */
export async function pullRemote(st: Settings): Promise<{ ok: number; failed: string[]; at: string | null }> {
  const r = st.remote!; const base = `https://raw.githubusercontent.com/${r.repo}/${r.branch}/`; let ok = 0; const failed: string[] = [];
  for (const [path, local] of publishedFiles(st)) {
    try { const res = await fetch(base + path + "?t=" + Date.now(), { signal: AbortSignal.timeout(20000) }); if (!res.ok) throw new Error(`HTTP ${res.status}`); const v = await res.json(); writeJson(local, v); ok++; }
    catch (e) { failed.push(`${path}: ${(e as Error).message}`); }
  }
  const hb = await fetch(base + "heartbeat.json?t=" + Date.now(), { signal: AbortSignal.timeout(20000) }).then(x => (x.ok ? x.json() : null)).catch(() => null) as { at?: string } | null;
  const out = { ok, failed, at: hb?.at ?? null, repo: r.repo, branch: r.branch, pulledAt: new Date().toISOString() };
  writeJson(join(P.derived, "remote.json"), out);
  return out;
}
export const evalFile = (v: View, key: string) => join(files(v).evalDir, key.replace(/[^A-Za-z0-9@_-]/g, "_") + ".json");
const BOARD = () => join(P.derived, "board.json"), STATUS = () => join(P.derived, "status.json");
export const timeframes = (st: Settings): Timeframe[] => TIMEFRAMES.filter(t => st.timeframes.includes(t));
const inView = (v: View, s: Sym) => (v === "crypto" ? s.class === "crypto" : s.class !== "crypto");
const tradedBy = (v: View, s: Sym) => (v === "crypto" ? s.class === "crypto" : s.class === "stock" || s.class === "metal");
const costFor = (st: Settings, s: Sym, tf: Timeframe) => (s.class === "crypto" && tf !== "1d" ? st.intraday.costBps : st.costBps[s.class]);
/** Open interest on Lighter by symbol (read once per refresh), for the competition bots' spread and slippage tiers. */
let OI: Record<string, number | null> = {};
/** The competition bots' cost per side: by the market's open interest on Lighter (competition.costTiers), else costFor. */
const botCost = (st: Settings, s: Sym, tf: Timeframe) => tierBps(OI[s.symbol], st.competition.costTiers) ?? costFor(st, s, tf);
/** The desk guard's state (src/bot/desk.ts), shared through bot-data. */
export const DESK = () => join(P.bot, "desk.json");
export const OFFICE = () => join(P.derived, "office.json");

// Evaluations are re-run only when a new bar has closed (or the settings changed): the full set takes seconds.
const cache = new Map<string, { sig: string; summary: SymbolEval }>();

let running: Promise<RefreshResult> | null = null;
export interface RefreshResult { at: string; tookMs: number; fetch: FetchStatus[]; symbolsWithData: number; retested: number; error?: string; remote?: { ok: number; failed: number; at: string | null } }
/** When the check now running started (null when none is running): the screens say "checking now" instead of "late". */
let runningSince: string | null = null;
export const checkingSince = () => runningSince;
export function refresh(opts: { fetch?: boolean; force?: boolean; now?: number } = {}): Promise<RefreshResult> {
  if (!running) { runningSince = new Date().toISOString(); running = doRefresh(opts).finally(() => { running = null; runningSince = null; }); }
  return running;
}

const rulesOf = (st: Settings): AccountantRules => ({ graceDays: st.competition.graceDays, tiers: st.competition.tiers, minTradesPerWeek: st.competition.minTradesPerWeek, maxStrikes: st.competition.maxStrikes });
/** League records: which month's prize went to whom (never paid twice). */
export const LEAGUE = () => join(P.bot, "league.json");
/** Month standings from the bots' own ledgers (badges, then % return, then fewest saves). */
function monthTable(states: { b: CompetitionBot; s: BotState }[], month: string) {
  return standings(states.map(({ b, s }) => ({ id: b.id, row: s.accountant?.months[month] })));
}
/** Before the bots trade: pay any finished month's prize, and find who is last this month (hungry: more charts to catch up). */
function leagueDuties(st: Settings, now: number): Set<string> {
  const states = competitors(st).map(b => ({ b, s: loadBot(b, st, now) }));
  const league = readJson<{ prizes: Record<string, string | null> }>(LEAGUE(), { prizes: {} }); const month = madridMonth(new Date(now).toISOString().slice(0, 16)); let changed = false;
  const past = [...new Set(states.flatMap(x => Object.keys(x.s.accountant?.months ?? {})))].filter(m => m < month && !(m in league.prizes)).sort();
  for (const m of past) {
    const top = monthTable(states, m)[0]; const row = states.find(x => x.b.id === top?.id);
    const earned = top && (top.trades > 0 || top.badges > 0) && row?.s.accountant && !row.s.fired;
    league.prizes[m] = earned ? top.id : null; changed = true;
    // "We cannot lose money": a prize is paid only out of the accountant's own profit, never out of the money it started with.
    if (earned && st.competition.monthlyPrize > 0 && bankOf(st).profit >= st.competition.monthlyPrize) { addBonus(row!.s.accountant!, new Date(now).toISOString().slice(0, 16), st.competition.monthlyPrize, `for winning ${m}`); row!.s.log.push({ d: new Date(now).toISOString().slice(0, 16), msg: `Won ${m}: the accountant paid a ${st.competition.monthlyPrize} USD prize into the award.` }); writeJson(botFiles(row!.b.id).state, row!.s); }
  }
  if (changed) writeJson(LEAGUE(), league);
  // Hungry: last this month and clearly behind the leader (a badge fewer, or half a point of % return).
  const table = monthTable(states, month); const lead = table[0]; const last = table.at(-1);
  const hungry = new Set<string>();
  if (lead && last && lead.id !== last.id && (lead.badges > last.badges || lead.returnPct - last.returnPct >= 0.5)) hungry.add(last.id);
  return hungry;
}
/** Everyone who has worked in the competition: names used, bots fired, and chart-strategy pairs each seat has already tried. */
export interface Roster { used: string[]; fired: FiredRecord[]; banned: Record<string, string[]> }
export interface FiredRecord { slot: string; name: string; recruit: number; hiredAt: string; firedAt: string; badges: number; bestStreak: number; tier: string; trades: number; returnPct: number;
  /** Paid back over its whole time (including what was recovered when it was fired). */ repaid: number; /** Loan the accountant lost. */ debtLeft: number; recovered?: number; interestCharged?: number; prizes?: number; /** Money above the loan handed back when replaced. */ returned?: number; file: string }
export const ROSTER = () => join(P.bot, "roster.json");
export const readRoster = (): Roster => ({ used: [], fired: [], banned: {}, ...readJson<Partial<Roster>>(ROSTER(), {}) });
function freshBot(b: CompetitionBot, st: Settings, stamp: string, name: string, recruit: number): BotState {
  const g = st.competition.startGrant; const s = { ...newState(g, stamp), accountant: newAccountant(g, stamp, rulesOf(st)), side: b.side, persona: { name, recruit, slot: b.id }, fired: null, playbook: [] };
  s.accountant.events.push({ d: stamp, kind: "hired", badges: 0, msg: `${name} hired with a ${g} USD loan.` });
  s.log.push({ d: stamp, msg: recruit === 1 ? `${name} joins the competition with a ${g} USD grant (a loan from the accountant).` : `${name} is hired to replace the fired bot, with a fresh ${g} USD grant (a loan from the accountant).` });
  return s;
}
function loadBot(b: CompetitionBot, st: Settings, now: number): BotState {
  const stamp = new Date(now).toISOString().slice(0, 16); const g = st.competition.startGrant;
  let s = readJson<BotState | null>(botFiles(b.id).state, null);
  // A bot that has never traded restarts cleanly when the starting grant or the rules' shape changed. A bot with history is converted, never reset.
  const old = s?.accountant && !("debt" in s.accountant);
  if (!s || (!s.trades.length && !Object.keys(s.positions).length && (s.startEquity !== g || old))) {
    const r = readRoster(); if (!r.used.includes(b.name)) { r.used.push(b.name); writeJson(ROSTER(), r); }
    return freshBot(b, st, stamp, b.name, 1);
  }
  if (old) { const a0 = s.accountant as unknown as { index: number; daily?: Record<string, number> }; s.accountant = { ...newAccountant(g, s.startedAt, rulesOf(st)), index: a0.index, daily: a0.daily ?? {}, lastEquity: equityOf(s, () => undefined) }; }
  s.accountant ??= newAccountant(g, s.startedAt, rulesOf(st)); s.side = b.side; s.persona ??= { name: b.name, recruit: 1, slot: b.id };
  // The first bot of each seat carries the name in settings (the owner renamed them on 2026-11-25); recruits keep theirs.
  if (s.persona.recruit === 1 && s.persona.name !== b.name) {
    const old = s.persona.name; s.persona.name = b.name; s.log.push({ d: stamp, msg: `${old} is now called ${b.name}.` });
    const r = readRoster(); if (!r.used.includes(b.name)) { r.used.push(b.name); writeJson(ROSTER(), r); }
  }
  return s;
}
/** Monday 00:00 Madrid after a moment (UTC "YYYY-MM-DDTHH:MM"). */
export function nextMondayMadrid(d: string): string {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  let t = Math.floor(Date.parse(d.slice(0, 16) + ":00Z") / 3600e3) * 3600e3 + 3600e3;
  for (let k = 0; k < 8 * 24; k++, t += 3600e3) { const p = Object.fromEntries(f.formatToParts(new Date(t)).map(x => [x.type, x.value])); if (p.weekday === "Mon" && p.hour === "00") break; }
  return new Date(t).toISOString().slice(0, 16);
}
/** The accountant's money (owner: "we are not an infinite bank"): it starts with bankUsd, lends a grant to every bot
 *  ever hired and pays the prizes, and gets back what the bots repay (including what is recovered from a stopped bot). */
export function bankOf(st: Settings = settings()) {
  const roster = readRoster(); const states = competitors(st).map(b => readJson<BotState | null>(botFiles(b.id).state, null));
  const hires = competitors(st).length + roster.fired.length; const lent = st.competition.startGrant * hires;
  const repaid = states.reduce((t, s) => t + (s?.accountant?.repaid ?? 0), 0) + roster.fired.reduce((t, f) => t + f.repaid, 0);
  const prizes = states.reduce((t, s) => t + (s?.accountant?.bonuses ?? 0), 0) + roster.fired.reduce((t, f) => t + (f.prizes ?? 0), 0);
  const owed = states.reduce((t, s) => t + (s?.accountant?.debt ?? 0), 0); const lost = roster.fired.reduce((t, f) => t + f.debtLeft, 0);
  const returned = states.reduce((t, s) => t + (s?.accountant?.returned ?? 0), 0) + roster.fired.reduce((t, f) => t + (f.returned ?? 0), 0);
  const available = st.competition.bankUsd - lent + repaid + returned - prizes;
  // The most the accountant can still lose: on each bot, what it is still owed, up to half the grant (the stop line).
  const atRisk = states.reduce((t, s) => t + (s?.fired ? 0 : Math.min(s?.accountant?.debt ?? 0, st.competition.startGrant / 2)), 0);
  // Profit: what the bank has plus what it is owed, above what it started with. Prizes are paid only out of this.
  const profit = available + owed - st.competition.bankUsd;
  return { start: st.competition.bankUsd, lent, repaid: +repaid.toFixed(2), returned: +returned.toFixed(2), prizes: +prizes.toFixed(2), owed: +owed.toFixed(2), lost: +lost.toFixed(2), available: +available.toFixed(2), atRisk: +atRisk.toFixed(2), profit: +profit.toFixed(2) };
}
/** The accountant fired this bot: keep its record (never traded again), and hire a recruit with a new name. */
function replaceFired(b: CompetitionBot, s: BotState, st: Settings, now: number): BotState {
  const r = readRoster(); const a = s.accountant!; const who = s.persona ?? { name: b.name, recruit: 1, slot: b.id };
  const file = join(P.bot, "fired", `${b.id}-${who.recruit}-${who.name}.json`.replace(/[^A-Za-z0-9.@_-]/g, "_"));
  writeJson(file, s);
  const tried = new Set([...(r.banned[b.id] ?? []), ...(s.playbook ?? []).map(p => `${p.key}|${p.id}`), ...s.trades.map(t => `${t.symbol}|${t.strategyId}`)]);
  r.banned[b.id] = [...tried];
  r.fired.push({ slot: b.id, name: who.name, recruit: who.recruit, hiredAt: s.startedAt, firedAt: s.fired!.at, badges: a.badges, bestStreak: a.bestStreak, tier: tierName(a, rulesOf(st)), trades: new Set(s.trades.map(t => `${t.symbol}|${t.entryDate}`)).size, returnPct: +(a.index - 100).toFixed(2), repaid: +a.repaid.toFixed(2), debtLeft: +(a.writtenOff ?? a.debt).toFixed(2), recovered: +(a.recovered ?? 0).toFixed(2), interestCharged: +a.interestPaid.toFixed(2), prizes: +(a.bonuses ?? 0).toFixed(2), returned: +(a.returned ?? 0).toFixed(2), file: file.split(/[\\/]/).slice(-2).join("/") });
  const name = st.competition.recruitNames.find(n => !r.used.includes(n)) ?? `Recruit ${r.fired.length + 4}`; r.used.push(name);
  writeJson(ROSTER(), r);
  const fresh = freshBot(b, st, new Date(now).toISOString().slice(0, 16), name, who.recruit + 1);
  fresh.log.unshift({ d: s.fired!.at, msg: `${who.name} was fired: ${s.fired!.reason}` });
  return fresh;
}
/** The bot's short list, re-picked when it is older than selection.refreshDays or the rules that judge it changed. */
/** The competition's weekend pause, bar by bar, for the backtests that choose the bots' strategies and charts. */
const pausedBars = (bars: { d: string }[], tf: Timeframe, cls: Sym["class"], clock?: "utc") => bars.map(x => inWeekendPause(barEndMs(x.d, tf, clock === "utc" ? "crypto" : cls)));
let readOnly = false;
function shortlistFor(b: CompetitionBot, st: Settings, markets: { s: Sym; tf: Timeframe; complete: { d: string }[]; c?: { clock?: "utc" } | null }[], now: number): Shortlist & { sig?: string } {
  const sig = JSON.stringify([st.exits ?? DEFAULT_EXITS, st.backtest, st.selection, st.costBps, st.intraday, st.timeframes, STRATEGIES.map(x => x.id), b.side, b.lighterCrypto ?? false, b.allLighter ?? false, st.competition.costTiers, "weekend-v3"]);
  const old = readJson<(Shortlist & { sig?: string }) | null>(botFiles(b.id).shortlist, null);
  if (old && readOnly) return old; // watching only: whoever trades picks it
  // Re-pick weekly, when the rules change, or when clearly more charts exist than at the last pick (new downloads). Not
  // when there are fewer: the PC and GitHub may hold different amounts of data and must not undo each other's pick.
  if (old && old.sig === sig && now - Date.parse(old.pickedAt) < st.selection.refreshDays * 864e5 && markets.length <= ((old as { seen?: number }).seen ?? 0) * 1.2) return old;
  const picked = { ...pickShortlist(markets.map(m => ({ key: `${m.s.symbol}@${m.tf}`, bars: m.complete as never, opt: { costBps: botCost(st, m.s, m.tf), maxLosingBars: st.backtest.maxLosingBars, barsPerYear: barsPerYear(m.complete as never, m.s.class === "crypto" ? 365 : 252), exits: st.exits ?? DEFAULT_EXITS, paused: pausedBars(m.complete, m.tf, m.s.class, m.c?.clock) } })), st.backtest, { ...st.selection, now, side: b.side === "both" ? undefined : b.side }), sig };
  (picked as { seen?: number }).seen = markets.length;
  writeJson(botFiles(b.id).shortlist, picked);
  return picked;
}
/** Which charts a bot can trade around the clock (Lighter or crypto) and which only while their market is open. */
export interface Hours { allDay: number; total: number; marketHoursOnly: string[]; /** Symbols the bot leaves alone because they cannot trade around the clock on Lighter. */ notTraded?: string[] }
/** Day by day (Madrid time): realized result, trades opened and closed, and the account value at the end of the day. */
export interface DayRow { day: string; equity: number; pnl: number; opened: number; closed: number; wins: number; losses: number }
const madridDay = (key: string) => key.length === 10 ? key : new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(key.slice(0, 16) + ":00Z"));
export function dailyRows(s: BotState, nowMs: number): DayRow[] {
  const first = madridDay(s.startedAt); const last = madridDay(new Date(nowMs).toISOString().slice(0, 16));
  const by = new Map<string, DayRow>(); const row = (d: string) => by.get(d) ?? (by.set(d, { day: d, equity: NaN, pnl: 0, opened: 0, closed: 0, wins: 0, losses: 0 }), by.get(d)!);
  const opened = new Set<string>();
  for (const t of s.trades) {
    const r = row(madridDay(t.exitDate)); r.pnl += t.pnl;
    // A position closed in parts (TP1, TP2...) counts as one closed trade, on the day its last part closed; each part's money counts on its own day.
    const id = `${t.symbol}|${t.entryDate}`; if (!opened.has(id)) { opened.add(id); row(madridDay(t.entryDate)).opened++; }
  }
  const ends = new Map<string, { day: string; pnl: number }>();
  for (const t of s.trades) { const id = `${t.symbol}|${t.entryDate}`; const e = ends.get(id) ?? { day: "", pnl: 0 }; e.pnl += t.pnl; if (madridDay(t.exitDate) >= e.day) e.day = madridDay(t.exitDate); ends.set(id, e); }
  const stillOpen = new Set(Object.entries(s.positions).map(([k, p]) => `${k}|${p.entryDate}`));
  for (const [id, e] of ends) { if (stillOpen.has(id)) continue; const r = row(e.day); r.closed++; if (e.pnl > 0) r.wins++; else r.losses++; }
  for (const [k, p] of Object.entries(s.positions)) { const id = `${k}|${p.entryDate}`; if (!opened.has(id)) { opened.add(id); row(madridDay(p.entryDate)).opened++; } }
  for (const pt of s.equityCurve) row(madridDay(pt.d)).equity = pt.equity;
  const out: DayRow[] = []; let eq = s.startEquity;
  for (let d = first; d <= last; d = new Date(Date.parse(d + "T12:00:00Z") + 864e5).toISOString().slice(0, 10)) {
    const r = by.get(d) ?? { day: d, equity: NaN, pnl: 0, opened: 0, closed: 0, wins: 0, losses: 0 };
    if (Number.isFinite(r.equity)) eq = r.equity; out.push({ ...r, equity: +eq.toFixed(2), pnl: +r.pnl.toFixed(2) });
    if (out.length > 400) break;
  }
  return out;
}
/** The next strategy check: one minute after the next quarter hour. */
const nextSlot = (ms: number) => { const q = 15 * 60000; return new Date(Math.floor(ms / q) * q + q + 60000).toISOString(); };
/** The account value curve for the screen: in time order, ending with the value right now, so the line ends where the account is. */
function liveCurve(s: BotState, now: number) {
  const c = [...s.equityCurve].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0)).slice(-600);
  const t = new Date().toISOString().slice(0, 16); if (c.length && c.at(-1)!.d >= t) c.pop();
  c.push({ d: t, equity: +now.toFixed(2) }); return c;
}
function botView(b: CompetitionBot, s: BotState, st: Settings, px: (k: string) => number | undefined, at: string, shortlist?: Shortlist, hours?: Hours | null) {
  const sg = (p: { side: string }) => (p.side === "short" ? -1 : 1); const v = b.view;
  return {
    id: b.id, name: s.persona?.name ?? b.name, recruit: s.persona?.recruit ?? 1, side: b.side, motto: b.motto ?? "", accountant: s.accountant ?? null,
    tier: s.accountant ? { level: tierOf(s.accountant, rulesOf(st)), name: tierName(s.accountant, rulesOf(st)), toNext: toNextTier(s.accountant, rulesOf(st)), tiers: st.competition.tiers, names: TIER_NAMES } : null,
    playbook: s.playbook ?? [], weekend: inWeekendPause(Date.parse(at)), lighterCrypto: !!b.lighterCrypto, allLighter: !!b.allLighter,
    twin: s.twin ? { equity: equityOf(s.twin, px), indexPct: (equityOf(s.twin, px) / s.twin.startEquity - 1) * 100, trades: new Set(s.twin.trades.map(t => `${t.symbol}|${t.entryDate}`)).size, wins: s.twin.trades.filter(t => t.pnl > 0).length, positions: Object.keys(s.twin.positions).length } : null,
    // The bot's books: cash + award + paid to the accountant must equal the grant + every closed trade's profit.
    books: s.accountant ? { difference: +reconcile(s.accountant, s.cash, s.trades.reduce((t, x) => t + x.pnl, 0), s.fundingPaid ?? 0).toFixed(4) } : null,
    fundingPaid: +(s.fundingPaid ?? 0).toFixed(4), hungry: !!s.hungry, fired: s.fired ?? null, strikes: s.accountant?.strikes ?? 0,
    // The trading result now, at live prices (the stored index only moves at bar closes).
    resultPct: s.accountant ? (s.accountant.lastEquity > 0 ? s.accountant.index * equityOf(s, px) / s.accountant.lastEquity : s.accountant.index) - 100 : (equityOf(s, px) / s.startEquity - 1) * 100,
    view: v, at, startedAt: s.startedAt, startEquity: s.startEquity, cash: s.cash, equity: equityOf(s, px), exposure: exposureOf(s, px),
    shortlist: shortlist ? { pickedAt: shortlist.pickedAt, chosen: shortlist.chosen, candidates: shortlist.candidates, charts: shortlist.charts, testShare: shortlist.testShare } : null,
    exits: st.exits ?? DEFAULT_EXITS, hours: hours ?? null, daily: dailyRows(s, Date.parse(at)), nextCheck: nextSlot(Date.parse(at)), pricesAt: loadLive().at ?? null,
    maxLeverage: st.bot.maxLeverage, riskPct: st.competition.riskPctPerTrade, maxDrawdownPct: st.bot.maxDrawdownPct, peak: s.peak ?? s.startEquity, halted: s.halted ?? null, checked: s.checked ?? null,
    positions: Object.entries(s.positions).map(([key, p]) => ({ key, symbol: underlying(key), tf: tfOf(key), ...p, price: px(key) ?? p.entry, pnl: sg(p) * p.qty * ((px(key) ?? p.entry) - p.entry) })),
    pending: Object.entries(s.pending).map(([key, p]) => ({ key, symbol: underlying(key), tf: tfOf(key), ...p })),
    trades: s.trades.map(t => ({ ...t, key: t.symbol, symbol: underlying(t.symbol), tf: tfOf(t.symbol) })), equityCurve: liveCurve(s, equityOf(s, px)), log: s.log.slice(-80).reverse(),
  };
}
/** Clear a halted bot after the owner's review (competition bots never halt: the accountant handles losses). */
export function resumeBot(id: string): boolean {
  const f = botFiles(id); const state = readJson<BotState | null>(f.state, null); if (!state?.halted) return false;
  const shown = readJson<{ positions: { key: string; price: number }[] } | null>(f.view, null); const prices = new Map((shown?.positions ?? []).map(p => [p.key, p.price]));
  writeJson(f.state, resume(state, k => prices.get(k), new Date().toISOString().slice(0, 16)));
  const b = readJson<Record<string, unknown> | null>(f.view, null); if (b) writeJson(f.view, { ...b, halted: null, peak: state.peak });
  return true;
}

async function doRefresh(opts: { fetch?: boolean; force?: boolean; now?: number }): Promise<RefreshResult> {
  const t0 = Date.now(); const st = settings(); const uni = universe(); const now = opts.now ?? Date.now(); const at = new Date(now).toISOString(); const tfs = timeframes(st);
  // Lighter's market list first (public data only): it says which stocks and gold get Lighter's around-the-clock candles.
  // A failure there never stops the rest.
  if (opts.fetch !== false) await refreshLighter(st, now).catch(() => undefined);
  const fetchStatus = opts.fetch === false
    ? uni.flatMap(s => tfs.filter(tf => tf === "1d" || s.class !== "index").map(tf => { const c = loadCached(s.symbol, tf, s.class); return { symbol: s.symbol, tf, ok: !!c, cached: true, source: c?.source, bars: c?.bars.length, lastBar: c?.bars.at(-1)?.d, fetchedAt: c?.fetchedAt, error: c ? undefined : "no saved prices" } as FetchStatus; }))
    : await refreshPrices(uni, opts.force, now, [...(competitors(st).some(b => b.lighterCrypto) ? lighterCryptoExtras(uni) : []), ...(competitors(st).some(b => b.allLighter) ? lighterOtherExtras(uni) : [])], lighterScalpable(uni.filter(x => x.traded)), st.competition.scalpTimeframes);
  // Remote mode: the bots live on GitHub. Bring their latest state here; this PC only shows it (and evaluates charts for the screens).
  // Shared mode (settings.remote): take the newest bot state from GitHub's bot-data branch (commit = lease). If that works
  // and remote.trade is not false, this PC trades the bots too and pushes the result back with the lease (src/data/sync.ts).
  // If git is missing or GitHub cannot be reached, it only shows the bots (read from raw files), as before.
  let lease: string | null = null; let syncError = "";
  if (st.remote?.repo && st.remote.trade !== false) { const r = syncPull(st.remote.repo, st.remote.branch, publishedFiles(st)); lease = r.sha; syncError = r.error ?? ""; }
  const remote = st.remote?.repo && !lease ? await pullRemote(st).catch(() => null) : null;
  const trading = !st.remote?.repo || !!lease; readOnly = !trading;
  const live = loadLive(); let retested = 0;
  const hungry = trading ? leagueDuties(st, now) : new Set<string>();
  OI = Object.fromEntries(Object.entries(readJson<LighterSnapshot | null>(lighterFile(), null)?.markets ?? {}).map(([k, m]) => [k, m.openInterestUsd]));
  // The desk guard (src/bot/desk.ts): the four bots as one desk, checked before they trade.
  const stamp = new Date(now).toISOString().slice(0, 16);
  const working = competitors(st).map(b => ({ b, s: readJson<BotState | null>(botFiles(b.id).state, null) })).filter(x => x.s?.accountant && !x.s.fired);
  const desk = readJson<DeskState>(DESK(), newDesk()); desk.daily ??= {};
  const guard = trading ? deskCheck(desk, working.map(x => ({ who: `${x.b.id}#${x.s!.persona?.recruit ?? 1}`, index: x.s!.accountant!.index })), stamp, st.competition.desk) : { stop: false, halve: !!desk.halved, dayPct: 0, fromHighPct: 0 };
  if (trading) writeJson(DESK(), { ...desk, last: guard });
  // The owner's decisions: requests shared through bot-data, answers kept on this PC only (src/bot/office.ts).
  const approvals = readApprovals(); let approvalsChanged = mergeAnswers(approvals);
  // Correlation cap: every bot's open positions (updated as each bot trades), and hourly closes for the correlations.
  const allSyms = Object.fromEntries([...uni, ...lighterCryptoExtras(uni), ...lighterOtherExtras(uni)].map(x => [x.symbol, x]));
  const holdings = new Map<string, { name: string; sym: string; side: "long" | "short" }[]>(competitors(st).map(b => { const s = readJson<BotState | null>(botFiles(b.id).state, null);
    return [b.id, s && !s.fired ? Object.entries(s.positions).map(([k, p]) => ({ name: s.persona?.name ?? b.name, sym: underlying(k), side: p.side })) : []]; }));
  const closes = new Map<string, Map<string, number>>();
  const closesOf = (sym: string) => { let m = closes.get(sym); if (m) return m; const x = allSyms[sym]; const c = x ? (x.lighterOnly ? loadLighterOnly(sym, "1h") : loadCached(sym, "1h", x.class) ?? loadLighterOnly(sym, "1h")) : null;
    m = new Map((c?.bars ?? []).slice(-st.competition.desk.corrDays * 24).map(bar => [bar.d, bar.c] as [string, number])); closes.set(sym, m); return m; };
  const corrs = new Map<string, number | null>();
  const corrOf = (a: string, b: string) => { const k = a < b ? `${a}|${b}` : `${b}|${a}`; if (!corrs.has(k)) corrs.set(k, correlation(closesOf(a), closesOf(b))); return corrs.get(k)!; };
  // Lighter funding, charged every hour on open positions (rate read as per fundingPeriodHours).
  const fundingRates = readJson<{ funding?: Record<string, number> } | null>(join(P.derived, "lighter.json"), null)?.funding ?? {};
  const fundingOf = (key: string) => (fundingRates[underlying(key)] ?? 0) / st.competition.fundingPeriodHours;
  for (const v of ["market", "crypto"] as View[]) {
    const rows: SymbolEval[] = []; const market: Record<string, MarketView> = {};
    const charts = uni.filter(x => inView(v, x)).flatMap(s => tfs.filter(tf => s.class !== "index" || tf === "1d").map(tf => {
      const c = loadCached(s.symbol, tf, s.class);
      return { s, tf, c, ...(c ? splitComplete(c.bars, c.clock === "utc" ? "crypto" : s.class, c.meta, now, tf) : { complete: [], partial: null }) };
    }));
    // The stocks bot trades only what can trade around the clock on Lighter (owner, 2026-11-22: test everything 24/7
    // before real money). Other stocks stay on Today for watching; an open position on one is still managed to its exit.
    const tradable = st.lighter?.prices24h === false ? null : lighterIds(uni);
    const botTrades = (x: Sym) => tradedBy(v, x) && (v === "crypto" || !tradable || tradable[x.symbol] != null);
    // Lighter-only crypto (1h and 4h): only for a bot with lighterCrypto (Catalina). Not on Today and not tested for the screens.
    const wide = (b: CompetitionBot) => !!(b.lighterCrypto || b.allLighter);
    const extras = !competitors(st).some(b => b.view === v && wide(b)) ? [] : v === "crypto" ? lighterCryptoExtras(uni) : lighterOtherExtras(uni);
    const extraCharts = extras.flatMap(s => (["1h", "4h"] as Timeframe[]).filter(tf => tfs.includes(tf)).map(tf => { const c = loadLighterOnly(s.symbol, tf); return c ? { s, tf, c, ...splitComplete(c.bars, "crypto", c.meta, now, tf) } : null; }).filter(<T,>(x: T | null): x is T => !!x));
    // Scalping charts (1m, 5m from Lighter): for the competition bots only, never on the screens.
    const scalpCharts = lighterScalpable(uni.filter(x => inView(v, x) && botTrades(x))).flatMap(s => st.competition.scalpTimeframes.map(tf => { const c = loadScalp(s.symbol, tf); return c ? { s, tf: tf as Timeframe, c, ...splitComplete(c.bars, "crypto", c.meta, now, tf) } : null; }).filter(<T,>(x: T | null): x is T => !!x));
    const bots = competitors(st).filter(b => b.view === v).map(b => ({ b, state: loadBot(b, st, now), shortlist: shortlistFor(b, st, [...charts.filter(m => botTrades(m.s)), ...scalpCharts, ...(wide(b) ? extraCharts : [])], now) }));
    const held = new Set(bots.flatMap(({ state }) => [...Object.keys(state.positions), ...Object.keys(state.pending)].map(underlying)));
    // Charts are judged once for both bots of this world: only strategies on one of their short lists can make a signal.
    const chosen = [...new Set(bots.flatMap(x => x.shortlist.chosen))];
    const sigSettings = JSON.stringify([st.costBps, st.intraday, st.backtest, st.exits, chosen]);
    for (const { s, tf, c, complete, partial } of charts) {
      const key = `${s.symbol}@${tf}`; const sig = `${complete.at(-1)?.d}|${complete.length}|${sigSettings}`; let hit = cache.get(`${v}:${key}`);
      if (!hit || hit.sig !== sig) {
        const { summary, curves } = evalSymbol(s, complete, null, st, { tf, costBps: costFor(st, s, tf), shortlist: chosen });
        writeJson(evalFile(v, key), { summary, curves }); hit = { sig, summary }; cache.set(`${v}:${key}`, hit); retested++;
      }
      rows.push({ ...hit.summary, livePrice: live.prices[s.symbol]?.price ?? partial?.c ?? c?.meta.price ?? null });
      if (botTrades(s) || (tradedBy(v, s) && held.has(s.symbol))) market[key] = { cls: s.class, group: s.group, tf, complete, partial, ...(c?.clock ? { clock: c.clock } : {}) };
    }
    writeJson(files(v).today, { view: v, at, timeframes: tfs, rows: rankToday(rows.map(slim)) });
    // Rule summaries cover the charts this bot trades (the Strategies screen's cards).
    const symOf = Object.fromEntries(uni.map(x => [x.symbol, x]));
    writeJson(files(v).indicators, { at, byTf: Object.fromEntries(tfs.map(tf => [tf, aggregate(rows.filter(r => r.tf === tf && r.evals.length && botTrades(symOf[r.symbol])))])) });
    // The competition bots of this world: each takes only strategies of its own side from its own short list.
    // Their own risk per trade; no circuit breaker (the accountant's bust line replaces it). Leverage stays under the ceiling.
    const byKey = Object.fromEntries(uni.map(s => [s.symbol, s]));
    const stBot: Settings = { ...st, bot: { ...st.bot, riskPctPerTrade: st.competition.riskPctPerTrade, maxDrawdownPct: 0 } };
    const side = (id: string) => STRATEGIES.find(x => x.id === id)?.side;
    const scalpMarket: Record<string, MarketView> = Object.fromEntries(scalpCharts.map(m => [`${m.s.symbol}@${m.tf}`, { cls: m.s.class, group: m.s.group, tf: m.tf, complete: m.complete, partial: m.partial, clock: "utc" as const }]));
    const extraMarket: Record<string, MarketView> = Object.fromEntries(extraCharts.map(m => [`${m.s.symbol}@${m.tf}`, { cls: m.s.class, group: m.s.group, tf: m.tf, complete: m.complete, partial: m.partial, clock: "utc" as const }]));
    for (const s of extras) byKey[s.symbol] = s;
    const fullMarket = { ...market, ...scalpMarket, ...extraMarket }; const baseMarket = { ...market, ...scalpMarket };
    const run = (st2: Settings, s: BotState, mk: Record<string, MarketView>, allowed: Record<string, string[]>, desk?: { id: string }) => step(s, mk, allowed, st2, { now, costBps: k => botCost(st, byKey[underlying(k)], tfOf(k)), lookup: twinStrategy, funding: fundingOf, maxSlipAtr: st.competition.maxSlipAtr,
      // The desk's rules apply to the real bots, not to their random twins (a twin only measures luck).
      ...(desk ? { flatten: guard.stop ? "desk-stop" : undefined, blocked: (k: string, side: "long" | "short") => correlationBlock(underlying(k), side, [...holdings].filter(([id]) => id !== desk.id).flatMap(([, h]) => h), corrOf, st.competition.desk.maxCorrelation) } : {}) });
    // Drawdown rule: half the risk per trade while the desk is too far under its best.
    const stDesk: Settings = guard.halve ? { ...stBot, bot: { ...stBot.bot, riskPctPerTrade: stBot.bot.riskPctPerTrade / 2 } } : stBot;
    // Bots with a fixed side choose first; a free bot (side "both") may not copy a chart-and-strategy pair another bot of
    // its world already trades, so every bot plays its own game.
    const order = [...bots].sort((p, q) => Number(p.b.side === "both") - Number(q.b.side === "both")); const taken = new Set<string>();
    for (const x of order) {
      if (!trading) continue; // watching only
      const { b, shortlist } = x; let state = x.state; const mk = wide(b) ? fullMarket : baseMarket;
      const tradable = (key: string) => { const sy = byKey[underlying(key)]; return !!sy && (sy.lighterOnly ? wide(b) : botTrades(sy)); };
      // The bot's own choice: up to maxCharts charts, each with the strategy that did best there on data it had not seen.
      const pick = (s: BotState) => { s.hungry = hungry.has(b.id); s.playbook = pickPlaybook(shortlist, st.competition.maxCharts + (hungry.has(b.id) ? st.competition.hungryExtraCharts : 0), new Set([...(readRoster().banned[b.id] ?? []), ...(b.side === "both" ? taken : [])])).filter(p => (b.side === "both" || side(p.id) === b.side) && tradable(p.key)); };
      const allowedFor = (s: BotState) => Object.fromEntries((s.playbook ?? []).map(p => [p.key, [p.id]]));
      // The random twin trades the same charts with the same rules, entering at random as often as the real strategy did.
      const twinAllowed = (s: BotState) => Object.fromEntries((s.playbook ?? []).map(p => [p.key, [twinId(p.key, p.id, (p as PlaybookPair).rate ?? 0)]]));
      const newTwin = (s: BotState) => ({ ...newState(st.competition.startGrant, s.startedAt), weekends: true });
      pick(state);
      run(stDesk, state, mk, allowedFor(state), b);
      // A stopped bot (bust line, no award to rescue it) waits for the end of the week; one replaced for quiet weeks goes at
      // once. Either way a recruit is hired only if the accountant has a grant's worth of money left.
      if (state.fired) {
        state.fired.replaceAt ??= /quiet weeks/.test(state.fired.reason) ? new Date(now).toISOString().slice(0, 16) : nextMondayMadrid(state.fired.at);
        // Hiring waits for the owner's yes on the Accountant screen (competition.approvals.hire).
        const who = state.persona ?? { name: b.name, recruit: 1, slot: b.id }; const hireId = `hire-${b.id}-${who.recruit + 1}`;
        const due = now >= Date.parse(state.fired.replaceAt + ":00Z") && bankOf(st).available >= st.competition.startGrant;
        if (due && st.competition.approvals.hire && !approvals.some(a => a.id === hireId)) {
          ask(approvals, { id: hireId, kind: "hire", slot: b.id, at: stamp, title: `Hire a recruit for ${who.name}'s seat?`, detail: `${who.name} was stopped on ${state.fired.at.replace("T", " ")} UTC: ${state.fired.reason} A recruit gets a new ${st.competition.startGrant} USD loan from the bank (${bankOf(st).available.toFixed(2)} USD available). Say no to leave the seat empty.` });
          approvalsChanged = true;
        }
        const ok = !st.competition.approvals.hire || approvals.find(a => a.id === hireId)?.status === "yes";
        if (due && ok) { state = replaceFired(b, state, st, now); pick(state); run(stDesk, state, mk, allowedFor(state), b); x.state = state; }
      }
      // A bot that reaches the top tier asks for real money. A yes is recorded only: real orders are not built (and will be asked again).
      if (!state.fired && st.competition.approvals.realMoney && state.accountant && tierOf(state.accountant, rulesOf(st)) >= 3) {
        const who = state.persona ?? { name: b.name, recruit: 1, slot: b.id }; const id = `real-${b.id}-${who.recruit}`;
        if (!approvals.some(a => a.id === id)) { ask(approvals, { id, kind: "real-money", slot: b.id, at: stamp, title: `${who.name} is an Experienced trader: move to real money?`, detail: `${who.name} has ${state.accountant.streak} badges in a row. A yes is recorded only: real orders on Lighter are not built yet, and before any real money the stops and take-profits must sit on Lighter as real orders. You will be asked again before anything real happens.` }); approvalsChanged = true; }
      }
      if (!state.fired) { state.twin ??= newTwin(state); delete state.twin.twin; run(stBot, state.twin, mk, twinAllowed(state)); }
      for (const p of state.playbook ?? []) taken.add(`${p.key}|${p.id}`);
      holdings.set(b.id, state.fired ? [] : Object.entries(state.positions).map(([k, p]) => ({ name: state.persona?.name ?? b.name, sym: underlying(k), side: p.side })));
      if (state.checked) state.checked.by = process.env.TD_ENGINE === "1" ? "GitHub" : "PC";
      writeJson(botFiles(b.id).state, state);
    }
    const px = (k: string) => live.prices[underlying(k)]?.price ?? fullMarket[k]?.partial?.c ?? fullMarket[k]?.complete.at(-1)?.c;
    const traded = Object.entries(market).filter(([k]) => botTrades(byKey[underlying(k)])); const hours: Hours = { total: traded.length, allDay: traded.filter(([, m]) => m.cls === "crypto" || m.clock === "utc").length,
      marketHoursOnly: [...new Set(traded.filter(([, m]) => m.cls !== "crypto" && m.clock !== "utc").map(([k]) => k.split("@")[0]))].sort(),
      notTraded: uni.filter(x => tradedBy(v, x) && !botTrades(x)).map(x => x.symbol).sort() };
    for (const { b, state, shortlist } of bots) writeJson(botFiles(b.id).view, botView(b, state, st, px, at, shortlist, hours));
  }
  if (approvalsChanged && trading) writeJson(APPROVALS(), approvals);
  const res: RefreshResult = { at: new Date().toISOString(), tookMs: Date.now() - t0, fetch: fetchStatus, symbolsWithData: new Set(fetchStatus.filter(f => f.bars).map(f => f.symbol)).size, retested, ...(remote ? { remote: { ok: remote.ok, failed: remote.failed.length, at: remote.at } } : {}) };
  writeJson(STATUS(), res);
  writeCompetition(now);
  logRun(process.env.TD_ENGINE === "1" ? "GitHub" : st.remote?.repo ? (trading ? "PC" : "PC (watching)") : "PC (alone)", Date.now() - t0, res.symbolsWithData, fetchStatus.filter(f => !f.ok && !f.skipped).length);
  if (lease && st.remote) {
    const pushed = syncPush(st.remote.repo, st.remote.branch, lease, publishedFiles(st), { "heartbeat.json": JSON.stringify({ at: new Date().toISOString(), by: "PC", tookMs: Date.now() - t0 }, null, 1), "README.md": "# TradingDesk bot data\n\nThe four paper bots' state and the competition scoreboard, written by whoever checked the bots last (GitHub's workflow or the owner's PC). Pretend money only.\n" });
    writeJson(join(P.derived, "remote.json"), { mode: "shared", trading: true, lease, pushed: pushed.pushed, note: pushed.error ?? "", at: new Date().toISOString(), repo: st.remote.repo, branch: st.remote.branch });
  } else if (st.remote?.repo && syncError) { const r = readJson<Record<string, unknown>>(join(P.derived, "remote.json"), {}); writeJson(join(P.derived, "remote.json"), { ...r, mode: "watching", trading: false, note: syncError }); }
  writeBoard(now);
  return res;
}

/** Every tick: new live prices, then the board and the bots' open profit. */
export async function tick(now = Date.now()): Promise<{ updated: number; errors: string[] }> {
  const uni = universe(); const watch = new Set<string>();
  for (const c of competitors()) {
    const b = readJson<{ positions: { symbol: string }[]; pending: { symbol: string }[] } | null>(botFiles(c.id).view, null);
    b?.positions.forEach(p => watch.add(p.symbol)); b?.pending.forEach(p => watch.add(p.symbol));
  }
  for (const v of ["market", "crypto"] as View[]) {
    readJson<{ rows: SlimRow[] }>(files(v).today, { rows: [] }).rows.filter(r => r.action === "enter" || r.action === "hold").forEach(r => watch.add(r.symbol));
  }
  const r = await tickPrices(uni, [...watch], now); const live = loadLive();
  const st = settings();
  for (const c of competitors(st)) {
    const f = botFiles(c.id); const s = readJson<BotState | null>(f.state, null); const b = readJson<{ positions: { key: string; price: number }[]; at: string; hours?: Hours | null } | null>(f.view, null);
    if (!s || !b) continue; const old = new Map(b.positions.map(p => [p.key, p.price]));
    writeJson(f.view, botView(c, s, st, k => live.prices[underlying(k)]?.price ?? old.get(k), b.at, readJson<Shortlist | undefined>(f.shortlist, undefined), b.hours));
  }
  writeJson(join(P.derived, "tick.json"), { at: new Date(now).toISOString(), ...r });
  writeCompetition(now);
  writeBoard(now);
  return r;
}

const ORDER = { enter: 0, exit: 1, hold: 2, wait: 3, "no-strategy": 4, "no-data": 5 } as const;
/** One row per symbol for the Today screen: price, what to do, every timeframe, the bot's position, whether it trades 24/7. */
export function writeBoard(now = Date.now()) {
  const uni = universe(); const live = loadLive(); const st = settings(); const tfs = timeframes(st); const allDay = lighterIds(uni);
  const rows = (["market", "crypto"] as View[]).flatMap(v => readJson<{ rows: SlimRow[] }>(files(v).today, { rows: [] }).rows);
  const bots = competitors(st).map(c => ({ v: c.view, c, b: readJson<ReturnType<typeof botView> | null>(botFiles(c.id).view, null) }));
  const symbols = uni.filter(s => s.class !== "index").map(s => {
    const mine = rows.filter(r => r.symbol === s.symbol); const daily = mine.find(r => r.tf === "1d"); const lp = live.prices[s.symbol];
    const top = [...mine].sort((a, b) => ORDER[a.action] - ORDER[b.action] || b.score - a.score || TIMEFRAMES.indexOf(b.tf) - TIMEFRAMES.indexOf(a.tf))[0] ?? null;
    const pos = bots.flatMap(({ v, c, b }) => (b?.positions ?? []).filter(p => p.symbol === s.symbol).map(p => ({ view: v, bot: c.id, botName: b?.name ?? c.name, ...p })))[0] ?? null;
    const order = bots.flatMap(({ v, c, b }) => (b?.pending ?? []).filter(p => p.symbol === s.symbol).map(p => ({ view: v, bot: c.id, botName: b?.name ?? c.name, ...p })))[0] ?? null;
    const fast = mine.find(r => r.tf === tfs[0]); const lastBarPrice = fast?.livePrice ?? fast?.lastClose ?? daily?.livePrice ?? daily?.lastClose ?? null;
    return {
      symbol: s.symbol, group: s.group, class: s.class, traded: s.traded,
      price: lp?.price ?? lastBarPrice, priceAt: lp?.at ?? null, changePct: lp?.changePct ?? daily?.dayChangePct ?? null, changeLabel: lp?.changeLabel ?? (s.class === "crypto" ? "24 h" : "today"),
      tfs: Object.fromEntries(mine.map(r => [r.tf, { action: r.action, side: r.side, best: r.best, bestName: r.bestName, why: r.why, plan: r.plan, record: r.record, lastDate: r.lastDate, passing: r.passing }])),
      top: top && { tf: top.tf, action: top.action, side: top.side, best: top.best, bestName: top.bestName, why: top.why, plan: top.plan, record: top.record, regime: top.regime },
      bot: pos, order,
      /** Trades around the clock (crypto, or a liquid Lighter market), so the bot trades it; otherwise only watched. */
      allDay: s.class === "crypto" || allDay[s.symbol] != null,
    };
  }).sort((a, b) => (a.bot || a.order ? -1 : 0) - (b.bot || b.order ? -1 : 0) || ORDER[a.top?.action ?? "no-data"] - ORDER[b.top?.action ?? "no-data"] || a.symbol.localeCompare(b.symbol));
  const context = uni.filter(s => s.class === "index").map(s => { const lp = live.prices[s.symbol]; const r = rows.find(x => x.symbol === s.symbol && x.tf === "1d"); return { symbol: s.symbol, price: lp?.price ?? r?.livePrice ?? r?.lastClose ?? null, changePct: lp?.changePct ?? r?.dayChangePct ?? null }; });
  const status = readJson<RefreshResult | null>(STATUS(), null); const t = readJson<{ at: string; errors: string[] } | null>(join(P.derived, "tick.json"), null);
  const slot = 15 * 60000; const next = new Date(Math.floor(now / slot) * slot + slot + 60000).toISOString();
  writeJson(BOARD(), {
    at: new Date(now).toISOString(), timeframes: tfs, symbols, context,
    status: { checkedAt: status?.at ?? null, tookMs: status?.tookMs ?? null, nextCheck: next, pricesAt: live.at, tickErrors: t?.errors ?? [], downloads: status ? { ok: status.fetch.filter(f => f.ok).length, total: status.fetch.length, failed: status.fetch.filter(f => !f.ok).map(f => ({ symbol: f.symbol, tf: f.tf, error: f.error, cached: f.cached })) } : null },
    bots: bots.map(({ v, c, b }) => b && { id: c.id, name: b.name ?? c.name, side: c.side, view: v, grant: b.accountant?.grant ?? null, badges: b.accountant?.badges ?? 0, equity: b.equity, startEquity: b.startEquity, positions: b.positions.length, pending: b.pending.length, trades: b.trades.length, halted: !!b.halted, checked: b.checked }),
  });
}

/** Parts of the same trade joined: one line per trade, with its whole result. */
function wholeTrades(trades: { key?: string; symbol: string; entryDate: string; exitDate: string; pnl: number; side: string }[]) {
  const m = new Map<string, { key: string; side: string; entryDate: string; exitDate: string; pnl: number }>();
  for (const t of trades) { const k = `${t.key ?? t.symbol}|${t.entryDate}`; const x = m.get(k) ?? { key: t.key ?? t.symbol, side: t.side, entryDate: t.entryDate, exitDate: t.exitDate, pnl: 0 }; x.pnl += t.pnl; if (t.exitDate > x.exitDate) x.exitDate = t.exitDate; m.set(k, x); }
  return [...m.values()];
}
const MADRID_DOW = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", weekday: "short" });
/** Monday (Madrid date) of the week a moment falls in. */
function weekOf(ms: number): string { const back = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(MADRID_DOW.format(new Date(ms))); return madridDay(new Date(ms - back * 864e5).toISOString().slice(0, 16)); }
/** Weekly duels (owner, 2026-11-23: make the bots compete): every week two pairs, rotating so everyone meets everyone
 *  every three weeks. The better trading result of the week (index, money moves left out) wins 3 points; a draw (within
 *  0.05 points of %) gives 1 each. The current week is shown live and counts once it is over. */
export function duelsOf(bots: { id: string; name: string; index: number; daily: Record<string, number>; hiredAt: string }[], now: number) {
  const ROUNDS = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]];
  const first = weekOf(Math.min(...bots.map(b => Date.parse(b.hiredAt + ":00Z") || now))); const current = weekOf(now);
  const startIdx = (b: (typeof bots)[number], mon: string) => { const before = Object.keys(b.daily).filter(d => d < mon).sort().at(-1); return before ? b.daily[before] : 100; };
  const endIdx = (b: (typeof bots)[number], mon: string, live: boolean) => { if (live) return b.index; const sun = madridDay(new Date(Date.parse(mon + "T12:00:00Z") + 6 * 864e5).toISOString().slice(0, 16)); const last = Object.keys(b.daily).filter(d => d <= sun).sort().at(-1); return last ? b.daily[last] : 100; };
  const weeks: { week: string; live: boolean; pairs: { a: string; b: string; aPct: number; bPct: number; winner: string | null }[] }[] = [];
  for (let t = Date.parse(first + "T12:00:00Z"), n = 0; t <= Date.parse(current + "T12:00:00Z") && bots.length >= 4; t += 7 * 864e5, n++) {
    const mon = madridDay(new Date(t).toISOString().slice(0, 16)); const live = mon === current;
    const pairs = ROUNDS[n % 3].map(([i, j]) => { const A = bots[i], B = bots[j]; const aPct = (endIdx(A, mon, live) / startIdx(A, mon) - 1) * 100, bPct = (endIdx(B, mon, live) / startIdx(B, mon) - 1) * 100;
      return { a: A.id, b: B.id, aPct: +aPct.toFixed(2), bPct: +bPct.toFixed(2), winner: Math.abs(aPct - bPct) < 0.05 ? null : aPct > bPct ? A.id : B.id }; });
    weeks.push({ week: mon, live, pairs });
  }
  const table = bots.map(b => { let w = 0, d = 0, l = 0; for (const wk of weeks.filter(x => !x.live)) for (const p of wk.pairs) if (p.a === b.id || p.b === b.id) { if (!p.winner) d++; else if (p.winner === b.id) w++; else l++; } return { id: b.id, points: 3 * w + d, won: w, drawn: d, lost: l }; })
    .sort((x, y) => y.points - x.points || y.won - x.won);
  return { current: weeks.at(-1) ?? null, past: weeks.filter(x => !x.live).reverse(), table };
}
/** The locker room: the bots' own voices on what happened (badges, saves, firings, prizes, duels, big trades). Made from the
 *  records with fixed phrases; nothing here changes how any bot trades. */
function lockerRoom(bots: { id: string; name: string; allEvents: { d: string; kind: string; amount?: number; badges: number }[]; bigTrades: { key: string; side: string; exitDate: string; pnl: number }[] }[],
  duels: ReturnType<typeof duelsOf>, roster: Roster) {
  const pick = (seed: string, xs: string[]) => xs[Math.floor(unitHash(seed) * xs.length)];
  const nameOf = (id: string) => bots.find(b => b.id === id)?.name ?? id; const out: { d: string; id: string; text: string }[] = [];
  for (const b of bots) {
    const rival = (d: string) => bots.filter(x => x.id !== b.id)[Math.floor(unitHash(b.id + d) * (bots.length - 1))];
    for (const e of b.allEvents) {
      const seed = b.id + e.d + e.kind;
      if (e.kind === "milestone") { out.push({ d: e.d, id: b.id, text: pick(seed, [`Badge number ${e.badges}. Who's next?`, `Another $500 day. Badge ${e.badges} locked in.`, `That's ${e.badges}. The accountant knows my name now.`]) });
        const r = rival(e.d); if (r) out.push({ d: e.d, id: r.id, text: pick(seed + "r", [`${b.name} got lucky. My turn is coming.`, `Fine, ${b.name}. Enjoy it while it lasts.`, `Noted, ${b.name}. I'm hunting the next one.`]) }); }
      else if (e.kind === "save") out.push({ d: e.d, id: b.id, text: pick(seed, ["Ouch. The award saved me this time. Streak back to zero.", "Bad run. Back to $250 and back to work.", "Bruised, not fired. Starting the streak again."]) });
      else if (e.kind === "fired") out.push({ d: e.d, id: b.id, text: pick(seed, ["That's it for me. Good luck, team.", "Clearing my desk. Beat them for me, recruit.", "Stopped. The market won this one."]) });
      else if (e.kind === "hired") out.push({ d: e.d, id: b.id, text: "New on the desk. Watch me." });
      else if (e.kind === "bonus") out.push({ d: e.d, id: b.id, text: `Monthly title and a $${(e.amount ?? 0).toFixed(0)} prize. Thank you, accountant.` });
      else if (e.kind === "strike") out.push({ d: e.d, id: b.id, text: pick(seed, ["Quiet week. A strike from the accountant. I need to trade more.", "Strike. Waiting for the perfect trade doesn't pay here."]) });
    }
    for (const t of b.bigTrades) out.push({ d: t.exitDate, id: b.id, text: t.pnl > 0 ? `${t.key.replace("@", " ")} ${t.side} closed for +$${t.pnl.toFixed(2)}.` : `${t.key.replace("@", " ")} ${t.side} cost me $${(-t.pnl).toFixed(2)}. Moving on.` });
  }
  for (const wk of duels.past) for (const p of wk.pairs) {
    const d = madridDay(new Date(Date.parse(wk.week + "T12:00:00Z") + 6 * 864e5).toISOString().slice(0, 16)) + "T21:00";
    out.push({ d, id: p.winner ?? p.a, text: p.winner ? `Won the week against ${nameOf(p.winner === p.a ? p.b : p.a)}: ${p.winner === p.a ? p.aPct : p.bPct}% against ${p.winner === p.a ? p.bPct : p.aPct}%.` : `A draw with ${nameOf(p.b)} this week.` });
  }
  for (const f of roster.fired) out.push({ d: f.firedAt, id: f.slot, text: `${f.name} has left the desk.` });
  return out.sort((x, y) => (x.d < y.d ? 1 : -1)).slice(0, 40);
}
/** The scoreboard: every bot's tier, streak, badges, award and loan, this month's standings, the fired bots, the index chart. */
export function writeCompetition(now = Date.now()) {
  const st = settings(); const rules = rulesOf(st); const month = madridMonth(new Date(now).toISOString().slice(0, 16)); const roster = readRoster();
  const bots = competitors(st).map(c => {
    const v = readJson<ReturnType<typeof botView> | null>(botFiles(c.id).view, null);
    const a: Accountant = v?.accountant && "debt" in v.accountant ? v.accountant : newAccountant(st.competition.startGrant, new Date(now).toISOString().slice(0, 16), rules);
    const equity = v?.equity ?? a.grant; const live = a.lastEquity > 0 ? a.index * equity / a.lastEquity : a.index; const m = a.months[month];
    return { id: c.id, name: v?.name ?? c.name, recruit: v?.recruit ?? 1, view: c.view, side: c.side, motto: c.motto ?? "", started: !!v, hiredAt: a.hiredAt, checkedAt: v?.checked?.at ?? null,
      tier: tierOf(a, rules), tierName: tierName(a, rules), streak: a.streak, bestStreak: a.bestStreak, toNext: toNextTier(a, rules),
      grant: a.grant, badges: a.badges, saves: a.saves, award: +a.award.toFixed(2), debt: +a.debt.toFixed(2), repaid: +a.repaid.toFixed(2), interestPaid: +a.interestPaid.toFixed(2), nextInterestAt: a.nextInterestAt,
      equity, bustLine: a.grant / 2, target: 2 * a.grant, index: +live.toFixed(3), totalReturnPct: +(live - 100).toFixed(2),
      twin: v?.twin ? { returnPct: +v.twin.indexPct.toFixed(2), trades: v.twin.trades } : null, lighterCrypto: !!c.lighterCrypto,
      positions: v?.positions.length ?? 0, pending: v?.pending.length ?? 0, playbook: (v?.playbook ?? []).map((p: PlaybookPair) => ({ key: p.key, id: p.id, name: p.name })),
      month: m ? { badges: m.badges, saves: m.saves, interest: +m.interest.toFixed(2), returnPct: +((live / m.indexStart - 1) * 100).toFixed(2), trades: m.trades, wins: m.wins, pnl: +m.pnl.toFixed(2) } : null,
      events: a.events.filter(e => e.kind !== "weekend" && e.kind !== "active").slice(-12).reverse(), allEvents: a.events, daily: a.daily ?? {}, months: a.months,
      fundingPaid: v?.fundingPaid ?? 0, hungry: !!v?.hungry, strikes: a.strikes ?? 0, stopped: v?.fired ?? null, ownMoney: a.debt <= 0.005, bonuses: +(a.bonuses ?? 0).toFixed(2),
      bigTrades: wholeTrades(v?.trades ?? []).filter(t => Math.abs(t.pnl) >= st.competition.startGrant * 0.03),
      report: { id: c.id, name: v?.name ?? c.name, hiredAt: a.hiredAt, index: live, daily: a.daily ?? {}, trades: wholeTrades(v?.trades ?? []), events: a.events, equity, grant: a.grant, award: a.award, debt: a.debt, strikes: a.strikes ?? 0, tierName: tierName(a, rules), streak: a.streak, badges: a.badges, stopped: v?.fired ?? null } as ReportBot };
  });
  const allMonths = [...new Set([month, ...bots.flatMap(b => Object.keys(b.months))])].sort().reverse();
  const table = (mo: string) => standings(bots.map(b => ({ id: b.id, row: mo === month && b.months[mo] ? { ...b.months[mo], indexEnd: b.index } : b.months[mo] })));
  const months = allMonths.map(mo => ({ month: mo, finished: mo < month, standings: table(mo), fired: roster.fired.filter(f => madridMonth(f.firedAt) === mo).map(f => f.name) }));
  // The ladder: highest tier first, then the longest streak, then badges, then the trading result.
  const ladder = [...bots].sort((a, b) => b.tier - a.tier || b.streak - a.streak || b.badges - a.badges || b.index - a.index).map((b, i) => ({ id: b.id, rank: i + 1 }));
  const duels = duelsOf(bots, now);
  const locker = lockerRoom(bots, duels, roster);
  const runs = readJson<{ at: string; by: string; tookMs: number; failed: number }[]>(RUNS(), []);
  const day = runs.filter(r => now - Date.parse(r.at) < 864e5); const remoteNote = readJson<Record<string, unknown> | null>(join(P.derived, "remote.json"), null);
  const checks = { last: runs.slice(-12).reverse(), last24h: Object.fromEntries([...new Set(day.map(r => r.by))].map(b => [b, day.filter(r => r.by === b).length])), shared: !!st.remote?.repo, sync: remoteNote };
  writeJson(COMPETITION(), { at: new Date(now).toISOString(), month, duels, locker, checks, weekend: inWeekendPause(now), startGrant: st.competition.startGrant, riskPct: st.competition.riskPctPerTrade,
    rules: { ...rules, maxCharts: st.competition.maxCharts, tierNames: TIER_NAMES }, bots: bots.map(({ months: _m, allEvents: _e, bigTrades: _t, report: _r, ...b }) => b), months, ladder,
    // The accountant's own books: loans (lent = repaid + lost + still owed) and the bank (start - lent + repaid - prizes = available).
    books: (() => { const k = bankOf(st); return { ...k, funding: +bots.reduce((t, b) => t + b.fundingPaid, 0).toFixed(2),
      difference: +(k.lent - k.repaid - k.lost - k.owed).toFixed(2) }; })(),
    experienced: bots.filter(b => b.tier >= 3).length, recruitsTried: competitors(st).length + roster.fired.length, fired: [...roster.fired].reverse() });
  writeOffice(st, bots.map(b => b.report), months, now);
}
/** The Accountant screen: decisions waiting for the owner, the accountant's daily and weekly reports, every bot's weekly report. */
function writeOffice(st: Settings, bots: ReportBot[], months: unknown, now: number) {
  const desk = readJson<(DeskState & { last?: ReturnType<typeof deskCheck> }) | null>(DESK(), null); const bank = bankOf(st);
  const days = dailyReports(bots, desk?.daily ?? {}, now, 14);
  const weeks = Object.fromEntries(bots.map(b => [b.id, weeklyReports(b, now, st.competition.minTradesPerWeek, 8)]));
  // The accountant's weekly report to the owner: the four bots' weeks added up.
  const weekly = (weeks[bots[0]?.id] ?? []).map((w, i) => { const all = bots.map(b => weeks[b.id][i]).filter(Boolean);
    return { week: w.week, live: w.live, trades: all.reduce((t, x) => t + x.trades, 0), pnl: +all.reduce((t, x) => t + x.pnl, 0).toFixed(2), badges: all.reduce((t, x) => t + x.badges, 0), saves: all.reduce((t, x) => t + x.saves, 0), strikes: all.filter(x => x.strike).length,
      best: all.some(x => x.trades || x.returnPct) ? [...all].sort((x, y) => y.returnPct - x.returnPct).map(x => bots.find(b => weeks[b.id].includes(x))?.name)[0] ?? null : null }; });
  const risk = bots.map(b => ({ id: b.id, name: b.name, equity: +b.equity.toFixed(2), bustLine: b.grant / 2, cushion: +(b.equity - b.grant / 2).toFixed(2), award: +b.award.toFixed(2), debt: +b.debt.toFixed(2), strikes: b.strikes, tier: b.tierName, streak: b.streak, stopped: !!b.stopped,
    // What the accountant itself can still lose on this bot: what it is owed, up to the money above the stop line (half the grant).
    accountantAtRisk: b.stopped ? 0 : +Math.min(b.debt, b.grant / 2).toFixed(2) }));
  const pending = readApprovals();
  writeJson(OFFICE(), { at: new Date(now).toISOString(), bank, desk: desk ? { index: +desk.index.toFixed(3), high: +desk.high.toFixed(3), stoppedDay: desk.stoppedDay ?? null, halved: !!desk.halved, last: desk.last ?? null, log: desk.log.slice(-20).reverse() } : null,
    rules: { ...st.competition.desk, costTiers: st.competition.costTiers, maxSlipAtr: st.competition.maxSlipAtr, approvals: st.competition.approvals, minTradesPerWeek: st.competition.minTradesPerWeek },
    approvals: [...pending].sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending") || (a.at < b.at ? 1 : -1)), days, weekly, weeks, risk, months });
}

if (import.meta.main) {
  const r = await refresh({ force: process.argv.includes("--force"), fetch: !process.argv.includes("--offline") });
  const bad = r.fetch.filter(f => !f.ok);
  console.log(`Refreshed ${r.symbolsWithData} symbols (${r.retested} symbol-timeframes re-tested) in ${(r.tookMs / 1000).toFixed(1)}s.` + (bad.length ? ` Failed: ${bad.map(b => `${b.symbol} ${b.tf} (${b.error})`).join("; ")}` : ""));
}
