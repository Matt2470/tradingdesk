// The gene tree (owner, 2026-11-27: "the evils and the angels are biological clones grown from the participants' genes;
// the genes are the evolution page ... a tree of technological growth, and the bot can choose the branch of the tree:
// more gadgets to trade, better techniques, more skills, or how to get more money ... a lot of genes can be activated
// after some eras or badges, like the progression in Civilization").
//   DNA points: 2 at birth, 1 per badge, 2 per era (tier) reached, 1 per deed held, 1 per green week.
//   Four branches of four genes, each needing the one before; later genes open only in later eras. Two capstones in the
//   last era need the top of two branches.
//   The bot spends its points itself, on the branch its own results say it needs (owner's answer, 2026-11-27); the owner
//   can plan a gene for it instead.
//   Visual first (owner's answer): the genes do not change how the participants trade yet. The evil and angel clones are
//   grown from the participant (owner's answer: pure clones) and already trade with their dark and light genes, so they
//   preview what genes would do.

export type Branch = "gadgets" | "techniques" | "skills" | "fortune";
export interface Gene { id: string; branch: Branch | "capstone"; name: string; text: string; era: number; needs: string[]; cost: number; /** False: drawn in the tree, not traded with yet. */ built?: boolean }
export const BRANCHES: { id: Branch; name: string; text: string }[] = [
  { id: "gadgets", name: "Gadgets", text: "More to trade: more charts, faster charts, other markets." },
  { id: "techniques", name: "Techniques", text: "Better trades: reading the market, smarter exits, confirmation." },
  { id: "skills", name: "Skills", text: "Discipline: smaller losses, fewer costly trades, steadier nerves." },
  { id: "fortune", name: "Fortune", text: "More money from the same trades, always within the 3x leverage limit." },
];
export const GENES: Gene[] = [
  { id: "second-screen", branch: "gadgets", name: "Second screen", text: "Trades 2 more charts each week (10 instead of 8).", era: 0, needs: [], cost: 1 },
  { id: "scalper-keys", built: false, branch: "gadgets", name: "Scalper's keyboard", text: "Adds the 1- and 5-minute charts.", era: 0, needs: ["second-screen"], cost: 1 },
  { id: "global-terminal", built: false, branch: "gadgets", name: "Global terminal", text: "Can trade the other world too: crypto for a stocks bot, Lighter stocks for a crypto bot.", era: 1, needs: ["scalper-keys"], cost: 2 },
  { id: "satellite-feed", branch: "gadgets", name: "Satellite feed", text: "Trades 4 more charts (14).", era: 2, needs: ["global-terminal"], cost: 3 },
  { id: "market-reader", branch: "techniques", name: "Market reader", text: "Trades the ADX-filtered version of its strategies: it enters only when the market really trends.", era: 0, needs: [], cost: 1 },
  { id: "safe-exit", branch: "techniques", name: "Safe exit", text: "Takes half the position at the first take-profit (a third otherwise); the stop still moves to break-even.", era: 0, needs: ["market-reader"], cost: 1 },
  { id: "second-opinion", built: false, branch: "techniques", name: "Second opinion", text: "Enters only when two strategies agree on the same chart.", era: 1, needs: ["safe-exit"], cost: 2 },
  { id: "regime-master", built: false, branch: "techniques", name: "Regime master", text: "Switches its strategies when the market changes from trend to range.", era: 2, needs: ["second-opinion"], cost: 3 },
  { id: "cool-head", branch: "skills", name: "Cool head", text: "Half the size after 3 losing trades in a row, until a winner.", era: 0, needs: [], cost: 1 },
  { id: "spread-sense", branch: "skills", name: "Spread sense", text: "Skips markets where spread and slippage cost more than 0.15% a side.", era: 0, needs: ["cool-head"], cost: 1 },
  { id: "funding-sense", branch: "skills", name: "Funding sense", text: "Skips a trade when the funding would make it pay to hold it (longs when longs pay, shorts when shorts pay).", era: 1, needs: ["spread-sense"], cost: 2 },
  { id: "iron-nerves", branch: "skills", name: "Iron nerves", text: "Tighter stepped stops: smaller losses before the full stop.", era: 2, needs: ["funding-sense"], cost: 3 },
  { id: "compounding", branch: "fortune", name: "Let it run", text: "The last third of a winning trade has no take-profit: it rides the rising stop for a bigger win.", era: 0, needs: [], cost: 1 },
  { id: "hot-hand", branch: "fortune", name: "Hot hand", text: "Risks 2.5% a trade while on a winning streak (2% otherwise).", era: 0, needs: ["compounding"], cost: 1 },
  { id: "pyramid", built: false, branch: "fortune", name: "Pyramid", text: "Adds once to a winning trade after its first take-profit.", era: 1, needs: ["hot-hand"], cost: 2 },
  { id: "award-investor", built: false, branch: "fortune", name: "Award investor", text: "Lets the locked award earn on the side (a small share traded with the account).", era: 2, needs: ["pyramid"], cost: 3 },
  { id: "quant-lab", built: false, branch: "capstone", name: "Quant lab", text: "Every gadget and technique working together: tests and changes its playbook every day.", era: 3, needs: ["satellite-feed", "regime-master"], cost: 4 },
  { id: "hedge-fund", built: false, branch: "capstone", name: "Hedge fund", text: "Discipline and fortune together: runs a long and a short book at once.", era: 3, needs: ["iron-nerves", "award-investor"], cost: 4 },
];
/** Devils and angels (owner, 2026-11-27: "strategist, devil and angel are the evolutions of the trader that take better
 *  decisions about trading ... it is all about genes"). A devil is grown from its participant's genes with a few random
 *  changes and trades with them; liquidated (half its 250 lost) it is replaced by a new devil with new changes. Hired by
 *  the owner, it becomes a player, and the participant gets an angel instead: it starts from the hired devil's genes and
 *  every Monday tests small gene changes on the last 14 days, keeping the best. */
export const DEVIL_TEXT = "Grown from the participant's genes with a few random changes; it trades the participant's charts with its own genes. Liquidated at half its 250, a new devil with new changes takes its place.";
export const ANGEL_TEXT = "Grown from the genes of the devil you hired; every Monday it tests small gene changes on the last 14 days and keeps the best.";
export const builtGene = (id: string) => GENES.find(g => g.id === id)?.built !== false;
const rngOf = (seed: string) => { let h = 2166136261; for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); } let a = h >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
/** Genes no other owned gene needs (they can be dropped without breaking the tree). */
const leaves = (ids: string[]) => ids.filter(id => !ids.some(o => GENES.find(g => g.id === o)?.needs.includes(id)));
/** Fill spare DNA with random built genes that can be taken. */
function fill(ids: string[], total: number, era: number, rnd: () => number): string[] {
  const out = [...ids]; const g = (): Genome => ({ who: "", picks: out.map(id => ({ id, at: "", why: "", by: "bot" as const })) });
  for (let guard = 0; guard < 30; guard++) { const spare = total - spentOf(g()); const open = GENES.filter(x => builtGene(x.id) && canTake(x.id, g(), era, spare).ok); if (!open.length) break; out.push(open[Math.floor(rnd() * open.length)].id); }
  return out;
}
/** A devil's genes: the participant's, with `changes` random genes dropped and the DNA spent again on random built genes. */
export function mutate(base: string[], total: number, era: number, seed: string, changes = 2): string[] {
  const rnd = rngOf(seed); let ids = base.filter(id => GENES.some(g => g.id === id));
  for (let k = 0; k < changes && ids.length; k++) { const l = leaves(ids); ids = ids.filter(id => id !== l[Math.floor(rnd() * l.length)]); }
  const out = fill(ids, Math.max(total, 2), era, rnd);
  return out.sort().join() === [...base].sort().join() && base.length ? mutate(base, total, era, seed + "+", changes + 1) : out;
}
/** The angel's weekly try-outs: its genes, and genomes one change away (one gene dropped, one added, or both). */
export function neighbours(ids: string[], total: number, era: number, seed: string, n = 5): string[][] {
  const rnd = rngOf(seed); const out: string[][] = [ids]; const key = (x: string[]) => [...x].sort().join();
  for (let guard = 0; guard < 40 && out.length < n + 1; guard++) {
    let x = [...ids]; const l = leaves(x); if (l.length && rnd() < 0.6) x = x.filter(id => id !== l[Math.floor(rnd() * l.length)]);
    x = fill(x, total, era, rnd); if (!out.some(o => key(o) === key(x))) out.push(x);
  }
  return out;
}
/** How a set of genes trades (src/pipeline.ts applies it): extra charts, exits, sizing, which charts and strategies. */
export function expression(ids: string[]) {
  const has = (id: string) => ids.includes(id);
  return { extraCharts: (has("second-screen") ? 2 : 0) + (has("satellite-feed") ? 4 : 0), adx: has("market-reader"), safeExit: has("safe-exit"), letRun: has("compounding"),
    hotHand: has("hot-hand"), coolHead: has("cool-head"), spreadSense: has("spread-sense"), fundingSense: has("funding-sense"), ironNerves: has("iron-nerves") };
}

export interface GeneStats { badges: number; tiersReached: number; deeds: number; greenWeeks: number; tradesPerWeek: number; winRate: number; worstDropPct: number; minTrades: number }
export interface Pick { id: string; at: string; why: string; by: "bot" | "owner" }
export interface Genome { who: string; picks: Pick[]; /** DNA earned and era reached, saved for the devils and angels. */ total?: number; era?: number }
export interface GeneStore { at?: string; genomes: Record<string, Genome>; /** The owner's planned genes, copied from the owner's answers by the PC so GitHub's checks follow them too. */ plans?: Record<string, string[]> }

export const pointsOf = (s: GeneStats) => ({ birth: 2, badges: s.badges, eras: 2 * s.tiersReached, deeds: s.deeds, greenWeeks: s.greenWeeks,
  total: 2 + s.badges + 2 * s.tiersReached + s.deeds + s.greenWeeks });
export const spentOf = (g: Genome) => g.picks.reduce((t, p) => t + (GENES.find(x => x.id === p.id)?.cost ?? 0), 0);
/** Can this gene be taken now (not owned, era reached, genes before it owned, enough points)? */
export function canTake(id: string, g: Genome, era: number, spare: number): { ok: boolean; why: string } {
  const gene = GENES.find(x => x.id === id); if (!gene) return { ok: false, why: "unknown gene" };
  if (g.picks.some(p => p.id === id)) return { ok: false, why: "already has it" };
  if (gene.era > era) return { ok: false, why: `opens in era ${["I", "II", "III", "IV"][gene.era]}` };
  const missing = gene.needs.filter(n => !g.picks.some(p => p.id === n)); if (missing.length) return { ok: false, why: `needs ${missing.map(m => GENES.find(x => x.id === m)!.name).join(" and ")}` };
  if (gene.cost > spare) return { ok: false, why: `costs ${gene.cost} DNA` };
  return { ok: true, why: "" };
}
/** The branch a bot's own results say it needs most, then the others. */
export function preference(s: GeneStats): { order: (Branch | "capstone")[]; why: string } {
  if (s.tradesPerWeek < s.minTrades) return { order: ["gadgets", "techniques", "skills", "fortune", "capstone"], why: `only ${s.tradesPerWeek.toFixed(1)} trades a week: it wants more to trade` };
  if (s.worstDropPct < -8) return { order: ["skills", "techniques", "gadgets", "fortune", "capstone"], why: `a ${(-s.worstDropPct).toFixed(1)}% drop: it wants more discipline` };
  if (s.winRate < 0.45) return { order: ["techniques", "skills", "gadgets", "fortune", "capstone"], why: `wins only ${(s.winRate * 100).toFixed(0)}% of its trades: it wants better techniques` };
  return { order: ["fortune", "capstone", "techniques", "gadgets", "skills"], why: "its trading works: it wants more money from it" };
}
/** Spend the spare points: the owner's planned genes first, then the bot's own choice by its results. */
/** A planned gene with the genes it needs first, in the order they must be taken. */
export function withNeeds(ids: string[]): string[] {
  const out: string[] = []; const add = (id: string) => { const g = GENES.find(x => x.id === id); if (!g || out.includes(id)) return; g.needs.forEach(add); out.push(id); };
  ids.forEach(add); return out;
}
export function evolve(g: Genome, s: GeneStats, era: number, at: string, planned: string[] = []): Genome {
  const out: Genome = { ...g, picks: [...g.picks] }; const total = pointsOf(s).total;
  const plan = withNeeds(planned).filter(id => !out.picks.some(p => p.id === id));
  for (const id of plan) { const c = canTake(id, out, era, total - spentOf(out)); if (c.ok) out.picks.push({ id, at, why: planned.includes(id) ? "planned by the owner" : "needed for a gene the owner planned", by: "owner" }); }
  // The bot saves its points for the owner's plan while the plan waits only for points.
  if (plan.some(id => !out.picks.some(p => p.id === id) && /^costs /.test(canTake(id, out, era, total - spentOf(out)).why))) return out;
  for (let guard = 0; guard < 20; guard++) {
    const spare = total - spentOf(out); const pref = preference(s); let took = false;
    for (const br of pref.order) {
      const gene = GENES.filter(x => x.branch === br).find(x => canTake(x.id, out, era, spare).ok);
      if (gene) { out.picks.push({ id: gene.id, at, why: pref.why, by: "bot" }); took = true; break; }
    }
    if (!took) break;
  }
  return out;
}
