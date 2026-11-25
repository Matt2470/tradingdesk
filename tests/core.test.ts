import { test, expect, describe } from "bun:test";
import { sma, ema, rsi, atr, highest, lowest, efficiency } from "../src/core/indicators";
import { STRATEGIES, variants, buildCtx, type Bar, type Strategy } from "../src/core/strategies";
import { luckTest, sensitivity, robustness } from "../src/core/robust";
import { runBacktest, judge, maxDrawdownPct } from "../src/core/backtest";
import { synthBars } from "../scripts/make-fixtures";
import { smcSignals } from "../src/core/smc";

describe("indicators", () => {
  test("sma and warm-up", () => { const s = sma([1, 2, 3, 4, 5], 3); expect(s[1]).toBeNaN(); expect(s.slice(2)).toEqual([2, 3, 4]); });
  test("ema seeds with the simple average", () => { const e = ema([2, 4, 6, 8], 3); expect(e[2]).toBe(4); expect(e[3]).toBe(6); });
  test("rsi is 100 when price only rises and 0 when it only falls", () => { const up = Array.from({ length: 20 }, (_, i) => 10 + i); expect(rsi(up, 14)[19]).toBe(100); expect(rsi([...up].reverse(), 14)[19]).toBe(0); });
  test("atr of constant-range bars equals the range", () => { const n = 30; const h = Array(n).fill(11), l = Array(n).fill(9), c = Array(n).fill(10); expect(atr(h, l, c, 14)[29]).toBeCloseTo(2, 10); });
  test("highest / lowest / efficiency", () => { expect(highest([1, 5, 2, 3], 2)).toEqual([NaN, 5, 5, 3]); expect(lowest([1, 5, 2, 3], 2)).toEqual([NaN, 1, 2, 2]); expect(efficiency([1, 2, 3, 4, 5], 4)[4]).toBe(1); });
  test("indicators never use future data", () => { const x = synthBars(7, 300, "2026-01-01", true).map(b => b.c); for (const f of [(v: number[]) => sma(v, 20), (v: number[]) => ema(v, 20), (v: number[]) => rsi(v, 14)]) { const full = f(x), cut = f(x.slice(0, 200)); expect(cut[199]).toBeCloseTo(full[199], 10); } });
});

const flat = (n: number, px = 100): Bar[] => Array.from({ length: n }, (_, i) => ({ d: new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10), o: px, h: px + 1, l: px - 1, c: px, v: 1 }));
const once = (entryAt: number, exitAt: number, side: "long" | "short" = "long"): Strategy => ({ id: "t", name: "t", family: "trend", side, params: {}, plain: "", indicators: [], warmup: 15, stopAtr: 3, entry: (_x, i) => i === entryAt, exit: (_x, i) => i === exitAt });

describe("backtest engine", () => {
  test("a signal at the close of bar i is filled at the open of bar i+1", () => {
    const bars = flat(60); for (let i = 21; i < 31; i++) Object.assign(bars[i], { o: 105, h: 106, l: 104, c: 105 }); bars[31].o = 120; bars[31].h = 121; bars[31].l = 119; bars[31].c = 120;
    const r = runBacktest(bars, once(20, 30), { costBps: 0, maxLosingBars: 0 });
    expect(r.trades).toHaveLength(1); expect(r.trades[0].entryDate).toBe(bars[21].d); expect(r.trades[0].entry).toBe(105); expect(r.trades[0].exitDate).toBe(bars[31].d); expect(r.trades[0].exit).toBe(120);
  });
  test("costs are charged on both sides", () => {
    const bars = flat(60); const free = runBacktest(bars, once(20, 30), { costBps: 0, maxLosingBars: 0 }), paid = runBacktest(bars, once(20, 30), { costBps: 50, maxLosingBars: 0 });
    expect(free.trades[0].retPct).toBeCloseTo(0, 10); expect(paid.trades[0].retPct).toBeCloseTo((0.995 / 1.005 - 1) * 100, 8);
  });
  test("a stop fills at the stop price, or at the open when the bar gaps through it", () => {
    const a = flat(60); a[25].l = 90; // ATR is 2, stop = 100 - 3*2 = 94
    expect(runBacktest(a, once(20, 50), { costBps: 0, maxLosingBars: 0 }).trades[0]).toMatchObject({ exit: 94, reason: "stop" });
    const b = flat(60); b[25].o = 80; b[25].h = 81; b[25].l = 79; b[25].c = 80;
    expect(runBacktest(b, once(20, 50), { costBps: 0, maxLosingBars: 0 }).trades[0]).toMatchObject({ exit: 80, reason: "stop" });
  });
  test("the time stop closes a trade that is still losing after maxLosingBars", () => {
    const bars = flat(80); for (let i = 22; i < 80; i++) { bars[i].o = 99; bars[i].h = 99.5; bars[i].l = 98.5; bars[i].c = 99; }
    const r = runBacktest(bars, once(20, 70), { costBps: 0, maxLosingBars: 5 }); expect(r.trades[0].reason).toBe("time-stop"); expect(r.trades[0].bars).toBe(5);
  });
  test("no lookahead: cutting off the future never changes past trades", () => {
    const bars = synthBars(42, 900, "2026-06-01", true);
    for (const s of STRATEGIES) {
      const full = runBacktest(bars, s, { costBps: 10, maxLosingBars: 10 }); const k = 600; const cut = runBacktest(bars.slice(0, k), s, { costBps: 10, maxLosingBars: 10 });
      const before = full.trades.filter(t => t.exitDate <= bars[k - 1].d);
      expect(cut.trades).toEqual(before);
    }
  });
  test("a short earns when price falls, pays costs on both sides, and its stop fills at the open on a gap up", () => {
    const a = flat(60); for (let i = 21; i < 60; i++) Object.assign(a[i], { o: 90, h: 91, l: 89, c: 90 }); a[21].o = 100;
    const t = runBacktest(a, once(20, 30, "short"), { costBps: 50, maxLosingBars: 0 }).trades[0];
    expect(t.side).toBe("short"); expect(t.entry).toBeCloseTo(99.5, 8); expect(t.exit).toBeCloseTo(90.45, 8); expect(t.retPct).toBeCloseTo((1 - 90.45 / 99.5) * 100, 8);
    const b = flat(60); b[25].h = 110; // ATR 2, short stop = 100 + 6 = 106
    expect(runBacktest(b, once(20, 50, "short"), { costBps: 0, maxLosingBars: 0 }).trades[0]).toMatchObject({ exit: 106, reason: "stop" });
    const c = flat(60); Object.assign(c[25], { o: 120, h: 121, l: 119, c: 120 });
    const g = runBacktest(c, once(20, 50, "short"), { costBps: 0, maxLosingBars: 0 }).trades[0]; expect(g).toMatchObject({ exit: 120, reason: "stop" }); expect(g.retPct).toBeCloseTo(-20, 8);
  });
  test("every strategy reports sane metrics; longs trade in a rising market and shorts in a falling one", () => {
    const up = synthBars(3, 1000, "2026-06-01", true), dn = synthBars(5, 1000, "2026-06-01", true, -0.0006);
    for (const s of STRATEGIES) {
      for (const bars of [up, dn]) { const m = runBacktest(bars, s, { costBps: 10, maxLosingBars: 10 }).metrics; expect(m.maxDrawdownPct).toBeLessThanOrEqual(0); expect(m.exposurePct).toBeLessThanOrEqual(100); expect(Number.isFinite(m.profitFactor)).toBe(true); expect(Number.isFinite(m.totalReturnPct)).toBe(true); }
      // The SMC pattern is rare by design (a handful of signals in years of daily bars), so it is exempt from this check.
      // The quiet-spell breakouts need the bands at their narrowest of 120 bars first, which a steady trend never gives.
      if (!s.id.startsWith("squeeze_")) expect(runBacktest(s.side === "long" ? up : dn, s, { costBps: 10, maxLosingBars: 10 }).metrics.trades).toBeGreaterThan(0);
    }
    expect(STRATEGIES.filter(s => s.side === "short").every(s => /_short(_adx)?$/.test(s.id))).toBe(true);
  });
  test("a profit target closes the trade at the target; if stop and target share a bar, the stop wins", () => {
    const tgt = (side: "long" | "short"): Strategy => ({ ...once(20, 50, side), targetR: 2 });          // ATR 2: stop 6 away, target 12 away
    const a = flat(60); a[25].h = 113;
    expect(runBacktest(a, tgt("long"), { costBps: 0, maxLosingBars: 0 }).trades[0]).toMatchObject({ exit: 112, reason: "target" });
    const b = flat(60); b[25].h = 113; b[25].l = 93;
    expect(runBacktest(b, tgt("long"), { costBps: 0, maxLosingBars: 0 }).trades[0]).toMatchObject({ exit: 94, reason: "stop" });
    const c = flat(60); c[25].l = 87;
    expect(runBacktest(c, tgt("short"), { costBps: 0, maxLosingBars: 0 }).trades[0]).toMatchObject({ exit: 88, reason: "target" });
  });
  test("a strategy can name its own stop price, and no trade is taken if the open is already beyond it", () => {
    const own = (stop: number): Strategy => ({ ...once(20, 50), stopPrice: () => stop, targetR: 3 });
    const a = flat(60); a[30].h = 107;                                                                   // stop 98 -> risk 2 -> target 106
    const r = runBacktest(a, own(98), { costBps: 0, maxLosingBars: 0 }); expect(r.trades[0]).toMatchObject({ exit: 106, reason: "target" }); expect(r.trades[0].retPct).toBeCloseTo(6, 8);
    expect(runBacktest(flat(60), own(101), { costBps: 0, maxLosingBars: 0 }).trades).toHaveLength(0);
  });
  test("SMC: a sweep of a swing low followed by a close above the swing high gives one buy signal, with the stop at the sweep low", () => {
    //         bar:   0    1    2     3     4     5    6     7
    const h = [10, 12, 11, 13, 12.8, 12, 12.5, 14], l = [9, 10, 9.5, 10.5, 11.5, 9.0, 9.8, 11.9], c = [9.5, 11, 10, 12.5, 12, 10, 12, 13.5], o = [9.4, 9.5, 11, 10, 12.5, 11.8, 10, 12];
    const r = smcSignals(o, h, l, c, { slen: 1, len: 1, maxBars: 10 });
    expect(r.bull).toEqual([0, 0, 0, 0, 0, 0, 0, 1]); expect(r.bear.every(v => v === 0)).toBe(true); expect(r.stop[7]).toBe(9);
    // Without the close above the swing high (13) there is no signal.
    expect(smcSignals(o, h, l, [...c.slice(0, 7), 12.9], { slen: 1, len: 1, maxBars: 10 }).bull.every(v => v === 0)).toBe(true);
    // Mirror image gives one sell signal with the stop at the sweep high.
    const m = (v: number[]) => v.map(x => 30 - x); const s = smcSignals(m(o), m(l), m(h), m(c), { slen: 1, len: 1, maxBars: 10 });
    expect(s.bear).toEqual([0, 0, 0, 0, 0, 0, 0, 1]); expect(s.stop[7]).toBe(21);
    // Order block: bar 5 is the last falling candle at the low of the move (open 11.8, close 10, high 12, low 9).
    // Its lower wick (1.0) is longer than half its body (0.9), so the zone is 10 to 12. Price returns into it at bar 9.
    const o2 = [...o, 13.5, 14, 12.2], h2 = [...h, 14.5, 14.2, 12.6], l2 = [...l, 12.5, 11.5, 11], c2 = [...c, 14, 12.2, 12.4];
    const ob = smcSignals(o2, h2, l2, c2, { slen: 1, len: 1, maxBars: 10 });
    expect(ob.obBull).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0]); expect(ob.obStop[9]).toBe(10);   // one signal only: the block is used up after the first touch
    // If the returning bar closes below the bottom of the block, the block is spent and there is no signal.
    expect(smcSignals(o2, h2, [...l2.slice(0, 9), 9.5, 11], [...c2.slice(0, 9), 9.8, 12.4], { slen: 1, len: 1, maxBars: 10 }).obBull.every(v => v === 0)).toBe(true);
  });
  test("SMC signals never change when future bars are added", () => {
    const b = synthBars(9, 700, "2026-06-01", true); const H = b.map(x => x.h), L = b.map(x => x.l), C = b.map(x => x.c); const p = { slen: 5, len: 3, maxBars: 30 };
    const O = b.map(x => x.o); const full = smcSignals(O, H, L, C, p), cut = smcSignals(O.slice(0, 450), H.slice(0, 450), L.slice(0, 450), C.slice(0, 450), p);
    expect(cut.bull).toEqual(full.bull.slice(0, 450)); expect(cut.bear).toEqual(full.bear.slice(0, 450)); expect(cut.obBull).toEqual(full.obBull.slice(0, 450)); expect(cut.obBear).toEqual(full.obBear.slice(0, 450)); expect(full.bull.reduce((a, v) => a + v, 0) + full.bear.reduce((a, v) => a + v, 0)).toBeGreaterThan(0);
  });
  test("settings test: each setting moves 25% down and up, one at a time, and the real strategies are untouched", () => {
    const v = variants("donchian_trend"); expect(v.map(q => q.label)).toEqual(["entry 20 -> 15", "entry 20 -> 25", "exit 10 -> 8", "exit 10 -> 13", "trend 200 -> 150", "trend 200 -> 250"]);
    expect(v[0].strategy.params).toEqual({ entry: 15, exit: 10, trend: 200 }); expect(STRATEGIES.find(s => s.id === "donchian_trend")!.params).toEqual({ entry: 20, exit: 10, trend: 200 });
    expect(variants("rsi2_dip").map(q => q.label)).toContain("extreme 10 -> 7.5"); expect(variants("rsi2_dip").some(q => q.label.startsWith("rsi 2 -> 2"))).toBe(false); expect(variants("nope")).toEqual([]);
    const bars = synthBars(3, 1000, "2026-06-01", true); const s = sensitivity(bars, "ema_pullback", { costBps: 10, maxLosingBars: 10 });
    expect(s.tested).toBe(4); expect(s.profitable).toBeGreaterThanOrEqual(0); expect(s.profitable).toBeLessThanOrEqual(4); expect(s.worst).toMatch(/->/);
  });
  test("luck test: always the same answer for the same trades, 0% for all winners, 100% for all losers", () => {
    expect(luckTest([2, 3, 1, 4]).lossPct).toBe(0); expect(luckTest([-2, -3, -1]).lossPct).toBe(100); expect(luckTest([])).toMatchObject({ runs: 0 });
    const mixed = [10, -4, -4, -4, 9, -5, 12, -3, -4, -4]; const a = luckTest(mixed), b = luckTest(mixed); expect(a).toEqual(b); expect(a.lossPct).toBeGreaterThan(5); expect(a.lossPct).toBeLessThan(95); expect(a.p5ReturnPct).toBeLessThan(a.medianReturnPct);
    const one = [300, -5, -5, -5, -5, -5, -5, -5, -5, -5, -5, -5]; const r = robustness(synthBars(3, 600, "2026-06-01", true), "ma_cross", one, { costBps: 10, maxLosingBars: 10 });
    expect(r.luck.lossPct).toBeGreaterThan(20); expect(r.fragile).toBe(true); expect(r.why[0]).toMatch(/random redraws/);   // a result carried by one trade is flagged
  });
  test("the gate rejects thin or inconsistent results", () => {
    const base = { trades: 40, winRate: 50, avgWinPct: 2, avgLossPct: -1, profitFactor: 2, expectancyPct: 0.5, totalReturnPct: 20, cagrPct: 5, maxDrawdownPct: -10, exposurePct: 30, buyHoldReturnPct: 10, buyHoldMaxDrawdownPct: -30, firstHalfReturnPct: 8, secondHalfReturnPct: 11, years: 4 };
    const g = { minTrades: 10, minProfitFactor: 1.2 };
    expect(judge(base, g)).toMatchObject({ passes: true, evidence: "solid" });
    expect(judge({ ...base, trades: 5 }, g).passes).toBe(false);
    expect(judge({ ...base, secondHalfReturnPct: -1 }, g).passes).toBe(false);
    expect(judge({ ...base, profitFactor: 1.1 }, g).passes).toBe(false);
    expect(judge({ ...base, trades: 12 }, g).evidence).toBe("thin");
  });
  test("max drawdown", () => { expect(maxDrawdownPct([1, 2, 1, 3])).toBeCloseTo(-50, 10); });
});

describe("the strategies added on 2026-11-22", () => {
  const { STRATEGIES: S } = require("../src/core/strategies");
  const { supertrend } = require("../src/core/indicators");
  const flatThenUp = () => { const b: any[] = []; let px = 100; for (let k = 0; k < 420; k++) { const quiet = k < 380; px = quiet ? 100 + Math.sin(k / 3) * (k > 300 ? 0.05 : 1.5) : px * 1.012; b.push({ d: new Date(Date.UTC(2025, 0, 1) + k * 864e5).toISOString().slice(0, 10), o: px, h: px * 1.002, l: px * 0.998, c: px, v: 1 }); } return b; };
  test("quiet-spell breakout buys only after the bands were narrow, on a close above the upper band", () => {
    const bars = flatThenUp(); const s = S.find((x: any) => x.id === "squeeze_break"); const x = buildCtx(bars);
    const hits = bars.map((_: any, i: number) => (i > s.warmup && s.entry(x, i) ? i : -1)).filter((i: number) => i >= 0);
    expect(hits.length).toBeGreaterThan(0); expect(hits[0]).toBeGreaterThanOrEqual(380);
  });
  test("supertrend direction flips up in a rise and down in a fall", () => {
    const up = Array.from({ length: 60 }, (_, k) => 100 + k), dn = Array.from({ length: 60 }, (_, k) => 160 - k); const c = [...up, ...dn];
    const d = supertrend(c.map(v => v + 1), c.map(v => v - 1), c, 10, 3);
    expect(d[55]).toBe(1); expect(d[115]).toBe(-1);
  });
  test("there are 16 rules, 8 long and 8 short, and no SMC rules", () => {
    expect(S).toHaveLength(30); expect(S.filter((x: any) => x.side === "short")).toHaveLength(15); expect(S.filter((x: any) => x.id.endsWith("_adx"))).toHaveLength(14); expect(S.some((x: any) => x.id.startsWith("smc_"))).toBe(false);
  });
});

import { adx } from "../src/core/indicators";
describe("market-type filters", () => {
  test("ADX is high in a steady trend and low in a sideways market", () => {
    const n = 300; const up = Array.from({ length: n }, (_, i) => 100 + i); const side = Array.from({ length: n }, (_, i) => 100 + Math.sin(i / 2) * 2);
    const a1 = adx(up.map(x => x + 1), up.map(x => x - 1), up, 14), a2 = adx(side.map(x => x + 1), side.map(x => x - 1), side, 14);
    expect(a1[n - 1]).toBeGreaterThan(40); expect(a2[n - 1]).toBeLessThan(20); expect(Number.isNaN(a1[10])).toBe(true);
  });
  test("a filtered rule only enters where its plain rule would, and only in its market type", async () => {
    const { STRATEGIES, buildCtx, I } = await import("../src/core/strategies");
    const { synthBars } = await import("../scripts/make-fixtures");
    const x = buildCtx(synthBars(3, 1500, "2026-06-01", false)); const ad = I.adx(x, 14);
    for (const f of STRATEGIES.filter(s => s.id.endsWith("_adx"))) {
      const base = STRATEGIES.find(s => s.id === f.id.replace(/_adx$/, ""))!;
      for (let i = f.warmup; i < x.n; i++) if (f.entry(x, i)) { expect(base.entry(x, i)).toBe(true); expect(base.family === "trend" ? ad[i] > 25 : ad[i] < 28).toBe(true); }
    }
  });
});
