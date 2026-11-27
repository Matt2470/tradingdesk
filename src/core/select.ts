// The short list: the 3-4 strategies a bot is allowed to trade (the owner, 2026-11-20: "they don't need 20 strategies,
// with 3 or 4 is enough. Each one should have the best that works for them").
// Picking the best of 14 on the same history it is judged on flatters the winners, so the choice is made in two steps:
//  1. PICK on the older part of every history (the first 1 - testShare): a strategy scores by how many charts
//     (symbol + timeframe) it passes the quality gate on, then by its median profit factor there.
//  2. CONFIRM on the newer part it never saw: the trades it would have taken on the charts where it was picked must
//     still make money there (profit factor above 1, at least minTrades trades). Strategies that fail are dropped,
//     even if that leaves fewer than maxStrategies. An empty list is a valid answer: the bot then trades nothing.
// The bot then trades, on each chart, only the best strategy from this list that passes the gate on that chart's full history.
import { STRATEGIES, type Bar } from "./strategies";
import { runBacktest, judge, type BtOpts } from "./backtest";

export interface SelectMarket { key: string; bars: Bar[]; opt: BtOpts }
export interface Candidate {
  id: string; name: string; side: "long" | "short";
  /** Older part: charts where it passed, out of charts tested, and the median profit factor on those. */
  pickPass: number; pickTested: number; pickMedianPF: number;
  /** Newer part, on the charts where it passed before. */
  testTrades: number; testPF: number; testAvgPct: number;
  chosen: boolean; why: string;
  /** Chart by chart, where it passed in the older data: how it did in the newer data. */
  charts?: { key: string; testTrades: number; testPF: number; testAvgPct: number; /** Bars in the newer part (how often it traded there = testTrades / testBars). */ testBars?: number }[];
}
export interface Shortlist { pickedAt: string; testShare: number; maxStrategies: number; charts: number; chosen: string[]; candidates: Candidate[] }

const median = (v: number[]) => { if (!v.length) return 0; const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export function pickShortlist(markets: SelectMarket[], gate: { minTrades: number; minProfitFactor: number }, o: { testShare: number; maxStrategies: number; now?: number; /** Only strategies of this side (a bullish or bearish competition bot). */ side?: "long" | "short"; /** Only strategies this accepts (a guild trader's genes). */ only?: (id: string) => boolean }): Shortlist {
  const cands: Candidate[] = [];
  const usable = markets.filter(m => m.bars.length >= 400);
  for (const s of STRATEGIES.filter(x => (!o.side || x.side === o.side) && (!o.only || o.only(x.id)))) {
    const pf: number[] = []; let pass = 0; let gw = 0, gl = 0, tn = 0, tsum = 0; const per: NonNullable<Candidate["charts"]> = [];
    for (const m of usable) {
      const cut = Math.floor(m.bars.length * (1 - o.testShare)); const cutDate = m.bars[cut].d;
      const older = runBacktest(m.bars.slice(0, cut), s, m.opt);
      if (!judge(older.metrics, gate).passes) continue;
      pass++; pf.push(Math.min(older.metrics.profitFactor, 10));
      // Newer part: run on the whole history (so indicators are warmed up) and keep only trades that started after the cut.
      let cn = 0, cw = 0, cl = 0, cs = 0;
      for (const t of runBacktest(m.bars, s, m.opt).trades) if (t.entryDate >= cutDate) { tn++; tsum += t.retPct; cn++; cs += t.retPct; if (t.retPct > 0) { gw += t.retPct; cw += t.retPct; } else { gl -= t.retPct; cl -= t.retPct; } }
      per.push({ key: m.key, testTrades: cn, testPF: cl === 0 ? (cw > 0 ? 99 : 0) : cw / cl, testAvgPct: cn ? cs / cn : 0, testBars: m.bars.length - cut });
    }
    cands.push({ id: s.id, name: s.name, side: s.side, pickPass: pass, pickTested: usable.length, pickMedianPF: median(pf), testTrades: tn, testPF: gl === 0 ? (gw > 0 ? 99 : 0) : gw / gl, testAvgPct: tn ? tsum / tn : 0, chosen: false, why: "", charts: per });
  }
  cands.sort((a, b) => b.pickPass - a.pickPass || b.pickMedianPF - a.pickMedianPF);
  const chosen: string[] = [];
  for (const c of cands) {
    if (!c.pickPass) { c.why = "Did not pass the quality test on any chart in the older data."; continue; }
    if (c.testTrades < gate.minTrades) { c.why = `Only ${c.testTrades} trades in the newer data, too few to confirm.`; continue; }
    if (c.testPF <= 1) { c.why = `Lost money in the newer data it had not seen (profit factor ${c.testPF.toFixed(2)}).`; continue; }
    if (chosen.length >= o.maxStrategies) { c.why = `Confirmed, but ${o.maxStrategies} better ones were already chosen.`; continue; }
    c.chosen = true; chosen.push(c.id);
    c.why = `Passed on ${c.pickPass} of ${c.pickTested} charts in the older data and still made money in the newer data (profit factor ${c.testPF.toFixed(2)} over ${c.testTrades} trades).`;
  }
  return { pickedAt: new Date(o.now ?? Date.now()).toISOString(), testShare: o.testShare, maxStrategies: o.maxStrategies, charts: usable.length, chosen, candidates: cands };
}

export interface PlaybookPair { key: string; id: string; name: string; testTrades: number; testPF: number; testAvgPct: number; score: number; /** Signals per bar in the newer data: how often the random twin enters on this chart. */ rate: number }
/** The charts a competition bot chooses to trade, and the strategy on each: the best chart-and-strategy pairs from its
 *  short list that also made money chart by chart in the newer data (at least `minTrades` trades there).
 *  One chart per symbol. `banned` ("SYMBOL@tf|strategy") are pairs a fired bot of the same seat already used:
 *  a recruit must try something different. An empty playbook is valid: the bot then trades nothing that week. */
export function pickPlaybook(sl: Shortlist, maxCharts: number, banned: Set<string> = new Set(), minTrades = 5): PlaybookPair[] {
  const pairs: PlaybookPair[] = [];
  for (const c of sl.candidates.filter(x => x.chosen)) for (const ch of c.charts ?? []) {
    if (ch.testTrades < minTrades || ch.testPF <= 1 || banned.has(`${ch.key}|${c.id}`)) continue;
    pairs.push({ key: ch.key, id: c.id, name: c.name, testTrades: ch.testTrades, testPF: ch.testPF, testAvgPct: ch.testAvgPct, score: Math.min(ch.testPF, 5) * Math.log10(ch.testTrades + 1), rate: ch.testBars ? ch.testTrades / ch.testBars : 0 });
  }
  pairs.sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1));
  const out: PlaybookPair[] = []; const syms = new Set<string>();
  for (const p of pairs) { const sym = p.key.split("@")[0]; if (syms.has(sym)) continue; syms.add(sym); out.push(p); if (out.length >= maxCharts) break; }
  return out;
}
