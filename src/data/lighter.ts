// Lighter, READ-ONLY. Public endpoints only: the market list with prices and limits, funding rates, and (if the owner
// gives an account index in settings.lighter.accountIndex) that account's balance and positions. No keys, no signing,
// no orders. Sending orders is a separate, later step that the owner must approve (CLAUDE.md, "Stop and ask").
// Docs: https://docs.lighter.xyz/api (orderBookDetails, funding-rates, account). Lighter names markets by plain ticker
// (NVDA, XAU, BTC), the same names as config/universe.json.
import { join } from "node:path";
import { P, readJson, writeJson, type Settings, type Sym } from "../config";
import type { Bar } from "../core/strategies";

export const LIGHTER_API = "https://mainnet.zklighter.elliot.ai";
export interface LighterMarket {
  symbol: string; marketId: number; status: string; lastPrice: number | null; markPrice: number | null;
  minBase: number | null; minQuote: number | null; sizeDecimals: number | null; priceDecimals: number | null;
  /** Highest leverage the market allows (1 / min initial margin fraction), when Lighter reports it. */
  maxLeverage: number | null; dailyChangePct: number | null; openInterestUsd: number | null; frozen: boolean;
}
export interface LighterAccount { index: number; collateral: number | null; available: number | null; totalValue: number | null; positions: { symbol: string; side: "long" | "short"; size: number; entry: number | null; value: number | null; unrealizedPnl: number | null; liquidationPrice: number | null; fundingPaid: number | null }[] }
export interface LighterSnapshot { at: string; ok: boolean; error?: string; markets: Record<string, LighterMarket>; funding: Record<string, number>; account: LighterAccount | null; accountError?: string }
export const lighterFile = () => join(P.derived, "lighter.json");

const num = (v: unknown): number | null => { const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN; return Number.isFinite(n) ? n : null; };
// Margin fractions come as integers in hundredths of a percent on some markets (e.g. 500 = 5%) and as plain fractions on others.
const lev = (imf: unknown) => { const f = num(imf); if (!f || f <= 0) return null; const frac = f > 1 ? f / 10000 : f; return Math.round(1 / frac); };

export function parseMarkets(json: any): Record<string, LighterMarket> {
  const out: Record<string, LighterMarket> = {};
  for (const m of json?.order_book_details ?? []) {
    if (!m?.symbol || (m.market_type && m.market_type !== "perp")) continue;
    const last = num(m.last_trade_price), chg = num(m.daily_price_change);
    out[String(m.symbol).toUpperCase()] = {
      symbol: String(m.symbol).toUpperCase(), marketId: Number(m.market_id), status: String(m.status ?? "unknown"), lastPrice: last, markPrice: num(m.mark_price),
      minBase: num(m.min_base_amount), minQuote: num(m.min_quote_amount), sizeDecimals: num(m.size_decimals), priceDecimals: num(m.price_decimals),
      maxLeverage: lev(m.min_initial_margin_fraction ?? m.default_initial_margin_fraction),
      // daily_price_change is a percentage on Lighter's own screens; it is shown, never used for decisions.
      dailyChangePct: chg, openInterestUsd: num(m.open_interest_usd), frozen: !!m.is_frozen,
    };
  }
  return out;
}
export function parseFunding(json: any): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of json?.funding_rates ?? []) if (f?.exchange === "lighter" && f.symbol && num(f.rate) != null) out[String(f.symbol).toUpperCase()] = num(f.rate)!;
  return out;
}
export function parseAccount(json: any, index: number): LighterAccount | null {
  const a = (json?.accounts ?? []).find((x: any) => Number(x.account_index ?? x.index) === index) ?? json?.accounts?.[0];
  if (!a) return null;
  return {
    index, collateral: num(a.collateral), available: num(a.available_balance), totalValue: num(a.total_asset_value),
    positions: (a.positions ?? []).filter((p: any) => (num(p.position) ?? 0) !== 0).map((p: any) => ({
      symbol: String(p.symbol ?? p.market_id).toUpperCase(), side: Number(p.sign) < 0 ? "short" : "long", size: Math.abs(num(p.position) ?? 0),
      entry: num(p.avg_entry_price), value: num(p.position_value), unrealizedPnl: num(p.unrealized_pnl), liquidationPrice: num(p.liquidation_price), fundingPaid: num(p.total_funding_paid_out),
    })),
  };
}

async function get(path: string): Promise<any> {
  // every request counts against Lighter's 60-a-minute limit
  const res = await fetch(LIGHTER_API + path, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from Lighter (${path.split("?")[0]})`);
  return res.json();
}
/** One read of Lighter: at most three requests. Failures are recorded, never thrown; the last good markets are kept. */
export async function refreshLighter(st: Settings, now = Date.now()): Promise<LighterSnapshot> {
  const prev = readJson<LighterSnapshot | null>(lighterFile(), null);
  const snap: LighterSnapshot = { at: new Date(now).toISOString(), ok: true, markets: prev?.markets ?? {}, funding: prev?.funding ?? {}, account: null };
  try { await pace(); snap.markets = parseMarkets(await get("/api/v1/orderBookDetails?filter=perp")); }
  catch (e) { snap.ok = false; snap.error = (e as Error).message; }
  try { await pace(); snap.funding = parseFunding(await get("/api/v1/funding-rates")); } catch { /* funding is informative only */ }
  const idx = st.lighter?.accountIndex;
  if (idx != null) {
    try { await pace(); snap.account = parseAccount(await get(`/api/v1/account?by=index&value=${idx}&active_only=true`), idx); if (!snap.account) snap.accountError = `Lighter has no account with index ${idx}.`; }
    catch (e) { snap.accountError = (e as Error).message; }
  }
  writeJson(lighterFile(), snap);
  return snap;
}

/** For each symbol the market bot trades: can it go live on Lighter, and is the planned size above Lighter's minimum? */
export interface Readiness { symbol: string; onLighter: boolean; status: string; price: number | null; minQuote: number | null; ok: boolean; why: string }
export function readiness(snap: LighterSnapshot | null, syms: Sym[], st: Settings): Readiness[] {
  const budget = st.lighter?.budgetUsd ?? 500; const riskUsd = budget * st.bot.riskPctPerTrade / 100;
  return syms.map(s => {
    const m = snap?.markets[s.symbol];
    if (!m) return { symbol: s.symbol, onLighter: false, status: "missing", price: null, minQuote: null, ok: false, why: snap ? "Not listed on Lighter: stays on paper." : "Lighter not read yet." };
    const minQ = m.minQuote ?? (m.minBase != null && m.lastPrice ? m.minBase * m.lastPrice : null);
    const smallest = Math.min(budget * st.bot.maxPositionPct / 100, budget * st.bot.maxLeverage);
    if (m.frozen || (m.status && !["active", "unknown"].includes(m.status))) return { symbol: s.symbol, onLighter: true, status: m.status, price: m.lastPrice, minQuote: minQ, ok: false, why: `Lighter shows this market as ${m.frozen ? "frozen" : m.status}.` };
    if (!(m.lastPrice && m.lastPrice > 0) || (m.openInterestUsd ?? 0) < (st.lighter?.minOpenInterestUsd ?? 25000) || (m.markPrice && m.lastPrice && Math.abs(m.lastPrice / m.markPrice - 1) >= 0.02))
      return { symbol: s.symbol, onLighter: true, status: m.status, price: m.lastPrice, minQuote: minQ, ok: false, why: `Listed, but too thin to trade: ${m.lastPrice ? `open interest $${Math.round(m.openInterestUsd ?? 0).toLocaleString("en-US")}` : "no trades yet"}. Stays on paper, market hours only.` };
    if (minQ != null && minQ > smallest) return { symbol: s.symbol, onLighter: true, status: m.status, price: m.lastPrice, minQuote: minQ, ok: false, why: `Lighter's smallest order ($${minQ.toFixed(0)}) is bigger than the largest position the ${budget} USDC budget allows.` };
    return { symbol: s.symbol, onLighter: true, status: m.status, price: m.lastPrice, minQuote: minQ, ok: true, why: `Ready. Risk per trade would be about $${riskUsd.toFixed(2)}.` };
  });
}

// ---------------------------------------------------------------- candles (stocks and gold around the clock)
// GET /api/v1/candles?market_id&resolution&start_timestamp&end_timestamp&count_back (public). Request times are in
// SECONDS; each candle's `t` comes back in MILLISECONDS (bar start). At most 500 candles per call. Zero values are left
// out of the response. Responses are cached by Lighter per end_timestamp (not start), so paging walks end_timestamp back.
// Sources: Lighter's API reference (candles) and lighterpedia.com's verified endpoint guide, read 2026-11-21.
// Public limit: 60 requests per minute per IP, so every Lighter call here waits for `pace()`.
export type LighterRes = "1m" | "5m" | "15m" | "1h";
export const LIGHTER_RES_MS: Record<LighterRes, number> = { "1m": 60000, "5m": 300000, "15m": 900000, "1h": 3600000 };
/** How much history to keep per resolution. 30m is built from 15m and 4h from 1h, in UTC blocks, like crypto. */
/** 1m and 5m are for the competition bots' scalping only (owner, 2026-11-23): 3 days of 1m (4,320 bars) and 20 days of 5m (5,760 bars). */
export const LIGHTER_KEEP_DAYS: Record<LighterRes, number> = { "1m": 3, "5m": 20, "15m": 60, "1h": 365 };

export function parseCandles(json: any): Bar[] {
  if (!json || (json.code != null && json.code !== 200)) throw new Error(`Lighter candles: ${json?.message ?? "code " + json?.code}`);
  const out: Bar[] = [];
  for (const k of json.c ?? []) {
    const t = Number(k.t); const ms = t > 1e12 ? t : t * 1000;
    const o = num(k.o), h = num(k.h), l = num(k.l), c = num(k.c);
    if (!Number.isFinite(ms) || o == null || h == null || l == null || c == null || o <= 0 || c <= 0) continue; // a missing price is a zero left out
    out.push({ d: new Date(ms).toISOString().slice(0, 16), o, h, l, c, v: num(k.v) ?? 0 });
  }
  return out.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
}
/** Merge new candles into old ones by bar key; the newer copy of a bar wins (the last bar keeps updating until it closes). */
export function mergeBars(old: Bar[], add: Bar[], keepFromMs: number): Bar[] {
  const m = new Map(old.map(b => [b.d, b])); for (const b of add) m.set(b.d, b);
  return [...m.values()].filter(b => Date.parse(b.d + ":00Z") >= keepFromMs).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
}
/** Bars of `minutes` built from shorter bars on UTC blocks (Lighter trades around the clock, so there are no sessions). */
export function aggregateUtc(bars: Bar[], minutes: number): Bar[] {
  const out: Bar[] = []; const w = minutes * 60000; let key = "";
  for (const b of bars) {
    const k = new Date(Math.floor(Date.parse(b.d + ":00Z") / w) * w).toISOString().slice(0, 16);
    if (k !== key) { key = k; out.push({ ...b, d: k }); }
    else { const a = out[out.length - 1]; a.h = Math.max(a.h, b.h); a.l = Math.min(a.l, b.l); a.c = b.c; a.v += b.v; }
  }
  return out;
}

let lastCall = 0;
/** At most one Lighter request every 1.3 s (about 46 a minute, under the 60 a minute public limit). */
export async function pace(gapMs = 1300) { const wait = lastCall + gapMs - Date.now(); if (wait > 0) await new Promise(r => setTimeout(r, wait)); lastCall = Date.now(); }
export async function getCandles(marketId: number, res: LighterRes, startSec: number, endSec: number): Promise<Bar[]> {
  await pace();
  return parseCandles(await get(`/api/v1/candles?market_id=${marketId}&resolution=${res}&start_timestamp=${Math.floor(startSec)}&end_timestamp=${Math.floor(endSec)}&count_back=500`));
}
