// The accountant of the bot competition (the owner, 2026-11-23, second version of the rules):
//  - GRANT: every bot trades a grant of `startGrant` (250), lent by the accountant. The loan is its debt.
//  - MILESTONE: when the account reaches twice the grant, the bot closes everything, earns a badge, the profit above
//    the grant goes into its LOCKED AWARD, and it starts again with the same grant.
//  - LOAN: the grant is a loan with NO interest: a debt never grows (owner, 2026-11-23: "the bots can't owe money ...
//    we are not an infinite bank"). The bot repays from its locked award as soon as the award has money.
//  - ACTIVITY: from `graceDays` after hiring, a weekly check: fewer than `minTradesPerWeek` closed trades is a strike,
//    a busy week clears them; `maxStrikes` strikes in a row and the bot is replaced.
//  - BUST LINE: at half the grant the bot closes everything and its streak goes back to 0. If the locked award can
//    refill the account to the grant, it pays and the bot keeps its job (a "save"). If not, the bot is FIRED: it
//    never trades again and a new recruit takes its place (src/pipeline.ts).
//  - TIERS: badges in a row (no save in between): Pro at 4, Master at 8, Experienced trader at 12. A title, once
//    earned, stays. The goal: four Experienced traders.
//  - Monthly winner (Madrid months): most badges earned in the month, ties to the best % return, then fewest saves.
// Money the accountant moves never counts as performance: `index` (starts at 100) moves only with trading.
// Only paper money. Nothing here can send an order.

export type EventKind = "milestone" | "save" | "fired" | "interest" | "repay" | "weekend" | "hired" | "active" | "bonus" | "strike";
export interface AccountantEvent { d: string; kind: EventKind; amount?: number; equity?: number; badges: number; msg: string }
export interface MonthRow { badges: number; saves: number; interest: number; repaid: number; indexStart: number; indexEnd: number; trades: number; wins: number; pnl: number }
export interface Accountant {
  startGrant: number; grant: number;
  badges: number; streak: number; bestStreak: number; saves: number;
  /** Profits locked away at each milestone, minus repayments and saves. */ award: number;
  /** What the bot still owes the accountant (only ever the loan, less what it repaid). */ debt: number;
  repaid: number; /** Always 0 now (interest was dropped on 2026-11-23); kept so older records still read. */ interestPaid: number;
  /** Quiet weeks in a row (fewer closed trades than required). */ strikes?: number;
  /** When replaced: money above the loan handed back to the accountant's bank. */ returned?: number;
  /** When fired: what the money left in the account and the award paid back, and what the accountant lost. */ recovered?: number; writtenOff?: number;
  /** Trades closed since the last weekly check. */ weekTrades?: number;
  /** Prize money the accountant added to the award (monthly winner). */ bonuses?: number;
  hiredAt: string; /** Next weekly activity check (ISO, UTC). */ nextInterestAt: string;
  /** Performance index, 100 at the start; ignores the accountant's money moves. */ index: number;
  /** Account value right after the last check (or the last money move). */ lastEquity: number;
  events: AccountantEvent[]; months: Record<string, MonthRow>;
  /** Index at the end of each Madrid day, for the comparison chart. */ daily: Record<string, number>;
}
export interface AccountantRules { /** Days after hiring before the first weekly check. */ graceDays: number; tiers: number[];
  /** Closed trades a week needs to avoid a strike. */ minTradesPerWeek?: number;
  /** Strikes in a row that get a bot replaced. */ maxStrikes?: number }
export const DEFAULT_RULES: AccountantRules = { graceDays: 7, tiers: [4, 8, 12], minTradesPerWeek: 5, maxStrikes: 3 };
export const TIER_NAMES = ["Rookie", "Pro", "Master", "Experienced trader"];

const WEEK = 7 * 864e5;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16);
const ms = (d: string) => Date.parse(d.length === 10 ? d + "T00:00:00Z" : d.slice(0, 16) + ":00Z");
const money = (x: number) => `$${x.toFixed(2)}`;

export function newAccountant(grant: number, hiredAt: string, rules: AccountantRules = DEFAULT_RULES): Accountant {
  return { startGrant: grant, grant, badges: 0, streak: 0, bestStreak: 0, saves: 0, award: 0, debt: grant, repaid: 0, interestPaid: 0,
    hiredAt, nextInterestAt: iso(ms(hiredAt) + rules.graceDays * 864e5), index: 100, lastEquity: grant, events: [], months: {}, daily: {} };
}
/** Tier from the best streak of badges in a row: 0 Rookie, 1 Pro, 2 Master, 3 Experienced trader. */
export const tierOf = (a: Pick<Accountant, "bestStreak">, rules: AccountantRules = DEFAULT_RULES) => rules.tiers.filter(t => a.bestStreak >= t).length;
export const tierName = (a: Pick<Accountant, "bestStreak">, rules: AccountantRules = DEFAULT_RULES) => TIER_NAMES[tierOf(a, rules)];
/** Badges still needed in the current streak for the next tier, or null at the top. */
export const toNextTier = (a: Pick<Accountant, "bestStreak" | "streak">, rules: AccountantRules = DEFAULT_RULES) => { const next = rules.tiers[tierOf(a, rules)]; return next == null ? null : next - a.streak; };

const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", ...o });
const DAY = fmt({ year: "numeric", month: "2-digit", day: "2-digit" });
/** "2026-11-23T10:15" (UTC) -> "2026-11" in Madrid time. */
export const madridMonth = (d: string) => DAY.format(new Date(ms(d))).slice(0, 7);
export const madridDay = (d: string) => DAY.format(new Date(ms(d)));
const PARTS = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", weekday: "short", hour: "2-digit", hourCycle: "h23" });
/** The weekend pause: from Friday 22:00 to Monday 00:00, Madrid time. No trading, nothing held. */
export function inWeekendPause(t: number): boolean {
  const p = Object.fromEntries(PARTS.formatToParts(new Date(t)).map(x => [x.type, x.value])); const h = Number(p.hour);
  return p.weekday === "Sat" || p.weekday === "Sun" || (p.weekday === "Fri" && h >= 22);
}

export function monthRow(a: Accountant, d: string): MonthRow {
  return a.months[madridMonth(d)] ??= { badges: 0, saves: 0, interest: 0, repaid: 0, indexStart: a.index, indexEnd: a.index, trades: 0, wins: 0, pnl: 0 };
}
/** Count a closed trade (or part of one) in its month. `whole` is the result of the whole trade, all parts together:
 *  a trade is a win when the whole trade made money, not when its last part did. */
export function countTrade(a: Accountant, d: string, pnl: number, last: boolean, whole = pnl) { const r = monthRow(a, d); r.pnl += pnl; if (last) { r.trades++; a.weekTrades = (a.weekTrades ?? 0) + 1; if (whole > 0) r.wins++; } }
function log(a: Accountant, e: AccountantEvent) { a.events.push(e); if (a.events.length > 500) a.events.shift(); }

export type Decision = { kind: "milestone" | "save" | "fired"; why?: "strikes" } | null;
/** What the accountant does at this account value: nothing, a milestone, a save from the award, or firing the bot. */
export function decide(a: Accountant, equity: number, rules: AccountantRules = DEFAULT_RULES): Decision {
  if (rules.maxStrikes && (a.strikes ?? 0) >= rules.maxStrikes) return { kind: "fired", why: "strikes" };
  if (equity >= 2 * a.grant) return { kind: "milestone" };
  if (equity <= a.grant / 2) return a.award >= a.grant - equity ? { kind: "save" } : { kind: "fired" };
  return null;
}

/** Move the index with the bot's own result since the last check. Call before any money move. */
export function track(a: Accountant, d: string, equity: number) {
  const r = monthRow(a, d);
  if (a.lastEquity > 0 && equity > 0) a.index *= equity / a.lastEquity;
  a.lastEquity = equity; r.indexEnd = a.index;
  a.daily[madridDay(d)] = +a.index.toFixed(4);
  const keys = Object.keys(a.daily); if (keys.length > 800) for (const k of keys.sort().slice(0, keys.length - 800)) delete a.daily[k];
}

/** Apply a decision after every position has been closed. Returns the new cash balance (0 when fired). */
export function settle(a: Accountant, d: string, equity: number, dec: NonNullable<Decision>): number {
  const r = monthRow(a, d);
  if (dec.kind === "milestone") {
    const locked = equity - a.grant; a.award += locked; a.badges++; a.streak++; a.bestStreak = Math.max(a.bestStreak, a.streak); r.badges++;
    log(a, { d, kind: "milestone", amount: +locked.toFixed(2), equity: +equity.toFixed(2), badges: a.badges, msg: `Milestone: ${money(equity)} is twice the grant. Badge ${a.badges} (${a.streak} in a row); ${money(locked)} locked in the award; back to ${money(a.grant)}.` });
    repay(a, d); a.lastEquity = a.grant; return a.grant;
  }
  if (dec.kind === "save") {
    const need = a.grant - equity; a.award -= need; a.saves++; a.streak = 0; r.saves++;
    log(a, { d, kind: "save", amount: +need.toFixed(2), equity: +equity.toFixed(2), badges: a.badges, msg: `Bust line: ${money(equity)} is half the grant. The award paid ${money(need)} to refill it to ${money(a.grant)}; the streak starts again at 0.` });
    a.lastEquity = a.grant; return a.grant;
  }
  // Fired: what is left in the account and in the award goes back to the accountant against the loan; the rest is a loss to the accountant.
  // Anything above the loan (a bot replaced for quiet weeks may still hold profits) goes to the accountant's bank too.
  a.streak = 0; const pool = equity + a.award; const back = Math.min(pool, a.debt);
  a.recovered = back; a.repaid += back; monthRow(a, d).repaid += back; a.debt -= back; a.writtenOff = a.debt; a.award = 0; a.debt = 0;
  a.returned = pool - back;
  log(a, { d, kind: "fired", equity: +equity.toFixed(2), amount: +back.toFixed(2), badges: a.badges, msg: `${dec.why === "strikes" ? "Replaced: too many quiet weeks in a row" : `Stopped: ${money(equity)} is half the grant and the award could not refill it`}. ${money(back + a.returned)} went back to the accountant${a.writtenOff > 0.005 ? `; ${money(a.writtenOff)} of the loan is lost` : ""}. A recruit takes this seat${dec.why === "strikes" ? "" : " at the end of the week"}.` });
  a.lastEquity = 0; return 0;
}

/** Repay the loan from the award, as much as the award allows. */
export function repay(a: Accountant, d: string) {
  const pay = Math.min(a.award, a.debt); if (!(pay > 1e-9)) return;
  a.award -= pay; a.debt -= pay; a.repaid += pay; monthRow(a, d).repaid += pay;
  if (a.debt < 1e-9) a.debt = 0; // only float dust; every cent is counted in `repaid`
  if (pay >= 0.005) log(a, { d, kind: "repay", amount: +pay.toFixed(2), badges: a.badges, msg: a.debt === 0 ? `Loan repaid in full (${money(pay)} from the award).` : `Repaid ${money(pay)} of the loan from the award; ${money(a.debt)} still owed.` });
}

/** Weekly activity check (from graceDays after hiring): a week with fewer than minTradesPerWeek closed trades is a strike;
 *  a busy week clears the strikes. The debt never grows. Then repay what the award allows. */
export function accrue(a: Accountant, d: string, rules: AccountantRules = DEFAULT_RULES) {
  const now = ms(d);
  while (now >= ms(a.nextInterestAt)) {
    const n = a.weekTrades ?? 0; a.weekTrades = 0; const need = rules.minTradesPerWeek ?? 0;
    if (n >= need) { if (a.strikes) log(a, { d: a.nextInterestAt, kind: "active", badges: a.badges, msg: `Weekly check: ${n} trades closed. Strikes cleared.` }); a.strikes = 0; }
    else { a.strikes = (a.strikes ?? 0) + 1; log(a, { d: a.nextInterestAt, kind: "strike", badges: a.badges, msg: `Weekly check: only ${n} trade${n === 1 ? "" : "s"} closed (${need} needed). Strike ${a.strikes} of ${rules.maxStrikes ?? "-"}.` }); }
    a.nextInterestAt = iso(ms(a.nextInterestAt) + WEEK);
  }
  repay(a, d);
}

/** The bot's books must balance: cash + award + everything paid to the accountant = grant + profit of every closed trade.
 *  Returns the difference (0 when the books balance; a few cents of rounding at most). */
export function reconcile(a: Accountant, cash: number, closedPnl: number, funding = 0): number { return cash + a.award + a.repaid + (a.returned ?? 0) - a.startGrant - closedPnl + funding - (a.bonuses ?? 0); }
/** The accountant pays a prize into the award (and the award repays the loan first, as always). */
export function addBonus(a: Accountant, d: string, amount: number, why: string) {
  a.award += amount; a.bonuses = (a.bonuses ?? 0) + amount;
  log(a, { d, kind: "bonus", amount, badges: a.badges, msg: `Prize: ${money(amount)} into the award, ${why}.` }); repay(a, d);
}

/** % return in a month, from the index (money moves left out). */
export const monthReturnPct = (r: MonthRow) => (r.indexStart > 0 ? (r.indexEnd / r.indexStart - 1) * 100 : 0);

export interface Standing { id: string; badges: number; returnPct: number; saves: number; trades: number; wins: number; pnl: number; rank: number }
/** Order for a month: most badges, then best % return, then fewest saves. Full ties keep the bots' own order. */
export function standings(rows: { id: string; row?: MonthRow }[]): Standing[] {
  const s = rows.map(({ id, row }) => ({ id, badges: row?.badges ?? 0, returnPct: row ? monthReturnPct(row) : 0, saves: row?.saves ?? 0, trades: row?.trades ?? 0, wins: row?.wins ?? 0, pnl: row?.pnl ?? 0, rank: 0 }))
    .sort((a, b) => b.badges - a.badges || b.returnPct - a.returnPct || a.saves - b.saves);
  s.forEach((x, i) => (x.rank = i + 1));
  return s;
}
