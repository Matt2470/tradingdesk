// Two stress tests shown next to every strategy that passes the gate. They inform; they do not decide.
//  - Luck test: redraw the strategy's own trades at random 1,000 times and see how often the total is a loss.
//  - Settings test: move each setting 25% down and up and see whether the result survives.
import { variants, type Bar } from "./strategies";
import { runBacktest, type BtOpts } from "./backtest";

/** Small deterministic random generator, so the same trades always give the same answer. */
export function rng(seed: number) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export interface Luck { runs: number; lossPct: number; p5ReturnPct: number; medianReturnPct: number }
/** Bootstrap: each run draws as many trades as the strategy made, with repeats allowed, and compounds them. */
export function luckTest(tradeReturnsPct: number[], runs = 1000, seed = 20261115): Luck {
  const n = tradeReturnsPct.length; if (!n) return { runs: 0, lossPct: 0, p5ReturnPct: 0, medianReturnPct: 0 };
  const r = rng(seed); const totals: number[] = [];
  for (let k = 0; k < runs; k++) { let eq = 1; for (let j = 0; j < n; j++) eq *= 1 + tradeReturnsPct[Math.floor(r() * n)] / 100; totals.push((eq - 1) * 100); }
  totals.sort((a, b) => a - b);
  return { runs, lossPct: (totals.filter(t => t < 0).length / runs) * 100, p5ReturnPct: totals[Math.floor(runs * 0.05)], medianReturnPct: totals[Math.floor(runs / 2)] };
}

export interface Sensitivity { tested: number; profitable: number; worstReturnPct: number; worst: string }
export function sensitivity(bars: Bar[], id: string, opt: BtOpts): Sensitivity {
  let profitable = 0, worstReturnPct = Infinity, worst = ""; const vs = variants(id);
  for (const v of vs) { const ret = runBacktest(bars, v.strategy, opt).metrics.totalReturnPct; if (ret > 0) profitable++; if (ret < worstReturnPct) { worstReturnPct = ret; worst = v.label; } }
  return { tested: vs.length, profitable, worstReturnPct: vs.length ? worstReturnPct : 0, worst };
}

export interface Robust { luck: Luck; settings: Sensitivity; fragile: boolean; why: string[] }
export function robustness(bars: Bar[], id: string, tradeReturnsPct: number[], opt: BtOpts): Robust {
  const luck = luckTest(tradeReturnsPct), settings = sensitivity(bars, id, opt); const why: string[] = [];
  if (luck.lossPct > 20) why.push(`lost money in ${luck.lossPct.toFixed(0)}% of the random redraws`);
  if (settings.tested && settings.profitable < settings.tested * 0.75) why.push(`only ${settings.profitable} of ${settings.tested} setting changes still made money`);
  return { luck, settings, fragile: why.length > 0, why };
}
