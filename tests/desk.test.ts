import { test, expect, describe } from "bun:test";
import "./tmpdata"; // before the app's modules: never touch real data
import { newDesk, deskCheck, correlation, correlationBlock, tierBps } from "../src/bot/desk";
import { mergeAnswers, ask, answer, readApprovals, weeklyReports, dailyReports, mondayOf, APPROVALS, type Approval, type ReportBot } from "../src/bot/office";
import { step, newState, type MarketView } from "../src/bot/bot";
import { STRATEGIES, buildCtx, I } from "../src/core/strategies";
import { settings, writeJson, DEFAULT_COMPETITION, DATA } from "../src/config";
import { synthBars } from "../scripts/make-fixtures";

const R = { dailyLossPct: 3, drawdownPct: 7, recoverPct: 3.5 };
describe("desk guard", () => {
  test("the desk index moves by the average change of the bots' indexes", () => {
    const k = newDesk(); deskCheck(k, [{ who: "a#1", index: 100 }, { who: "b#1", index: 100 }], "2026-11-25T08:00", R);
    deskCheck(k, [{ who: "a#1", index: 102 }, { who: "b#1", index: 100 }], "2026-11-25T09:00", R);
    expect(k.index).toBeCloseTo(101, 8);
  });
  test("a new recruit joins from its first check: a firing never moves the desk", () => {
    const k = newDesk(); deskCheck(k, [{ who: "a#1", index: 60 }, { who: "b#1", index: 100 }], "2026-11-25T08:00", R);
    deskCheck(k, [{ who: "a#2", index: 100 }, { who: "b#1", index: 100 }], "2026-11-25T09:00", R);
    expect(k.index).toBeCloseTo(100, 8);
  });
  test("3% down in one Madrid day stops the desk until the next day", () => {
    const k = newDesk(); deskCheck(k, [{ who: "a#1", index: 100 }], "2026-11-25T08:00", R);
    expect(deskCheck(k, [{ who: "a#1", index: 98 }], "2026-11-25T10:00", R).stop).toBe(false);
    const g = deskCheck(k, [{ who: "a#1", index: 96.9 }], "2026-11-25T12:00", R); expect(g.stop).toBe(true); expect(g.dayPct).toBeLessThanOrEqual(-3);
    expect(deskCheck(k, [{ who: "a#1", index: 98 }], "2026-11-25T20:00", R).stop).toBe(true);   // a bounce the same day does not lift it
    expect(deskCheck(k, [{ who: "a#1", index: 98 }], "2026-11-25T23:30", R).stop).toBe(false);  // 00:30 Madrid: a new day
    expect(k.log.some(l => /lifted/.test(l.msg))).toBe(true);
  });
  test("7% under the best halves the risk until the desk is back within 3.5%", () => {
    const k = newDesk(); const at = (d: number) => `2026-11-${String(10 + d).padStart(2, "0")}T12:00`;
    deskCheck(k, [{ who: "a#1", index: 100 }], at(0), R); deskCheck(k, [{ who: "a#1", index: 110 }], at(1), R);
    expect(deskCheck(k, [{ who: "a#1", index: 103 }], at(2), R).halve).toBe(false);
    expect(deskCheck(k, [{ who: "a#1", index: 102 }], at(3), R).halve).toBe(true);
    expect(deskCheck(k, [{ who: "a#1", index: 105 }], at(4), R).halve).toBe(true);
    expect(deskCheck(k, [{ who: "a#1", index: 106.5 }], at(5), R).halve).toBe(false);
  });
});

describe("correlation cap", () => {
  const series = (f: (i: number) => number) => new Map(Array.from({ length: 300 }, (_, i) => [`2026-10-01T${String(i).padStart(4, "0")}`, f(i)] as [string, number]));
  const noise = (seed: number) => (i: number) => 100 * Math.exp(0.01 * Math.sin(i * seed) + 0.002 * i);
  test("the same series correlates at 1, too little overlap gives no answer", () => {
    const a = series(noise(1.3)); expect(correlation(a, a)).toBeCloseTo(1, 8);
    expect(correlation(a, new Map([...a].slice(0, 50)))).toBeNull();
  });
  test("same market or a market that moves with it, same direction: blocked; the other direction: allowed", () => {
    const corr = (a: string, b: string) => (a + b === "BTCETH" || a + b === "ETHBTC" ? 0.9 : 0.1);
    const others = [{ name: "Valeria", sym: "BTC", side: "short" as const }];
    expect(correlationBlock("BTC", "short", others, corr, 0.8)).toContain("Valeria already holds BTC short");
    expect(correlationBlock("ETH", "short", others, corr, 0.8)).toContain("moves with ETH");
    expect(correlationBlock("ETH", "long", others, corr, 0.8)).toBeNull();
    expect(correlationBlock("SOL", "short", others, corr, 0.8)).toBeNull();
  });
});

describe("costs by open interest", () => {
  const T = DEFAULT_COMPETITION.costTiers;
  test("deeper markets cost less; no Lighter number keeps the old cost", () => {
    expect(tierBps(228e6, T)).toBe(3); expect(tierBps(8.5e6, T)).toBe(8); expect(tierBps(70e3, T)).toBe(40); expect(tierBps(0, T)).toBe(40); expect(tierBps(null, T)).toBeNull();
    for (let i = 1; i < T.length; i++) expect(T[i].bps).toBeGreaterThan(T[i - 1].bps);
  });
});

describe("bot step: desk options", () => {
  const st = settings(); const all = synthBars(3, 900, "2026-06-01", true);
  const x = buildCtx(all); const strat = STRATEGIES.find(q => q.id === "rsi2_dip")!; let i = 420; while (i < 880 && !strat.entry(x, i)) i++;
  const view = (n: number, partial = false): Record<string, MarketView> => ({ AAA: { cls: "stock", complete: all.slice(0, partial ? n - 1 : n), partial: partial ? all[n - 1] : null } });
  const best = { AAA: ["rsi2_dip"] };
  test("an entry signal keeps its close and ATR", () => {
    const s = newState(10000, "2000-01-01"); step(s, view(i + 1), best, st);
    expect(s.pending.AAA.signalPx).toBe(all[i].c); expect(s.pending.AAA.atr).toBeCloseTo(I.atr(x, 14)[i], 10);
  });
  test("the slippage cap cancels an entry when the open ran away from the signal close", () => {
    const s = newState(10000, "2000-01-01"); step(s, view(i + 1), best, st);
    const gap = Math.abs(all[i + 1].o - all[i].c) / s.pending.AAA.atr!;
    step(s, view(i + 2, true), best, st, { maxSlipAtr: gap / 2 }); expect(s.positions.AAA).toBeUndefined(); expect(s.log.at(-1)!.msg).toContain("ran away");
    const t = newState(10000, "2000-01-01"); step(t, view(i + 1), best, st); step(t, view(i + 2, true), best, st, { maxSlipAtr: gap * 2 + 0.01 }); expect(t.positions.AAA).toBeDefined();
  });
  test("the correlation cap skips an entry and says why", () => {
    const s = newState(10000, "2000-01-01"); step(s, view(i + 1), best, st);
    step(s, view(i + 2, true), best, st, { blocked: () => "Lucas already holds AAA long" }); expect(s.positions.AAA).toBeUndefined(); expect(s.log.at(-1)!.msg).toContain("correlation cap");
  });
  test("the daily loss limit closes everything and opens nothing", () => {
    const s = newState(10000, "2000-01-01"); step(s, view(i + 1), best, st); step(s, view(i + 2, true), best, st); expect(s.positions.AAA).toBeDefined();
    step(s, view(i + 3), best, st, { flatten: "desk-stop", now: Date.parse("2026-11-25T10:00:00Z") });
    expect(Object.keys(s.positions)).toHaveLength(0); expect(s.trades.at(-1)!.reason).toBe("desk-stop"); expect(Object.keys(s.pending)).toHaveLength(0);
    const n = s.trades.length; for (let m = i + 4; m < i + 60; m += 3) step(s, view(m), best, st, { flatten: "desk-stop" });
    expect(s.trades.length).toBe(n); expect(Object.keys(s.positions)).toHaveLength(0);
  });
});

describe("the accountant's office", () => {
  test("tests write into a temp folder, never the real data", () => { expect(DATA).toContain("td-test-"); });
  test("answers are kept apart from the shared requests and merged back after a pull", () => {
    const list: Approval[] = []; ask(list, { id: "hire-x-2", kind: "hire", slot: "x", at: "2026-11-25T10:00", title: "Hire?", detail: "d" });
    ask(list, { id: "hire-x-2", kind: "hire", slot: "x", at: "2026-11-26T10:00", title: "again", detail: "d" }); expect(list).toHaveLength(1);
    writeJson(APPROVALS(), list); answer("hire-x-2", true, Date.parse("2026-11-25T11:00:00Z")); expect(readApprovals()[0].status).toBe("yes");
    writeJson(APPROVALS(), list.map(a => ({ ...a, status: "pending" })));   // a pull from bot-data brings the old copy back
    const back = readApprovals(); expect(mergeAnswers(back)).toBe(true); expect(back[0].status).toBe("yes"); expect(mergeAnswers(back)).toBe(false);
    expect(answer("nope", true)).toBeNull();
  });
  const bot = (over: Partial<ReportBot> = {}): ReportBot => ({ id: "a", name: "Nico", hiredAt: "2026-11-16T08:00", index: 104, daily: { "2026-11-16": 100, "2026-11-22": 102, "2026-11-24": 103 },
    trades: [{ key: "BTC@1h", side: "long", entryDate: "2026-11-24T09:00", exitDate: "2026-11-24T12:00", pnl: 5 }, { key: "ETH@1h", side: "long", entryDate: "2026-11-18T09:00", exitDate: "2026-11-18T12:00", pnl: -2 }],
    events: [{ d: "2026-11-21T21:00", kind: "strike", badges: 0, msg: "" }], equity: 260, grant: 250, award: 0, debt: 250, strikes: 1, tierName: "Rookie", streak: 0, badges: 0, stopped: null, ...over });
  const now = Date.parse("2026-11-25T12:00:00Z");
  test("Monday of a Madrid week", () => { expect(mondayOf(now)).toBe("2026-11-23"); expect(mondayOf(Date.parse("2026-11-22T23:30:00Z"))).toBe("2026-11-23"); });
  test("weekly reports: what the bot did and what the accountant answers", () => {
    const w = weeklyReports(bot(), now, 5); expect(w.map(x => x.week)).toEqual(["2026-11-23", "2026-11-16"]);
    expect(w[0]).toMatchObject({ live: true, trades: 1, wins: 1, pnl: 5 }); expect(w[0].returnPct).toBeCloseTo((104 / 102 - 1) * 100, 1); expect(w[0].accountant).toContain("4 more closed trades");
    expect(w[1]).toMatchObject({ trades: 1, strike: true }); expect(w[1].accountant).toContain("Strike");
  });
  test("daily reports add the bots up and name the best and the worst", () => {
    const d = dailyReports([bot(), bot({ id: "b", name: "Lucas", trades: [], daily: { "2026-11-24": 100 }, index: 99 })], { "2026-11-23": 100, "2026-11-24": 101 }, now, 5);
    expect(d[0].day).toBe("2026-11-25"); expect(d[1]).toMatchObject({ day: "2026-11-24", trades: 1, pnl: 5, deskPct: 1 });
    expect(d[0].bots.find(b => b.id === "b")!.pct).toBeCloseTo(-1, 6); expect(d[1].text).toContain("1 trade closed");
  });
});
