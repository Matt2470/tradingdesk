// Price bars and live prices: fetch, parse, cache. With src/data/lighter.ts, the only code that talks to market-data servers.
// Bars: Yahoo Finance chart endpoint for every symbol and timeframe; Binance klines as a fallback for daily crypto.
// Stocks and gold listed on Lighter: Lighter's 15m and 1h candles (around the clock) replace Yahoo's intraday bars once
// enough are saved (LIGHTER_MIN_BARS); 30m and 4h are built from them on UTC blocks. Daily bars stay Yahoo's (5 years of history).
// The 4-hour bars are built here from the 1-hour bars (Yahoo has no 4-hour interval).
// Live prices: once a minute, Binance ticker for crypto, Lighter's market list for stocks and gold it lists,
// and Yahoo 1-minute charts for a small set of the other stocks.
import { join } from "node:path";
import { aggregateUtc, getCandles, lighterFile, LIGHTER_API, LIGHTER_KEEP_DAYS, LIGHTER_RES_MS, mergeBars, pace, parseMarkets, type LighterRes, type LighterSnapshot } from "./lighter";
import { P, readJson, writeJson, settings, lighterCryptoList, type Sym, type AssetClass } from "../config";
import type { Bar } from "../core/strategies";

export type Timeframe = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d";
/** Timeframes on the screens (Today, Strategies). */
export const TIMEFRAMES: Timeframe[] = ["15m", "30m", "1h", "4h", "1d"];
/** Scalping timeframes: competition bots only, Lighter candles only, never on the screens' tests. */
export const SCALP_TFS: ("1m" | "5m")[] = ["1m", "5m"];
export const TF_MINUTES: Record<Timeframe, number> = { "1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240, "1d": 1440 };
/** Yahoo interval and the longest history it serves for it. 4h is built from 1h; 1d uses settings.historyRange. */
const YAHOO: Record<"15m" | "30m" | "1h", [string, string]> = { "15m": ["15m", "60d"], "30m": ["30m", "60d"], "1h": ["60m", "730d"] };

export interface Meta { gmtoffset: number; regularEnd: number | null; price: number | null; currency: string | null }
export interface Cached { symbol: string; source: string; fetchedAt: string; meta: Meta; bars: Bar[]; /** "utc": the last bars come from Lighter, which trades around the clock, so bars close on UTC blocks and daily bars at midnight UTC. */ clock?: "utc" }
export interface FetchStatus { symbol: string; tf?: Timeframe; ok: boolean; source?: string; bars?: number; lastBar?: string; error?: string; fetchedAt?: string; cached?: boolean; skipped?: string }

/** Binance market data. GitHub's US runners are refused by api.binance.com, so the workflow sets BINANCE_HOST to the public mirror. */
const BINANCE = /^https:\/\/[a-z0-9.-]+$/.test(process.env.BINANCE_HOST ?? "") ? process.env.BINANCE_HOST! : "https://api.binance.com";
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const minute = (ms: number) => new Date(ms).toISOString().slice(0, 16); // "2026-11-15T07:15", UTC
/** Bar keys: daily "YYYY-MM-DD" (exchange date); intraday "YYYY-MM-DDTHH:MM" (UTC). Old hourly files used "YYYY-MM-DDTHH". */
export const normKey = (d: string) => (d.length === 13 ? d + ":00" : d);
export function barStartMs(d: string): number { return d.length === 10 ? Date.parse(d + "T00:00:00Z") : Date.parse(normKey(d).slice(0, 16) + ":00Z"); }
/** When a bar closes. Daily stock bars are taken to close at 21:00 UTC (16:00 New York in winter). Used only to order bars of different timeframes. */
export function barEndMs(d: string, tf: Timeframe, cls: AssetClass): number {
  const s = barStartMs(d);
  if (tf !== "1d") return s + TF_MINUTES[tf] * 60000;
  return s + (cls === "crypto" ? 24 : 21) * 3600000;
}

/** Parse a Yahoo v8 chart response. Rows with a missing price are dropped. Throws with a clear message on an unexpected shape. */
export function parseYahooChart(json: any, tf: Timeframe = "1d"): { meta: Meta; bars: Bar[] } {
  const r = json?.chart?.result?.[0];
  if (!r) throw new Error("Yahoo: " + (json?.chart?.error?.description ?? "no result in response"));
  const ts: number[] = r.timestamp ?? []; const q = r.indicators?.quote?.[0];
  if (!q || !ts.length) throw new Error("Yahoo: response has no price rows");
  const off = r.meta?.gmtoffset ?? 0; const bars: Bar[] = []; const step = TF_MINUTES[tf] * 60; let prevTs = -Infinity;
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i], v = q.volume?.[i] ?? 0;
    if (![o, h, l, c].every(x => typeof x === "number" && isFinite(x) && x > 0)) continue;
    if (tf === "1d") {
      const d = day((ts[i] + off) * 1000);
      if (bars.length && bars[bars.length - 1].d === d) bars.pop(); // Yahoo sometimes repeats the live day
      bars.push({ d, o, h, l, c, v });
    } else if (bars.length && ts[i] - prevTs < step) {
      // A row inside the current interval is Yahoo's live update of that bar: merge it, keep the bar's start.
      const b = bars[bars.length - 1]; b.h = Math.max(b.h, h); b.l = Math.min(b.l, l); b.c = c; b.v = Math.max(b.v, v);
    } else { bars.push({ d: minute(ts[i] * 1000), o, h, l, c, v }); prevTs = ts[i]; }
  }
  return { meta: { gmtoffset: off, regularEnd: r.meta?.currentTradingPeriod?.regular?.end ?? null, price: r.meta?.regularMarketPrice ?? null, currency: r.meta?.currency ?? null }, bars };
}
/** Parse Binance klines: [[openTime, open, high, low, close, volume, ...], ...]. */
export function parseBinanceKlines(rows: any): { meta: Meta; bars: Bar[] } {
  if (!Array.isArray(rows) || !rows.length) throw new Error("Binance: " + (rows?.msg ?? "empty response"));
  const bars = rows.map((k: any[]) => ({ d: day(+k[0]), o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
  return { meta: { gmtoffset: 0, regularEnd: null, price: bars[bars.length - 1].c, currency: "USD" }, bars };
}

/**
 * Build 4-hour bars from 1-hour bars. Crypto and gold: fixed 4-hour blocks of the UTC clock (00:00, 04:00, ...).
 * Stocks: each session splits into its first four hourly bars (09:30-13:30 New York) and the rest.
 */
export function aggregate4h(bars: Bar[], cls: AssetClass, gmtoffset: number): Bar[] {
  const out: Bar[] = []; let key = ""; let k = 0; let lastDate = "";
  for (const b of bars) {
    const s = barStartMs(b.d); let bucket: string;
    if (cls === "crypto" || cls === "metal") bucket = minute(Math.floor(s / 14400000) * 14400000);
    else { const ld = day(s + gmtoffset * 1000); if (ld !== lastDate) { lastDate = ld; k = 0; } bucket = ld + "#" + Math.floor(k++ / 4); }
    if (bucket !== key) { key = bucket; out.push({ d: cls === "crypto" || cls === "metal" ? bucket : normKey(b.d), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }); }
    else { const a = out[out.length - 1]; a.h = Math.max(a.h, b.h); a.l = Math.min(a.l, b.l); a.c = b.c; a.v += b.v; }
  }
  return out;
}

/**
 * Split bars into finished bars and the bar still in progress.
 * Signals may only use `complete`. `partial` is used for the live price and for filling orders at its open.
 */
export function splitComplete(bars: Bar[], cls: AssetClass, meta: Meta, nowMs: number, tf: Timeframe = "1d"): { complete: Bar[]; partial: Bar | null } {
  if (!bars.length) return { complete: [], partial: null };
  const last = bars[bars.length - 1]; const nowSec = nowMs / 1000;
  let partial = false;
  if (tf !== "1d") partial = barStartMs(last.d) + TF_MINUTES[tf] * 60000 > nowMs;
  else if (cls === "crypto") partial = last.d === day(nowMs);
  else if (last.d === day((nowSec + meta.gmtoffset) * 1000)) partial = meta.regularEnd == null ? true : nowSec < meta.regularEnd;
  return partial ? { complete: bars.slice(0, -1), partial: last } : { complete: bars, partial: null };
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36", Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  if (res.status === 429) { pausedUntil = Date.now() + 5 * 60000; throw new Error(`HTTP 429 (too many requests) from ${new URL(url).host}; live prices pause for 5 minutes`); }
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
}
const cachePath = (symbol: string, tf: Timeframe = "1d") => join(P.bars, symbol + (tf === "1d" ? "" : "." + tf) + ".json");
const lighterPath = (symbol: string, res: LighterRes) => join(P.bars, `${symbol}.lighter.${res}.json`);
/** Lighter bars are used for a stock or gold timeframe once at least this many base bars (15m or 1h) are saved. Until then Yahoo's are. */
export const LIGHTER_MIN_BARS = 1500;
interface LighterCache extends Cached { marketId: number; backfillDone: boolean }
const usesLighter = (cls: AssetClass) => (cls === "stock" || cls === "metal") && settings().lighter?.prices24h !== false;
/** Lighter's bars for a stock or gold timeframe (15m and 1h as downloaded, 30m and 4h built from them), or null when not ready. */
export function loadLighter(symbol: string, tf: Timeframe): Cached | null {
  if (tf === "1d") return null;
  const res: LighterRes = tf === "15m" || tf === "30m" ? "15m" : "1h";
  const c = readJson<LighterCache | null>(lighterPath(symbol, res), null);
  if (!c || c.bars.length < LIGHTER_MIN_BARS) return null;
  const bars = tf === "30m" ? aggregateUtc(c.bars, 30) : tf === "4h" ? aggregateUtc(c.bars, 240) : c.bars;
  return { ...c, source: `lighter ${tf}${tf === "30m" || tf === "4h" ? ` (built from ${res})` : ""}`, bars, clock: "utc" };
}
/** Crypto that only Lighter lists for us (in config/lighter-crypto.json, not in config/universe.json), while liquid there. */
export function lighterCryptoExtras(uni: Sym[]): Sym[] {
  const snap = readJson<LighterSnapshot | null>(lighterFile(), null); if (!snap) return [];
  const have = new Set(uni.map(s => s.symbol));
  return lighterCryptoList().filter(sym => !have.has(sym) && liquidOnLighter(snap.markets[sym])).map(sym => ({ symbol: sym, yahoo: "", class: "crypto" as const, group: "Lighter crypto", traded: true, lighterOnly: true }));
}
/** Symbols the competition bots may scalp: in the universe, not an index, and liquid on Lighter right now. */
export function lighterScalpable(uni: Sym[]): Sym[] {
  const snap = readJson<LighterSnapshot | null>(lighterFile(), null); if (!snap) return [];
  return uni.filter(s => s.class !== "index" && liquidOnLighter(snap.markets[s.symbol]));
}
/** 1m or 5m bars from Lighter, once at least 1,000 are saved. */
export function loadScalp(symbol: string, tf: "1m" | "5m"): Cached | null {
  const c = readJson<LighterCache | null>(lighterPath(symbol, tf), null); if (!c || c.bars.length < 1000) return null;
  return { ...c, source: `lighter ${tf}`, clock: "utc" };
}
/** Lighter-only crypto needs this many 1h bars (about 17 days) before its charts can be judged. */
export const LIGHTER_ONLY_MIN_BARS = 400;
/** Bars of a Lighter-only crypto: 1h as downloaded, 4h built from it. Other timeframes are not downloaded for these. */
export function loadLighterOnly(symbol: string, tf: Timeframe): Cached | null {
  if (tf !== "1h" && tf !== "4h") return null;
  const c = readJson<LighterCache | null>(lighterPath(symbol, "1h"), null); if (!c || c.bars.length < LIGHTER_ONLY_MIN_BARS) return null;
  return { ...c, source: tf === "4h" ? "lighter 4h (built from 1h)" : "lighter 1h", bars: tf === "4h" ? aggregateUtc(c.bars, 240) : c.bars, clock: "utc" };
}
/** Lighter's bars for a timeframe however few are saved (1d is built from 1h on UTC days), for joining onto Yahoo's history. */
function lighterBarsAnyLength(symbol: string, tf: Timeframe): Bar[] {
  const res: LighterRes = tf === "15m" || tf === "30m" ? "15m" : "1h";
  const b = readJson<LighterCache | null>(lighterPath(symbol, res), null)?.bars ?? [];
  if (!b.length) return [];
  if (tf === "1d") return aggregateUtc(b, 1440).map(x => ({ ...x, d: x.d.slice(0, 10) }));
  return tf === "30m" ? aggregateUtc(b, 30) : tf === "4h" ? aggregateUtc(b, 240) : b;
}
/** A Lighter market is used only if it really trades: a last trade, enough open interest, and a last price near the mark price. */
export function liquidOnLighter(m: { lastPrice: number | null; markPrice: number | null; openInterestUsd: number | null; frozen: boolean; status: string } | undefined, minOiUsd = settings().lighter?.minOpenInterestUsd ?? 25000): boolean {
  if (!m || m.frozen || m.status !== "active" || !m.lastPrice || !(m.lastPrice > 0)) return false;
  if ((m.openInterestUsd ?? 0) < minOiUsd) return false;
  return !m.markPrice || Math.abs(m.lastPrice / m.markPrice - 1) < 0.02;
}
const liquidSymbol = (symbol: string) => liquidOnLighter(readJson<LighterSnapshot | null>(lighterFile(), null)?.markets[symbol]);
/** Cached bars for one timeframe. 4h is built from the 1h file on the fly. Intraday keys are normalised to "YYYY-MM-DDTHH:MM". */
export function loadCached(symbol: string, tf: Timeframe = "1d", cls: AssetClass = "stock"): Cached | null {
  // Stocks and gold trade around the clock on Lighter (perpetual futures). For a liquid Lighter market its candles
  // win: alone for intraday timeframes once enough are saved, otherwise joined after Yahoo's older history.
  const onLighter = usesLighter(cls) && liquidSymbol(symbol);
  if (onLighter && tf !== "1d") { const l = loadLighter(symbol, tf); if (l) return l; }
  const y = loadYahoo(symbol, tf, cls);
  if (!onLighter) return y;
  const L = lighterBarsAnyLength(symbol, tf);
  if (!L.length) return y;
  const from = barStartMs(L[0].d);
  const older = (y?.bars ?? []).filter(b => barStartMs(b.d) < from);
  return { symbol, source: `${older.length ? "yahoo until " + L[0].d.slice(0, 10) + ", then " : ""}lighter ${tf}`, fetchedAt: y?.fetchedAt ?? new Date().toISOString(), meta: { gmtoffset: 0, regularEnd: null, price: L.at(-1)!.c, currency: "USD" }, bars: [...older, ...L], clock: "utc" };
}
function loadYahoo(symbol: string, tf: Timeframe, cls: AssetClass): Cached | null {
  if (tf === "4h") { const h = loadYahoo(symbol, "1h", cls); return h ? { ...h, source: h.source + " (4h built from 1h)", bars: aggregate4h(h.bars, cls, h.meta.gmtoffset) } : null; }
  const c = readJson<Cached | null>(cachePath(symbol, tf), null);
  if (c && tf !== "1d") for (const b of c.bars) b.d = normKey(b.d);
  return c;
}

/** Rough US stock session check, wide enough to cover both daylight-saving offsets. */
export function stocksMaybeOpen(ms: number): boolean { const d = new Date(ms); const wd = d.getUTCDay(), m = d.getUTCHours() * 60 + d.getUTCMinutes(); return wd >= 1 && wd <= 5 && m >= 13 * 60 && m <= 21 * 60 + 30; }
/** Gold futures trade from Sunday evening to Friday evening (UTC). */
export function metalMaybeOpen(ms: number): boolean { const d = new Date(ms); const wd = d.getUTCDay(), hr = d.getUTCHours(); return !(wd === 6 || (wd === 0 && hr < 22) || (wd === 5 && hr >= 22)); }
export const maybeOpen = (cls: AssetClass, ms: number) => (cls === "crypto" ? true : cls === "metal" ? metalMaybeOpen(ms) : stocksMaybeOpen(ms));

async function fetchDaily(s: Sym): Promise<FetchStatus> {
  const errors: string[] = [];
  const tries: [string, () => Promise<{ meta: Meta; bars: Bar[] }>][] = [
    ["yahoo", async () => parseYahooChart(await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s.yahoo)}?range=${settings().historyRange}&interval=1d&includePrePost=false`), "1d")],
  ];
  if (s.binance) tries.push(["binance", async () => parseBinanceKlines(await getJson(`${BINANCE}/api/v3/klines?symbol=${s.binance}&interval=1d&limit=1000`))]);
  for (const [source, run] of tries) {
    try {
      const { meta, bars } = await run();
      if (bars.length < 30) throw new Error(`${source}: only ${bars.length} bars returned`);
      const c: Cached = { symbol: s.symbol, source, fetchedAt: new Date().toISOString(), meta, bars };
      writeJson(cachePath(s.symbol), c);
      return { symbol: s.symbol, tf: "1d", ok: true, source, bars: bars.length, lastBar: bars[bars.length - 1].d, fetchedAt: c.fetchedAt };
    } catch (e) { errors.push(String((e as Error).message ?? e)); }
  }
  const old = loadCached(s.symbol);
  return { symbol: s.symbol, tf: "1d", ok: false, error: errors.join(" | "), cached: !!old, bars: old?.bars.length, lastBar: old?.bars.at(-1)?.d, fetchedAt: old?.fetchedAt, source: old?.source };
}

async function fetchIntraday(s: Sym, tf: "15m" | "30m" | "1h"): Promise<FetchStatus> {
  const [interval, range] = YAHOO[tf];
  try {
    const { meta, bars } = parseYahooChart(await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s.yahoo)}?range=${range}&interval=${interval}&includePrePost=false`), tf);
    if (bars.length < 100) throw new Error(`only ${bars.length} bars returned`);
    const c: Cached = { symbol: s.symbol, source: "yahoo " + tf, fetchedAt: new Date().toISOString(), meta, bars };
    writeJson(cachePath(s.symbol, tf), c);
    return { symbol: s.symbol, tf, ok: true, source: c.source, bars: bars.length, lastBar: bars[bars.length - 1].d, fetchedAt: c.fetchedAt };
  } catch (e) {
    const old = loadCached(s.symbol, tf);
    return { symbol: s.symbol, tf, ok: false, error: String((e as Error).message ?? e), cached: !!old, bars: old?.bars.length, lastBar: old?.bars.at(-1)?.d, fetchedAt: old?.fetchedAt, source: old?.source };
  }
}

/**
 * Download what is due. A timeframe is due when its cache is older than one bar (daily: 30 minutes).
 * Stocks and gold are not downloaded again while their market is closed if the last download was also made while it was closed.
 * Benchmarks (class "index") get daily bars only.
 */
export async function refreshPrices(list: Sym[], force = false, now = Date.now(), extras: Sym[] = [], scalp: Sym[] = [], scalpTfs: ("1m" | "5m")[] = []): Promise<FetchStatus[]> {
  const out: FetchStatus[] = []; const tfs = settings().timeframes.filter(t => t !== "4h") as ("15m" | "30m" | "1h" | "1d")[];
  const ids = lighterIds(list); const budget = { left: LIGHTER_CALLS_PER_REFRESH };
  for (const res of ["15m", "1h"] as LighterRes[]) for (const s of list) if (ids[s.symbol] != null) out.push(await fetchLighter(s, res, ids[s.symbol], now, budget, force));
  // Scalping candles (1m, 5m) for the competition bots, then Lighter-only crypto (1h), with what is left of the request budget.
  const snap = extras.length || scalp.length ? readJson<LighterSnapshot | null>(lighterFile(), null) : null;
  for (const res of scalpTfs) for (const s of scalp) { const m = snap?.markets[s.symbol]; if (m && Number.isFinite(m.marketId)) out.push(await fetchLighter(s, res, m.marketId, now, budget, force)); }
  for (const s of extras) { const m = snap?.markets[s.symbol]; if (m && Number.isFinite(m.marketId)) out.push(await fetchLighter(s, "1h", m.marketId, now, budget, force)); }
  const ordered = [...list.filter(s => s.class === "crypto"), ...list.filter(s => s.class !== "crypto")];
  for (const tf of tfs) for (const s of ordered) {
    if (tf !== "1d" && s.class === "index") continue;
    // Yahoo's intraday bars are only needed while Lighter's are not ready yet.
    if (tf !== "1d" && ids[s.symbol] != null && loadLighter(s.symbol, tf)) continue;
    const old = loadCached(s.symbol, tf); const age = old ? now - Date.parse(old.fetchedAt) : Infinity; const maxAge = (tf === "1d" ? 30 : TF_MINUTES[tf] - 1) * 60000;
    const quiet = old && !maybeOpen(s.class, now) && !maybeOpen(s.class, Date.parse(old.fetchedAt));
    const base = { symbol: s.symbol, tf, ok: true, source: old?.source, bars: old?.bars.length, lastBar: old?.bars.at(-1)?.d, fetchedAt: old?.fetchedAt, cached: true };
    if (!force && old && age < maxAge) { out.push(base); continue; }
    if (!force && quiet) { out.push({ ...base, skipped: "market closed" }); continue; }
    out.push(tf === "1d" ? await fetchDaily(s) : await fetchIntraday(s, tf));
    await new Promise(r => setTimeout(r, 150));
  }
  return out;
}

// ---------------------------------------------------------------- Lighter candles for stocks and gold
/** Lighter calls one refresh may make (about 2.5 minutes at Lighter's pace). The first history download is spread over several refreshes. */
export const LIGHTER_CALLS_PER_REFRESH = 230; // at 1.3 s each, under 5 minutes; Lighter allows 60 a minute
/** Lighter market ids for the stock and gold symbols it lists, from the last read of Lighter's market list. */
export function lighterIds(list: Sym[]): Record<string, number> {
  const snap = readJson<LighterSnapshot | null>(lighterFile(), null); const out: Record<string, number> = {};
  if (!snap) return out;
  for (const s of list) { const m = snap.markets[s.symbol]; if (m && usesLighter(s.class) && Number.isFinite(m.marketId) && liquidOnLighter(m)) out[s.symbol] = m.marketId; }
  return out;
}
async function fetchLighter(s: Sym, res: LighterRes, marketId: number, now: number, budget: { left: number }, force: boolean): Promise<FetchStatus> {
  const path = lighterPath(s.symbol, res); const step = LIGHTER_RES_MS[res];
  const c = readJson<LighterCache | null>(path, null) ?? { symbol: s.symbol, source: "lighter " + res, fetchedAt: new Date(0).toISOString(), meta: { gmtoffset: 0, regularEnd: null, price: null, currency: "USD" }, bars: [], marketId, backfillDone: false };
  const tag = { symbol: s.symbol, tf: res as Timeframe, source: "lighter " + res };
  const keepFrom = now - LIGHTER_KEEP_DAYS[res] * 864e5;
  if (c.marketId !== marketId) { c.bars = []; c.backfillDone = false; c.marketId = marketId; }
  const due = force || now - Date.parse(c.fetchedAt) >= step - 60000 || !c.backfillDone;
  if (!due || budget.left <= 0) return { ...tag, ok: c.bars.length > 0, cached: true, bars: c.bars.length, lastBar: c.bars.at(-1)?.d, fetchedAt: c.fetchedAt, ...(budget.left <= 0 && due ? { skipped: "Lighter request budget used; next check" } : {}) };
  try {
    // Newest bars first (one call covers 500 bars), then older pages until the kept history is there.
    const from = c.bars.length ? Date.parse(c.bars.at(-1)!.d + ":00Z") - 2 * step : now - 499 * step;
    budget.left--; c.bars = mergeBars(c.bars, await getCandles(marketId, res, from / 1000, now / 1000), keepFrom);
    while (!c.backfillDone && budget.left > 0) {
      const first = c.bars.length ? Date.parse(c.bars[0].d + ":00Z") : now;
      if (first <= keepFrom + step) { c.backfillDone = true; break; }
      const end = first / 1000 - 1; budget.left--;
      const page = await getCandles(marketId, res, end - 500 * step / 1000, end);
      if (!page.length) { c.backfillDone = true; break; } // nothing older: the market is younger than the history we keep
      c.bars = mergeBars(c.bars, page, keepFrom);
    }
    c.fetchedAt = new Date(now).toISOString(); c.meta.price = c.bars.at(-1)?.c ?? null; writeJson(path, c);
    return { ...tag, ok: true, bars: c.bars.length, lastBar: c.bars.at(-1)?.d, fetchedAt: c.fetchedAt, ...(c.backfillDone ? {} : { skipped: "history still downloading" }) };
  } catch (e) {
    return { ...tag, ok: false, error: String((e as Error).message ?? e), cached: c.bars.length > 0, bars: c.bars.length, lastBar: c.bars.at(-1)?.d, fetchedAt: c.fetchedAt };
  }
}

// ---------------------------------------------------------------- live prices
export interface Live { price: number; prevClose: number | null; changePct: number | null; at: string; source: string; changeLabel: "today" | "24 h" }
let pausedUntil = 0; let rotation = 0;
const livePath = () => join(P.derived, "live.json");
export const loadLive = () => readJson<{ at: string | null; prices: Record<string, Live>; note?: string }>(livePath(), { at: null, prices: {} });

/** Parse Binance /api/v3/ticker/24hr for several symbols. */
export function parseBinanceTickers(rows: any): Record<string, { price: number; changePct: number; prevClose: number }> {
  if (!Array.isArray(rows)) throw new Error("Binance: " + (rows?.msg ?? "unexpected ticker response"));
  return Object.fromEntries(rows.map((r: any) => [r.symbol, { price: +r.lastPrice, changePct: +r.priceChangePercent, prevClose: +r.openPrice }]));
}
/** Latest price from a Yahoo 1-minute chart: meta.regularMarketPrice, compared with the previous session's close. */
export function parseYahooQuote(json: any): { price: number; prevClose: number | null; at: number | null } {
  const m = json?.chart?.result?.[0]?.meta; if (!m || typeof m.regularMarketPrice !== "number") throw new Error("Yahoo: no live price in response");
  return { price: m.regularMarketPrice, prevClose: m.chartPreviousClose ?? m.previousClose ?? null, at: m.regularMarketTime ?? null };
}

/**
 * One live tick (every settings.tickSeconds). Crypto: one Binance request for all coins (Yahoo if Binance fails).
 * Stocks and gold, only while their market may be open: the `watch` symbols (bot positions, orders, signals; at most 10)
 * plus a few others in turn, so every symbol is refreshed every few minutes without hammering Yahoo.
 */
export async function tickPrices(list: Sym[], watch: string[], now = Date.now()): Promise<{ updated: number; errors: string[] }> {
  const live = loadLive(); const errors: string[] = []; let updated = 0; const iso = new Date(now).toISOString();
  if (now < pausedUntil) return { updated, errors: ["paused after a 429 from the price server"] };
  const crypto = list.filter(s => s.class === "crypto");
  if (crypto.length) {
    try {
      const t = parseBinanceTickers(await getJson(`${BINANCE}/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(crypto.filter(s => s.binance).map(s => s.binance)))}`));
      for (const s of crypto) { const x = s.binance ? t[s.binance] : undefined; if (x) { live.prices[s.symbol] = { price: x.price, prevClose: x.prevClose, changePct: x.changePct, at: iso, source: "binance", changeLabel: "24 h" }; updated++; } }
    } catch (e) {
      errors.push(String((e as Error).message));
      for (const s of crypto) await quote(s, "24 h");
    }
  }
  // Stocks and gold that Lighter lists: one request gives every last trade price, around the clock.
  const ids = lighterIds(list); const onLighter = list.filter(s => ids[s.symbol] != null);
  if (onLighter.length) {
    try {
      await pace(); const m = parseMarkets(await (await fetch(LIGHTER_API + "/api/v1/orderBookDetails?filter=perp", { signal: AbortSignal.timeout(15000) })).json());
      for (const s of onLighter) {
        const x = m[s.symbol]; if (!x?.lastPrice) continue;
        // Change over 24 hours, from the saved 15-minute candles (Lighter's own daily change field is not documented).
        const bars = readJson<Cached | null>(lighterPath(s.symbol, "15m"), null)?.bars ?? []; const ago = now - 864e5;
        const ref = [...bars].reverse().find(b => Date.parse(b.d + ":00Z") <= ago)?.c ?? null;
        live.prices[s.symbol] = { price: x.lastPrice, prevClose: ref, changePct: ref ? (x.lastPrice / ref - 1) * 100 : null, at: iso, source: "lighter", changeLabel: "24 h" }; updated++;
      }
    } catch (e) { errors.push("Lighter: " + String((e as Error).message)); }
  }
  const others = list.filter(s => s.class !== "crypto" && ids[s.symbol] == null && maybeOpen(s.class, now));
  const picked = new Set(others.filter(s => watch.includes(s.symbol)).slice(0, 10).map(s => s.symbol));
  for (let k = 0; k < Math.min(6, others.length); k++) picked.add(others[(rotation + k) % others.length].symbol);
  rotation = others.length ? (rotation + 6) % others.length : 0;
  for (const s of others.filter(x => picked.has(x.symbol))) await quote(s, "today");
  writeJson(livePath(), { at: updated ? iso : live.at, prices: live.prices });
  return { updated, errors };
  async function quote(s: Sym, label: Live["changeLabel"]) {
    try {
      const q = parseYahooQuote(await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s.yahoo)}?range=1d&interval=1m&includePrePost=false`));
      live.prices[s.symbol] = { price: q.price, prevClose: q.prevClose, changePct: q.prevClose ? (q.price / q.prevClose - 1) * 100 : null, at: q.at ? new Date(q.at * 1000).toISOString() : iso, source: "yahoo", changeLabel: label }; updated++;
    } catch (e) { errors.push(`${s.symbol}: ${(e as Error).message}`); }
  }
}
