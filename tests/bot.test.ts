import { test, expect, describe } from "bun:test";
import { step, newState, equityOf, exposureOf, resume, migrate, underlying, type MarketView, type BotState } from "../src/bot/bot";
import { STRATEGIES, buildCtx } from "../src/core/strategies";
import { settings } from "../src/config";
import { synthBars } from "../scripts/make-fixtures";

const st = settings(); const all = synthBars(3, 900, "2026-06-01", true);
const view = (n: number, partial = false): Record<string, MarketView> => ({ AAA: { cls: "stock", complete: all.slice(0, partial ? n - 1 : n), partial: partial ? all[n - 1] : null } });
const best = { AAA: ["rsi2_dip"] };
const run = (from: number, to: number) => { const s = newState(10000, "2000-01-01"); for (let n = from; n <= to; n++) step(s, view(n), best, st); return s; };

describe("paper bot", () => {
  test("running the same step twice changes nothing (apart from the heartbeat)", () => { const s = run(400, 700); const strip = (x: BotState) => JSON.stringify({ ...x, checked: null }); const snap = strip(s); step(s, view(700), best, st); expect(strip(s)).toBe(snap); expect(s.checked).toMatchObject({ markets: 1, withStrategy: 1, newBars: 0 }); });
  test("catching up after days offline gives the same trades as running every day", () => {
    const daily = run(400, 800); const s = newState(10000, "2000-01-01"); step(s, view(400), best, st); step(s, view(800), best, st);
    expect(s.trades).toEqual(daily.trades); expect(s.cash).toBeCloseTo(daily.cash, 6);
  });
  test("it trades, the trade list only grows, and the account never goes to zero", () => {
    const s = newState(10000, "2000-01-01"); let prev = 0;
    for (let n = 400; n <= 900; n += 5) { step(s, view(n), best, st); expect(s.trades.length).toBeGreaterThanOrEqual(prev); prev = s.trades.length; expect(equityOf(s, () => undefined)).toBeGreaterThan(0); }
    expect(s.trades.length).toBeGreaterThan(3);
  });
  test("a buy is filled at the open of the day after the signal, sized by the risk rule", () => {
    const x = buildCtx(all); const strat = STRATEGIES.find(q => q.id === "rsi2_dip")!; let i = 420; while (i < 880 && !strat.entry(x, i)) i++; expect(i).toBeLessThan(880);
    const s = newState(10000, "2000-01-01"); step(s, view(i + 1), best, st);          // bar i is the last finished day
    expect(s.pending.AAA).toMatchObject({ type: "entry", signalDate: all[i].d }); expect(s.positions.AAA).toBeUndefined();
    step(s, view(i + 2, true), best, st);                                              // next day opens
    const p = s.positions.AAA; expect(p.entryDate).toBe(all[i + 1].d); expect(p.entry).toBeCloseTo(all[i + 1].o * (1 + st.costBps.stock / 1e4), 8);
    expect(p.qty * p.entry).toBeLessThanOrEqual(10000 * st.bot.maxPositionPct / 100 + 1e-6);
    expect(equityOf(s, () => p.entry)).toBeCloseTo(10000, 4);
  });
  test("shorts: profit is entry minus exit, and the direction is recorded", () => {
    const dn = synthBars(5, 900, "2026-06-01", true, -0.0006); const s = newState(10000, "2000-01-01");
    for (let n = 400; n <= 900; n += 3) step(s, { AAA: { cls: "stock", complete: dn.slice(0, n), partial: null } }, { AAA: ["ema_pullback_short"] }, st);
    expect(s.trades.length).toBeGreaterThan(2);
    for (const t of s.trades) { expect(t.side).toBe("short"); expect(t.pnl).toBeCloseTo((t.entry - t.exit) * t.qty, 6); }
    expect(s.cash).toBeCloseTo(10000 + s.trades.reduce((a, t) => a + t.pnl, 0), 6);
  });
  test("total exposure at entry never exceeds maxLeverage times the account", () => {
    const tight = { ...st, bot: { ...st.bot, maxLeverage: 0.6, maxPositionPct: 50, riskPctPerTrade: 5, maxPositions: 8 } }; const s = newState(10000, "2000-01-01");
    const syms = ["A", "B", "C", "D"]; const data = syms.map((_, k) => synthBars(20 + k, 900, "2026-06-01", true)); let seen = 0;
    for (let n = 400; n <= 900; n += 2) {
      const before = Object.keys(s.positions).length;
      step(s, Object.fromEntries(syms.map((k, j) => [k, { cls: "stock" as const, complete: data[j].slice(0, n - 1), partial: data[j][n - 1] }])), Object.fromEntries(syms.map(k => [k, ["ema_pullback", "ema_pullback_short"]])), tight);
      if (Object.keys(s.positions).length > before) { seen++; const entryPx = (k: string) => s.positions[k]?.entry; expect(exposureOf(s, entryPx)).toBeLessThanOrEqual(0.6 * 10000 * 1.25); }
    }
    expect(seen).toBeGreaterThan(3); expect(Math.max(...Object.values(s.positions).map(p => p.qty * p.entry), 0)).toBeLessThanOrEqual(0.6 * equityOf(s, () => undefined) * 1.5 + 1);
  });
  test("with nothing else open, a new position is capped at exactly maxLeverage times the account", () => {
    const x = buildCtx(all); const strat = STRATEGIES.find(q => q.id === "rsi2_dip")!; let i = 420; while (i < 880 && !strat.entry(x, i)) i++;
    const tight = { ...st, bot: { ...st.bot, maxLeverage: 0.1, maxPositionPct: 50, riskPctPerTrade: 50 } }; const s = newState(10000, "2000-01-01");
    step(s, view(i + 1), best, tight); step(s, view(i + 2, true), best, tight);
    expect(s.positions.AAA.qty * s.positions.AAA.entry).toBeCloseTo(1000, 6);
  });
  test("circuit breaker: a fall of maxDrawdownPct from the peak closes everything and halts the bot until it is resumed", () => {
    const s = newState(10000, "2000-01-01"); for (let n = 400; n <= 700 && !Object.keys(s.positions).length; n++) step(s, view(n), best, st);
    expect(Object.keys(s.positions)).toHaveLength(1); const n0 = all.findIndex(b => b.d === s.last.AAA) + 1;
    s.peak = equityOf(s, () => undefined) * 1.2;                                   // pretend the account was 20% higher before
    step(s, view(n0 + 1), best, st);
    expect(s.halted?.reason).toMatch(/fell 10%/); expect(Object.keys(s.positions)).toHaveLength(0); expect(s.trades.at(-1)!.reason).toBe("circuit-breaker");
    const trades = s.trades.length; for (let n = n0 + 2; n <= n0 + 200; n += 2) step(s, view(n), best, st);
    expect(s.trades).toHaveLength(trades); expect(s.pending).toEqual({});          // halted: no new orders at all
    resume(s, () => undefined, "2026-06-01"); expect(s.halted).toBeNull(); expect(s.peak).toBeCloseTo(s.cash, 6);
    for (let n = n0 + 202; n <= 900; n += 2) step(s, view(n), best, st); expect(s.trades.length).toBeGreaterThan(trades);
  });
  test("at most maxPerGroup positions in one direction inside a group", () => {
    const one = { ...st, bot: { ...st.bot, maxPerGroup: 1, maxDrawdownPct: 0 } }; const s = newState(10000, "2000-01-01"); const syms = ["A", "B", "C"]; const data = syms.map((_, k) => synthBars(3 + k * 7, 900, "2026-06-01", true)); let most = 0, skipped = false;
    for (let n = 400; n <= 900; n += 2) { step(s, Object.fromEntries(syms.map((k, j) => [k, { cls: "stock" as const, group: "Chips", complete: data[j].slice(0, n), partial: null }])), Object.fromEntries(syms.map(k => [k, ["ema_pullback", "rsi2_dip"]])), one); most = Math.max(most, Object.values(s.positions).filter(p => p.side === "long").length); }
    skipped = s.log.some(l => l.msg.includes("tend to move together")); expect(most).toBe(1); expect(skipped).toBe(true);
  });
  test("an entry carrying its own stop price gets that stop, and stepped exits put TP1 at 1R from it", () => {
    const s = newState(10000, "2000-01-01"); const i = 500; const bars = all.slice(0, i + 2); const stop = bars[i + 1].o * 0.98;
    s.last.AAA = bars[i].d; s.pending.AAA = { type: "entry", signalDate: bars[i].d, strategyId: "donchian_trend", stopPrice: stop };
    const single = { ...st, exits: { mode: "single" as const, tpR: [], fractions: [], trailAtr: 0 } };
    step(s, { AAA: { cls: "stock", complete: bars.slice(0, i + 1), partial: bars[i + 1] } }, { AAA: ["donchian_trend"] }, single);
    const p = s.positions.AAA; expect(p.stop).toBeCloseTo(stop, 8); expect(p.target ?? null).toBeNull(); // no target of its own in "single"
    // With stepped exits the first take-profit is at 1R (the stop is 2% away, so 2% above the open).
    const s2 = newState(10000, "2000-01-01"); s2.last.AAA = bars[i].d;
    s2.pending.AAA = { type: "entry", signalDate: bars[i].d, strategyId: "donchian_trend", stopPrice: stop };
    step(s2, { AAA: { cls: "stock", complete: bars.slice(0, i + 1), partial: bars[i + 1] } }, { AAA: ["donchian_trend"] }, { ...st, exits: { mode: "ladder", tpR: [1, 2], fractions: [1 / 3, 1 / 3], trailAtr: 3 } });
    expect(s2.positions.AAA.target!).toBeCloseTo(bars[i + 1].o * 1.02, 6); expect(s2.positions.AAA.qty0).toBe(s2.positions.AAA.qty);
  });
  test("stepped exits in the bot: partial closes are separate trades, cash adds up, and the stop never moves back", () => {
    const s = newState(10000, "2000-01-01"); const plan = { mode: "ladder" as const, tpR: [1, 2], fractions: [1 / 3, 1 / 3], trailAtr: 3 };
    let parts = 0; let prevStop = -Infinity; let monotone = true;
    for (let n = 400; n <= all.length; n++) {
      step(s, { AAA: { cls: "stock", complete: all.slice(0, n), partial: null } }, { AAA: ["ema_pullback", "donchian_trend"] }, { ...st, exits: plan });
      const p = s.positions.AAA; if (p) { if (p.entryDate !== (s as any)._e) { (s as any)._e = p.entryDate; prevStop = -Infinity; } if (p.stop < prevStop - 1e-9) monotone = false; prevStop = p.stop; }
    }
    parts = s.trades.filter(t => t.reason === "tp1" || t.reason === "tp2").length;
    expect(parts).toBeGreaterThan(0); expect(monotone).toBe(true);
    const pnl = s.trades.reduce((a, t) => a + t.pnl, 0); expect(s.cash).toBeCloseTo(10000 + pnl, 6);
  });
  test("timeframes: bars of different timeframes are handled in the order they close, and one symbol is held only once", () => {
    // Synthetic 1h bars and the 4h bars built from the same prices: both keys point at the same symbol.
    const h1 = synthBars(3, 1600, "2026-01-01", false, 0.0004, 0.01).map((b, i) => ({ ...b, d: new Date(Date.parse("2025-10-01T00:00:00Z") + i * 3600000).toISOString().slice(0, 16) }));
    const h4: typeof h1 = []; for (const b of h1) { const k = new Date(Math.floor(Date.parse(b.d + ":00Z") / 14400000) * 14400000).toISOString().slice(0, 16); const a = h4.at(-1); if (a?.d === k) { a.h = Math.max(a.h, b.h); a.l = Math.min(a.l, b.l); a.c = b.c; } else h4.push({ ...b, d: k }); }
    const s = newState(10000, "2025-10-01"); let both = 0; const order: string[] = [];
    for (let n = 1100; n <= 1600; n += 4) {
      const m = { "AAA@1h": { cls: "crypto" as const, tf: "1h" as const, complete: h1.slice(0, n), partial: null }, "AAA@4h": { cls: "crypto" as const, tf: "4h" as const, complete: h4.filter(b => Date.parse(b.d + ":00Z") + 14400000 <= Date.parse(h1[n - 1].d + ":00Z") + 3600000), partial: null } };
      step(s, m, { "AAA@1h": ["ema_pullback", "rsi2_dip"], "AAA@4h": ["ema_pullback", "rsi2_dip"] }, st);
      if (Object.keys(s.positions).length > 1) both++;
      for (const t of s.trades) if (!order.includes(t.entryDate + t.symbol)) order.push(t.entryDate + t.symbol);
    }
    expect(both).toBe(0); expect(s.trades.length).toBeGreaterThan(2); expect(new Set(s.trades.map(t => t.symbol)).size).toBeGreaterThanOrEqual(1);
    expect(s.log.some(l => l.msg.includes("already holding AAA"))).toBe(true);
    const ends = s.equityCurve.map(p => p.d); expect([...ends].sort()).toEqual(ends);          // the account line never goes back in time
  });
  test("state files from before timeframes are migrated: plain symbols get the timeframe they ran on", () => {
    const s = newState(2000, "2026-11-15"); s.last = { BTC: "2026-11-15T17", ETH: "2026-11-15T17:00" }; s.positions = { BTC: { side: "long", qty: 1, entry: 1, entryDate: "x", stop: 0.5, strategyId: "rsi2_dip", held: 0 } };
    migrate(s, "1h"); expect(s.last).toEqual({ "BTC@1h": "2026-11-15T17:00", "ETH@1h": "2026-11-15T17:00" }); expect(Object.keys(s.positions)).toEqual(["BTC@1h"]); expect(underlying("BTC@1h")).toBe("BTC");
    migrate(s, "1h"); expect(Object.keys(s.last)).toEqual(["BTC@1h", "ETH@1h"]);                // running it again changes nothing
  });
  test("settings refuse leverage of 3 or more", () => { expect(st.bot.maxLeverage).toBeLessThan(3); });
  test("no strategy assigned means no trades", () => { const s = newState(10000, "2000-01-01"); for (let n = 400; n <= 700; n += 10) step(s, view(n), { AAA: [] }, st); expect(s.trades).toHaveLength(0); expect(s.cash).toBe(10000); });
});
