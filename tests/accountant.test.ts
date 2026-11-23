import { test, expect, describe } from "bun:test";
import { newAccountant, decide, settle, track, accrue, standings, madridMonth, monthReturnPct, inWeekendPause, tierName, toNextTier, type MonthRow } from "../src/bot/accountant";
import { step, newState, equityOf } from "../src/bot/bot";
import { settings } from "../src/config";
import { synthBars } from "../scripts/make-fixtures";

const T0 = "2026-11-02T10:00";
describe("the accountant", () => {
  test("twice the grant: a badge, the profit locked in the award, the loan repaid from it, back to the same grant", () => {
    const a = newAccountant(250, T0); track(a, "2026-11-04T10:00", 520); const d = decide(a, 520)!; expect(d.kind).toBe("milestone");
    expect(settle(a, "2026-11-04T10:00", 520, d)).toBe(250);
    expect(a).toMatchObject({ grant: 250, badges: 1, streak: 1, bestStreak: 1, debt: 0, repaid: 250 }); expect(a.award).toBeCloseTo(20, 6);
    expect(a.events.map(e => e.kind)).toEqual(["milestone", "repay"]); expect(a.index).toBeCloseTo(208, 6);
  });
  test("half the grant with enough award: the award refills it and the streak starts again", () => {
    const a = newAccountant(250, T0); a.debt = 0; a.award = 300; a.streak = 3; a.bestStreak = 3;
    const d = decide(a, 125)!; expect(d.kind).toBe("save"); expect(settle(a, "2026-11-05T10:00", 125, d)).toBe(250);
    expect(a).toMatchObject({ award: 175, saves: 1, streak: 0, bestStreak: 3 });
  });
  test("half the grant without enough award: fired", () => {
    const a = newAccountant(250, T0); a.award = 100; const d = decide(a, 120)!; expect(d.kind).toBe("fired");
    expect(settle(a, "2026-11-05T10:00", 120, d)).toBe(0); expect(a.events.at(-1)!.kind).toBe("fired");
  });
  test("nothing happens between the bust line and the target", () => { const a = newAccountant(250, T0); expect(decide(a, 126)).toBeNull(); expect(decide(a, 499)).toBeNull(); });
  test("the debt never grows: weekly checks only count strikes", () => {
    const a = newAccountant(250, T0); accrue(a, "2026-11-08T10:00"); expect(a.strikes ?? 0).toBe(0); // first check after 7 days
    accrue(a, "2026-11-09T10:00"); expect(a.strikes).toBe(1); expect(a.debt).toBe(250);
    accrue(a, "2026-11-30T10:00"); expect(a.strikes).toBe(4); expect(a.debt).toBe(250); expect(a.interestPaid).toBe(0);
  });
  test("a part of the loan is repaid when the award cannot cover all of it", () => {
    const a = newAccountant(250, T0); a.award = 100; accrue(a, "2026-11-03T10:00"); expect(a).toMatchObject({ award: 0, debt: 150, repaid: 100 });
  });
  test("tiers: 4, 8 and 12 badges in a row; a save resets the streak but not the title", () => {
    const a = newAccountant(250, T0); a.debt = 0;
    for (let k = 0; k < 4; k++) settle(a, T0, 500, { kind: "milestone" });
    expect(tierName(a)).toBe("Pro"); expect(toNextTier(a)).toBe(4);
    settle(a, T0, 125, { kind: "save" }); expect(a.streak).toBe(0); expect(tierName(a)).toBe("Pro"); expect(toNextTier(a)).toBe(8);
    for (let k = 0; k < 12; k++) settle(a, T0, 500, { kind: "milestone" }); expect(tierName(a)).toBe("Experienced trader"); expect(toNextTier(a)).toBeNull();
  });
  test("the index counts only trading, never the accountant's money", () => {
    const a = newAccountant(250, T0); a.award = 200; track(a, T0, 125); settle(a, T0, 125, { kind: "save" });
    expect(a.index).toBeCloseTo(50, 6); track(a, "2026-11-03T10:00", 275); expect(a.index).toBeCloseTo(55, 6);
  });
  test("months and the weekend follow Madrid time", () => {
    expect(madridMonth("2026-11-30T23:30")).toBe("2026-12"); expect(madridMonth("2026-11-30T22:30")).toBe("2026-11");
    const t = (s: string) => Date.parse(s + "Z");
    expect(inWeekendPause(t("2026-11-27T20:59"))).toBe(false); expect(inWeekendPause(t("2026-11-27T21:00"))).toBe(true); // Fri 22:00 Madrid
    expect(inWeekendPause(t("2026-11-29T22:59"))).toBe(true); expect(inWeekendPause(t("2026-11-29T23:00"))).toBe(false);  // Mon 00:00 Madrid
  });
  test("standings: most badges first, ties to the best % return", () => {
    const row = (badges: number, end: number): MonthRow => ({ badges, saves: 0, interest: 0, repaid: 0, indexStart: 100, indexEnd: end, trades: 5, wins: 2, pnl: 0 });
    const s = standings([{ id: "a", row: row(1, 101) }, { id: "b", row: row(1, 120) }, { id: "c", row: row(2, 90) }, { id: "d", row: row(0, 300) }, { id: "e" }]);
    expect(s.map(x => x.id)).toEqual(["c", "b", "a", "d", "e"]); expect(monthReturnPct(row(0, 110))).toBeCloseTo(10, 6);
  });
});

describe("a competition bot", () => {
  const st = settings(); const comp = { ...st, bot: { ...st.bot, riskPctPerTrade: 5, maxDrawdownPct: 0 } };
  const ids = { AAA: ["donchian_trend", "ema_pullback", "rsi2_dip", "ma_cross"] };
  const bot = () => ({ ...newState(250, "2000-01-01"), accountant: newAccountant(250, "2026-01-01T00:00"), side: "long" as const });
  test("reaching twice the grant closes every position, awards the badge, locks the profit and restarts at the grant", () => {
    const up = synthBars(7, 900, "2026-06-01", true, 0.008); const s = bot();
    for (let n = 300; n <= 900 && !s.accountant.badges; n++) step(s, { AAA: { cls: "stock", complete: up.slice(0, n), partial: null } }, ids, comp);
    expect(s.accountant.badges).toBe(1); expect(s.accountant.grant).toBe(250); expect(Object.keys(s.positions)).toHaveLength(0);
    expect(s.accountant.award + s.accountant.repaid).toBeGreaterThanOrEqual(245); expect(s.cash).toBeCloseTo(250, 6);
  });
  test("a falling market: the bot is fired (no award to save it), never halted, and then trades nothing", () => {
    const dn = synthBars(9, 900, "2026-06-01", true, -0.006); const s = bot();
    for (let n = 300; n <= 900; n += 2) step(s, { AAA: { cls: "stock", complete: dn.slice(0, n), partial: null } }, ids, comp);
    expect(s.halted ?? null).toBeNull();
    if (s.fired) { const n = s.trades.length; step(s, { AAA: { cls: "stock", complete: dn, partial: null } }, ids, comp); expect(s.trades.length).toBe(n); expect(s.accountant.events.at(-1)!.kind).toBe("fired"); }
    else expect(equityOf(s, () => undefined)).toBeGreaterThan(125 * 0.8);
  });
  test("weekend pause: nothing is held from Friday 22:00 to Monday 00:00 (Madrid)", () => {
    const t0 = Date.parse("2026-06-01T00:00:00Z"); const bars = synthBars(11, 3000, "2026-12-31", false).map((b, k) => ({ ...b, d: new Date(t0 + k * 3600e3).toISOString().slice(0, 16) }));
    const s = bot(); const t = (d: string) => Date.parse(d + ":00Z");
    for (let n = 400; n <= 3000; n += 7) step(s, { AAA: { cls: "crypto", tf: "1h", complete: bars.slice(0, n), partial: null, clock: "utc" } }, ids, comp);
    for (const tr of s.trades) { expect(inWeekendPause(t(tr.entryDate))).toBe(false); }
    expect(s.trades.some(tr => tr.reason === "weekend") || s.trades.length === 0).toBe(true);
  });
});

import { runBacktest } from "../src/core/backtest";
import { strategyById, buildCtx } from "../src/core/strategies";
import { twinStrategy, twinId, unitHash } from "../src/bot/bot";
describe("weekend pause in the backtester", () => {
  test("no trade is open across a paused bar, and a position open when the pause starts closes as 'weekend'", () => {
    const bars = synthBars(21, 1200, "2026-06-01", false); const paused = bars.map((_, i) => i % 7 >= 5);
    const s = strategyById("donchian_trend")!; const opt = { costBps: 10, maxLosingBars: 10, exits: settings().exits, paused };
    const r = runBacktest(bars, s, opt); const idx = new Map(bars.map((b, i) => [b.d, i]));
    expect(r.trades.length).toBeGreaterThan(3);
    for (const t of r.trades) { const a = idx.get(t.entryDate)!, b = idx.get(t.exitDate)!; expect(paused[a]).toBe(false); for (let i = a; i < b; i++) expect(paused[i]).toBe(false); }
    const free = runBacktest(bars, s, { ...opt, paused: undefined }); expect(free.trades.some(t => t.bars > 5)).toBe(true);
  });
});
describe("the random twin", () => {
  test("enters on the same bars every time, about as often as asked, and copies side and stop", () => {
    const bars = synthBars(5, 2000, "2026-06-01", false); const x = buildCtx(bars);
    const t = twinStrategy(twinId("BTC@1h", "rsi2_dip_short", 0.05))!; const base = strategyById("rsi2_dip_short")!;
    expect(t.side).toBe("short"); expect(t.stopAtr).toBe(base.stopAtr); expect(t.exit(x, 500, 3)).toBe(false);
    const hits = bars.map((_, i) => t.entry(x, i)); const again = bars.map((_, i) => twinStrategy(twinId("BTC@1h", "rsi2_dip_short", 0.05))!.entry(x, i));
    expect(again).toEqual(hits); const rate = hits.filter(Boolean).length / bars.length; expect(rate).toBeGreaterThan(0.03); expect(rate).toBeLessThan(0.07);
    expect(bars.some((_, i) => twinStrategy(twinId("BTC@1h", "rsi2_dip_short", 0))!.entry(x, i))).toBe(false);
    expect(twinStrategy("rsi2_dip")).toBeUndefined(); expect(unitHash("a")).not.toBe(unitHash("b"));
  });
});

describe("fair play", () => {
  test("a bot never acts on a bar that closed before it was hired", () => {
    const st = settings(); const bars = synthBars(3, 900, "2026-06-01", true, 0.004);
    const ids = { AAA: ["donchian_trend", "ema_pullback", "rsi2_dip", "ma_cross", "macd_cross", "supertrend"] };
    const late = newState(250, "2030-01-01T00:00"); for (let n = 300; n <= 900; n++) step(late, { AAA: { cls: "stock", complete: bars.slice(0, n), partial: null } }, ids, st);
    expect(late.trades.length + Object.keys(late.positions).length + Object.keys(late.pending).length).toBe(0);
  });
  test("an open position is valued at the newest close of its symbol on any timeframe", () => {
    const s = newState(1000, "2000-01-01T00:00"); s.positions["BTC@4h"] = { side: "long", qty: 1, qty0: 1, entry: 100, entryDate: "2026-01-01T00:00", stop: 90, target: 120, strategyId: "donchian_trend", held: 0 } as never;
    // The newest 15m bar closes 4 hours after the newest 4h bar.
    const mk = (n: number, last: number, stepMin: number) => Array.from({ length: n }, (_, i) => ({ d: new Date(Date.UTC(2026, 0, 1) + (i - n + 1) * stepMin * 60e3 + 30 * 864e5 + (stepMin === 15 ? 4 * 3600e3 : 0)).toISOString().slice(0, 16), o: 100, h: 101, l: 99, c: i === n - 1 ? last : 100, v: 1 }));
    s.last["BTC@4h"] = mk(300, 100, 240).at(-2)!.d; s.last["BTC@15m"] = mk(300, 110, 15).at(-2)!.d;
    step(s, { "BTC@4h": { cls: "crypto", tf: "4h", complete: mk(300, 100, 240), partial: null, clock: "utc" }, "BTC@15m": { cls: "crypto", tf: "15m", complete: mk(300, 110, 15), partial: null, clock: "utc" } }, {}, settings());
    expect(s.equityCurve.at(-1)!.equity).toBeCloseTo(1010, 0);
  });
});

import { reconcile } from "../src/bot/accountant";
describe("audit: the books always balance", () => {
  const st = settings(); const comp = { ...st, bot: { ...st.bot, riskPctPerTrade: 5, maxDrawdownPct: 0 }, competition: { ...st.competition, graceDays: 0 } };
  const ids = { AAA: ["donchian_trend", "ema_pullback", "rsi2_dip", "ma_cross", "macd_cross"] };
  for (const [name, drift, seed] of [["a rising market", 0.008, 7], ["a choppy market", 0, 13], ["a falling market", -0.006, 9]] as const) {
    test(`${name}: cash + award + paid back = grant + closed profit, at every step`, () => {
      const bars = synthBars(seed, 1400, "2026-06-01", true, drift); const hire = bars[290].d + "T00:00";
      const s = { ...newState(250, hire), accountant: newAccountant(250, hire), side: "long" as const };
      for (let n = 300; n <= 1400 && !s.fired; n += 3) { // runs on until the bot is stopped or replaced: those moves must balance too
        step(s, { AAA: { cls: "stock", complete: bars.slice(0, n), partial: null } }, ids, comp, { funding: () => 0.00002 });
        expect(Math.abs(reconcile(s.accountant, s.cash, s.trades.reduce((t, x) => t + x.pnl, 0), s.fundingPaid ?? 0))).toBeLessThan(1e-6);
        const a = s.accountant; expect(a.award).toBeGreaterThanOrEqual(-1e-9); expect(a.debt).toBeGreaterThanOrEqual(-1e-9);
        // The loan: 250 = paid back + still owed (+ lost, once stopped); it never grows.
        expect(250 - a.repaid - a.debt - (a.writtenOff ?? 0)).toBeCloseTo(0, 6); expect(a.debt).toBeLessThanOrEqual(250);
      }
    });
  }
  test("stopped: what is left goes back against the loan, and the loss is recorded", () => {
    const a = newAccountant(250, T0); a.award = 20; a.debt = 250; a.repaid = 0;
    settle(a, "2026-11-20T10:00", 120, { kind: "fired" });
    expect(a.recovered).toBeCloseTo(140, 6); expect(a.writtenOff).toBeCloseTo(110, 6); expect(a.award).toBe(0); expect(a.debt).toBe(0);
    expect(250 - a.repaid - (a.writtenOff ?? 0)).toBeCloseTo(0, 6);
  });
  test("a trade is a win when the whole trade made money, not just its last part", () => {
    const a = newAccountant(250, T0);
    countTradeAll(a, [5, 5, -2]); countTradeAll(a, [2, -6]);
    const r = a.months[madridMonth(T0)]; expect(r.trades).toBe(2); expect(r.wins).toBe(1); expect(r.pnl).toBeCloseTo(4, 6);
  });
});
import { countTrade } from "../src/bot/accountant";
function countTradeAll(a: ReturnType<typeof newAccountant>, parts: number[]) { let sum = 0; parts.forEach((p, i) => { sum += p; countTrade(a, T0, p, i === parts.length - 1, sum); }); }

import { addBonus } from "../src/bot/accountant";
import { duelsOf } from "../src/pipeline";
describe("competition rules, second round", () => {
  test("a busy week clears the strikes; three quiet weeks in a row and the bot is replaced", () => {
    const a = newAccountant(250, T0, { ...DEFAULT_RULES_T, graceDays: 0 });
    a.weekTrades = 2; accrue(a, "2026-11-02T10:00", DEFAULT_RULES_T); expect(a.strikes).toBe(1);
    a.weekTrades = 6; accrue(a, "2026-11-09T10:00", DEFAULT_RULES_T); expect(a.strikes).toBe(0); expect(a.events.at(-1)!.kind).toBe("active");
    for (const d of ["2026-11-16", "2026-11-23"]) accrue(a, d + "T10:00", DEFAULT_RULES_T); expect(decide(a, 300, DEFAULT_RULES_T)).toBeNull();
    accrue(a, "2026-11-30T10:00", DEFAULT_RULES_T); expect(a.strikes).toBe(3); expect(decide(a, 300, DEFAULT_RULES_T)).toEqual({ kind: "fired", why: "strikes" });
    expect(a.debt).toBe(250);
  });
  test("a prize goes into the award, repays the loan first, and the books still balance", () => {
    const a = newAccountant(250, T0); addBonus(a, T0, 25, "for winning 2026-10");
    expect(a).toMatchObject({ award: 0, debt: 225, repaid: 25, bonuses: 25 }); expect(reconcile(a, 250, 0)).toBeCloseTo(0, 9);
  });
  test("funding: longs pay when the rate is positive, every full hour, from cash", () => {
    const st2 = settings(); const s = newState(1000, "2000-01-01T00:00");
    s.positions["BTC@1h"] = { side: "long", qty: 1, qty0: 1, entry: 100, entryDate: "x", stop: 50, strategyId: "donchian_trend", held: 0, fundingAt: Date.parse("2026-01-05T00:00:00Z") } as never;
    const bars = Array.from({ length: 300 }, (_, i) => ({ d: new Date(Date.parse("2025-12-24T00:00:00Z") + i * 3600e3).toISOString().slice(0, 16), o: 100, h: 101, l: 99, c: 100, v: 1 }));
    s.last["BTC@1h"] = "2026-01-05T00:00";
    step(s, { "BTC@1h": { cls: "crypto", tf: "1h", complete: bars, partial: null, clock: "utc" } }, {}, st2, { funding: () => 0.001 });
    const hours = (Date.parse(bars.at(-1)!.d + ":00Z") + 3600e3 - Date.parse("2026-01-05T00:00:00Z")) / 3600e3;
    expect(s.fundingPaid).toBeCloseTo(hours * 0.1, 6); expect(s.cash).toBeCloseTo(1000 - hours * 0.1, 6);
  });
  test("weekly duels: pairs rotate, the better week wins 3 points", () => {
    const mk = (id: string, daily: Record<string, number>, index: number) => ({ id, name: id, index, daily, hiredAt: "2026-11-02T08:00" });
    const d = duelsOf([mk("a", { "2026-11-06": 110 }, 110), mk("b", { "2026-11-06": 95 }, 95), mk("c", { "2026-11-06": 100 }, 101), mk("d", { "2026-11-06": 100.01 }, 100)], Date.parse("2026-11-10T12:00:00Z"));
    expect(d.past).toHaveLength(1); expect(d.past[0].pairs.map(p => [p.a, p.b, p.winner])).toEqual([["a", "b", "a"], ["c", "d", null]]);
    expect(d.current!.pairs.map(p => [p.a, p.b])).toEqual([["a", "c"], ["b", "d"]]);
    expect(d.table.find(x => x.id === "a")).toMatchObject({ points: 3, won: 1 }); expect(d.table.find(x => x.id === "c")).toMatchObject({ points: 1, drawn: 1 });
  });
});
const DEFAULT_RULES_T = { graceDays: 7, tiers: [4, 8, 12], minTradesPerWeek: 5, maxStrikes: 3 };

import { nextMondayMadrid } from "../src/pipeline";
describe("replacement timing", () => {
  test("a stopped bot's seat is filled on the next Monday at 00:00 Madrid", () => {
    expect(nextMondayMadrid("2026-11-25T14:20")).toBe("2026-11-29T23:00"); // Wednesday -> Monday 00:00 CET
    expect(nextMondayMadrid("2026-11-29T23:30")).toBe("2026-12-06T23:00"); // already Monday in Madrid -> the next one
  });
});

describe("the accountant never loses on a bot that has earned a badge", () => {
  test("the first badge repays the whole loan, so a later stop costs the accountant nothing", () => {
    const a = newAccountant(250, T0); settle(a, T0, 503, decide(a, 503)!); expect(a.debt).toBe(0);
    settle(a, "2026-11-05T10:00", 120, { kind: "fired" }); expect(a.writtenOff ?? 0).toBe(0); expect(a.returned).toBeCloseTo(120 + 3, 6);
  });
});
