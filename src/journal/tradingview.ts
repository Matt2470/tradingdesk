// TradingView paper-trading "balance history" export -> closed trades.
// The export language follows the TradingView UI, so columns are read by position, not by name.
import { parseCsv } from "./csv";

export interface PaperTrade { time: string; symbol: string; side: "long" | "short"; qty: number; avgEntry: number; exit: number; pnl: number; notional: number; retPct: number; balanceAfter: number }
const RX = /Close (long|short) position for symbol (\S+) at price ([\d.]+) for ([\d.]+) units\. Position AVG Price was ([\d.]+)/;
export const isTradingViewCsv = (text: string) => RX.test(text);

export function parseTradingView(text: string): PaperTrade[] {
  const out: PaperTrade[] = [];
  for (const r of parseCsv(text).slice(1)) {
    const m = RX.exec(r[5] ?? ""); if (!m) continue; // deposits, resets and other rows are not trades
    const qty = +m[4], avg = +m[5], pnl = +r[3];
    out.push({ time: new Date(r[0].replace(" ", "T") + "Z").toISOString(), symbol: m[2], side: m[1] as "long" | "short", qty, avgEntry: avg, exit: +m[3], pnl, notional: qty * avg, retPct: (pnl / (qty * avg)) * 100, balanceAfter: +r[2] });
  }
  return out.sort((a, b) => a.time.localeCompare(b.time));
}
