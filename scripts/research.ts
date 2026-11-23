// Research report: every strategy on every symbol in the price cache, pooled. Run with: bun run research
// Reads data/cache/bars (or TD_DATA_DIR). Prints a table; changes nothing.
import { settings, universe } from "../src/config";
import { loadCached, splitComplete } from "../src/data/prices";
import { STRATEGIES } from "../src/core/strategies";
import { runBacktest, judge } from "../src/core/backtest";

const st = settings(); const rows: Record<string, { trades: number; wins: number; gw: number; gl: number; pass: number; tested: number; both: number; reasons: Record<string, number> }> = {};
for (const sym of universe()) {
  const c = loadCached(sym.symbol); if (!c) continue; const { complete } = splitComplete(c.bars, sym.class, c.meta, Date.now()); if (complete.length < 260) continue;
  for (const s of STRATEGIES) {
    const r = runBacktest(complete, s, { costBps: st.costBps[sym.class], maxLosingBars: st.backtest.maxLosingBars }); const a = (rows[s.id] ??= { trades: 0, wins: 0, gw: 0, gl: 0, pass: 0, tested: 0, both: 0, reasons: {} });
    a.tested++; a.trades += r.trades.length; if (judge(r.metrics, st.backtest).passes) a.pass++; if (r.metrics.firstHalfReturnPct > 0 && r.metrics.secondHalfReturnPct > 0) a.both++;
    for (const t of r.trades) { if (t.retPct > 0) { a.wins++; a.gw += t.retPct; } else a.gl -= t.retPct; a.reasons[t.reason] = (a.reasons[t.reason] ?? 0) + 1; }
  }
}
console.log("strategy".padEnd(24), "trades", " win%", "  PF ", " R:R ", "avg%/trade", "pass", "bothHalves", " exits");
for (const [id, a] of Object.entries(rows)) { const losses = a.trades - a.wins; console.log(id.padEnd(24), String(a.trades).padStart(6), (a.trades ? (a.wins / a.trades * 100).toFixed(0) : "-").padStart(5), (a.gl ? (a.gw / a.gl).toFixed(2) : "-").padStart(5), (a.wins && losses && a.gl ? ((a.gw / a.wins) / (a.gl / losses)).toFixed(2) : "-").padStart(5), (a.trades ? ((a.gw - a.gl) / a.trades).toFixed(2) : "-").padStart(10), `${a.pass}/${a.tested}`.padStart(5), `${a.both}/${a.tested}`.padStart(9), " ", JSON.stringify(a.reasons)); }
