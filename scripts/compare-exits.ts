// Research script: compares exit plans on the cached real prices. Prints a table; changes nothing.
// Usage: bun scripts/compare-exits.ts
import { settings, universe } from "../src/config";
import { loadCached } from "../src/data/prices";
import { STRATEGIES } from "../src/core/strategies";
import { runBacktest, judge } from "../src/core/backtest";
import { barsPerYear } from "../src/core/rank";
import type { ExitPlan } from "../src/core/exits";

const st = settings();
const plans: Record<string, ExitPlan> = {
  "single (today)": { mode: "single", tpR: [], fractions: [], trailAtr: 0 },
  "ladder 1/2/3R, trail 2 ATR": { mode: "ladder", tpR: [1, 2, 3], fractions: [1 / 3, 1 / 3, 1 / 3], trailAtr: 2 },
  "ladder 1/2/3R, trail 3 ATR": { mode: "ladder", tpR: [1, 2, 3], fractions: [1 / 3, 1 / 3, 1 / 3], trailAtr: 3 },
  "ladder 1/2/3R, no trail": { mode: "ladder", tpR: [1, 2, 3], fractions: [1 / 3, 1 / 3, 1 / 3], trailAtr: 0 },
  "ladder 1.5/3/5R, trail 3 ATR": { mode: "ladder", tpR: [1.5, 3, 5], fractions: [1 / 3, 1 / 3, 1 / 3], trailAtr: 3 },
};
const med = (v: number[]) => { if (!v.length) return NaN; const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const views = { market: (c: string) => c === "stock" || c === "metal", crypto: (c: string) => c === "crypto" } as const;
for (const [view, pick] of Object.entries(views)) {
  const res: Record<string, { pass: number; pf: number[]; ret: number[]; dd: number[]; wr: number[]; trades: number; expR: number[] }> = {};
  for (const name of Object.keys(plans)) res[name] = { pass: 0, pf: [], ret: [], dd: [], wr: [], trades: 0, expR: [] };
  for (const sym of universe().filter(s => pick(s.class))) for (const tf of st.timeframes) {
    const c = loadCached(sym.symbol, tf, sym.class); if (!c || c.bars.length < 260) continue;
    const bars = c.bars.slice(0, -1); const bpy = barsPerYear(bars, sym.class === "crypto" ? 365 : 252);
    const costBps = sym.class === "crypto" && tf !== "1d" ? st.intraday.costBps : st.costBps[sym.class];
    for (const s of STRATEGIES) for (const [name, plan] of Object.entries(plans)) {
      const r = runBacktest(bars, s, { costBps, maxLosingBars: st.backtest.maxLosingBars, barsPerYear: bpy, exits: plan });
      const m = r.metrics; const R = res[name]; R.trades += m.trades;
      if (judge(m, st.backtest).passes) R.pass++;
      if (m.trades >= 10) { R.pf.push(Math.min(m.profitFactor, 10)); R.ret.push(m.totalReturnPct); R.dd.push(m.maxDrawdownPct); R.wr.push(m.winRate); R.expR.push(m.expectancyPct); }
    }
  }
  console.log(`\n== ${view} ==`);
  console.log("plan".padEnd(30), "passing", "medPF", "medRet%", "medDD%", "medWin%", "medExp%/trade", "combos");
  for (const [name, R] of Object.entries(res)) console.log(name.padEnd(30), String(R.pass).padStart(7), med(R.pf).toFixed(2).padStart(5), med(R.ret).toFixed(1).padStart(7), med(R.dd).toFixed(1).padStart(6), med(R.wr).toFixed(1).padStart(7), med(R.expR).toFixed(3).padStart(13), R.pf.length);
}
