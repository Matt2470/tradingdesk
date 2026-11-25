// The desk guard (owner, 2026-11-25, from the optimisation proposal): the four competition bots seen as one desk.
//   Daily loss limit: when the desk falls dailyLossPct in one Madrid day, every bot closes its positions and opens nothing
//   until the next Madrid day.
//   Drawdown rule: when the desk is drawdownPct under its best, every bot risks half as much per trade until the desk is
//   back within recoverPct of its best.
//   Correlation cap: a bot may not open a trade in the same direction as another bot's open position on the same market,
//   or on a market whose hourly returns move with it (correlation above maxCorrelation).
// The desk index starts at 100 and moves each check by the average change of the bots' performance indexes (money moves
// by the accountant left out, like the bots' own index). A recruit joins the average from its first check, so a firing
// never makes the desk jump. Checked once per refresh (every 15 minutes), before the bots trade.
import { madridDay } from "./accountant";

export interface DeskState {
  index: number; high: number; day: string; dayStart: number;
  /** Each bot's index at the last check, keyed "seat#recruit". */ prev: Record<string, number>;
  /** Madrid day the daily loss limit stopped the desk (no trading until the next day). */ stoppedDay?: string | null;
  /** Risk per trade halved (desk too far under its best). */ halved?: boolean;
  /** Desk index at the end of each Madrid day. */ daily: Record<string, number>;
  log: { d: string; msg: string }[];
}
export interface DeskRules { dailyLossPct: number; drawdownPct: number; recoverPct: number }
export const newDesk = (): DeskState => ({ index: 100, high: 100, day: "", dayStart: 100, prev: {}, stoppedDay: null, halved: false, daily: {}, log: [] });

/** One check of the desk. `bots` are the working bots with their performance index; `at` is "YYYY-MM-DDTHH:MM" (UTC). */
export function deskCheck(k: DeskState, bots: { who: string; index: number }[], at: string, r: DeskRules): { stop: boolean; halve: boolean; dayPct: number; fromHighPct: number } {
  const note = (msg: string) => { k.log.push({ d: at, msg }); if (k.log.length > 200) k.log.shift(); };
  const moves = bots.filter(b => k.prev[b.who] > 0 && b.index > 0).map(b => b.index / k.prev[b.who] - 1);
  if (moves.length) k.index *= 1 + moves.reduce((t, x) => t + x, 0) / moves.length;
  k.prev = Object.fromEntries(bots.filter(b => b.index > 0).map(b => [b.who, b.index]));
  const day = madridDay(at);
  if (k.day !== day) {
    if (k.stoppedDay && k.stoppedDay !== day) note("New day: the daily loss limit is lifted and the bots may trade again.");
    k.day = day; k.dayStart = k.index; if (k.stoppedDay !== day) k.stoppedDay = null;
  }
  k.high = Math.max(k.high, k.index); k.daily[day] = +k.index.toFixed(4);
  const keep = Object.keys(k.daily).sort().slice(-120); k.daily = Object.fromEntries(keep.map(d => [d, k.daily[d]]));
  const dayPct = (k.index / k.dayStart - 1) * 100; const fromHighPct = (k.index / k.high - 1) * 100;
  if (!k.stoppedDay && dayPct <= -r.dailyLossPct) { k.stoppedDay = day; note(`Daily loss limit: the desk is ${dayPct.toFixed(2)}% down today (limit ${r.dailyLossPct}%). Every position closed; no new trades until tomorrow.`); }
  if (!k.halved && fromHighPct <= -r.drawdownPct) { k.halved = true; note(`Drawdown rule: the desk is ${(-fromHighPct).toFixed(2)}% under its best. Risk per trade is halved until it is back within ${r.recoverPct}% of it.`); }
  else if (k.halved && fromHighPct >= -r.recoverPct) { k.halved = false; note(`Drawdown rule lifted: the desk is back within ${r.recoverPct}% of its best. Full risk per trade again.`); }
  return { stop: k.stoppedDay === day, halve: !!k.halved, dayPct: +dayPct.toFixed(3), fromHighPct: +fromHighPct.toFixed(3) };
}

/** Correlation of hourly log returns of two close series keyed by bar time; null when they share fewer than `minBars` bars. */
export function correlation(a: Map<string, number>, b: Map<string, number>, minBars = 100): number | null {
  const keys = [...a.keys()].filter(d => b.has(d)).sort(); const x: number[] = [], y: number[] = [];
  for (let i = 1; i < keys.length; i++) {
    const a0 = a.get(keys[i - 1])!, a1 = a.get(keys[i])!, b0 = b.get(keys[i - 1])!, b1 = b.get(keys[i])!;
    if (a0 > 0 && a1 > 0 && b0 > 0 && b1 > 0) { x.push(Math.log(a1 / a0)); y.push(Math.log(b1 / b0)); }
  }
  if (x.length < minBars) return null;
  const mx = x.reduce((t, v) => t + v, 0) / x.length, my = y.reduce((t, v) => t + v, 0) / y.length;
  let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

/** Why a bot may not open `side` on `sym` because of the other bots' open positions (null = it may). */
export function correlationBlock(sym: string, side: "long" | "short", others: { name: string; sym: string; side: "long" | "short" }[], corr: (a: string, b: string) => number | null, max: number): string | null {
  for (const o of others) {
    if (o.side !== side) continue;
    if (o.sym === sym) return `${o.name} already holds ${sym} ${side === "short" ? "short" : "long"}`;
    const c = corr(sym, o.sym); if (c != null && c > max) return `${o.name} is already ${side === "short" ? "short" : "long"} ${o.sym}, which moves with ${sym} (correlation ${c.toFixed(2)})`;
  }
  return null;
}

/** Spread and slippage per side (bps) for a market with this open interest on Lighter; null when Lighter has no number for it. */
export function tierBps(oiUsd: number | null | undefined, tiers: { minOiUsd: number; bps: number }[]): number | null {
  if (oiUsd == null || !Number.isFinite(oiUsd)) return null;
  return (tiers.find(t => oiUsd >= t.minOiUsd) ?? tiers.at(-1))?.bps ?? null;
}
