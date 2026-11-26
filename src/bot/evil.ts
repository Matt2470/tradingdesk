// The evil twins (owner, 2026-11-26): each participant faces a copy of a ready-made bot from Pionex, the exchange known for
// its free bots, with the same money and the same rules, so we can see whether our bots beat the "off the shelf" ideas.
//   Nico     -> neutral futures grid: no position at the start, sells above and buys below on a ladder of 20 lines
//               spread over the last 14 days' range; the ladder moves when the price leaves it (Pionex "Trailing Move").
//   Lucas    -> short futures grid (Pionex's reverse grid on futures): short at the start, shorts more as the price rises
//               and buys back as it falls.
//   Catalina -> trailing buy / trailing sell: buys after a 2% bounce from a low, or sells short after a 2% fall from a
//               high, then closes after a 3% move back from the best price.
//   Valeria  -> martingale (DCA) short: a first short, then up to 5 more, each 1.5 times bigger, every 2% higher; closes
//               everything 1.5% below the average price and starts again.
// Same rules as the participants: a 250 USD grant, at most 3x, a badge at twice the grant (everything closes, back to
// 250), the stop line at half the grant (counted as "would have been stopped", then a fresh 250 so the comparison goes
// on), the weekend pause, hourly funding and the same Lighter costs. Replayed from the participant's hire on hourly
// bars, so the result is the same on the PC and on GitHub. Paper only: an evil twin never sends an order.
import type { Bar } from "../core/strategies";
import { track, accrue, decide, settle, countTrade, type Accountant, type AccountantRules } from "./accountant";

export type EvilKind = "neutral-grid" | "short-grid" | "trailing" | "dca-short";
export const EVIL_NAMES: Record<EvilKind, string> = { "neutral-grid": "Neutral grid", "short-grid": "Short grid (reverse grid)", trailing: "Trailing buy / trailing sell", "dca-short": "Martingale (DCA) short" };
export const EVIL_PLAIN: Record<EvilKind, string> = {
  "neutral-grid": "A ladder of 20 orders over the last 14 days' range: it sells as the price rises and buys as it falls, starting with no position. Pionex's favourite for sideways markets.",
  "short-grid": "A ladder of 20 orders over the last 14 days' range, short from the start: it shorts more as the price rises and buys back as it falls. Pionex's reverse grid, on futures.",
  trailing: "Waits for a 2% bounce from a low to buy, or a 2% fall from a high to sell short, then closes after a 3% move back from the best price. Pionex's trailing buy and trailing sell.",
  "dca-short": "Sells short, then adds 5 bigger shorts (1.5 times each) every 2% higher, and closes everything 1.5% under the average price. Pionex's martingale bot, short.",
};
/** Which evil twin each seat faces. */
export const EVIL_FOR: Record<string, EvilKind> = { "stocks-bull": "neutral-grid", "stocks-bear": "short-grid", "crypto-bull": "trailing", "crypto-bear": "dca-short" };

export interface EvilSpec { kind: EvilKind; sym: string; since: string; recruit: number }
export interface EvilOpts {
  grant: number; leverage: number; costBps: number;
  /** Funding per hour (positive: longs pay) at a bar's end. */ fundingPerHour?: (endMs: number) => number;
  /** True when the bar ending then is in the weekend pause. */ paused?: (endMs: number) => boolean;
  /** A hired evil twin (owner, 2026-11-26: "so I can hire them"): the real accountant runs its books, as for a participant
   *  (badge locks the profit in the award, the award refills at the stop line or the bot is fired, weekly strikes). */
  accountant?: { a: Accountant; rules: AccountantRules };
  rangeBars?: number; grids?: number; rebound?: number; trail?: number; dcaStep?: number; dcaScale?: number; dcaOrders?: number; dcaTp?: number;
}
export interface EvilResult {
  kind: EvilKind; name: string; sym: string; since: string; bars: number; equity: number; resultPct: number; index: number;
  trades: number; wins: number; pnl: number; fundingPaid: number; badges: number; stops: number; worstDropPct: number;
  position: number; positionUsd: number; avgEntry: number; cash: number;
  /** Closed trades (hired twins keep them for their profile and the accountant's reports). */ closed: { symbol: string; side: "long" | "short"; entryDate: string; exitDate: string; entry: number; exit: number; qty: number; pnl: number; reason: string }[];
  /** A hired twin the accountant fired. */ fired: { at: string; reason: string } | null; curve: { d: string; equity: number }[]; notes: { d: string; msg: string }[]; plain: string;
}

const startMs = (d: string) => Date.parse((d.length === 13 ? d + ":00" : d.slice(0, 16)) + ":00Z");

/** Replay one evil twin over hourly bars. `bars` must include up to `rangeBars` bars before `spec.since` for the first ladder. */
export function runEvil(bars: Bar[], spec: EvilSpec, o: EvilOpts): EvilResult {
  const N = o.grids ?? 20, RB = o.rangeBars ?? 336, lev = Math.min(o.leverage, 3), cost = o.costBps / 1e4;
  const rb = o.rebound ?? 0.02, tr = o.trail ?? 0.03, step = o.dcaStep ?? 0.02, scale = o.dcaScale ?? 1.5, orders = o.dcaOrders ?? 5, tp = o.dcaTp ?? 0.015;
  const t0 = startMs(spec.since); const first = bars.findIndex(b => startMs(b.d) >= t0);
  let cash = o.grant, u = 0, avg = 0, index = 100, prevEq = o.grant, peak = 100, worst = 0;
  let trades = 0, wins = 0, pnl = 0, funding = 0, badges = 0, stops = 0;
  const curve: { d: string; equity: number }[] = []; const notes: { d: string; msg: string }[] = [];
  const note = (d: string, msg: string) => { notes.push({ d, msg }); if (notes.length > 60) notes.shift(); };
  const eq = (p: number) => cash + u * p;
  // Open lots, newest last. A closing fill is matched against the newest lots first, so a grid's sell is matched with the
  // buy one line below it (one grid profit), and a martingale's take-profit closes all its lots as one trade.
  let lots: { n: number; x: number; fee: number; d: string }[] = []; let curD = spec.since; let why = "grid";
  const closed: EvilResult["closed"] = []; const A = o.accountant;
  /** Move the position to `target` units at price x. Each fill that closes something counts as one trade. */
  const fill = (target: number, x: number) => {
    const du = target - u; if (Math.abs(du) < 1e-12 || !(x > 0)) return;
    const fee = Math.abs(du) * x * cost; cash -= du * x + fee;
    let left = Math.abs(du);
    if (u !== 0 && Math.sign(du) !== Math.sign(u)) {
      let p = 0; const closing = Math.min(left, Math.abs(u));
      while (left > 1e-12 && lots.length) { const lot = lots[lots.length - 1]; const k = Math.min(lot.n, left); const share = k / lot.n;
        p += (x - lot.x) * k * Math.sign(u) - lot.fee * share; lot.fee -= lot.fee * share; lot.n -= k; left -= k; if (lot.n <= 1e-12) lots.pop(); }
      p -= fee * (closing / Math.abs(du)); trades++; pnl += p; if (p > 0) wins++;
      closed.push({ symbol: `${spec.sym}@1h`, side: u > 0 ? "long" : "short", entryDate: lots[0]?.d ?? curD, exitDate: curD, entry: +avg.toFixed(6), exit: x, qty: closing, pnl: +p.toFixed(4), reason: why });
      if (closed.length > 600) closed.shift();
      if (A) countTrade(A.a, curD, p, true, p);
    }
    if (left > 1e-12) lots.push({ n: left, x, fee: fee * (left / Math.abs(du)), d: curD });
    u = Math.abs(target) < 1e-12 ? 0 : target; if (u === 0) lots = [];
    avg = lots.length ? lots.reduce((t, l) => t + l.n * l.x, 0) / lots.reduce((t, l) => t + l.n, 0) : 0;
  };
  // ---- engine state ----
  let lines: number[] = [], q = 0, lev0 = 0, refLev = 0, built = false; // grids
  let lo = 0, hi = 0, best = 0; // trailing
  let dcaBase = 0, dcaFirst = 0, dcaNext = 0; // martingale: base notional, first entry price, safety orders placed
  // Classic grid: the line last traded has no order; a sell waits one line above and a buy one line below.
  const nearest = (p: number) => Math.max(0, Math.min(N, Math.round((p - lines[0]) / (lines[1] - lines[0]))));
  const target = (lv: number) => (spec.kind === "neutral-grid" ? q * (refLev - lv) : -q * lv);
  const build = (i: number, p: number, d: string) => {
    const win = bars.slice(Math.max(0, i - RB), i + 1); const top = Math.max(...win.map(b => b.h)), bot = Math.min(...win.map(b => b.l));
    const lo2 = Math.min(bot, p * 0.99), hi2 = Math.max(top, p * 1.01); const gap = (hi2 - lo2) / N;
    lines = Array.from({ length: N + 1 }, (_, k) => lo2 + gap * k); const e = eq(p);
    q = spec.kind === "neutral-grid" ? (e * lev / (N / 2)) / p : (e * lev / N) / p;
    lev0 = nearest(p); refLev = lev0; built = true; fill(target(lev0), p);
    note(d, `New ladder ${lo2.toFixed(2)} to ${hi2.toFixed(2)} (${N} lines, ${(gap / p * 100).toFixed(2)}% apart).`);
  };
  const startDca = (p: number) => { dcaBase = eq(p) * lev / Array.from({ length: orders + 1 }, (_, k) => scale ** k).reduce((t, x) => t + x, 0); dcaFirst = p; dcaNext = 1; fill(-dcaBase / p, p); };
  const reset = (d: string, p: number, why: "badge" | "stop") => {
    fill(0, p); built = false; lo = hi = best = p; dcaBase = 0;
    if (why === "badge") { badges++; note(d, `Badge: ${eq(p).toFixed(2)} USD, twice the grant. Back to ${o.grant}.`); }
    else { stops++; note(d, `Would have been stopped: ${eq(p).toFixed(2)} USD, under half the grant. A fresh ${o.grant} to keep comparing.`); }
    index *= eq(p) / prevEq; cash = o.grant; prevEq = o.grant;
  };
  /** One price on the bar's path. Returns false after a stop. */
  const at = (p: number, d: string): boolean => {
    if (spec.kind === "neutral-grid" || spec.kind === "short-grid") {
      if (!built) return true;
      while (lev0 < N && p >= lines[lev0 + 1]) { lev0++; fill(target(lev0), lines[lev0]); }
      while (lev0 > 0 && p <= lines[lev0 - 1]) { lev0--; fill(target(lev0), lines[lev0]); }
    } else if (spec.kind === "trailing") {
      if (u === 0) {
        if (lo > 0 && p >= lo * (1 + rb)) { fill(eq(lo * (1 + rb)) * lev / (lo * (1 + rb)), lo * (1 + rb)); best = p; }
        else if (hi > 0 && p <= hi * (1 - rb)) { fill(-eq(hi * (1 - rb)) * lev / (hi * (1 - rb)), hi * (1 - rb)); best = p; }
        else { lo = lo > 0 ? Math.min(lo, p) : p; hi = Math.max(hi, p); }
      } else if (u > 0) { best = Math.max(best, p); if (p <= best * (1 - tr)) { fill(0, best * (1 - tr)); lo = hi = best * (1 - tr); } }
      else { best = Math.min(best, p); if (p >= best * (1 + tr)) { fill(0, best * (1 + tr)); lo = hi = best * (1 + tr); } }
    } else {
      if (dcaBase === 0) startDca(p);
      while (dcaNext <= orders && p >= dcaFirst * (1 + step * dcaNext)) { const x = dcaFirst * (1 + step * dcaNext); fill(u - dcaBase * scale ** dcaNext / x, x); dcaNext++; }
      if (u < 0 && p <= avg * (1 - tp)) { const x = avg * (1 - tp); fill(0, x); dcaBase = 0; startDca(x); }
    }
    if (eq(p) <= o.grant / 2) { if (A) { book(d, p); return !firedAt; } reset(d, p, "stop"); return false; }
    return true;
  };
  let firedAt: { at: string; reason: string } | null = null;
  /** The accountant looks at the account (hired twins): nothing, a badge, a refill from the award, or the end. */
  const book = (d: string, p: number) => {
    const a = A!.a; let e = eq(p); track(a, d, e); accrue(a, d, A!.rules); const dec = decide(a, e, A!.rules); if (!dec) return;
    why = dec.kind === "milestone" ? "milestone" : "bust"; fill(0, p); why = "grid"; built = false; lo = hi = best = p; dcaBase = 0; e = eq(p); track(a, d, e);
    const final = dec.kind === "milestone" || dec.why === "strikes" ? dec : { kind: a.award >= a.grant - e ? "save" as const : "fired" as const };
    cash = settle(a, d, e, final); const ev = a.events.at(-1)!; note(d, ev.msg);
    if (final.kind === "milestone") badges++; if (ev.kind === "fired") firedAt = { at: d, reason: ev.msg }; else if (final.kind === "save") stops++;
    prevEq = cash;
  };
  let wasPaused = false;
  for (let i = Math.max(first, 0); first >= 0 && i < bars.length; i++) {
    const b = bars[i]; const end = startMs(b.d) + 3600_000; curD = b.d; if (firedAt) break;
    if (o.paused?.(end)) { if (!wasPaused) { if (u !== 0) note(b.d, "Weekend pause: everything closed."); why = "weekend"; fill(0, b.o); why = "grid"; built = false; dcaBase = 0; lo = hi = 0; } wasPaused = true; curve.push({ d: b.d, equity: +eq(b.c).toFixed(2) }); continue; }
    wasPaused = false;
    if ((spec.kind === "neutral-grid" || spec.kind === "short-grid") && !built) build(i, b.o, b.d);
    if (spec.kind === "trailing" && lo === 0) lo = hi = b.o;
    const path = b.c >= b.o ? [b.o, b.l, b.h, b.c] : [b.o, b.h, b.l, b.c];
    for (const p of path) if (!at(p, b.d)) break;
    const f = (o.fundingPerHour?.(end) ?? 0) * u * b.c; cash -= f; funding += f;
    // The ladder follows the price when it leaves the range (Pionex's Trailing Move).
    if ((spec.kind === "neutral-grid" || spec.kind === "short-grid") && built && (b.c > lines[N] || b.c < lines[0])) build(i, b.c, b.d);
    const e = eq(b.c);
    if (A) { if (!firedAt) book(b.d, b.c); index = A.a.index; prevEq = A.a.lastEquity > 0 ? A.a.lastEquity : eq(b.c); }
    else if (e >= o.grant * 2) reset(b.d, b.c, "badge"); else { index *= e / prevEq; prevEq = e; }
    peak = Math.max(peak, index); worst = Math.min(worst, (index / peak - 1) * 100);
    curve.push({ d: b.d, equity: +eq(b.c).toFixed(2) });
  }
  const last = bars.at(-1)?.c ?? 0; const e = eq(last);
  return { kind: spec.kind, name: EVIL_NAMES[spec.kind], sym: spec.sym, since: spec.since, bars: first >= 0 ? bars.length - first : 0, equity: +e.toFixed(2), resultPct: +(index * (prevEq > 0 ? e / prevEq : 1) - 100).toFixed(2), index: +index.toFixed(4),
    trades, wins, pnl: +pnl.toFixed(2), fundingPaid: +funding.toFixed(4), badges, stops, worstDropPct: +worst.toFixed(2), position: u, positionUsd: +(u * last).toFixed(2), avgEntry: avg, cash, closed, fired: firedAt,
    curve: curve.slice(-600), notes: [...notes].reverse(), plain: EVIL_PLAIN[spec.kind] };
}

/** The market an evil twin plays: the one its participant traded most (latest on a tie), else its first chart. */
export function evilMarket(trades: { symbol: string; exitDate: string }[], playbookKeys: string[], fallback: string): string {
  const n = new Map<string, { c: number; last: string }>();
  for (const t of trades) { const s = t.symbol.split("@")[0]; const x = n.get(s) ?? { c: 0, last: "" }; x.c++; if (t.exitDate > x.last) x.last = t.exitDate; n.set(s, x); }
  const top = [...n].sort((a, b) => b[1].c - a[1].c || (a[1].last < b[1].last ? 1 : -1))[0]?.[0];
  return top ?? playbookKeys[0]?.split("@")[0] ?? fallback;
}
