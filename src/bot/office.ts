// The accountant's office (owner, 2026-11-25: "we need to respond to the accountant and he must respond to me").
//   Bots -> accountant: every bot files a weekly report (trades, result, badges, strikes) and the accountant answers it.
//   Accountant -> owner: a daily and a weekly report on the Accountant screen (desk, bank, money at risk, every bot).
//   Owner -> accountant: big decisions wait for the owner's yes or no (hiring a recruit; a bot asking for real money).
// Requests live in data/bot/approvals.json, which is shared with GitHub through bot-data. The owner's answers are kept on
// the PC only (data/owner-answers.json, never published) and merged into the requests on every check, so a pull from
// bot-data can never lose an answer. Nothing here moves money or sends an order.
import { join } from "node:path";
import { DATA, P, readJson, writeJson } from "../config";
import { madridDay, type AccountantEvent } from "./accountant";

export interface Approval { id: string; kind: "hire" | "real-money"; slot: string; at: string; title: string; detail: string; status: "pending" | "yes" | "no"; answeredAt?: string }
export const APPROVALS = () => join(P.bot, "approvals.json");
export const ANSWERS = () => join(DATA, "owner-answers.json");
type Answers = Record<string, { answer: "yes" | "no"; at: string }>;

export const readApprovals = (): Approval[] => readJson<Approval[]>(APPROVALS(), []);
/** Put the owner's answers (PC only) into the shared requests. Returns true when something changed. */
export function mergeAnswers(list: Approval[], answers: Answers = readJson<Answers>(ANSWERS(), {})): boolean {
  let changed = false;
  for (const a of list) { const x = answers[a.id]; if (x && (a.status !== x.answer || a.answeredAt !== x.at)) { a.status = x.answer; a.answeredAt = x.at; changed = true; } }
  return changed;
}
/** The request with this id, created (pending) if it does not exist yet. */
export function ask(list: Approval[], req: Omit<Approval, "status">): Approval {
  const old = list.find(a => a.id === req.id); if (old) return old;
  const a: Approval = { ...req, status: "pending" }; list.push(a); return a;
}
/** The owner's answer from the Accountant screen. Answers can be changed while the decision has not been carried out. */
export function answer(id: string, yes: boolean, now = Date.now()): Approval | null {
  const list = readApprovals(); const a = list.find(x => x.id === id); if (!a) return null;
  const answers = readJson<Answers>(ANSWERS(), {}); answers[id] = { answer: yes ? "yes" : "no", at: new Date(now).toISOString().slice(0, 16) };
  writeJson(ANSWERS(), answers); mergeAnswers(list, answers); writeJson(APPROVALS(), list); return a;
}

// ---- Reports ----
export interface ReportTrade { key: string; side: string; entryDate: string; exitDate: string; pnl: number }
export interface ReportBot { id: string; name: string; hiredAt: string; index: number; daily: Record<string, number>; trades: ReportTrade[]; events: AccountantEvent[];
  equity: number; grant: number; award: number; debt: number; strikes: number; tierName: string; streak: number; badges: number; stopped: unknown }
export interface WeekReport { week: string; live: boolean; trades: number; wins: number; pnl: number; returnPct: number; badges: number; saves: number; strike: boolean; bot: string; accountant: string }

const dayAdd = (d: string, n: number) => new Date(Date.parse(d + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const madridDow = (ms: number) => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", weekday: "short" }).format(new Date(ms)));
/** Monday (Madrid date) of the week a moment falls in. */
export const mondayOf = (ms: number) => madridDay(new Date(ms - madridDow(ms) * 864e5).toISOString().slice(0, 16));
const dayOf = (d: string) => madridDay(d.length === 10 ? d + "T12:00" : d.slice(0, 16));
/** Index at the end of a Madrid day (the last known day on or before it), 100 before the bot started. */
const idxAt = (daily: Record<string, number>, day: string) => { const k = Object.keys(daily).filter(d => d <= day).sort().at(-1); return k ? daily[k] : 100; };
const usd = (x: number) => `${x < 0 ? "-" : ""}$${Math.abs(x).toFixed(2)}`;
const pctTxt = (x: number) => `${x > 0 ? "+" : ""}${x.toFixed(2)}%`;

/** A bot's weekly reports, newest first: what the bot says, and the accountant's answer. */
export function weeklyReports(b: ReportBot, now: number, minTrades: number, weeks = 8): WeekReport[] {
  const out: WeekReport[] = []; const thisMon = mondayOf(now); const firstMon = mondayOf(Date.parse(b.hiredAt.slice(0, 16) + ":00Z") || now);
  for (let mon = thisMon, n = 0; mon >= firstMon && n < weeks; mon = dayAdd(mon, -7), n++) {
    const sun = dayAdd(mon, 6); const live = mon === thisMon;
    const ts = b.trades.filter(t => { const d = dayOf(t.exitDate); return d >= mon && d <= sun; });
    const ev = b.events.filter(e => { const d = dayOf(e.d); return d >= mon && d <= sun; });
    const start = idxAt(b.daily, dayAdd(mon, -1)); const end = live ? b.index : idxAt(b.daily, sun);
    const ret = start > 0 ? (end / start - 1) * 100 : 0; const pnl = ts.reduce((t, x) => t + x.pnl, 0); const wins = ts.filter(t => t.pnl > 0).length;
    const badges = ev.filter(e => e.kind === "milestone").length, saves = ev.filter(e => e.kind === "save").length, strike = ev.some(e => e.kind === "strike");
    const fired = ev.some(e => e.kind === "fired");
    const bot = `${live ? "So far this week" : "This week"} I closed ${ts.length} trade${ts.length === 1 ? "" : "s"}${ts.length ? ` (${wins} won)` : ""}, ${usd(pnl)}, ${pctTxt(ret)} on my index.` +
      (badges ? ` I earned ${badges} badge${badges === 1 ? "" : "s"}.` : "") + (saves ? " The award had to refill my account." : "");
    let acc: string;
    if (fired) acc = "Stopped this week. The seat goes to a recruit when the owner says yes and the bank has the money.";
    else if (strike) acc = `Strike: fewer than ${minTrades} trades closed. Trade more next week; three strikes in a row and you are replaced.`;
    else if (live && ts.length < minTrades) acc = `${minTrades - ts.length} more closed trade${minTrades - ts.length === 1 ? "" : "s"} needed before the weekly check to avoid a strike.`;
    else if (badges) acc = "Well done. The badge is locked in the award; the streak goes on.";
    else if (saves) acc = "Noted. The streak starts again; keep the losses small.";
    else if (ret < 0) acc = "A losing week. Keep the risk per trade as it is and stick to your charts.";
    else acc = "Good. Keep going.";
    out.push({ week: mon, live, trades: ts.length, wins, pnl: +pnl.toFixed(2), returnPct: +ret.toFixed(2), badges, saves, strike, bot, accountant: acc });
  }
  return out;
}

export interface DayReport { day: string; live: boolean; deskPct: number | null; pnl: number; trades: number; wins: number; badges: number; saves: number; fired: number;
  bots: { id: string; name: string; pct: number; pnl: number; trades: number }[]; text: string }
/** The accountant's daily reports to the owner, newest first. */
export function dailyReports(bots: ReportBot[], deskDaily: Record<string, number>, now: number, days = 14): DayReport[] {
  const today = madridDay(new Date(now).toISOString().slice(0, 16)); const out: DayReport[] = [];
  const first = bots.map(b => dayOf(b.hiredAt)).sort()[0] ?? today;
  for (let day = today, n = 0; day >= first && n < days; day = dayAdd(day, -1), n++) {
    const live = day === today;
    const rows = bots.map(b => { const ts = b.trades.filter(t => dayOf(t.exitDate) === day); const s = idxAt(b.daily, dayAdd(day, -1)), e = live ? b.index : idxAt(b.daily, day);
      return { id: b.id, name: b.name, pct: +(s > 0 ? (e / s - 1) * 100 : 0).toFixed(2), pnl: +ts.reduce((t, x) => t + x.pnl, 0).toFixed(2), trades: ts.length, wins: ts.filter(t => t.pnl > 0).length }; });
    const ev = bots.flatMap(b => b.events.filter(e => dayOf(e.d) === day).map(e => ({ ...e, name: b.name })));
    const dk = Object.keys(deskDaily).sort(); const prev = dk.filter(d => d < day).at(-1);
    const deskPct = deskDaily[day] != null && prev ? +((deskDaily[day] / deskDaily[prev] - 1) * 100).toFixed(2) : null;
    const pnl = rows.reduce((t, r) => t + r.pnl, 0), trades = rows.reduce((t, r) => t + r.trades, 0), wins = rows.reduce((t, r) => t + r.wins, 0);
    const badges = ev.filter(e => e.kind === "milestone"), saves = ev.filter(e => e.kind === "save"), fired = ev.filter(e => e.kind === "fired");
    const best = [...rows].sort((a, b) => b.pct - a.pct)[0], worst = [...rows].sort((a, b) => a.pct - b.pct)[0];
    const text = !trades && !badges.length && !saves.length && !fired.length ? (live ? "No trades closed yet today." : "A quiet day: no trades closed.") :
      `${trades} trade${trades === 1 ? "" : "s"} closed (${wins} won), ${usd(pnl)} in all.` + (best && worst && best.id !== worst.id ? ` Best: ${best.name} ${pctTxt(best.pct)}; worst: ${worst.name} ${pctTxt(worst.pct)}.` : "") +
      (badges.length ? ` Badges: ${badges.map(e => e.name).join(", ")}.` : "") + (saves.length ? ` Saved by the award: ${saves.map(e => e.name).join(", ")}.` : "") + (fired.length ? ` Stopped: ${fired.map(e => e.name).join(", ")}.` : "");
    out.push({ day, live, deskPct, pnl: +pnl.toFixed(2), trades, wins, badges: badges.length, saves: saves.length, fired: fired.length, bots: rows.map(({ wins: _w, ...r }) => r), text });
  }
  return out;
}
