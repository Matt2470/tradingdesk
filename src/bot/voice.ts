// What the participants think about their week (owner, 2026-11-26: "a more game like UX ... their thoughts for this
// week's trades"). Each seat has a character; a recruit keeps the seat's character. The words are made only from the
// bot's own numbers (this week's trades, its rank, how far it is from a badge or the stop line, its evil twin), and the
// choice of phrase is fixed by the week, so the thought does not change on every refresh. Flavour only: nothing here
// changes how a bot trades.

export type Character = "bold" | "grumpy" | "curious" | "cold" | "evil";
export const CHARACTER: Record<string, Character> = { "stocks-bull": "bold", "stocks-bear": "grumpy", "crypto-bull": "curious", "crypto-bear": "cold" };
export const CHARACTER_TEXT: Record<Character, string> = {
  bold: "Confident, quick, likes a fight. Free to buy or sell short.",
  grumpy: "A born pessimist who sells rallies. Trusts nobody's good news.",
  curious: "Optimistic and always testing a new coin. Long or short, whatever moves.",
  cold: "Calm, precise, never raises her voice. Sells crypto when it is too high.",
  evil: "A ready-made bot from the shop window, hired to prove that thinking is overrated. Follows its rules and never doubts.",
};
/** A participant's character, or "evil" for a hired evil twin. */
export const characterOf = (id: string): Character => (id.startsWith("evil-") ? "evil" : CHARACTER[id] ?? "bold");

export interface ThoughtInput {
  id: string; name: string; week: string; trades: number; wins: number; pnl: number; returnPct: number;
  rank: number; of: number; leader?: string; equity: number; grant: number; minTrades: number; badges: number; streak: number; toNextTier?: number; nextTier?: string;
  best?: { sym: string; pnl: number } | null; worst?: { sym: string; pnl: number } | null;
  evil?: { name: string; resultPct: number; kind: string } | null; resultPct: number; stopped: boolean; weekend: boolean; /** Still in the first days after hiring: no strikes yet. */ graced?: boolean;
}

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const pickOne = (xs: string[], seed: string) => xs[hash(seed) % xs.length];
const usd = (x: number) => `$${Math.abs(x).toFixed(2)}`;

/** Two or three sentences in the bot's own voice about this week. */
export function thoughtOf(t: ThoughtInput): string {
  const c = characterOf(t.id); const seed = `${t.id}|${t.week}`; const out: string[] = [];
  if (t.stopped) return pickOne([
    "I'm out. The stop line got me; the bank keeps what is left.", "That's the end of my run. Someone new will sit here if the owner says yes.",
  ], seed);
  // How the week went.
  if (!t.trades) out.push(pickOne({ bold: ["Nothing closed yet. I'm waiting for a fight worth having.", "Quiet so far. My charts haven't called me in."], grumpy: ["Not one trade closed. Fine. Bad trades are worse than none.", "Nothing yet. Everyone is too cheerful to short properly."], curious: ["No trades closed yet this week. Something is about to move, I can feel it.", "Still nothing closed. I keep watching the coins."], cold: ["No trades closed. Patience is a position too.", "Nothing closed. The setups are not there yet."], evil: ["My orders are set. The market will come to them.", "Nothing closed yet. I don't get bored."] }[c], seed));
  else if (t.pnl >= 0) out.push(pickOne({
    bold: [`${t.trades} trade${t.trades === 1 ? "" : "s"}, ${t.wins} won, ${usd(t.pnl)} up. That's how it's done.`, `Up ${usd(t.pnl)} this week with ${t.wins} of ${t.trades} winners. Keep them coming.`],
    grumpy: [`${t.wins} of ${t.trades} worked, ${usd(t.pnl)} up. Don't get used to it.`, `${usd(t.pnl)} up. The market fell exactly as I said it would.`],
    curious: [`${t.trades} trade${t.trades === 1 ? "" : "s"} and ${usd(t.pnl)} up! ${t.wins} winner${t.wins === 1 ? "" : "s"}, and I learned something from the rest.`, `Up ${usd(t.pnl)} so far. Fun week.`],
    cold: [`${t.wins} of ${t.trades} closed in profit: ${usd(t.pnl)}. As planned.`, `${usd(t.pnl)} up on ${t.trades} trade${t.trades === 1 ? "" : "s"}. Acceptable.`],
    evil: [`${t.trades} fills, ${usd(t.pnl)} up. No thinking required.`, `${usd(t.pnl)} up. The ladder does the work.`] }[c], seed));
  else out.push(pickOne({
    bold: [`Down ${usd(t.pnl)} on ${t.trades} trade${t.trades === 1 ? "" : "s"}. I'll get it back.`, `${t.wins} of ${t.trades} won and I'm ${usd(t.pnl)} down. Not my best, not my last.`],
    grumpy: [`Down ${usd(t.pnl)}. The market is irrational, as usual.`, `${usd(t.pnl)} down. I told you rallies were dangerous.`],
    curious: [`Down ${usd(t.pnl)} so far. Ouch. Next coin, please.`, `${t.trades} trade${t.trades === 1 ? "" : "s"}, ${usd(t.pnl)} down. I'm still learning this one.`],
    cold: [`${usd(t.pnl)} down. The stops did their job.`, `Down ${usd(t.pnl)}. Losses are part of the plan; their size is what matters.`],
    evil: [`Down ${usd(t.pnl)}. My rules don't care.`, `${usd(t.pnl)} down. I'll keep doing exactly the same thing.`] }[c], seed));
  // One detail: a trade worth mentioning.
  if (t.best && t.best.pnl > 0 && (!t.worst || t.best.pnl >= -t.worst.pnl)) out.push(pickOne([`${t.best.sym} paid the most: +${usd(t.best.pnl)}.`, `Best one: ${t.best.sym}, +${usd(t.best.pnl)}.`], seed + "b"));
  else if (t.worst && t.worst.pnl < 0) out.push(pickOne([`${t.worst.sym} hurt: −${usd(t.worst.pnl)}.`, `Worst one: ${t.worst.sym}, −${usd(t.worst.pnl)}.`], seed + "w"));
  // What worries or drives the bot right now, most urgent first.
  const cushion = t.equity - t.grant / 2; const toBadge = t.grant * 2 - t.equity;
  if (cushion < t.grant * 0.15) out.push(`Only ${usd(cushion)} above the stop line. Careful now.`);
  else if (!t.weekend && !t.graced && t.trades < t.minTrades) out.push(`I need ${t.minTrades - t.trades} more closed trade${t.minTrades - t.trades === 1 ? "" : "s"} before the weekly check or it's a strike.`);
  else if (toBadge < t.grant * 0.25) out.push(`${usd(toBadge)} to my next badge.`);
  else if (c === "evil" && t.evil && Math.abs(t.evil.resultPct - t.resultPct) >= 1) out.push(t.evil.resultPct > t.resultPct
    ? pickOne([`${t.evil.name} copied my rules and is ahead. Copycat.`, `That goody-goody ${t.evil.name} is beating me with my own tricks.`], seed + "a")
    : pickOne([`${t.evil.name} keeps "improving" my rules and is still behind me.`, `Ahead of ${t.evil.name}. Halos don't trade.`], seed + "a"));
  else if (t.evil && Math.abs(t.evil.resultPct - t.resultPct) >= 1) out.push(t.evil.resultPct > t.resultPct
    ? pickOne([`${t.evil.name} is beating me with my own genes. That can't last.`, `${t.evil.name} changed a few of my genes and it's ahead. Noted.`], seed + "e")
    : pickOne([`${t.evil.name} is behind me. My genes work better as they are.`, `Ahead of ${t.evil.name}. Mutations aren't always improvements.`], seed + "e"));
  else if (t.rank === 1 && t.of > 1) out.push(pickOne(["Top of the desk this week.", "Leading the desk this week. Catch me if you can."], seed + "r"));
  else if (t.leader && t.rank > 1) out.push(`${t.leader} leads this week; I'm number ${t.rank}.`);
  return out.join(" ");
}

/** The evil twin's taunt, from its own numbers. */
export function tauntOf(twin: { kind: string; resultPct: number; trades: number; stops: number; badges: number }, rival: { name: string; resultPct: number }, seed: string): string {
  const angel = twin.kind === "angel";
  if (!twin.trades && !twin.stops && !twin.badges && Math.abs(twin.resultPct) < 0.01) return angel ? pickOne([`New genes, fresh start. Watch and learn, ${rival.name}.`, `Born from a winner's genes. ${rival.name}, I'll show you how it's done.`], seed) : pickOne([`Just born from your genes, ${rival.name}. A few changes and I'll do better.`, `Your genes, my changes. Let's see who uses them better, ${rival.name}.`], seed);
  if (twin.stops) return pickOne([`Stopped ${twin.stops} time${twin.stops === 1 ? "" : "s"}, but I'm still here.`, "I hit the stop line once. I won't again."], seed);
  if (twin.badges) return `${twin.badges} badge${twin.badges === 1 ? "" : "s"} already with these genes, ${rival.name}.`;
  const d = twin.resultPct - rival.resultPct;
  if (d > 1) return angel ? pickOne([`Ahead of ${rival.name} by ${d.toFixed(1)} points. Better genes, better decisions.`, `${twin.trades} trades and I'm ahead of ${rival.name}. Every Monday I get better.`], seed) : pickOne([`Ahead of ${rival.name} by ${d.toFixed(1)} points with your own genes, a little changed.`, `${twin.trades} trades and I'm ahead of ${rival.name}. Hire me.`], seed);
  if (d < -1) return pickOne([`${rival.name} is ahead, for now. My genes need time.`, `Behind ${rival.name} by ${(-d).toFixed(1)} points. Not done yet.`], seed);
  return pickOne([`Neck and neck with ${rival.name}.`, `Level with ${rival.name}. Let's see whose genes win.`], seed);
}
