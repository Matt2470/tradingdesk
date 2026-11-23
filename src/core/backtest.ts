// Single-symbol backtester. Each strategy is long-only or short-only (strategy.side).
// Invariants (tests/backtest.test.ts enforces them):
//  1. No lookahead: a decision at the close of bar i is filled at the open of bar i+1.
//  2. Costs are always charged, on entry and on exit.
//  3. Stops fill at the stop price, or at the open if the bar gaps through it (never at a better price).
import { buildCtx, I, type Bar, type Strategy } from "./strategies";
import { openLegs, onBar, onClose, nextTarget, type ExitPlan, type Legs } from "./exits";

export interface Trade { entryDate: string; exitDate: string; entry: number; exit: number; retPct: number; bars: number; side: "long" | "short"; reason: "rule" | "stop" | "target" | "time-stop" | "weekend" | "tp1" | "tp2" | "tp3" | "sl1" | "sl2" | "sl3" | "trail"; /** Take-profits that filled before the last part closed (ladder exits). */ partials?: number }
export interface Metrics {
  trades: number; winRate: number; avgWinPct: number; avgLossPct: number; profitFactor: number; expectancyPct: number;
  totalReturnPct: number; cagrPct: number; maxDrawdownPct: number; exposurePct: number;
  buyHoldReturnPct: number; buyHoldMaxDrawdownPct: number;
  firstHalfReturnPct: number; secondHalfReturnPct: number;
  years: number;
}
export interface EndState { inPosition: boolean; pendingEntry: boolean; pendingExit: boolean; pendingStop?: number; target?: number | null; entryDate?: string; entry?: number; stop?: number; barsHeld?: number; openRetPct?: number; /** Fraction of the position still open (ladder exits). */ left?: number }
export interface BacktestResult { trades: Trade[]; equity: number[]; buyHold: number[]; dates: string[]; metrics: Metrics; end: EndState; firstIndex: number }
export interface BtOpts { costBps: number; maxLosingBars: number; /** 252 for daily stocks, 365 for daily crypto, 8760 for hourly crypto. */ barsPerYear?: number; /** How positions are closed; default "single" (one stop, the strategy's own target). */ exits?: ExitPlan;
  /** One flag per bar: true while trading is paused (the competition's weekend). A position open when a pause starts closes at that bar's open; nothing opens during it. */
  paused?: boolean[] }

export function maxDrawdownPct(eq: number[]): number {
  let peak = -Infinity, dd = 0;
  for (const e of eq) { if (e > peak) peak = e; const d = e / peak - 1; if (d < dd) dd = d; }
  return dd * 100;
}

export function runBacktest(bars: Bar[], s: Strategy, opt: BtOpts): BacktestResult {
  const x = buildCtx(bars); const n = x.n; const cost = opt.costBps / 1e4; const a = I.atr(x, 14);
  const plan: ExitPlan = opt.exits ?? { mode: "single", tpR: [], fractions: [], trailAtr: 0 };
  const start = Math.min(Math.max(s.warmup, 15), n);
  const trades: Trade[] = []; const equity: number[] = []; const buyHold: number[] = []; const dates: string[] = [];
  let realized = 1; let pendingEntry = false; let pendingExit: Trade["reason"] | null = null; let inBars = 0;
  // banked: return already locked in by partial closes, as a fraction of the starting size. pxSum: frac-weighted exit prices.
  let pos: { i: number; px: number; legs: Legs; held: number; eq0: number; banked: number; pxSum: number; partials: number } | null = null; let pendingStop = NaN;
  const dir = s.side === "short" ? -1 : 1;
  // A long buys at price*(1+cost) and sells at price*(1-cost); a short does the reverse.
  const sell = (i: number, rawPx: number, frac: number, reason: Trade["reason"]) => {
    const p = pos!; const px = rawPx * (1 - dir * cost);
    p.banked += frac * dir * (px / p.px - 1); p.pxSum += frac * px;
    if (p.legs.left > 1e-9) { p.partials++; return; }
    realized = p.eq0 * (1 + p.banked);
    trades.push({ entryDate: x.d[p.i], exitDate: x.d[i], entry: p.px, exit: p.pxSum, retPct: p.banked * 100, bars: p.held, reason, side: s.side, ...(p.partials ? { partials: p.partials } : {}) });
    pos = null;
  };
  const closeAll = (i: number, rawPx: number, reason: Trade["reason"]) => { const f = pos!.legs.left; pos!.legs.left = 0; sell(i, rawPx, f, reason); };
  for (let i = start; i < n; i++) {
    const halt = !!opt.paused?.[i];
    if (halt) { if (pos) closeAll(i, x.o[i], "weekend"); pendingEntry = false; pendingExit = null; }
    if (pendingExit && pos) { closeAll(i, x.o[i], pendingExit); }
    pendingExit = null;
    if (pendingEntry && !pos) {
      const stop = isNaN(pendingStop) ? x.o[i] - dir * s.stopAtr * a[i - 1] : pendingStop; const risk = dir * (x.o[i] - stop);
      // If the open is already beyond the stop there is no trade to take.
      if (risk > 0) pos = { i, px: x.o[i] * (1 + dir * cost), legs: openLegs(plan, dir as 1 | -1, x.o[i], stop, s.targetR), held: 0, eq0: realized, banked: 0, pxSum: 0, partials: 0 };
    }
    pendingEntry = false;
    if (pos) {
      inBars++;
      for (const f of onBar(pos.legs, plan, x.o[i], x.h[i], x.l[i])) { sell(i, f.px, f.frac, f.reason); if (!pos) break; }
      if (pos) {
        pos.held++; onClose(pos.legs, plan, x.c[i], a[i]);
        if (s.exit(x, i, pos.held)) pendingExit = "rule";
        else if (opt.maxLosingBars > 0 && pos.held >= opt.maxLosingBars && pos.legs.hits === 0 && dir * (x.c[i] - pos.px) < 0) pendingExit = "time-stop";
      }
    } else if (!halt && s.entry(x, i)) { pendingEntry = true; pendingStop = s.stopPrice ? s.stopPrice(x, i) : NaN; }
    const p = pos as typeof pos;
    equity.push(p ? Math.max(p.eq0 * (1 + p.banked + p.legs.left * dir * (x.c[i] / p.px - 1)), 1e-9) : realized);
    buyHold.push(x.c[i] / x.c[start]);
    dates.push(x.d[i]);
  }
  const wins = trades.filter(t => t.retPct > 0), losses = trades.filter(t => t.retPct <= 0);
  const sum = (v: number[]) => v.reduce((p, q) => p + q, 0);
  const gw = sum(wins.map(t => t.retPct)), gl = -sum(losses.map(t => t.retPct));
  const m = equity.length; const years = m / (opt.barsPerYear ?? 252); const last = m ? equity[m - 1] : 1; const mid = Math.floor(m / 2);
  const metrics: Metrics = {
    trades: trades.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    avgWinPct: wins.length ? gw / wins.length : 0,
    avgLossPct: losses.length ? -gl / losses.length : 0,
    profitFactor: gl === 0 ? (gw > 0 ? 99 : 0) : gw / gl,
    expectancyPct: trades.length ? (gw - gl) / trades.length : 0,
    totalReturnPct: (last - 1) * 100,
    cagrPct: years > 0.2 ? (Math.pow(Math.max(last, 1e-9), 1 / years) - 1) * 100 : 0,
    maxDrawdownPct: maxDrawdownPct(equity),
    exposurePct: m ? (inBars / m) * 100 : 0,
    buyHoldReturnPct: m ? (buyHold[m - 1] - 1) * 100 : 0,
    buyHoldMaxDrawdownPct: maxDrawdownPct(buyHold),
    firstHalfReturnPct: m > 1 ? (equity[mid] - 1) * 100 : 0,
    secondHalfReturnPct: m > 1 ? (last / equity[mid] - 1) * 100 : 0,
    years,
  };
  const end: EndState = { inPosition: !!pos, pendingEntry, pendingExit: !!pendingExit }; if (pendingEntry && !isNaN(pendingStop)) end.pendingStop = pendingStop;
  if (pos) { const p = pos as unknown as { i: number; px: number; legs: Legs; held: number; banked: number }; Object.assign(end, { entryDate: x.d[p.i], entry: p.px, stop: p.legs.stop, target: nextTarget(p.legs, plan), barsHeld: p.held, openRetPct: (p.banked + p.legs.left * dir * (x.c[n - 1] / p.px - 1)) * 100, left: p.legs.left }); }
  return { trades, equity, buyHold, dates, metrics, end, firstIndex: start };
}

export type Evidence = "solid" | "thin" | "insufficient";
export interface Verdict { passes: boolean; evidence: Evidence; reasons: string[] }
/** The quality gate. A strategy is only offered for trading on a symbol if it passes. */
export function judge(m: Metrics, gate: { minTrades: number; minProfitFactor: number }): Verdict {
  const reasons: string[] = [];
  if (m.trades < gate.minTrades) reasons.push(`only ${m.trades} trades (needs ${gate.minTrades})`);
  if (m.profitFactor < gate.minProfitFactor) reasons.push(`profit factor ${m.profitFactor.toFixed(2)} (needs ${gate.minProfitFactor})`);
  if (m.firstHalfReturnPct <= 0) reasons.push("lost money in the first half of the history");
  if (m.secondHalfReturnPct <= 0) reasons.push("lost money in the second half of the history");
  const evidence: Evidence = m.trades >= 30 ? "solid" : m.trades >= gate.minTrades ? "thin" : "insufficient";
  return { passes: reasons.length === 0, evidence, reasons };
}
