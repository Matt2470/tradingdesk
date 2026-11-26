// Paths, settings and JSON file helpers. Every other module gets paths from here.
import { join, resolve, dirname } from "node:path";
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { DEFAULT_EXITS, type ExitPlan } from "./core/exits";

export const ROOT = resolve(import.meta.dir, "..");
/** Data directory. Tests and the smoke run point TD_DATA_DIR at a temp folder so they never touch real data. */
export const DATA = process.env.TD_DATA_DIR ? resolve(process.env.TD_DATA_DIR) : join(ROOT, "data");
export const P = {
  bars: join(DATA, "cache", "bars"),
  derived: join(DATA, "derived"),
  bot: join(DATA, "bot"),
  briefs: join(DATA, "briefs"),
  imports: join(DATA, "imports"),
};

export type AssetClass = "stock" | "crypto" | "metal" | "index";
export interface Sym { symbol: string; yahoo: string; binance?: string; class: AssetClass; group: string; traded: boolean; /** A crypto listed on Lighter but not in config/universe.json: prices from Lighter only, traded only by a bot with lighterCrypto. */ lighterOnly?: boolean }
export interface Settings {
  port: number; historyRange: string;
  /** Seconds between live price ticks. Strategies are re-checked when a 15-minute bar closes. */
  tickSeconds: number;
  /** Timeframes evaluated and traded, from "15m" "30m" "1h" "4h" "1d". */
  timeframes: string[];
  /** Cost per side for crypto on timeframes shorter than a day. */
  intraday: { costBps: number };
  costBps: Record<AssetClass, number>;
  backtest: { maxLosingBars: number; minTrades: number; minProfitFactor: number };
  bot: { startEquity: number; riskPctPerTrade: number; maxPositionPct: number; maxLeverage: number; maxPositions: number; /** Stop the bot when the account falls this far below its peak. */ maxDrawdownPct: number; /** Most positions in one direction inside one group of related symbols. */ maxPerGroup: number };
  /** How positions are closed (src/core/exits.ts). Missing = DEFAULT_EXITS. */
  exits: ExitPlan;
  /** The short list of strategies each bot may trade (src/core/select.ts). */
  selection: { maxStrategies: number; /** Share of each history kept back to confirm the choice. */ testShare: number; /** Re-pick after this many days. */ refreshDays: number };
  /** Lighter, read-only for now (src/data/lighter.ts). accountIndex is public (it is not a key); null = do not read an account. */
  lighter?: { accountIndex: number | null; budgetUsd: number; live: boolean; /** Use Lighter's candles and prices for stocks and gold (they trade there around the clock). Default true. */ prices24h?: boolean; /** A Lighter market needs at least this much open interest (USD) to be used. Default 25000. */ minOpenInterestUsd?: number };
  /** The bot competition (src/bot/accountant.ts): four paper bots, one per world and direction. */
  competition: Competition;
  /** The bots run on GitHub (a public repo, every 15 minutes). When set, this PC reads their state from the repo's
   *  data branch and never steps the bots itself, so two copies never trade the same bots. Null = the bots run here. */
  remote?: { repo: string; branch: string; /** Shared mode (default true): this PC trades the bots too, taking turns with GitHub through bot-data. false = only show them. */ trade?: boolean } | null;
  risk: { accountUsd?: number; maxLeverage?: number; maxHoldHoursLosing: number; maxNotionalUsd: number; maxAddsToLoser: number };
}

export interface CompetitionBot { id: string; name: string; view: "market" | "crypto";
  /** "long" bullish, "short" bearish, "both" free to choose. */ side: "long" | "short" | "both"; motto?: string;
  /** Also trades every liquid crypto on Lighter listed in config/lighter-crypto.json (owner, 2026-11-23, for Catalina). */ lighterCrypto?: boolean;
  /** Also trades every liquid non-crypto perp on Lighter listed in config/lighter-other.json: more stocks, indices, commodities, currencies, pre-IPO (owner, 2026-11-24, for Nico and Lucas). */ allLighter?: boolean ; /** A hired evil twin (src/bot/evil.ts): replayed, not stepped. */ evil?: { kind: string; sym: string; of: string }}
export interface Competition {
  startGrant: number; /** Risk per trade for competition bots (% of the account). */ riskPctPerTrade: number;
  /** Days after hiring before the first weekly activity check. */ graceDays: number;
  /** Quiet weeks in a row that get a bot replaced. */ maxStrikes: number;
  /** The accountant's money: it lends grants and pays prizes from it, and gets repayments back. No recruit or prize without the money (owner: "we are not an infinite bank"). */ bankUsd: number;
  /** Badges in a row for Pro, Master and Experienced trader. */ tiers: number[];
  /** Most charts (symbol and timeframe) a bot chooses to trade. */ maxCharts: number;
  /** Names given to recruits, in order, when a bot is fired. */ recruitNames: string[];
  /** Scalping timeframes the bots may also choose ("1m", "5m"; [] for none). Lighter candles only. */ scalpTimeframes: ("1m" | "5m")[];
  /** Trades a bot must close in a week to avoid a strike. */ minTradesPerWeek: number;
  /** Lighter's funding rate is read as a rate per this many hours and charged every hour (8 = the usual "8-hour rate"; unconfirmed). */ fundingPeriodHours: number;
  /** Prize the accountant pays into the monthly winner's award. */ monthlyPrize: number;
  /** Extra charts a bot may trade while it is last in the month (more chances to catch up, same risk per trade). */ hungryExtraCharts: number;
  /** The four bots as one desk (owner, 2026-11-25, src/bot/desk.ts). dailyLossPct: a fall this big in one Madrid day closes
   *  every position and stops new trades until the next day. drawdownPct: this far under the desk's best, risk per trade is
   *  halved until the desk is back within recoverPct of it. maxCorrelation: a bot may not open a trade in the same direction as
   *  another bot's open position on the same market or on one that moves with it (hourly returns over corrDays days). */
  desk: { dailyLossPct: number; drawdownPct: number; recoverPct: number; maxCorrelation: number; corrDays: number };
  /** Spread and slippage per side (bps) by the market's open interest on Lighter, biggest first; markets with no Lighter data keep costBps. */
  costTiers: { minOiUsd: number; bps: number }[];
  /** An entry is cancelled when the next open is more than this many ATRs (14) from the signal bar's close: the price ran away (0 = off). */
  maxSlipAtr: number;
  /** Decisions that wait for the owner's yes or no on the Accountant screen: hiring a recruit, and a bot asking for real money. */
  approvals: { hire: boolean; realMoney: boolean };
  bots: CompetitionBot[];
}
export const DEFAULT_COMPETITION: Competition = { startGrant: 250, riskPctPerTrade: 2, graceDays: 7, maxStrikes: 3, bankUsd: 1500, tiers: [4, 8, 12], maxCharts: 8, scalpTimeframes: ["1m", "5m"], minTradesPerWeek: 5, fundingPeriodHours: 8, monthlyPrize: 25, hungryExtraCharts: 2,
  desk: { dailyLossPct: 3, drawdownPct: 7, recoverPct: 3.5, maxCorrelation: 0.8, corrDays: 30 },
  costTiers: [{ minOiUsd: 100e6, bps: 3 }, { minOiUsd: 10e6, bps: 5 }, { minOiUsd: 2e6, bps: 8 }, { minOiUsd: 500e3, bps: 15 }, { minOiUsd: 100e3, bps: 25 }, { minOiUsd: 0, bps: 40 }],
  maxSlipAtr: 0.5, approvals: { hire: true, realMoney: true },
  recruitNames: ["Atlas", "Bruno", "Cleo", "Dante", "Echo", "Freya", "Gus", "Hana", "Iris", "Juno", "Kai", "Luna", "Milo", "Nina", "Otto", "Pia", "Quinn", "Rosa", "Sol", "Tara", "Uma", "Vito", "Wren", "Yara", "Zeno"],
  bots: [
  { id: "stocks-bull", name: "Nico", view: "market", side: "both", motto: "Free to buy or sell short, on stocks, gold and every other Lighter market that is not crypto.", allLighter: true },
  { id: "stocks-bear", name: "Lucas", view: "market", side: "short", motto: "Sells weakness in stocks, gold and every other Lighter market that is not crypto.", allLighter: true },
  { id: "crypto-bull", name: "Catalina", view: "crypto", side: "both", motto: "Free to buy or sell short, on any crypto Lighter trades.", lighterCrypto: true },
  { id: "crypto-bear", name: "Valeria", view: "crypto", side: "short", motto: "Sells weakness in crypto." },
] };

/** Hard ceiling on the paper bot's leverage (exposure / account value). Not configurable. */
export const LEVERAGE_CEILING = 3;

export function readJson<T>(path: string, fallback: T): T {
  try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return fallback; }
}
/** Atomic write: a crash mid-write never leaves a half-written file. */
export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(value, null, 1));
  renameSync(tmp, path);
}
export function settings(): Settings {
  const s = readJson<Settings | null>(join(ROOT, "config", "settings.json"), null);
  if (!s) throw new Error("config/settings.json is missing or not valid JSON");
  // Owner's rule: total exposure must always stay under 3 times the account. The code refuses any setting at or above it.
  if (!(s.bot.maxLeverage > 0 && s.bot.maxLeverage < LEVERAGE_CEILING)) throw new Error(`config/settings.json: bot.maxLeverage must be above 0 and below ${LEVERAGE_CEILING}`);
  s.exits = s.exits ?? DEFAULT_EXITS;
  const e = s.exits; const fsum = e.fractions.reduce((a, b) => a + b, 0);
  if (!(e.mode === "single" || (e.mode === "ladder" && e.tpR.length && e.tpR.length === e.fractions.length && e.tpR.every((r, i) => r > 0 && (i === 0 || r > e.tpR[i - 1])) && e.fractions.every(f => f > 0) && fsum <= 1 + 1e-9)))
    throw new Error("config/settings.json: exits needs mode \"single\", or mode \"ladder\" with rising tpR values and one fraction per take-profit adding up to at most 1");
  if (e.slR?.length && !(e.mode === "ladder" && e.slR.length === (e.slFractions ?? []).length && e.slR.every((r, i) => r > 0 && r < 1 && (i === 0 || r > e.slR![i - 1])) && e.slFractions!.every(f => f > 0) && e.slFractions!.reduce((a, b) => a + b, 0) < 1))
    throw new Error("config/settings.json: exits.slR needs rising values between 0 and 1 (parts of the risk), one slFractions value each, adding up to less than 1");
  s.lighter = { accountIndex: null, budgetUsd: 500, live: false, prices24h: true, minOpenInterestUsd: 25000, ...(s.lighter ?? {}) };
  // Real orders are not built yet. Turning this on must fail loudly rather than look like it works.
  if (s.lighter.live) throw new Error("config/settings.json: lighter.live is true, but sending real orders to Lighter is not built yet. Set it to false.");
  s.selection = { maxStrategies: 4, testShare: 0.3, refreshDays: 7, ...(s.selection ?? {}) };
  if (!(s.selection.maxStrategies >= 1 && s.selection.maxStrategies <= 14)) throw new Error("config/settings.json: selection.maxStrategies must be between 1 and 14");
  // The GitHub run (TD_ENGINE=1) is the copy that trades, whatever the PC's settings.remote says.
  if (process.env.TD_ENGINE === "1") s.remote = null;
  if (s.remote && !(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s.remote.repo ?? "") && /^[A-Za-z0-9_./-]+$/.test(s.remote.branch ?? ""))) throw new Error("config/settings.json: remote needs repo \"owner/name\" and branch (for example \"bot-data\"), or null");
  s.competition = { ...DEFAULT_COMPETITION, ...(s.competition ?? {}) };
  const c = s.competition;
  if (!(c.startGrant >= 50)) throw new Error("config/settings.json: competition.startGrant must be at least 50");
  if (!(c.graceDays >= 0 && c.maxStrikes >= 1 && c.bankUsd >= c.startGrant * c.bots.length)) throw new Error("config/settings.json: competition needs graceDays >= 0, maxStrikes >= 1 and bankUsd of at least one grant per bot");
  if (!(c.tiers.length === 3 && c.tiers.every((t, i) => t > 0 && (i === 0 || t > c.tiers[i - 1])))) throw new Error("config/settings.json: competition.tiers needs three rising numbers (Pro, Master, Experienced trader)");
  if (!(Array.isArray(c.scalpTimeframes) && c.scalpTimeframes.every(t => t === "1m" || t === "5m"))) throw new Error("config/settings.json: competition.scalpTimeframes may hold \"1m\" and \"5m\" only");
  if (!(c.minTradesPerWeek >= 0 && c.fundingPeriodHours >= 1 && c.monthlyPrize >= 0 && c.hungryExtraCharts >= 0 && c.hungryExtraCharts <= 10)) throw new Error("config/settings.json: competition needs minTradesPerWeek >= 0, fundingPeriodHours >= 1, monthlyPrize >= 0, hungryExtraCharts 0-10");
  if (!(c.maxCharts >= 1 && c.maxCharts <= 30) || !c.recruitNames.length) throw new Error("config/settings.json: competition.maxCharts must be 1-30 and recruitNames not empty");
  c.desk = { ...DEFAULT_COMPETITION.desk, ...(c.desk ?? {}) }; c.approvals = { ...DEFAULT_COMPETITION.approvals, ...(c.approvals ?? {}) };
  const k = c.desk; if (!(k.dailyLossPct > 0 && k.dailyLossPct <= 20 && k.drawdownPct > 0 && k.drawdownPct <= 50 && k.recoverPct >= 0 && k.recoverPct < k.drawdownPct && k.maxCorrelation > 0 && k.maxCorrelation <= 1 && k.corrDays >= 3))
    throw new Error("config/settings.json: competition.desk needs dailyLossPct 0-20, drawdownPct 0-50, recoverPct below drawdownPct, maxCorrelation 0-1, corrDays at least 3");
  if (!(Array.isArray(c.costTiers) && c.costTiers.length && c.costTiers.every((t, i) => t.minOiUsd >= 0 && t.bps >= 0 && t.bps <= 200 && (i === 0 || t.minOiUsd < c.costTiers[i - 1].minOiUsd)) && c.costTiers.at(-1)!.minOiUsd === 0))
    throw new Error("config/settings.json: competition.costTiers needs falling minOiUsd values ending at 0, bps 0-200 each");
  if (!(c.maxSlipAtr >= 0 && c.maxSlipAtr <= 10)) throw new Error("config/settings.json: competition.maxSlipAtr must be 0-10 (0 = off)");
  if (!(c.riskPctPerTrade > 0 && c.riskPctPerTrade <= 5)) throw new Error("config/settings.json: competition.riskPctPerTrade must be above 0 and at most 5");
  if (!c.bots.every(b => /^[a-z0-9-]+$/.test(b.id) && (b.view === "market" || b.view === "crypto") && (b.side === "long" || b.side === "short" || b.side === "both")) || new Set(c.bots.map(b => b.id)).size !== c.bots.length)
    throw new Error("config/settings.json: competition.bots need unique ids (a-z, 0-9, -), view \"market\" or \"crypto\", side \"long\", \"short\" or \"both\"");
  return s;
}
export function universe(): Sym[] {
  const u = readJson<Sym[] | null>(join(ROOT, "config", "universe.json"), null);
  if (!u || !Array.isArray(u)) throw new Error("config/universe.json is missing or not valid JSON");
  return u;
}
export const exists = existsSync;
/** Crypto tickers on Lighter that a bot with lighterCrypto may trade (only while liquid there). The owner may edit the list. */
/** Non-crypto tickers on Lighter (stocks, ETFs, indices, commodities, currencies, bonds, pre-IPO) that a bot with allLighter may trade. */
export function lighterOtherList(): string[] { return readJson<string[]>(join(ROOT, "config", "lighter-other.json"), []).filter(x => typeof x === "string").map(x => x.toUpperCase()); }
export function lighterCryptoList(): string[] { return readJson<string[]>(join(ROOT, "config", "lighter-crypto.json"), []).filter(x => typeof x === "string").map(x => x.toUpperCase()); }
