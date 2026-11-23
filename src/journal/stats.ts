// Journal: read every export in data/imports, summarise the real and the paper account, and check the risk rules.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { P, type Settings } from "../config";
import { parseLighter, roundTrips, isLighterCsv, type Trip, type Fill } from "./lighter";
import { parseTradingView, isTradingViewCsv, type PaperTrade } from "./tradingview";

export interface Summary { trades: number; pnl: number; winRate: number; avgWin: number; avgLoss: number; profitFactor: number; from: string | null; to: string | null }
export function summarise(pnls: number[], from: string | null, to: string | null): Summary {
  const w = pnls.filter(p => p > 0), l = pnls.filter(p => p <= 0); const sum = (v: number[]) => v.reduce((a, b) => a + b, 0); const gl = -sum(l);
  return { trades: pnls.length, pnl: sum(pnls), winRate: pnls.length ? (w.length / pnls.length) * 100 : 0, avgWin: w.length ? sum(w) / w.length : 0, avgLoss: l.length ? sum(l) / l.length : 0, profitFactor: gl > 0 ? sum(w) / gl : w.length ? 99 : 0, from, to };
}
const bucket = <T,>(items: T[], key: (t: T) => string, pnl: (t: T) => number) => {
  const m = new Map<string, { n: number; pnl: number; wins: number }>();
  for (const t of items) { const k = key(t); const b = m.get(k) ?? { n: 0, pnl: 0, wins: 0 }; b.n++; b.pnl += pnl(t); if (pnl(t) > 0) b.wins++; m.set(k, b); }
  return [...m].map(([k, b]) => ({ key: k, n: b.n, pnl: b.pnl, winRate: (b.wins / b.n) * 100 }));
};
const holdBucket = (h: number) => (h < 0.25 ? "Under 15 min" : h < 1 ? "15 min to 1 h" : h < 6 ? "1 to 6 h" : h < 24 ? "6 to 24 h" : "Over 1 day");
const HOLD_ORDER = ["Under 15 min", "15 min to 1 h", "1 to 6 h", "6 to 24 h", "Over 1 day"];
const weekOf = (iso: string) => { const d = new Date(iso); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };

export interface Breach { rule: string; trip: Trip }
export function checkRules(trips: Trip[], risk: Settings["risk"]) {
  const breaches: Breach[] = [];
  for (const t of trips) {
    if (t.holdHours > risk.maxHoldHoursLosing && t.pnl < 0) breaches.push({ rule: `Held a losing position longer than ${risk.maxHoldHoursLosing} h`, trip: t });
    if (t.maxNotional > risk.maxNotionalUsd) breaches.push({ rule: `Position larger than $${risk.maxNotionalUsd.toLocaleString("en-US")}`, trip: t });
    if (t.addsToLoser > risk.maxAddsToLoser) breaches.push({ rule: `Added to a losing position more than ${risk.maxAddsToLoser} times`, trip: t });
    if (t.liquidated) breaches.push({ rule: "Liquidated by the exchange", trip: t });
  }
  const bad = new Set(breaches.map(b => b.trip)); const clean = trips.filter(t => !bad.has(t));
  const byRule = bucket(breaches, b => b.rule, b => b.trip.pnl);
  return { breaches: breaches.sort((a, b) => a.trip.pnl - b.trip.pnl).slice(0, 40), byRule, broke: { n: bad.size, pnl: [...bad].reduce((a, t) => a + t.pnl, 0) }, clean: { n: clean.length, pnl: clean.reduce((a, t) => a + t.pnl, 0) } };
}

function readAll(dir: string): { name: string; text: string }[] {
  if (!existsSync(dir)) return [];
  const out: { name: string; text: string }[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...readAll(p)); else if (e.name.toLowerCase().endsWith(".csv")) out.push({ name: e.name, text: readFileSync(p, "utf8") });
  }
  return out;
}

export function buildJournal(st: Settings, dir = P.imports) {
  const files = readAll(dir); const fills: Fill[] = []; const paper = new Map<string, PaperTrade>(); const problems: string[] = []; const used: string[] = [];
  for (const f of files) {
    try {
      if (isLighterCsv(f.text)) { fills.push(...parseLighter(f.text)); used.push(f.name); }
      else if (isTradingViewCsv(f.text)) { for (const t of parseTradingView(f.text)) paper.set(t.time + t.symbol + t.pnl, t); used.push(f.name); }
      else problems.push(`${f.name}: not recognised as a Lighter trade export or a TradingView balance history.`);
    } catch (e) { problems.push(`${f.name}: ${(e as Error).message}`); }
  }
  const { trips, open } = roundTrips(fills); const pt = [...paper.values()].sort((a, b) => a.time.localeCompare(b.time));
  let cum = 0; const realCurve = trips.map(t => ({ d: t.end, v: +(cum += t.pnl).toFixed(2) })); cum = 0; const paperCurve = pt.map(t => ({ d: t.time, v: +(cum += t.pnl).toFixed(2) }));
  return {
    files: used, problems,
    real: {
      summary: summarise(trips.map(t => t.pnl), trips[0]?.start ?? null, trips.at(-1)?.end ?? null), fills: fills.length,
      bySide: bucket(trips, t => t.side, t => t.pnl), byMarket: bucket(trips, t => t.market, t => t.pnl).sort((a, b) => a.pnl - b.pnl),
      byHold: bucket(trips, t => holdBucket(t.holdHours), t => t.pnl).sort((a, b) => HOLD_ORDER.indexOf(a.key) - HOLD_ORDER.indexOf(b.key)),
      byWeek: bucket(trips, t => weekOf(t.end), t => t.pnl).sort((a, b) => a.key.localeCompare(b.key)),
      worst: [...trips].sort((a, b) => a.pnl - b.pnl).slice(0, 5), curve: realCurve, open, rules: checkRules(trips, st.risk),
    },
    paper: {
      summary: summarise(pt.map(t => t.pnl), pt[0]?.time ?? null, pt.at(-1)?.time ?? null), startBalance: pt.length ? pt[0].balanceAfter - pt[0].pnl : null, endBalance: pt.at(-1)?.balanceAfter ?? null,
      bySymbol: bucket(pt, t => t.symbol, t => t.pnl).sort((a, b) => b.pnl - a.pnl), bySide: bucket(pt, t => t.side, t => t.pnl), curve: paperCurve,
    },
  };
}
