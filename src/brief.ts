// Morning brief: written each morning by a Claude scheduled task into data/briefs/YYYY-MM-DD.json.
// The contract for that file is docs/BRIEF_TASK.md. This module only reads and validates.
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { P, readJson } from "./config";

export interface Brief {
  date: string; generatedAt: string;
  /** Stocks: the last trading session (Friday's on a weekend). */ marketSummary: string;
  /** Crypto: the last 24 hours. Optional in older briefs. */ cryptoSummary?: string;
  items: { symbol: string; type: "news" | "filing" | "earnings" | "macro"; headline: string; why: string; sources: string[] }[];
  earnings: { symbol: string; date: string; when?: string }[];
  fundamentals: Record<string, { revenueGrowthYoYPct?: number | null; netMarginPct?: number | null; peRatio?: number | null; note: string; asOf: string; sources: string[] }>;
  strategyOfDay: { strategyId: string; symbols: string[]; timeframe?: string; reasoning: string; risks: string } | null;
}
export function validateBrief(b: any): string[] {
  const e: string[] = [];
  if (!b || typeof b !== "object") return ["file is not a JSON object"];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date ?? "")) e.push("date must be YYYY-MM-DD");
  if (typeof b.marketSummary !== "string") e.push("marketSummary must be text");
  if (b.cryptoSummary != null && typeof b.cryptoSummary !== "string") e.push("cryptoSummary must be text");
  if (b.strategyOfDay?.timeframe != null && !["15m", "30m", "1h", "4h", "1d"].includes(b.strategyOfDay.timeframe)) e.push("strategyOfDay.timeframe must be one of 15m 30m 1h 4h 1d");
  if (!Array.isArray(b.items)) e.push("items must be a list");
  else b.items.forEach((it: any, i: number) => { if (!it.symbol || !it.headline || !Array.isArray(it.sources) || !it.sources.length) e.push(`items[${i}] needs symbol, headline and at least one source link`); });
  if (!Array.isArray(b.earnings)) e.push("earnings must be a list");
  if (!b.fundamentals || typeof b.fundamentals !== "object") e.push("fundamentals must be an object");
  return e;
}
export function latestBrief(dir = P.briefs): { brief: Brief | null; file: string | null; errors: string[]; ageDays: number | null; available: string[] } {
  if (!existsSync(dir)) return { brief: null, file: null, errors: [], ageDays: null, available: [] };
  const files = readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  if (!files.length) return { brief: null, file: null, errors: [], ageDays: null, available: [] };
  const file = files[files.length - 1]; const b = readJson<any>(join(dir, file), null); const errors = validateBrief(b);
  const ageDays = Math.floor((Date.now() - Date.parse(file.slice(0, 10) + "T00:00:00Z")) / 864e5);
  return { brief: errors.length ? null : (b as Brief), file, errors, ageDays, available: files.slice(-14) };
}
