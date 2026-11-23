// Lighter read-only parsers, on responses written from the documented shapes (docs.lighter.xyz/api). No owner data.
import { describe, test, expect } from "bun:test";
import { parseMarkets, parseFunding, parseAccount, readiness } from "../src/data/lighter";
import { settings } from "../src/config";

const books = { code: 200, order_book_details: [
  { symbol: "NVDA", market_id: 77, market_type: "perp", status: "active", last_trade_price: 189.17, mark_price: 189.2, min_base_amount: "0.01", min_quote_amount: "10", size_decimals: 2, price_decimals: 2, min_initial_margin_fraction: 500, open_interest_usd: 5000000, is_frozen: false },
  { symbol: "XAU", market_id: 92, market_type: "perp", status: "active", last_trade_price: "4060.5", mark_price: "4061", open_interest_usd: 2000000, min_quote_amount: "10" },
  { symbol: "HUGE", market_id: 5, market_type: "perp", status: "active", last_trade_price: 10, open_interest_usd: 900000, min_quote_amount: "5000" },
  { symbol: "OLD", market_id: 6, market_type: "perp", status: "inactive", last_trade_price: 1 },
], spot_order_book_details: [] };

describe("lighter (read-only)", () => {
  test("markets: perps keyed by ticker, numbers parsed from strings, leverage from the margin fraction", () => {
    const m = parseMarkets(books);
    expect(Object.keys(m).sort()).toEqual(["HUGE", "NVDA", "OLD", "XAU"]);
    expect(m.NVDA).toMatchObject({ marketId: 77, lastPrice: 189.17, minQuote: 10, maxLeverage: 20 });
    expect(m.XAU.lastPrice).toBe(4060.5);
  });
  test("funding: only Lighter's own rates", () => {
    expect(parseFunding({ funding_rates: [{ market_id: 77, exchange: "lighter", symbol: "NVDA", rate: 0.0001 }, { market_id: 77, exchange: "binance", symbol: "NVDA", rate: 9 }] })).toEqual({ NVDA: 0.0001 });
  });
  test("account: balances and open positions, sign gives the side", () => {
    const a = parseAccount({ accounts: [{ account_index: 12, collateral: "500", available_balance: "420.5", total_asset_value: "503", positions: [{ symbol: "NVDA", sign: -1, position: "0.5", avg_entry_price: "190", unrealized_pnl: "0.4" }, { symbol: "XAU", sign: 1, position: "0" }] }] }, 12)!;
    expect(a.collateral).toBe(500); expect(a.positions).toHaveLength(1); expect(a.positions[0]).toMatchObject({ symbol: "NVDA", side: "short", size: 0.5, entry: 190 });
  });
  test("readiness: missing, inactive, and too-big minimum orders are not ready", () => {
    const st = settings(); const snap = { at: "x", ok: true, markets: parseMarkets(books), funding: {}, account: null };
    const r = readiness(snap, [{ symbol: "NVDA" }, { symbol: "XAU" }, { symbol: "HUGE" }, { symbol: "OLD" }, { symbol: "NOPE" }] as never, st);
    expect(r.map(x => x.ok)).toEqual([true, true, false, false, false]);
    expect(r[4].why).toContain("Not listed");
  });
  test("settings: live trading cannot be switched on, it is not built", () => { expect(settings().lighter!.live).toBe(false); });
});

describe("lighter candles (stocks and gold around the clock)", () => {
  const { parseCandles, mergeBars, aggregateUtc } = require("../src/data/lighter");
  test("candles: t in milliseconds (or seconds), single-letter keys, zero prices left out are skipped, sorted", () => {
    const b = parseCandles({ code: 200, r: "15m", c: [
      { t: 1795212000000, o: "190.1", h: 191, l: 189.5, c: "190.7", v: 12, V: 2280, i: 9 },
      { t: 1795211100000, o: 189.9, h: 190.4, l: 189.6, c: 190.1, v: 3 },
      { t: 1795212900, o: 190.7, h: 190.9, l: 190.2, c: 190.3 },
      { t: 1795213800000, h: 1, l: 1, c: 1 }] });
    expect(b.map((x: any) => x.d)).toEqual(["2026-11-20T21:45", "2026-11-20T22:00", "2026-11-20T22:15"]);
    expect(b[1]).toEqual({ d: "2026-11-20T22:00", o: 190.1, h: 191, l: 189.5, c: 190.7, v: 12 });
    expect(b[2].v).toBe(0);
    expect(() => parseCandles({ code: 400, message: "invalid resolution" })).toThrow("invalid resolution");
  });
  test("merge: newer copy of a bar wins, old history is trimmed", () => {
    const a = [{ d: "2026-11-20T10:00", o: 1, h: 1, l: 1, c: 1, v: 1 }, { d: "2026-11-20T10:15", o: 1, h: 2, l: 1, c: 2, v: 1 }];
    const m = mergeBars(a, [{ d: "2026-11-20T10:15", o: 1, h: 3, l: 1, c: 3, v: 2 }, { d: "2026-11-20T10:30", o: 3, h: 3, l: 3, c: 3, v: 1 }], Date.parse("2026-11-20T10:10:00Z"));
    expect(m.map((x: any) => [x.d, x.c])).toEqual([["2026-11-20T10:15", 3], ["2026-11-20T10:30", 3]]);
  });
  test("30m and 4h are built on UTC blocks, weekends and nights included", () => {
    const bars = Array.from({ length: 8 }, (_, k) => ({ d: new Date(Date.parse("2026-11-21T22:00:00Z") + k * 3600000).toISOString().slice(0, 16), o: 10 + k, h: 11 + k, l: 9 + k, c: 10.5 + k, v: 1 }));
    const h4 = aggregateUtc(bars, 240);
    expect(h4.map((x: any) => x.d)).toEqual(["2026-11-21T20:00", "2026-11-22T00:00", "2026-11-22T04:00"]);
    expect(h4[1]).toEqual({ d: "2026-11-22T00:00", o: 12, h: 16, l: 11, c: 15.5, v: 4 });
  });
});

describe("which Lighter markets are used", () => {
  const { liquidOnLighter } = require("../src/data/prices");
  const m = (o: object) => ({ lastPrice: 100, markPrice: 100.1, openInterestUsd: 500000, frozen: false, status: "active", ...o });
  test("a market with trades, open interest and a last price near the mark is used", () => expect(liquidOnLighter(m({}), 25000)).toBe(true));
  test("never traded, too little open interest, a stale last price, or not active: not used", () => {
    expect(liquidOnLighter(m({ lastPrice: 0 }), 25000)).toBe(false);
    expect(liquidOnLighter(m({ openInterestUsd: 558 }), 25000)).toBe(false);
    expect(liquidOnLighter(m({ lastPrice: 203, markPrice: 156.75 }), 25000)).toBe(false);
    expect(liquidOnLighter(m({ status: "inactive" }), 25000)).toBe(false);
  });
});
