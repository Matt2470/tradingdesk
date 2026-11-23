import { describe, test, expect } from "bun:test";
import { openLegs, onBar, onClose, nextTarget, type ExitPlan } from "../src/core/exits";
import { runBacktest } from "../src/core/backtest";
import { STRATEGIES } from "../src/core/strategies";
import { synthBars } from "../scripts/make-fixtures";

const ladder: ExitPlan = { mode: "ladder", tpR: [1, 2], fractions: [1 / 3, 1 / 3], trailAtr: 3 };
const full: ExitPlan = { mode: "ladder", tpR: [1, 2, 3], fractions: [1 / 3, 1 / 3, 1 / 3], trailAtr: 0 };
const single: ExitPlan = { mode: "single", tpR: [], fractions: [], trailAtr: 0 };

describe("exit engine", () => {
  test("ladder: TP1 sells a third and moves the stop to the entry price, but only from the next bar", () => {
    const L = openLegs(ladder, 1, 100, 95); // R = 5
    const f = onBar(L, ladder, 100, 106, 99);
    expect(f).toEqual([{ reason: "tp1", px: 105, frac: 1 / 3 }]); expect(L.stop).toBe(100); expect(L.left).toBeCloseTo(2 / 3, 9);
    expect(nextTarget(L, ladder)).toBe(110);
  });
  test("stop and take-profit in the same bar: the stop wins, with the stop the bar opened with", () => {
    const L = openLegs(ladder, 1, 100, 95);
    expect(onBar(L, ladder, 100, 106, 94)).toEqual([{ reason: "stop", px: 95, frac: 1 }]); expect(L.left).toBe(0);
  });
  test("a gap through the stop fills at the open, never at the stop", () => {
    const L = openLegs(ladder, 1, 100, 95); expect(onBar(L, ladder, 90, 92, 88)[0].px).toBe(90);
    const S = openLegs(ladder, -1, 100, 105); expect(onBar(S, ladder, 110, 112, 109)[0].px).toBe(110);
  });
  test("one big bar can fill TP1 and TP2; the rest runs and the stop locks TP1", () => {
    const L = openLegs(ladder, 1, 100, 95);
    const f = onBar(L, ladder, 100, 112, 100);
    expect(f.map(x => x.reason)).toEqual(["tp1", "tp2"]); expect(L.left).toBeCloseTo(1 / 3, 9); expect(L.stop).toBe(105); expect(nextTarget(L, ladder)).toBeNull();
  });
  test("fractions adding to 1: the last take-profit closes everything", () => {
    const L = openLegs(full, 1, 100, 95); const f = onBar(L, full, 100, 120, 100);
    expect(f.map(x => x.reason)).toEqual(["tp1", "tp2", "tp3"]); expect(L.left).toBe(0); expect(f.reduce((a, x) => a + x.frac, 0)).toBeCloseTo(1, 9);
  });
  test("trailing stop: starts after TP1, follows the best close, never moves back; shorts mirror it", () => {
    const L = openLegs(ladder, 1, 100, 95); onClose(L, ladder, 104, 1); expect(L.stop).toBe(95); // no trail before TP1
    onBar(L, ladder, 104, 106, 103); onClose(L, ladder, 108, 1); expect(L.stop).toBe(105);       // 108 - 3
    onClose(L, ladder, 102, 1); expect(L.stop).toBe(105);                                         // never back
    const S = openLegs(ladder, -1, 100, 105); onBar(S, ladder, 100, 101, 94); onClose(S, ladder, 92, 1); expect(S.stop).toBe(95);
  });
  test("single plan keeps the old behaviour: one target at the strategy's R, or none", () => {
    const L = openLegs(single, 1, 100, 95, 3); expect(onBar(L, single, 100, 114, 99)).toEqual([]); expect(onBar(L, single, 100, 116, 99)).toEqual([{ reason: "target", px: 115, frac: 1 }]);
    const N = openLegs(single, 1, 100, 95); expect(onBar(N, single, 100, 500, 99)).toEqual([]);
  });
  test("backtest with stepped exits: still no lookahead (cutting the future does not change past trades) and returns add up", () => {
    const bars = synthBars(7, 900, "2024-06-01", true); const s = STRATEGIES.find(q => q.id === "ema_pullback")!;
    const a = runBacktest(bars, s, { costBps: 10, maxLosingBars: 10, exits: ladder }); const b = runBacktest(bars.slice(0, 700), s, { costBps: 10, maxLosingBars: 10, exits: ladder });
    const done = b.trades.filter(t => t.exitDate < bars[690].d); expect(a.trades.slice(0, done.length)).toEqual(done);
    let eq = 1; for (const t of a.trades) eq *= 1 + t.retPct / 100; expect(a.equity.at(-1)!).toBeCloseTo(a.end.inPosition ? a.equity.at(-1)! : eq, 6);
    expect(a.trades.some(t => (t.partials ?? 0) > 0)).toBe(true);
  });
});
describe("the owner's plan: TP1, TP2, TP3 and SL1, SL2, SL3", () => {
  const own: ExitPlan = { mode: "ladder", tpR: [1, 2, 3], fractions: [1 / 3, 1 / 3, 1 / 3], trailAtr: 3, slR: [0.5, 0.75], slFractions: [1 / 3, 1 / 3] };
  test("three take-profits of a third each close everything at 3R", () => {
    const L = openLegs(own, 1, 100, 90); const f = onBar(L, own, 100, 131, 100);
    expect(f.map(x => [x.reason, x.px])).toEqual([["tp1", 110], ["tp2", 120], ["tp3", 130]]); expect(L.left).toBe(0);
  });
  test("between TP2 and TP3 the rising stop can close the last third first", () => {
    const L = openLegs(own, 1, 100, 90); onBar(L, own, 100, 121, 100); onClose(L, own, 126, 1); expect(L.stop).toBe(123);
    expect(onBar(L, own, 125, 126, 122).map(x => [x.reason, x.px])).toEqual([["trail", 123]]);
  });
  test("the defaults are this plan", async () => { const { DEFAULT_EXITS } = await import("../src/core/exits"); expect(DEFAULT_EXITS).toEqual(own); });
});
describe("stepped stops", () => {
  const plan: ExitPlan = { mode: "ladder", tpR: [1, 2], fractions: [1 / 3, 1 / 3], trailAtr: 3, slR: [0.5, 0.75], slFractions: [1 / 3, 1 / 3] };
  test("SL1 at 0.5R and SL2 at 0.75R sell a third each; the full stop sells the rest", () => {
    const L = openLegs(plan, 1, 100, 90); // R = 10: SL1 95, SL2 92.5, stop 90
    expect(onBar(L, plan, 100, 101, 94)).toEqual([{ reason: "sl1", px: 95, frac: 1 / 3 }]);
    expect(onBar(L, plan, 94, 95, 92)).toEqual([{ reason: "sl2", px: 92.5, frac: 1 / 3 }]);
    const last = onBar(L, plan, 92, 93, 89); expect(last[0].reason).toBe("sl3"); expect(last[0].frac).toBeCloseTo(1 / 3, 9); expect(L.left).toBe(0);
  });
  test("a gap down through all stops fills each at the open", () => {
    const L = openLegs(plan, 1, 100, 90); const f = onBar(L, plan, 85, 86, 84);
    expect(f.map(x => [x.reason, x.px])).toEqual([["sl1", 85], ["sl2", 85], ["sl3", 85]]); expect(f.reduce((a, x) => a + x.frac, 0)).toBeCloseTo(1, 9);
  });
  test("a bar that touches SL1 takes no profit in the same bar; after TP1 the stepped stops no longer apply", () => {
    const L = openLegs(plan, 1, 100, 90); expect(onBar(L, plan, 100, 115, 94).map(x => x.reason)).toEqual(["sl1"]);
    const M = openLegs(plan, 1, 100, 90); onBar(M, plan, 100, 111, 99); expect(M.stop).toBe(100); expect(onBar(M, plan, 101, 102, 94.5).map(x => x.reason)).toEqual(["trail"]);
  });
  test("shorts mirror it", () => { const S = openLegs(plan, -1, 100, 110); expect(onBar(S, plan, 100, 105.5, 99)).toEqual([{ reason: "sl1", px: 105, frac: 1 / 3 }]); });
});
