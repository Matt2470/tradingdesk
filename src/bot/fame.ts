// Era stars, fame and competitive deeds (owner, 2026-11-26: "the stars and achievements should be in their profiles ...
// a better badge earning system, game like"). A layer on top of the rules, never instead of them: badges, tiers, loans,
// strikes and the monthly winner work exactly as before. Everything here is counted from the ledgers, so nothing is stored.
//   Eras are the tiers: I Rookie, II Pro, III Master, IV Experienced trader. An era's stars count once the bot has
//   reached that tier at least once (its best run of badges).
//   Each era has 7 medallions with 3 stars each (21 stars): the main one is badges in a row; the six others are trades
//   closed, winning trades, green days, green weeks, the best single trade and duels won. Each star earns fame.
//   Competitive deeds: firsts and records on the whole desk ("first badge", "biggest trade"); a record can change hands.

export const ERA_NAMES = ["Rookie", "Pro", "Master", "Experienced trader"];
export interface Medallion { id: string; name: string; icon: string; unit: string; value: number; goals: [number, number, number]; stars: number; reward: number; main?: boolean }
export interface Era { level: number; name: string; unlocked: boolean; medallions: Medallion[]; stars: number; fame: number }
export interface Deed { id: string; name: string; text: string; holder: string; d: string; value?: number; fame: number }
export interface FameInput {
  id: string; name: string; badges: number; streak: number; bestStreak: number; tiers: number[];
  trades: { pnl: number; exitDate: string }[]; daily: Record<string, number>; duelsWon: number; weekly: number[];
}

// [main badges in a row, trades closed, winning trades, green days, green weeks, best trade (USD), duels won] per era.
const GOALS: [number, number, number][][] = [
  [[1, 2, 4], [10, 25, 50], [5, 15, 30], [3, 7, 15], [1, 2, 4], [5, 15, 40], [1, 2, 3]],
  [[5, 6, 8], [75, 120, 200], [40, 60, 100], [20, 30, 45], [5, 7, 10], [50, 80, 125], [4, 6, 8]],
  [[9, 10, 12], [250, 350, 500], [120, 170, 250], [55, 70, 90], [12, 15, 20], [150, 200, 300], [10, 12, 15]],
  [[13, 14, 16], [600, 800, 1000], [300, 400, 500], [100, 130, 160], [24, 30, 40], [350, 450, 600], [18, 22, 26]],
];
const KINDS = [
  { id: "badges", name: "Badges in a row", icon: "badge", unit: "in a row" },
  { id: "trades", name: "Trades closed", icon: "candle", unit: "trades" },
  { id: "wins", name: "Winning trades", icon: "laurel", unit: "won" },
  { id: "greenDays", name: "Green days", icon: "sun", unit: "days" },
  { id: "greenWeeks", name: "Green weeks", icon: "calendar", unit: "weeks" },
  { id: "bestTrade", name: "Best single trade", icon: "gem", unit: "USD" },
  { id: "duels", name: "Duels won", icon: "swords", unit: "duels" },
];
/** Fame per star: the main medallion is worth more, and later eras more again. */
const starFame = (era: number, main: boolean) => (main ? 50 : 35) * (era + 1);
export const BADGE_FAME = 200, DEED_FAME = 300;

/** A bot's progress in each era, its stars and its fame (without deeds). */
export function erasOf(x: FameInput): { eras: Era[]; stars: number; fame: number } {
  const days = Object.keys(x.daily).sort(); let greenDays = 0;
  for (let i = 1; i < days.length; i++) if (x.daily[days[i]] > x.daily[days[i - 1]] + 1e-9) greenDays++;
  const values = [x.bestStreak, x.trades.length, x.trades.filter(t => t.pnl > 0).length, greenDays, x.weekly.filter(w => w > 0).length,
    Math.max(0, ...x.trades.map(t => t.pnl)), x.duelsWon];
  const reached = x.tiers.filter(t => x.bestStreak >= t).length; // tiers reached at least once
  const eras = GOALS.map((goals, level) => {
    const unlocked = level <= reached;
    const medallions = KINDS.map((k, i) => { const v = i === 0 ? (level === reached ? x.streak : x.bestStreak) : values[i]; const g = goals[i];
      const stars = i === 0 ? g.filter(t => x.bestStreak >= t).length : g.filter(t => values[i] >= t).length;
      return { ...k, value: +v.toFixed(2), goals: g, stars: unlocked ? stars : 0, reward: starFame(level, i === 0) * 3, ...(i === 0 ? { main: true } : {}) }; });
    const stars = medallions.reduce((t, m) => t + m.stars, 0);
    return { level, name: ERA_NAMES[level], unlocked, medallions, stars, fame: medallions.reduce((t, m) => t + m.stars * starFame(level, !!m.main), 0) };
  });
  const stars = eras.reduce((t, e) => t + e.stars, 0);
  return { eras, stars, fame: eras.reduce((t, e) => t + e.fame, 0) + x.badges * BADGE_FAME };
}

/** Firsts and records on the whole desk. `events` are the accountant's events; `weeks` each bot's finished weekly returns. */
export function deedsOf(bots: { id: string; name: string; trades: { pnl: number; exitDate: string }[]; events: { d: string; kind: string; badges: number }[]; bestStreak: number; tiers: number[]; weeks: { week: string; pct: number }[] }[]): Deed[] {
  const out: Deed[] = [];
  const first = (id: string, name: string, text: string, list: { who: string; d: string }[]) => { const w = [...list].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0))[0]; if (w) out.push({ id, name, text, holder: w.who, d: w.d, fame: DEED_FAME }); };
  first("first-win", "First blood", "First winning trade on the desk.", bots.flatMap(b => b.trades.filter(t => t.pnl > 0).map(t => ({ who: b.id, d: t.exitDate }))));
  first("first-badge", "First badge", "First to double the grant.", bots.flatMap(b => b.events.filter(e => e.kind === "milestone").map(e => ({ who: b.id, d: e.d }))));
  for (const [i, t] of [[1, 4], [2, 8], [3, 12]] as const) first(`first-tier-${i}`, `First ${ERA_NAMES[i]}`, `First to ${t} badges in a row.`, bots.flatMap(b => { const m = b.events.filter(e => e.kind === "milestone"); let run = 0; const hits: { who: string; d: string }[] = [];
    for (const e of b.events) { if (e.kind === "milestone") { run++; if (run === t) hits.push({ who: b.id, d: e.d }); } else if (e.kind === "save") run = 0; } return m.length ? hits : []; }));
  first("first-10", "Busy hands", "First to close 10 trades.", bots.flatMap(b => { const t = [...b.trades].sort((x, y) => (x.exitDate < y.exitDate ? -1 : 1)); return t[9] ? [{ who: b.id, d: t[9].exitDate }] : []; }));
  const record = (id: string, name: string, text: (v: number) => string, list: { who: string; d: string; v: number }[]) => { const w = [...list].sort((a, b) => b.v - a.v || (a.d < b.d ? -1 : 1))[0]; if (w && w.v > 0) out.push({ id, name, text: text(w.v), holder: w.who, d: w.d, value: +w.v.toFixed(2), fame: DEED_FAME }); };
  record("biggest-trade", "Biggest trade", v => `The desk's biggest single trade: +$${v.toFixed(2)}.`, bots.flatMap(b => b.trades.map(t => ({ who: b.id, d: t.exitDate, v: t.pnl }))));
  record("best-week", "Best week", v => `The desk's best finished week: +${v.toFixed(2)}%.`, bots.flatMap(b => b.weeks.map(w => ({ who: b.id, d: w.week, v: w.pct }))));
  record("win-run", "Hot streak", v => `The longest run of winning trades: ${v} in a row.`, bots.map(b => { let run = 0, best = 0, at = ""; for (const t of [...b.trades].sort((x, y) => (x.exitDate < y.exitDate ? -1 : 1))) { run = t.pnl > 0 ? run + 1 : 0; if (run > best) { best = run; at = t.exitDate; } } return { who: b.id, d: at, v: best }; }));
  return out;
}
