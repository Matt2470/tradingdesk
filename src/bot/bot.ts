// The paper bots: simulated margin accounts that follow the app's own signals with fake money.
// They NEVER send an order anywhere. They only write JSON files under data/bot.
// A bot watches many "markets": one per symbol and timeframe, keyed "SYMBOL@tf" (for example "BTC@15m").
// Invariants (tests/bot.test.ts): append-only trade list; running a step twice on the same data changes nothing;
// signals come from finished bars only and fill at the next bar's open, exactly like the backtester;
// bars of different timeframes are processed in the order they closed; at most one position per symbol;
// total exposure never exceeds bot.maxLeverage times the account value at the moment of entry;
// positions close by the shared exit engine (src/core/exits.ts): stop, take-profits in steps, trailing stop;
// a fall of bot.maxDrawdownPct from the account's peak closes everything and halts the bot until the owner resumes it.
// Accounting: `cash` is the realised balance. Opening a position does not move cash; closing adds its profit or loss.
import { buildCtx, I, strategyById, type Bar, type Strategy } from "../core/strategies";
import { barEndMs, type Timeframe } from "../data/prices";
import type { Settings, AssetClass } from "../config";
import { decide, settle, track, countTrade, accrue, inWeekendPause, madridDay, DEFAULT_RULES, type Accountant } from "./accountant";
import { DEFAULT_EXITS, openLegs, onBar, onClose, nextTarget, nextStop, type Legs } from "../core/exits";

export interface BotPosition { side: "long" | "short"; qty: number; entry: number; entryDate: string; stop: number; target?: number | null; strategyId: string; held: number;
  /** Size at entry; qty shrinks as take-profits fill. */ qty0?: number; /** Profit of the parts already closed. */ realized?: number; /** Funding paid (+) or received (-) so far, and when it was last charged (ms). */ funding?: number; fundingAt?: number; /** Next price where part of it closes at a loss, and its name (SL1, SL2, SL3, rising stop). */ nextStop?: { px: number; name: string }; /** Exit engine state (stop, take-profits filled, trailing). */ legs?: Legs }
export interface BotPending { type: "entry" | "exit"; signalDate: string; strategyId: string; stopDist?: number; stopPrice?: number; reason?: string; /** Entry signals: the signal bar's close and ATR (14), for the slippage cap. */ signalPx?: number; atr?: number }
export interface BotTrade { symbol: string; side: "long" | "short"; strategyId: string; entryDate: string; exitDate: string; entry: number; exit: number; qty: number; pnl: number; retPct: number; reason: string; /** Funding paid over the whole trade (on its last part only); already in cash, not in pnl. */ funding?: number; /** In words: why it closed (ready-made bots write their own). */ explain?: string }
export interface BotState {
  startedAt: string; startEquity: number; cash: number; peak?: number; halted?: { at: string; reason: string } | null;
  positions: Record<string, BotPosition>; pending: Record<string, BotPending>; last: Record<string, string>;
  trades: BotTrade[]; equityCurve: { d: string; equity: number }[]; log: { d: string; msg: string }[];
  /** Heartbeat: when the bot last looked, and what it saw then. */
  checked?: { at: string; markets: number; withStrategy: number; newBars: number; /** "GitHub" or "PC": who ran this check. */ by?: string };
  /** Competition bots only (src/bot/accountant.ts): grant, badges, busts, performance index, monthly ledger. Replaces the circuit breaker. */
  accountant?: Accountant;
  /** Competition bots only: the side this bot trades ("long" = bullish, "short" = bearish, "both" = free to choose). */
  side?: "long" | "short" | "both";
  /** Competition bots only: who this is. A fired bot is replaced by a recruit with a new name. */
  persona?: { name: string; recruit: number; slot: string };
  /** Set when the accountant fired the bot. A fired bot never trades again. */
  fired?: { at: string; reason: string; /** When a recruit may take the seat (stopped bots wait for the end of the week). */ replaceAt?: string } | null;
  /** Competition bots only: the charts and the strategy on each that this bot chose to trade (src/core/select.ts). */
  playbook?: { key: string; id: string; rate?: number }[];
  /** Funding paid (+) or received (-) over the bot's life; already taken from (or added to) cash. */
  fundingPaid?: number;
  /** Last in the month and behind: may trade a few more charts until it catches up. */
  hungry?: boolean;
  /** Close everything over the competition's weekend pause even without an accountant (the random twin). */
  weekends?: boolean;
  /** The random twin: same charts, side, sizing, exits and weekends as its bot, but it enters at random as often as the
   *  bot's strategy did. If the bot cannot beat it, its results are luck. Reset when the bot is replaced. */
  twin?: BotState;
  /** The evil and angel clones (src/bot/genes.ts): grown from this bot, the same charts and strategies, with its dark or
   *  light genes switched on. Paper previews of what the genes would do; reset when the bot is replaced. */
  clones?: { evil?: BotState; angel?: BotState };
  /** Its devils and angels (src/bot/genes.ts): the one alive now and the ones before (liquidated or hired). */
  lineage?: { recruit: number; gen: number; cur?: { kind: "devil" | "angel"; gen: number; name: string; genes: string[]; born: string; why: string; s: BotState; lessons: { d: string; text: string }[]; tuned?: string };
    past: { kind: "devil" | "angel"; gen: number; name: string; genes: string[]; born: string; ended: string; how: "liquidated" | "hired"; resultPct: number; trades: number; id?: string }[] };
  /** The Madrid day of the last moment looked at (the day-end rule on borrowed money). */
  day?: string;
  /** The evil twin it faces (src/bot/evil.ts): a Pionex-style bot replayed on one market from the hire. */ evil?: import("./evil").EvilSpec;
}
export interface MarketView { cls: AssetClass; group?: string; tf?: Timeframe; complete: Bar[]; partial: Bar | null; /** "utc": around-the-clock bars (Lighter): daily bars close at midnight UTC. */ clock?: "utc" }
export interface BotOpts { costBps?: number | ((key: string) => number); now?: number;
  /** Funding per hour for a chart key, as a fraction of the position's value (Lighter: positive = longs pay shorts). */ funding?: (key: string) => number; /** Strategies that are not in the list (the random twin's). */ lookup?: (id: string) => Strategy | undefined;
  /** Why a new entry may not open on this chart and side (the desk's correlation cap), or null. */ blocked?: (key: string, side: "long" | "short") => string | null;
  /** Close every position with this reason and open nothing (the desk's daily loss limit). */ flatten?: string;
  /** Cancel an entry when the open is more than this many ATRs from the signal bar's close (the price ran away). */ maxSlipAtr?: number }
type Px = (key: string) => number | undefined;
const sign = (p: { side: "long" | "short" }) => (p.side === "short" ? -1 : 1);
const findStrategy = strategyById;
/** A number in [0, 1) from a text, always the same for the same text (FNV-1a). */
export function unitHash(text: string): number { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0) / 4294967296; }
/** The random twin's strategy id for one chart: it copies the real strategy's side, stop and warm-up, and enters on a bar
 *  when unitHash(chart and bar) is below `rate` (the real strategy's signals per bar). It has no exit rule of its own. */
export const twinId = (key: string, baseId: string, rate: number) => `random|${key}|${baseId}|${rate.toFixed(6)}`;
export function twinStrategy(id: string): Strategy | undefined {
  const [tag, key, baseId, r] = id.split("|"); if (tag !== "random") return undefined; const base = strategyById(baseId); const rate = Number(r); if (!base || !(rate >= 0)) return undefined;
  return { ...base, id, name: `Random (${base.side === "short" ? "sell" : "buy"}) instead of ${base.name}`, stopPrice: undefined, targetR: undefined, entry: (x, i) => unitHash(`${key}|${x.d[i]}`) < rate, exit: () => false };
}
/** "BTC@15m" -> "BTC". Keys without "@" are whole symbols (older state files and tests). */
export const underlying = (key: string) => key.split("@")[0];
export const tfOf = (key: string): Timeframe => (key.split("@")[1] as Timeframe) ?? "1d";

export const newState = (startEquity: number, today: string): BotState => ({ startedAt: today, startEquity, cash: startEquity, peak: startEquity, halted: null, positions: {}, pending: {}, last: {}, trades: [], equityCurve: [], log: [] });
export function equityOf(s: BotState, px: Px): number { let e = s.cash; for (const [k, p] of Object.entries(s.positions)) e += sign(p) * p.qty * ((px(k) ?? p.entry) - p.entry); return e; }
export function exposureOf(s: BotState, px: Px): number { let e = 0; for (const [k, p] of Object.entries(s.positions)) e += p.qty * (px(k) ?? p.entry); return e; }
/** The owner's manual review: clear the halt and measure the next drawdown from the current account value. */
export function resume(s: BotState, px: Px, when: string): BotState { s.halted = null; s.peak = equityOf(s, px); s.log.push({ d: when, msg: "Bot resumed by the owner." }); return s; }
/** State files written before timeframes existed used plain symbols as keys. Give those keys the timeframe they ran on. */
export function migrate(s: BotState, tf: Timeframe): BotState {
  const fix = <T,>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.includes("@") ? k : `${k}@${tf}`, v]));
  s.positions = fix(s.positions); s.pending = fix(s.pending); s.last = fix(s.last);
  for (const k of Object.keys(s.last)) if (s.last[k].length === 13) s.last[k] += ":00";
  return s;
}

/** `allowed[key]` lists the strategy ids that passed the quality gate for that symbol and timeframe (at most one long and one short). */
export function step(s: BotState, market: Record<string, MarketView>, allowed: Record<string, string[]>, st: Settings, o: BotOpts = {}): BotState {
  if (s.fired) return s;
  const strategyById = (id: string) => o.lookup?.(id) ?? findStrategy(id);
  const rules = st.competition ? { graceDays: st.competition.graceDays, tiers: st.competition.tiers, minTradesPerWeek: st.competition.minTradesPerWeek, maxStrikes: st.competition.maxStrikes } : DEFAULT_RULES;
  const hired = Date.parse(s.startedAt.length === 10 ? s.startedAt + "T00:00:00Z" : s.startedAt.slice(0, 16) + ":00Z") || 0;
  const paused = (t: number) => (!!s.accountant || !!s.weekends) && inWeekendPause(t);
  // Positions are valued at the newest close of the same symbol on any timeframe (a 4h position moves with the 15m bars),
  // so the account value between bars follows the market instead of waiting for the position's own bar to close.
  const lastPx: Record<string, number> = {}; const symPx: Record<string, { t: number; c: number }> = {};
  const seen = (k: string, t: number, c: number) => { lastPx[k] = c; const u = underlying(k); if (!symPx[u] || t >= symPx[u].t) symPx[u] = { t, c }; };
  const px: Px = k => symPx[underlying(k)]?.c ?? lastPx[k]; const plan = st.exits ?? DEFAULT_EXITS;
  // Positions opened before the exit engine existed get its state now, measured from their entry and current stop.
  for (const p of Object.values(s.positions)) if (!p.legs) { p.qty0 = p.qty; p.legs = openLegs(plan, sign(p) as 1 | -1, p.entry, p.stop, strategyById(p.strategyId)?.targetR); if (!(p.legs.risk > 0)) p.legs.risk = Math.abs(p.entry) * 0.01; p.target = nextTarget(p.legs, plan); }
  for (const p of Object.values(s.positions)) if (p.legs) { p.nextStop = nextStop(p.legs, plan); p.target = nextTarget(p.legs, plan); }
  const costOf = (k: string) => (typeof o.costBps === "function" ? o.costBps(k) : o.costBps ?? st.costBps[market[k].cls]) / 1e4;
  const note = (d: string, msg: string) => { s.log.push({ d, msg }); if (s.log.length > 300) s.log.shift(); };
  const label = (k: string) => (k.includes("@") ? `${underlying(k)} ${tfOf(k)}` : k);
  const fillEntry = (k: string, d: string, open: number, p: BotPending, cost: number) => {
    delete s.pending[k]; const strat = strategyById(p.strategyId); if (!strat || s.halted || o.flatten) return;
    const dir = strat.side === "short" ? -1 : 1; const word = dir > 0 ? "buy" : "short sale";
    if (o.maxSlipAtr && p.signalPx && p.atr && p.atr > 0 && Math.abs(open - p.signalPx) > o.maxSlipAtr * p.atr)
      return note(d, `${label(k)}: ${word} cancelled, the price ran away (open ${open.toFixed(2)} is ${(Math.abs(open - p.signalPx) / p.atr).toFixed(2)} ATR from the signal close ${p.signalPx.toFixed(2)}, limit ${o.maxSlipAtr}).`);
    const why = o.blocked?.(k, strat.side); if (why) return note(d, `${label(k)}: ${word} skipped, ${why} (the desk's correlation cap).`);
    const held = Object.keys(s.positions).find(q => underlying(q) === underlying(k));
    if (held) return note(d, `${label(k)}: ${word} skipped, already holding ${underlying(k)} on ${tfOf(held)}.`);
    if (Object.keys(s.positions).length >= st.bot.maxPositions) return note(d, `${label(k)}: ${word} skipped, already holding ${st.bot.maxPositions} positions.`);
    const g = market[k]?.group; const same = Object.entries(s.positions).filter(([q, x]) => x.side === strat.side && g && market[q]?.group === g).length;
    if (same >= st.bot.maxPerGroup) return note(d, `${label(k)}: ${word} skipped, already ${same} ${strat.side} positions in "${g}" (they tend to move together).`);
    const stop = p.stopPrice ?? open - dir * p.stopDist!; const dist = dir * (open - stop);
    if (!(dist > 0)) return note(d, `${label(k)}: ${word} skipped, the open was already beyond the stop.`);
    const eq = equityOf(s, px); const fill = open * (1 + dir * cost);
    const room = st.bot.maxLeverage * eq - exposureOf(s, px);
    const qty = Math.min((eq * st.bot.riskPctPerTrade) / 100 / dist, (eq * st.bot.maxPositionPct) / 100 / fill, room / fill);
    if (!(eq > 0 && qty * fill >= 20)) return note(d, `${label(k)}: ${word} skipped, no room left under the ${st.bot.maxLeverage}:1 exposure limit.`);
    const legs = openLegs(plan, dir as 1 | -1, open, stop, strat.targetR); const target = nextTarget(legs, plan);
    s.positions[k] = { side: strat.side, qty, qty0: qty, entry: fill, entryDate: d, stop, target, strategyId: p.strategyId, held: 0, legs, nextStop: nextStop(legs, plan), funding: 0, fundingAt: Date.parse(d.length === 10 ? d + "T00:00:00Z" : d.slice(0, 16) + ":00Z") };
    note(d, `${label(k)}: ${dir > 0 ? "bought" : "sold short"} ${qty.toFixed(4)} at ${fill.toFixed(2)}, stop ${stop.toFixed(2)}${target ? `, first take-profit ${target.toFixed(2)}` : ""} (${strat.name}).`);
  };
  /** Funding at every full hour a position was open, at its value then (Lighter pays funding hourly). Taken from cash. */
  const payFunding = (t: number) => {
    if (!o.funding) return;
    for (const [k, p] of Object.entries(s.positions)) {
      const from = p.fundingAt ?? t; const hours = Math.floor(t / 3600e3) - Math.floor(from / 3600e3); p.fundingAt = t;
      if (hours <= 0) continue; const rate = o.funding(k); if (!rate) continue;
      const pay = sign(p) * p.qty * (px(k) ?? p.entry) * rate * hours; s.cash -= pay; p.funding = (p.funding ?? 0) + pay; s.fundingPaid = (s.fundingPaid ?? 0) + pay;
    }
  };
  /** Close `qty` units (all that is left when omitted). Every partial close is its own line in the trade list. */
  const closePos = (k: string, d: string, raw: number, reason: string, cost: number, qty?: number) => {
    const p = s.positions[k]; const dir = sign(p); const q = Math.min(qty ?? p.qty, p.qty); const fill = raw * (1 - dir * cost); const pnl = dir * q * (fill - p.entry);
    s.cash += pnl; p.qty -= q; const all = p.qty <= (p.qty0 ?? q) * 1e-6; p.realized = (p.realized ?? 0) + pnl;
    if (all) { delete s.positions[k]; delete s.pending[k]; }
    if (s.accountant) countTrade(s.accountant, d, pnl, all, p.realized - (p.funding ?? 0));
    s.trades.push({ symbol: k, side: p.side, strategyId: p.strategyId, entryDate: p.entryDate, exitDate: d, entry: p.entry, exit: fill, qty: q, pnl, retPct: dir * (fill / p.entry - 1) * 100, reason, ...(all && p.funding ? { funding: +p.funding.toFixed(4) } : {}) });
    note(d, `${label(k)}: ${all ? "closed" : `sold ${q.toFixed(4)} (part)`} at ${fill.toFixed(2)} (${reason}), ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}.`);
  };
  // An entry waiting for the next open is dropped if its strategy is no longer allowed on that chart (e.g. the weekly short list changed).
  for (const [k, pend] of Object.entries(s.pending)) if (pend.type === "entry" && !(allowed[k] ?? []).includes(pend.strategyId)) { delete s.pending[k]; note(pend.signalDate, `${label(k)}: order from ${pend.strategyId} cancelled, that strategy is no longer used on this chart.`); }
  // First sight of a market: start from its latest finished bar so the bot has no invented history.
  const ctx: Record<string, ReturnType<typeof buildCtx>> = {}; const events: { end: number; k: string; i: number }[] = [];
  for (const [k, m] of Object.entries(market)) {
    if (m.complete.length < 260) continue;
    ctx[k] = buildCtx(m.complete); const tf = m.tf ?? tfOf(k);
    if (!s.last[k]) s.last[k] = m.complete[m.complete.length - 2].d;
    for (let i = m.complete.length - 1; i >= 0; i--) {
      const d = m.complete[i].d; if (d <= s.last[k]) { seen(k, barEndMs(d, tf, m.clock === "utc" ? "crypto" : m.cls), m.complete[i].c); break; }
      events.push({ end: barEndMs(d, tf, m.clock === "utc" ? "crypto" : m.cls), k, i });
    }
  }
  events.sort((a, b) => a.end - b.end || (a.k < b.k ? -1 : 1));
  const withStrategy = Object.keys(ctx).filter(k => (allowed[k] ?? []).length).length;
  for (let e = 0; e < events.length; e++) {
    const { k, i } = events[e]; const x = ctx[k]; const d = x.d[i]; const cost = costOf(k);
    // The competition's weekend pause (Friday 22:00 to Monday 00:00, Madrid): close everything, cancel orders, open nothing.
    if (paused(events[e].end)) {
      const open = Object.keys(s.positions);
      for (const q of open) closePos(q, d, lastPx[q] ?? s.positions[q].entry, "weekend", market[q] ? costOf(q) : 0);
      if (open.length || Object.keys(s.pending).length) note(d, `Weekend pause: ${open.length} position${open.length === 1 ? "" : "s"} closed and orders cancelled. Trading starts again on Monday.`);
      s.pending = {}; seen(k, events[e].end, x.c[i]); s.last[k] = d;
      if (e + 1 < events.length && events[e + 1].end === events[e].end) continue;
      const eq = equityOf(s, px); if (s.accountant) { track(s.accountant, d, eq); accrue(s.accountant, d, rules); }
      s.equityCurve.push({ d: new Date(events[e].end).toISOString().slice(0, 16), equity: +eq.toFixed(2) }); if (s.equityCurve.length > 3000) s.equityCurve.splice(0, s.equityCurve.length - 3000);
      continue;
    }
    const pend = s.pending[k];
    if (pend && pend.signalDate < d) { if (pend.type === "entry" && !s.positions[k]) fillEntry(k, d, x.o[i], pend, cost); else if (pend.type === "exit" && s.positions[k]) closePos(k, d, x.o[i], pend.reason ?? "rule", cost); else delete s.pending[k]; }
    const p = s.positions[k];
    if (p) {
      const strat = strategyById(p.strategyId); const dir = sign(p); const L = p.legs!; const q0 = p.qty0 ?? p.qty;
      for (const f of onBar(L, plan, x.o[i], x.h[i], x.l[i])) { closePos(k, d, f.px, f.reason, cost, L.left === 0 ? undefined : f.frac * q0); if (!s.positions[k]) break; }
      if (s.positions[k]) { p.held++; const before = p.stop; onClose(L, plan, x.c[i], I.atr(x, 14)[i]); p.stop = L.stop; p.target = nextTarget(L, plan); p.nextStop = nextStop(L, plan);
        if (p.stop !== before) note(d, `${label(k)}: stop moved to ${p.stop.toFixed(2)}${L.hits ? " (protecting the profit)" : ""}.`);
        if (strat?.exit(x, i, p.held)) s.pending[k] = { type: "exit", signalDate: d, strategyId: p.strategyId, reason: "rule" };
        else if (st.backtest.maxLosingBars > 0 && p.held >= st.backtest.maxLosingBars && L.hits === 0 && dir * (x.c[i] - p.entry) < 0) s.pending[k] = { type: "exit", signalDate: d, strategyId: p.strategyId, reason: "time-stop" };
      }
    } else if (!s.pending[k] && !s.halted && !o.flatten && events[e].end >= hired - 30 * 60e3) { // never act on a bar that closed before the bot was hired
      for (const id of allowed[k] ?? []) {
        const strat = strategyById(id);
        if (strat && i >= strat.warmup && strat.entry(x, i)) { const atr = I.atr(x, 14)[i]; s.pending[k] = { type: "entry", signalDate: d, strategyId: strat.id, stopDist: strat.stopAtr * atr, signalPx: x.c[i], ...(atr > 0 ? { atr } : {}), ...(strat.stopPrice ? { stopPrice: strat.stopPrice(x, i) } : {}) }; break; }
      }
    }
    seen(k, events[e].end, x.c[i]); s.last[k] = d;
    if (e + 1 < events.length && events[e + 1].end === events[e].end) continue; // finish every bar that closed at this moment first
    payFunding(events[e].end);
    // Day-end rule (owner, 2026-11-27): a bot holding more than the money it has (exposure above its account) does not
    // carry it into another day. At the first close of a new Madrid day it takes the profit on its winners (biggest first),
    // then cuts its losers (biggest loss first; "they should cut back the loss too or they will be liquidated"), until what
    // it holds is no more than its account. It may trade again that day.
    const dayNow = madridDay(new Date(events[e].end).toISOString().slice(0, 16));
    if (s.day && dayNow > s.day && Object.keys(s.positions).length && exposureOf(s, px) > 1.02 * equityOf(s, px)) {
      const held = exposureOf(s, px), had = equityOf(s, px);
      const all = Object.entries(s.positions).map(([q, p]) => { const now = px(q) ?? p.entry; return { q, gain: sign(p) * p.qty * (now - p.entry) - p.qty * now * (market[q] ? costOf(q) : 0) }; });
      const order = [...all.filter(w => w.gain > 0).sort((a, b) => b.gain - a.gain), ...all.filter(w => w.gain <= 0).sort((a, b) => a.gain - b.gain)];
      const took: string[] = [];
      for (const w of order) { if (exposureOf(s, px) <= equityOf(s, px)) break; took.push(`${label(w.q)} ${w.gain >= 0 ? "+" : "-"}${Math.abs(w.gain).toFixed(2)}`); closePos(w.q, d, px(w.q) ?? s.positions[w.q].entry, "day-end", market[w.q] ? costOf(w.q) : 0); }
      if (took.length) note(d, `Day-end rule: held ${held.toFixed(0)} USD with an account of ${had.toFixed(0)} USD, more than its own money, so it closed ${took.join(", ")}. It may trade again today.`);
    }
    s.day = dayNow;
    let eq = equityOf(s, px); s.peak = Math.max(s.peak ?? s.startEquity, eq);
    // Competition bots: the accountant checks the milestone (twice the grant) and the bust line (half the grant).
    if (s.accountant) {
      // Decide on what the account would really hold after closing everything (closing costs taken off), not on the marked value.
      const liq = eq - Object.entries(s.positions).reduce((t, [q, p]) => t + p.qty * (px(q) ?? p.entry) * (market[q] ? costOf(q) : 0), 0);
      const a = s.accountant; track(a, d, eq); accrue(a, d, rules); const dec = decide(a, liq, rules);
      if (dec) {
        for (const q of Object.keys(s.positions)) closePos(q, d, lastPx[q] ?? s.positions[q].entry, dec.kind === "milestone" ? "milestone" : "bust", market[q] ? costOf(q) : 0);
        s.pending = {}; eq = equityOf(s, px); track(a, d, eq);
        // Closing costs a little: a save or a firing is decided again on the money actually left.
        const final = dec.kind === "milestone" || dec.why === "strikes" ? dec : { kind: a.award >= a.grant - eq ? "save" as const : "fired" as const };
        s.cash = settle(a, d, eq, final); const ev = a.events.at(-1)!; note(d, ev.msg);
        if (ev.kind === "fired") { s.fired = { at: d, reason: ev.msg }; s.equityCurve.push({ d: new Date(events[e].end).toISOString().slice(0, 16), equity: +eq.toFixed(2) }); break; }
        eq = s.cash; s.peak = eq;
      }
    }
    // Circuit breaker: a fall of maxDrawdownPct from the peak closes everything and stops the bot until the owner reviews it.
    else if (!s.halted && st.bot.maxDrawdownPct > 0 && eq <= s.peak * (1 - st.bot.maxDrawdownPct / 100)) {
      for (const q of Object.keys(s.positions)) closePos(q, d, lastPx[q] ?? s.positions[q].entry, "circuit-breaker", market[q] ? costOf(q) : 0);
      s.pending = {}; eq = equityOf(s, px);
      s.halted = { at: d, reason: `The account fell ${st.bot.maxDrawdownPct}% from its peak of ${s.peak.toFixed(2)}.` }; note(d, `Bot halted: ${s.halted.reason} All positions closed. It stays stopped until you resume it.`);
    }
    s.equityCurve.push({ d: new Date(events[e].end).toISOString().slice(0, 16), equity: +eq.toFixed(2) });
    if (s.equityCurve.length > 3000) s.equityCurve.splice(0, s.equityCurve.length - 3000);
  }
  // The desk's daily loss limit: close everything at the latest prices and cancel every order.
  if (o.flatten && !s.fired) {
    const open = Object.keys(s.positions); const when = new Date(o.now ?? Date.now()).toISOString().slice(0, 16);
    for (const q of open) closePos(q, when, px(q) ?? s.positions[q].entry, o.flatten, market[q] ? costOf(q) : 0);
    if (open.length || Object.keys(s.pending).length) { note(when, `Desk stop: ${open.length} position${open.length === 1 ? "" : "s"} closed and orders cancelled (the desk hit its daily loss limit). Trading starts again tomorrow.`); s.pending = {};
      const eq = equityOf(s, px); if (s.accountant) track(s.accountant, when, eq); s.equityCurve.push({ d: when, equity: +eq.toFixed(2) }); }
  }
  // Orders waiting for "the next open" fill as soon as the current (unfinished) bar exists (never during the weekend pause).
  if (!s.fired && !paused(o.now ?? Date.now())) for (const [k, pend] of Object.entries(s.pending)) {
    const m = market[k]; if (!m?.partial || pend.signalDate >= m.partial.d) continue;
    if (pend.type === "entry" && !s.positions[k]) fillEntry(k, m.partial.d, m.partial.o, pend, costOf(k));
    else if (pend.type === "exit" && s.positions[k]) closePos(k, m.partial.d, m.partial.o, pend.reason ?? "rule", costOf(k));
  }
  s.checked = { at: new Date(o.now ?? Date.now()).toISOString(), markets: Object.keys(ctx).length, withStrategy, newBars: events.length };
  return s;
}
