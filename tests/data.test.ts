import { test, expect, describe } from "bun:test";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseYahooChart, parseBinanceKlines, splitComplete, aggregate4h, barEndMs, normKey, parseBinanceTickers, parseYahooQuote, stocksMaybeOpen, metalMaybeOpen } from "../src/data/prices";
import { parseLighter, roundTrips } from "../src/journal/lighter";
import { parseTradingView } from "../src/journal/tradingview";
import { buildJournal, checkRules, summarise } from "../src/journal/stats";
import { validateBrief } from "../src/brief";
import { parseCsv } from "../src/journal/csv";
import { ROOT, settings } from "../src/config";

const fx = (f: string) => readFileSync(join(import.meta.dir, "fixtures", f), "utf8");
const T = (s: string) => Date.parse(s) / 1000;

describe("price parsing", () => {
  const yahoo = { chart: { result: [{ meta: { gmtoffset: -18000, regularMarketPrice: 12, currency: "USD", currentTradingPeriod: { regular: { end: T("2026-01-06T21:00:00Z") } } }, timestamp: [T("2026-01-02T14:30:00Z"), T("2026-01-05T14:30:00Z"), T("2026-01-06T14:30:00Z")], indicators: { quote: [{ open: [10, null, 11], high: [11, null, 13], low: [9, null, 10], close: [10.5, null, 12], volume: [100, null, 300] }] } }], error: null } };
  test("Yahoo: dates use the exchange time zone and empty rows are dropped", () => { const { bars, meta } = parseYahooChart(yahoo); expect(bars.map(b => b.d)).toEqual(["2026-01-02", "2026-01-06"]); expect(bars[1]).toMatchObject({ o: 11, h: 13, l: 10, c: 12, v: 300 }); expect(meta.price).toBe(12); });
  test("Yahoo: a clear error on an unexpected response", () => { expect(() => parseYahooChart({ chart: { result: null, error: { description: "No data found" } } })).toThrow("No data found"); expect(() => parseYahooChart({})).toThrow(/Yahoo/); });
  test("Binance klines", () => { const { bars } = parseBinanceKlines([[Date.parse("2026-01-01T00:00:00Z"), "1", "3", "0.5", "2", "10"]]); expect(bars[0]).toEqual({ d: "2026-01-01", o: 1, h: 3, l: 0.5, c: 2, v: 10 }); expect(() => parseBinanceKlines({ msg: "bad symbol" })).toThrow("bad symbol"); });
  test("the day in progress is never treated as finished", () => {
    const { bars, meta } = parseYahooChart(yahoo);
    expect(splitComplete(bars, "stock", meta, Date.parse("2026-01-06T18:00:00Z")).partial?.d).toBe("2026-01-06"); // market still open
    expect(splitComplete(bars, "stock", meta, Date.parse("2026-01-06T21:30:00Z")).partial).toBeNull();             // after the close
    expect(splitComplete(bars, "stock", meta, Date.parse("2026-01-07T09:00:00Z")).complete).toHaveLength(2);       // next morning
    const c = [{ d: "2026-01-05", o: 1, h: 1, l: 1, c: 1, v: 1 }, { d: "2026-01-06", o: 1, h: 1, l: 1, c: 1, v: 1 }];
    expect(splitComplete(c, "crypto", { gmtoffset: 0, regularEnd: null, price: 1, currency: "USD" }, Date.parse("2026-01-06T10:00:00Z")).complete).toHaveLength(1);
    expect(splitComplete(c, "crypto", { gmtoffset: 0, regularEnd: null, price: 1, currency: "USD" }, Date.parse("2026-01-07T00:10:00Z")).complete).toHaveLength(2);
  });
});

describe("hourly bars", () => {
  const y = { chart: { result: [{ meta: { gmtoffset: 0, regularMarketPrice: 3 }, timestamp: [T("2026-01-06T10:00:00Z"), T("2026-01-06T11:00:00Z"), T("2026-01-06T11:42:10Z")], indicators: { quote: [{ open: [1, 2, 2], high: [2, 3, 4], low: [1, 2, 2], close: [2, 3, 3.5], volume: [1, 1, 1] }] } }] } };
  test("intraday keys are UTC minutes and a live row inside the current hour updates that bar", () => { const { bars } = parseYahooChart(y, "1h"); expect(bars.map(b => b.d)).toEqual(["2026-01-06T10:00", "2026-01-06T11:00"]); expect(bars[1]).toMatchObject({ o: 2, h: 4, l: 2, c: 3.5 }); });
  test("the hour in progress is not finished", () => {
    const { bars, meta } = parseYahooChart(y, "1h");
    expect(splitComplete(bars, "crypto", meta, Date.parse("2026-01-06T11:50:00Z"), "1h")).toMatchObject({ partial: { d: "2026-01-06T11:00" } });
    expect(splitComplete(bars, "crypto", meta, Date.parse("2026-01-06T12:01:00Z"), "1h").complete).toHaveLength(2);
  });
});

describe("timeframes", () => {
  const T0 = Date.parse("2026-01-05T00:00:00Z"); const k = (ms: number) => new Date(ms).toISOString().slice(0, 16);
  const hours = (n: number, start = T0) => Array.from({ length: n }, (_, i) => ({ d: k(start + i * 3600000), o: 10 + i, h: 11 + i, l: 9 + i, c: 10.5 + i, v: 1 }));
  test("15-minute bars: the live row merges into its bar and the bar in progress is not finished", () => {
    const y = { chart: { result: [{ meta: { gmtoffset: 0 }, timestamp: [T("2026-01-06T10:00:00Z"), T("2026-01-06T10:15:00Z"), T("2026-01-06T10:22:31Z")], indicators: { quote: [{ open: [1, 2, 2.1], high: [2, 3, 3.4], low: [1, 2, 1.9], close: [2, 2.5, 3.2], volume: [5, 6, 7] }] } }] } };
    const { bars, meta } = parseYahooChart(y, "15m"); expect(bars.map(b => b.d)).toEqual(["2026-01-06T10:00", "2026-01-06T10:15"]); expect(bars[1]).toMatchObject({ o: 2, h: 3.4, l: 1.9, c: 3.2, v: 7 });
    expect(splitComplete(bars, "stock", meta, Date.parse("2026-01-06T10:29:00Z"), "15m").partial?.d).toBe("2026-01-06T10:15");
    expect(splitComplete(bars, "stock", meta, Date.parse("2026-01-06T10:30:00Z"), "15m").partial).toBeNull();
  });
  test("4-hour bars for crypto follow the UTC clock: 00:00, 04:00, 08:00", () => {
    const b = aggregate4h(hours(10, T0 + 2 * 3600000), "crypto", 0);   // 02:00 to 11:00
    expect(b.map(x => x.d)).toEqual(["2026-01-05T00:00", "2026-01-05T04:00", "2026-01-05T08:00"]);
    expect(b[1]).toEqual({ d: "2026-01-05T04:00", o: 12, h: 16, l: 11, c: 15.5, v: 4 });
    expect(b[0].v).toBe(2); expect(b[2].v).toBe(4);
  });
  test("4-hour bars for stocks split each session into its first four hourly bars and the rest", () => {
    const day = (d: string) => ["14:30", "15:30", "16:30", "17:30", "18:30", "19:30", "20:30"].map((t, i) => ({ d: `${d}T${t}`, o: i + 1, h: i + 2, l: i, c: i + 1.5, v: 1 }));
    const b = aggregate4h([...day("2026-01-05"), ...day("2026-01-06")], "stock", -18000);
    expect(b.map(x => x.d)).toEqual(["2026-01-05T14:30", "2026-01-05T18:30", "2026-01-06T14:30", "2026-01-06T18:30"]);
    expect(b[0]).toMatchObject({ o: 1, h: 5, l: 0, c: 4.5, v: 4 }); expect(b[1]).toMatchObject({ o: 5, c: 7.5, v: 3 });
  });
  test("bar close times order different timeframes correctly", () => {
    expect(barEndMs("2026-01-06T10:00", "15m", "crypto")).toBe(Date.parse("2026-01-06T10:15:00Z"));
    expect(barEndMs("2026-01-06T08:00", "4h", "crypto")).toBe(Date.parse("2026-01-06T12:00:00Z"));
    expect(barEndMs("2026-01-06", "1d", "crypto")).toBe(Date.parse("2026-01-07T00:00:00Z"));
    expect(barEndMs("2026-01-06", "1d", "stock")).toBe(Date.parse("2026-01-06T21:00:00Z"));
    expect(normKey("2026-01-06T10")).toBe("2026-01-06T10:00"); expect(normKey("2026-01-06")).toBe("2026-01-06");
  });
  test("live prices: Binance tickers and the Yahoo quote", () => {
    expect(parseBinanceTickers([{ symbol: "BTCUSDT", lastPrice: "100.5", priceChangePercent: "-1.25", openPrice: "101.8" }])).toEqual({ BTCUSDT: { price: 100.5, changePct: -1.25, prevClose: 101.8 } });
    expect(() => parseBinanceTickers({ msg: "Invalid symbol." })).toThrow("Invalid symbol.");
    expect(parseYahooQuote({ chart: { result: [{ meta: { regularMarketPrice: 12.5, chartPreviousClose: 12, regularMarketTime: 1700000000 } }] } })).toEqual({ price: 12.5, prevClose: 12, at: 1700000000 });
    expect(() => parseYahooQuote({ chart: { result: [] } })).toThrow(/no live price/);
  });
  test("market hours: stocks on weekday afternoons UTC, gold from Sunday evening to Friday evening", () => {
    expect(stocksMaybeOpen(Date.parse("2026-01-06T15:00:00Z"))).toBe(true); expect(stocksMaybeOpen(Date.parse("2026-01-06T22:00:00Z"))).toBe(false); expect(stocksMaybeOpen(Date.parse("2026-01-10T15:00:00Z"))).toBe(false);
    expect(metalMaybeOpen(Date.parse("2026-01-11T21:00:00Z"))).toBe(false); expect(metalMaybeOpen(Date.parse("2026-01-11T23:00:00Z"))).toBe(true); expect(metalMaybeOpen(Date.parse("2026-01-09T22:30:00Z"))).toBe(false);
  });
});

describe("journal", () => {
  test("csv parser handles quoted commas", () => { expect(parseCsv('a,b\n1,"x, y"\n')).toEqual([["a", "b"], ["1", "x, y"]]); });
  test("Lighter fills become flat-to-flat round trips", () => {
    const { trips, open } = roundTrips(parseLighter(fx("lighter-small.csv")));
    expect(trips).toHaveLength(3);
    const [eth, btc1, btc2] = [trips.find(t => t.market === "ETH")!, trips.filter(t => t.market === "BTC")[0], trips.filter(t => t.market === "BTC")[1]];
    expect(btc1).toMatchObject({ side: "long", pnl: 10, maxNotional: 200, holdHours: 48, fills: 3, liquidated: false, addsToLoser: 0 });
    expect(eth).toMatchObject({ side: "short", pnl: -46.5, liquidated: true, addsToLoser: 2, fills: 4 }); // fee is subtracted
    expect(btc2).toMatchObject({ pnl: 3, fills: 3, holdHours: 2 });                                        // a flip stays in one round trip
    expect(open).toEqual([{ market: "SOL", qty: 1, since: "2026-01-05T10:00:00.000Z", avgEntry: 50, addsToLoser: 0 }]);
  });
  test("duplicate fills from overlapping exports are counted once", () => { const f = parseLighter(fx("lighter-small.csv")); expect(roundTrips([...f, ...f]).trips).toHaveLength(3); });
  test("a file with another header is rejected with a clear message", () => { expect(() => parseLighter("a,b\n1,2")).toThrow(/Not a Lighter trade export/); });
  test("TradingView balance history: only closed positions are trades", () => {
    const t = parseTradingView(fx("tradingview-small.csv")); expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ symbol: "BITSTAMP:BTCUSD", side: "short", qty: 2, pnl: -4, notional: 200 }); expect(t[1]).toMatchObject({ symbol: "NASDAQ:AMD", side: "long", pnl: 10, retPct: 10 });
  });
  test("risk rules flag the round trips that broke them", () => {
    const { trips } = roundTrips(parseLighter(fx("lighter-small.csv"))); const r = checkRules(trips, { maxHoldHoursLosing: 24, maxNotionalUsd: 250, maxAddsToLoser: 1 }); // the ETH trip lasted exactly 24 h, which is not "longer than"
    expect(r.broke).toEqual({ n: 1, pnl: -46.5 }); expect(r.clean).toEqual({ n: 2, pnl: 13 }); expect(r.byRule.map(b => b.key).sort()).toEqual(["Added to a losing position more than 1 times", "Liquidated by the exchange", "Position larger than $250"]);
  });
  test("summary maths", () => { expect(summarise([10, -5, 5], null, null)).toMatchObject({ trades: 3, pnl: 10, avgWin: 7.5, avgLoss: -5, profitFactor: 3 }); });
  test("buildJournal reads a folder and reports unknown files", () => { const j = buildJournal(settings(), join(import.meta.dir, "fixtures")); expect(j.real.summary.trades).toBe(3); expect(j.paper.summary.trades).toBe(2); expect(j.paper.startBalance).toBe(1004); expect(j.problems).toEqual([]); });
  // Regression check against the owner's own exports, when they are present on this machine.
  const real = join(ROOT, "data", "imports", "lighter"); const has = existsSync(real) && readdirSync(real).some(f => f.startsWith("lighter-trade-export-2026-11-15"));
  test.skipIf(!has)("the 2026-11-15 exports still give the audited numbers", () => {
    const j = buildJournal(settings(), join(ROOT, "data", "imports", "lighter")); expect(j.real.fills).toBe(2123); expect(j.real.summary.trades).toBe(171); expect(j.real.summary.pnl).toBeCloseTo(-1620.01, 2);
  });
});

describe("brief contract", () => {
  const ok = { date: "2026-11-16", generatedAt: "x", marketSummary: "s", items: [{ symbol: "NVDA", type: "news", headline: "h", why: "w", sources: ["https://example.com"] }], earnings: [], fundamentals: {}, strategyOfDay: null };
  test("valid brief passes", () => { expect(validateBrief(ok)).toEqual([]); });
  test("crypto summary and timeframe are optional but checked", () => { expect(validateBrief({ ...ok, cryptoSummary: "c", strategyOfDay: { strategyId: "rsi2_dip", symbols: ["BTC"], timeframe: "4h", reasoning: "r", risks: "x" } })).toEqual([]); expect(validateBrief({ ...ok, strategyOfDay: { strategyId: "rsi2_dip", symbols: ["BTC"], timeframe: "2h", reasoning: "r", risks: "x" } })[0]).toMatch(/timeframe/); expect(validateBrief({ ...ok, cryptoSummary: 5 })[0]).toMatch(/cryptoSummary/); });
  test("an item without a source link is rejected", () => { expect(validateBrief({ ...ok, items: [{ symbol: "NVDA", headline: "h", sources: [] }] })[0]).toMatch(/source link/); expect(validateBrief(null)).toHaveLength(1); });
});
