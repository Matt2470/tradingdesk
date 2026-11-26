import { test, expect, describe } from "bun:test";
import { runEvil, evilMarket, EVIL_FOR, type EvilKind } from "../src/bot/evil";
import type { Bar } from "../src/core/strategies";

const hours = (n: number, f: (i: number) => number, start = "2026-11-01T00:00"): Bar[] => {
  const t0 = Date.parse(start + ":00Z");
  return Array.from({ length: n }, (_, i) => { const o = f(i), c = f(i + 1); return { d: new Date(t0 + i * 3600_000).toISOString().slice(0, 16), o, c, h: Math.max(o, c) * 1.001, l: Math.min(o, c) * 0.999, v: 1 }; });
};
const wave = (i: number) => 100 + 4 * Math.sin(i / 6);
const up = (i: number) => (i < 340 ? wave(i) : 100 * 1.004 ** (i - 340));
const down = (i: number) => (i < 340 ? wave(i) : 100 * 0.996 ** (i - 340));
const O = { grant: 250, leverage: 3, costBps: 5 };
const spec = (kind: EvilKind) => ({ kind, sym: "TEST", since: "2026-11-15T04:00", recruit: 1 });

describe("evil twins", () => {
  test("each seat has its Pionex bot", () => { expect(EVIL_FOR).toEqual({ "stocks-bull": "neutral-grid", "stocks-bear": "short-grid", "crypto-bull": "trailing", "crypto-bear": "dca-short" }); });
  test("a neutral grid earns in a sideways market and stays within 3x", () => {
    const bars = hours(700, wave); const r = runEvil(bars, spec("neutral-grid"), O);
    expect(r.trades).toBeGreaterThan(20); expect(r.resultPct).toBeGreaterThan(0); expect(r.stops).toBe(0);
    expect(Math.abs(r.positionUsd)).toBeLessThanOrEqual(r.equity * 3 + 1);
  });
  test("a short grid is hurt by a steady rise; the stop line is counted and a fresh grant goes on", () => {
    const r = runEvil(hours(900, up), spec("short-grid"), O); expect(r.resultPct).toBeLessThan(0); expect(r.stops).toBeGreaterThanOrEqual(1);
    expect(r.notes.some(n => /Would have been stopped/.test(n.msg))).toBe(true);
  });
  test("trailing buy rides a rise; trailing sell rides a fall", () => {
    expect(runEvil(hours(900, up), spec("trailing"), O).resultPct).toBeGreaterThan(0);
    expect(runEvil(hours(900, down), spec("trailing"), O).resultPct).toBeGreaterThan(0);
  });
  test("a martingale short takes small profits in a range and is stopped by a strong rise", () => {
    const a = runEvil(hours(700, wave), spec("dca-short"), O); expect(a.trades).toBeGreaterThan(3); expect(a.wins).toBeGreaterThan(0); expect(a.stops).toBe(0);
    const b = runEvil(hours(900, up), spec("dca-short"), O); expect(b.stops).toBeGreaterThanOrEqual(1);
  });
  test("twice the grant: a badge, everything closed, back to 250", () => {
    const r = runEvil(hours(1500, i => (i < 340 ? wave(i) : 100 * 1.006 ** (i - 340))), spec("trailing"), O);
    expect(r.badges).toBeGreaterThanOrEqual(1); expect(r.equity).toBeLessThan(500); expect(r.resultPct).toBeGreaterThan(100);
  });
  test("weekend pause: nothing open while paused", () => {
    const paused = (end: number) => new Date(end).getUTCDay() === 6;
    const r = runEvil(hours(700, wave), spec("neutral-grid"), { ...O, paused });
    const sat = r.curve.filter(c => new Date(c.d + ":00Z").getUTCDay() === 6 && new Date(c.d + ":00Z").getUTCHours() > 1);
    expect(sat.length).toBeGreaterThan(0); expect(new Set(sat.slice(0, 20).map(c => c.equity)).size).toBe(1);
  });
  test("funding: a short is paid when funding is positive", () => {
    const a = runEvil(hours(500, wave), spec("dca-short"), { ...O, fundingPerHour: () => 0.0001 }); expect(a.fundingPaid).toBeLessThan(0);
  });
  test("the same bars give the same result (PC and GitHub agree)", () => {
    const bars = hours(700, wave); expect(runEvil(bars, spec("dca-short"), O)).toEqual(runEvil(bars, spec("dca-short"), O));
  });
  test("the market: the participant's most traded, else the first chart", () => {
    expect(evilMarket([{ symbol: "BTC@1h", exitDate: "2026-11-20" }, { symbol: "ETH@15m", exitDate: "2026-11-21" }, { symbol: "BTC@5m", exitDate: "2026-11-19" }], [], "X")).toBe("BTC");
    expect(evilMarket([], ["NVDA@1h"], "X")).toBe("NVDA"); expect(evilMarket([], [], "X")).toBe("X");
  });
});

import { thoughtOf, tauntOf, CHARACTER } from "../src/bot/voice";
describe("voices", () => {
  const base = { id: "stocks-bear", name: "Lucas", week: "2026-11-23", trades: 3, wins: 3, pnl: 8.21, returnPct: 5.7, rank: 1, of: 4, leader: "Lucas", equity: 264, grant: 250, minTrades: 5, badges: 0, streak: 0,
    best: { sym: "AMD", pnl: 4.87 }, worst: null, evil: null, resultPct: 5.7, stopped: false, weekend: false };
  test("every seat has a character; a thought uses the bot's own numbers and stays the same all week", () => {
    expect(Object.keys(CHARACTER).sort()).toEqual(["crypto-bear", "crypto-bull", "stocks-bear", "stocks-bull"]);
    const t = thoughtOf(base); expect(t).toContain("$8.21"); expect(t).toContain("AMD"); expect(t).toContain("2 more closed trades"); expect(thoughtOf(base)).toBe(t);
  });
  test("the most urgent worry comes first: the stop line beats the strike rule", () => {
    expect(thoughtOf({ ...base, equity: 150, pnl: -60, wins: 0 })).toContain("above the stop line");
    expect(thoughtOf({ ...base, stopped: true })).toMatch(/stop line|end of my run/);
  });
  test("the evil twin taunts from its own numbers", () => {
    expect(tauntOf({ kind: "neutral-grid", resultPct: 10, trades: 9, stops: 0, badges: 0 }, { name: "Nico", resultPct: 2 }, "s")).toMatch(/Nico/);
    expect(tauntOf({ kind: "dca-short", resultPct: 0, trades: 0, stops: 0, badges: 0 }, { name: "Valeria", resultPct: 2 }, "s")).toMatch(/Valeria/);
    expect(tauntOf({ kind: "dca-short", resultPct: -20, trades: 9, stops: 1, badges: 0 }, { name: "Valeria", resultPct: 2 }, "s")).toMatch(/stop line|Stopped/);
  });
});
