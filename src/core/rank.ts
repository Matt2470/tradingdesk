// Evaluate every strategy on one symbol and timeframe, pick the best one that passes the gate, and rank today's setups.
import { STRATEGIES, buildCtx, I, type Bar } from "./strategies";
import { runBacktest, judge, type Metrics, type Verdict, type EndState } from "./backtest";
import { classify, type Regime } from "./regime";
import { robustness, type Robust } from "./robust";
import type { Settings, Sym } from "../config";
import { DEFAULT_EXITS, type ExitPlan } from "./exits";
import { barStartMs, type Timeframe } from "../data/prices";

export interface StratEval { id: string; name: string; family: string; side: "long" | "short"; metrics: Metrics; verdict: Verdict; end: EndState; score: number; /** Stress tests, only computed for strategies that pass the gate. */ robust?: Robust }
export type Action = "enter" | "hold" | "exit" | "wait" | "no-strategy" | "no-data";
export interface SymbolEval {
  /** "SYMBOL@tf", the key the bots use. */ key: string; tf: Timeframe;
  symbol: string; group: string; class: string; traded: boolean; lastDate: string | null; lastClose: number | null; livePrice: number | null; dayChangePct: number | null;
  regime: Regime | null; evals: StratEval[]; best: string | null; side: "long" | "short" | null; allowed: string[]; action: Action; why: string;
  plan: { stop: number; riskPct: number; target?: number | null; /** All take-profit prices (ladder exits). */ tps?: number[]; /** Stop prices: SL1, SL2, then the full stop. */ sls?: number[]; since?: string | null; /** Fraction of the position still open. */ left?: number } | null; score: number; bars: number;
}
const down = (v: number[], k = 240) => { if (v.length <= k) return v.map(x => +x.toFixed(4)); const out: number[] = []; for (let j = 0; j < k; j++) out.push(+v[Math.round((j * (v.length - 1)) / (k - 1))].toFixed(4)); return out; };

export interface EvalOpts { costBps?: number; barsPerYear?: number; tf?: Timeframe; /** The bot's short list (src/core/select.ts). When given, only these strategies can make a signal. */ shortlist?: string[] }
/** Take-profit prices for a trade entered at `ref` with stop `stop` (ladder exits), else the strategy's single target. */
export function takeProfits(plan: ExitPlan, dir: number, ref: number, stop: number, targetR?: number): number[] {
  const r = Math.abs(ref - stop);
  return plan.mode === "ladder" ? plan.tpR.map(k => ref + dir * k * r) : targetR ? [ref + dir * targetR * r] : [];
}
/** Bars per year measured from the bars themselves, so CAGR is right on any timeframe and any trading calendar. */
export function barsPerYear(bars: Bar[], fallback: number): number { if (bars.length < 50) return fallback; const yrs = (barStartMs(bars[bars.length - 1].d) - barStartMs(bars[0].d)) / (365.25 * 864e5); return yrs > 0.05 ? bars.length / yrs : fallback; }
export function evalSymbol(sym: Sym, complete: Bar[], livePrice: number | null, st: Settings, o: EvalOpts = {}): { summary: SymbolEval; curves: Record<string, { dates: string[]; equity: number[]; buyHold: number[] }> } {
  const tf = o.tf ?? "1d"; const bpy = o.barsPerYear ?? barsPerYear(complete, sym.class === "crypto" ? 365 : 252);
  const base: SymbolEval = { key: `${sym.symbol}@${tf}`, tf, symbol: sym.symbol, group: sym.group, class: sym.class, traded: sym.traded, lastDate: complete.at(-1)?.d ?? null, lastClose: complete.at(-1)?.c ?? null, livePrice, dayChangePct: null, regime: null, evals: [], best: null, side: null, allowed: [], action: "no-data", why: "No price history yet.", plan: null, score: 0, bars: complete.length };
  const curves: Record<string, { dates: string[]; equity: number[]; buyHold: number[] }> = {};
  if (complete.length < 260) { if (complete.length) base.why = `Only ${complete.length} bars of history on ${tf}; at least 260 are needed to test anything.`; return { summary: base, curves }; }
  const n = complete.length; base.dayChangePct = (complete[n - 1].c / complete[n - 2].c - 1) * 100;
  base.regime = classify(complete);
  for (const s of STRATEGIES) {
    const bt = { costBps: o.costBps ?? st.costBps[sym.class], maxLosingBars: st.backtest.maxLosingBars, barsPerYear: bpy, exits: st.exits ?? DEFAULT_EXITS };
    const r = runBacktest(complete, s, bt); const verdict = judge(r.metrics, st.backtest);
    const score = verdict.passes ? Math.min(r.metrics.profitFactor, 4) * Math.log10(r.metrics.trades + 1) : 0;
    base.evals.push({ id: s.id, name: s.name, family: s.family, side: s.side, metrics: r.metrics, verdict, end: r.end, score, ...(verdict.passes ? { robust: robustness(complete, s.id, r.trades.map(t => t.retPct), bt) } : {}) });
    curves[s.id] = { dates: down(r.dates.map((_, k) => k)).map(k => r.dates[Math.round(k)]), equity: down(r.equity), buyHold: down(r.buyHold) };
  }
  const short = o.shortlist ? new Set(o.shortlist) : null;
  const passing = base.evals.filter(e => e.verdict.passes && (!short || short.has(e.id))).sort((a, b) => b.score - a.score);
  if (!passing.length) {
    base.action = "no-strategy";
    base.why = short && !short.size ? "No strategy made money in the recent data it had not seen, so the bot's short list is empty and it trades nothing." : short && base.evals.some(e => e.verdict.passes) ? `Some rules worked on ${tf}, but none from the bot's short list, so the bot leaves it alone.` : `No strategy has a good record on ${tf}, so there is nothing to trade here.`;
    return { summary: base, curves };
  }
  // At most one strategy per direction on each symbol and timeframe: the best passing long and the best passing short
  // (from the short lists, when given). The bullish bots take the long one, the bearish bots the short one.
  base.allowed = (["long", "short"] as const).map(sd => passing.find(e => e.side === sd)?.id).filter((x): x is string => !!x);
  // On screen: a strategy with a live signal or trade wins; otherwise the one that fits the current behaviour.
  const want = base.regime?.trend === "downtrend" ? "short" : "long";
  const fit = passing.find(e => e.side === want && e.family === base.regime?.suits) ?? passing.find(e => e.side === want) ?? passing[0];
  const live = passing.filter(e => base.allowed.includes(e.id));
  const e = live.find(q => q.end.pendingEntry) ?? live.find(q => q.end.pendingExit) ?? live.find(q => q.end.inPosition) ?? fit;
  base.best = e.id; base.side = e.side; base.score = e.score;
  const x = buildCtx(complete); const a = I.atr(x, 14)[n - 1]; const strat = STRATEGIES.find(s => s.id === e.id)!; const dir = e.side === "short" ? -1 : 1; const c = complete[n - 1].c;
  if (e.end.pendingEntry) {
    const stop = e.end.pendingStop ?? c - dir * strat.stopAtr * a;
    base.action = "enter"; const ex = st.exits ?? DEFAULT_EXITS; const tps = takeProfits(ex, dir, c, stop, strat.targetR); const sls = [...(ex.mode === "ladder" ? ex.slR ?? [] : []).map(k => c - dir * k * Math.abs(c - stop)), stop]; base.plan = { stop, riskPct: Math.abs(c - stop) / c * 100, target: tps[0] ?? null, tps, sls }; base.why = `"${e.name}" gave a ${dir > 0 ? "buy" : "sell-short"} signal at the last close.`;
  }
  else if (e.end.pendingExit) { base.action = "exit"; base.why = `"${e.name}" says to close the ${e.side} trade at the next open.`; }
  else if (e.end.inPosition) { base.action = "hold"; base.plan = { stop: e.end.stop!, riskPct: Math.max(0, dir * (c - e.end.stop!) / c * 100), target: e.end.target ?? null, since: e.end.entryDate ?? null, left: e.end.left ?? 1 }; base.why = `"${e.name}" has been ${e.side} since ${e.end.entryDate} (${e.end.openRetPct!.toFixed(1)}%).`; }
  else { base.action = "wait"; base.why = `"${e.name}" is the strategy that has worked here. No signal now.`; }
  return { summary: base, curves };
}

const order: Record<Action, number> = { enter: 0, exit: 1, hold: 2, wait: 3, "no-strategy": 4, "no-data": 5 };
export const rankToday = <T extends { action: Action; score: number; symbol: string }>(rows: T[]) => [...rows].sort((a, b) => order[a.action] - order[b.action] || b.score - a.score || a.symbol.localeCompare(b.symbol));

/** What the screens need from one evaluation, without the full test results (those live in their own file per symbol and timeframe). */
export function slim(r: SymbolEval) {
  const { evals, regime, ...rest } = r; const b = evals.find(e => e.id === r.best);
  const rr = b && b.metrics.avgLossPct < 0 && b.metrics.avgWinPct > 0 ? b.metrics.avgWinPct / -b.metrics.avgLossPct : null;
  return { ...rest, regime: regime ? { trend: regime.trend, character: regime.character, atrPct: regime.atrPct, note: regime.note } : null, passing: evals.filter(e => e.verdict.passes).length, bestName: b?.name ?? null,
    record: b ? { trades: b.metrics.trades, winRate: b.metrics.winRate, profitFactor: b.metrics.profitFactor, rr, evidence: b.verdict.evidence, passes: b.verdict.passes, fragile: b.robust?.fragile ?? null, luckLossPct: b.robust?.luck.lossPct ?? null, settingsOk: b.robust ? [b.robust.settings.profitable, b.robust.settings.tested] : null } : null };
}
export type SlimRow = ReturnType<typeof slim>;

export interface StrategyAggregate { id: string; name: string; family: string; plain: string; indicators: string[]; symbolsTested: number; symbolsPassing: number; totalTrades: number; medianProfitFactor: number; medianWinRate: number; medianReturnPct: number; medianBuyHoldPct: number; medianMaxDrawdownPct: number; bothHalvesPositive: number }
const median = (v: number[]) => { if (!v.length) return 0; const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export function aggregate(rows: SymbolEval[]): StrategyAggregate[] {
  return STRATEGIES.map(s => {
    const ev = rows.flatMap(r => r.evals.filter(e => e.id === s.id)); const m = ev.map(e => e.metrics);
    return { id: s.id, name: s.name, family: s.family, plain: s.plain, indicators: s.indicators, symbolsTested: ev.length, symbolsPassing: ev.filter(e => e.verdict.passes).length, totalTrades: m.reduce((p, q) => p + q.trades, 0),
      medianProfitFactor: median(m.map(q => q.profitFactor)), medianWinRate: median(m.map(q => q.winRate)), medianReturnPct: median(m.map(q => q.totalReturnPct)), medianBuyHoldPct: median(m.map(q => q.buyHoldReturnPct)), medianMaxDrawdownPct: median(m.map(q => q.maxDrawdownPct)),
      bothHalvesPositive: m.filter(q => q.firstHalfReturnPct > 0 && q.secondHalfReturnPct > 0).length };
  });
}
