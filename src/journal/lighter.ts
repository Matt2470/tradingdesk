// Lighter trade export -> round trips. A round trip runs from flat to flat in one market
// (a direct flip from short to long stays inside the same round trip).
import { parseCsv } from "./csv";

export interface Fill { market: string; side: string; t: number; value: number; size: number; price: number; pnl: number; fee: number; role: string; type: string; id: string }
export interface Trip { market: string; side: "long" | "short"; start: string; end: string; pnl: number; maxNotional: number; holdHours: number; fills: number; liquidated: boolean; addsToLoser: number }
export interface OpenPosition { market: string; qty: number; since: string; avgEntry: number; addsToLoser: number }

const HEAD = "Market,Side,Date,Trade Value,Size,Price,Closed PnL,Fee,Role,Type,Trade ID";
export const isLighterCsv = (text: string) => text.replace(/^﻿/, "").startsWith(HEAD);

export function parseLighter(text: string): Fill[] {
  const rows = parseCsv(text);
  if (rows[0]?.join(",") !== HEAD) throw new Error("Not a Lighter trade export: header is different from the expected one.");
  return rows.slice(1).map(r => ({ market: r[0], side: r[1], t: Date.parse(r[2].replace(" ", "T") + "Z"), value: +r[3], size: +r[4], price: +r[5], pnl: r[6] === "-" ? 0 : +r[6], fee: +r[7], role: r[8], type: r[9], id: r[10] }));
}
const signed = (f: Fill) => (f.side === "Open Long" || f.side === "Close Short" || f.side === "Short > Long" ? f.size : -f.size);

export function roundTrips(fillsIn: Fill[]): { trips: Trip[]; open: OpenPosition[] } {
  const seen = new Set<string>(); const fills = fillsIn.filter(f => !seen.has(f.id) && seen.add(f.id)).sort((a, b) => a.t - b.t || (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  const by = new Map<string, Fill[]>(); for (const f of fills) (by.get(f.market) ?? by.set(f.market, []).get(f.market)!).push(f);
  const trips: Trip[] = []; const open: OpenPosition[] = []; const iso = (t: number) => new Date(t).toISOString();
  for (const [market, list] of by) {
    let pos = 0, start = 0, pnl = 0, maxAbs = 0, maxNot = 0, n = 0, liq = false, side: "long" | "short" = "long", avg = 0, adds = 0, lastAddMin = -1;
    for (const f of list) {
      if (Math.abs(pos) < 1e-9) { pos = 0; start = f.t; pnl = 0; maxAbs = 0; maxNot = 0; n = 0; liq = false; avg = 0; adds = 0; lastAddMin = -1; }
      const q = signed(f); const before = pos; pos += q; pnl += f.pnl - f.fee; n++; if (f.type === "liquidation") liq = true;
      if (before !== 0 && Math.sign(before) === Math.sign(q)) { // adding to an existing position
        const worse = before > 0 ? f.price < avg * 0.9985 : f.price > avg * 1.0015; const minute = Math.floor(f.t / 60000);
        if (worse && minute !== lastAddMin) { adds++; lastAddMin = minute; }
        avg = (avg * Math.abs(before) + f.price * Math.abs(q)) / (Math.abs(before) + Math.abs(q));
      } else if (before === 0 || Math.sign(pos) !== Math.sign(before)) avg = f.price;
      if (Math.abs(pos) > maxAbs) { maxAbs = Math.abs(pos); maxNot = maxAbs * f.price; side = pos > 0 ? "long" : "short"; }
      if (Math.abs(pos) < 1e-7) { trips.push({ market, side, start: iso(start), end: iso(f.t), pnl, maxNotional: maxNot, holdHours: (f.t - start) / 3.6e6, fills: n, liquidated: liq, addsToLoser: adds }); pos = 0; }
    }
    if (Math.abs(pos) > 1e-7) open.push({ market, qty: pos, since: iso(start), avgEntry: avg, addsToLoser: adds });
  }
  return { trips: trips.sort((a, b) => a.end.localeCompare(b.end)), open };
}
