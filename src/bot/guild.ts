// The Players Guild (owner, 2026-11-27: "a players guild, where I can hire some new trader to our company. There you can
// improve all the working theories that we are testing and get them better each time, so we have more competitive
// participants"). Every week the guild trains a new generation of candidate traders from what the desk is testing:
//   Strategists use our own strategy library. Their genes say which side, which family of strategies (trend or dip
//   buying), whether they want the ADX filter and which chart speeds; their try-out is the playbook those genes would
//   pick from the participants' short lists, scored on the newer data (the part the selection tests on).
//   Bot builders use the Pionex-style bots, improved the angel way (trend filters, stops, weekly re-tuning), each on one
//   Lighter market; their try-out is a replay of the last 21 days.
// Each generation keeps the best candidates of the last one (scored again on the newest data), adds mutants of the best
// (one gene changed) and a newcomer for variety, so the candidates get better as the theories are tested. The owner
// hires from the Guild Screen: a hired strategist becomes a full player with its own seat and loan; a hired bot builder
// plays with its own loan like a hired evil twin. Everything is paper. The random choices are seeded by the generation,
// so the PC and GitHub breed the same candidates.
import { STRATEGIES } from "../core/strategies";
import type { Shortlist } from "../core/select";
import type { EvilKind } from "./evil";

export type Side = "long" | "short" | "both";
export type Family = "trend" | "mean-reversion" | "any";
export type Speed = "scalp" | "intraday" | "swing" | "any";
export type World = "crypto" | "market";
export interface StrategistGenes { side: Side; family: Family; adx: "only" | "never" | "any"; speed: Speed; world: World }
export interface BuilderGenes { kind: EvilKind; sym: string }
export interface Tryout { fitness: number; trades: number; avgPct: number; pf: number; charts: number; resultPct?: number; worstDropPct?: number; stops?: number; playbook?: { key: string; id: string; name: string; testTrades: number; testPF: number; testAvgPct: number }[] }
export interface Candidate { id: string; name: string; type: "strategist" | "builder"; genes: StrategistGenes | BuilderGenes; gen: number; parent?: string; tryout: Tryout; text: string }
export interface Guild { gen: number; at: string; candidates: Candidate[]; history: { gen: number; at: string; best: number; bestName: string; avg: number }[]; names: string[] }

export const SPEEDS: Record<Exclude<Speed, "any">, string[]> = { scalp: ["1m", "5m"], intraday: ["15m", "30m", "1h"], swing: ["4h", "1d"] };
const NAMES = ["Max", "Zoe", "Kai", "Luna", "Theo", "Maya", "Ezra", "Iris", "Milo", "Nora", "Ravi", "Sofia", "Jin", "Ada", "Aria", "Omar", "Elena", "Finn", "Mila", "Hugo", "Yara", "Axel", "Lia", "Ivo", "Noa", "Tess", "Dario", "Ines", "Pablo", "Alba", "Rocco", "Vera", "Elio", "Dana", "Bruno", "Gala"];
const isAdx = (id: string) => /_adx$/.test(id);

/** Does a strategy fit these genes? (side, family, ADX filter) */
export const strategyFits = (id: string, g: StrategistGenes) => { const s = STRATEGIES.find(x => x.id === id); if (!s) return false;
  return (g.side === "both" || s.side === g.side) && (g.family === "any" || s.family === g.family) && (g.adx === "any" || (g.adx === "only") === isAdx(id)); };
/** Does a chart ("SYM@tf") fit these genes? (speed) */
export const chartFits = (key: string, g: StrategistGenes) => g.speed === "any" || SPEEDS[g.speed].includes(key.split("@")[1]);

/** A strategist in words. */
export function describeStrategist(g: StrategistGenes): string {
  const side = g.side === "both" ? "buys or sells short" : g.side === "long" ? "only buys" : "only sells short";
  const fam = g.family === "any" ? "any strategy" : g.family === "trend" ? "trend strategies" : "dip-buying (mean-reversion) strategies";
  const adx = g.adx === "only" ? ", only with the ADX market-type filter" : g.adx === "never" ? ", without the ADX filter" : "";
  const speed = g.speed === "any" ? "on any chart" : g.speed === "scalp" ? "on 1- and 5-minute charts" : g.speed === "intraday" ? "on 15-minute to 1-hour charts" : "on 4-hour and daily charts";
  return `${g.world === "crypto" ? "Crypto" : "Stocks, gold and other Lighter markets"}: ${side} with ${fam}${adx}, ${speed}.`;
}
const KIND_TEXT: Record<EvilKind, string> = { "neutral-grid": "an improved neutral grid", "short-grid": "an improved short grid", trailing: "improved trailing buy / sell", "dca-short": "an improved martingale short" };
export const describeBuilder = (g: BuilderGenes) => `Runs ${KIND_TEXT[g.kind]} on ${g.sym}, re-tuned every week the angel way (trend filter, stops, the best of a few settings on the last 14 days).`;

/** A strategist's try-out: the playbook its genes would pick from the participants' short lists, scored on the newer data. */
export function strategistTryout(g: StrategistGenes, shortlists: Shortlist[], maxCharts = 8): Tryout {
  const best = new Map<string, { key: string; id: string; name: string; testTrades: number; testPF: number; testAvgPct: number; score: number }>();
  for (const sl of shortlists) for (const c of sl.candidates) { if (!strategyFits(c.id, g)) continue;
    for (const ch of c.charts ?? []) { if (!chartFits(ch.key, g) || ch.testTrades < 5 || ch.testPF <= 1) continue;
      const k = `${ch.key}|${c.id}`; const score = Math.min(ch.testPF, 5) * Math.log10(ch.testTrades + 1);
      if (!best.has(k) || best.get(k)!.score < score) best.set(k, { key: ch.key, id: c.id, name: c.name, testTrades: ch.testTrades, testPF: ch.testPF, testAvgPct: ch.testAvgPct, score }); } }
  const pairs = [...best.values()].sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1)); const out: typeof pairs = []; const syms = new Set<string>();
  for (const p of pairs) { const s = p.key.split("@")[0]; if (syms.has(s)) continue; syms.add(s); out.push(p); if (out.length >= maxCharts) break; }
  const trades = out.reduce((t, p) => t + p.testTrades, 0); const total = out.reduce((t, p) => t + p.testTrades * p.testAvgPct, 0);
  const pf = trades ? out.reduce((t, p) => t + Math.min(p.testPF, 5) * p.testTrades, 0) / trades : 0;
  return { fitness: +(total * Math.min(pf, 3) / 2).toFixed(3), trades, avgPct: trades ? +(total / trades).toFixed(3) : 0, pf: +pf.toFixed(2), charts: out.length, playbook: out.map(({ score: _s, ...p }) => p) };
}

/** Seeded random numbers (the same generation breeds the same candidates on the PC and on GitHub). */
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pickOf = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length) % xs.length];
const SIDES: Side[] = ["long", "short", "both"], FAMS: Family[] = ["trend", "mean-reversion", "any"], ADX = ["only", "never", "any"] as const, SPEED: Speed[] = ["scalp", "intraday", "swing", "any"], WORLDS: World[] = ["crypto", "market"];
const KINDS: EvilKind[] = ["neutral-grid", "short-grid", "trailing", "dca-short"];
const randomStrategist = (r: () => number): StrategistGenes => ({ side: pickOf(r, SIDES), family: pickOf(r, FAMS), adx: pickOf(r, ADX), speed: pickOf(r, SPEED), world: pickOf(r, WORLDS) });
function mutateStrategist(g: StrategistGenes, r: () => number): StrategistGenes {
  const k = pickOf(r, ["side", "family", "adx", "speed", "world"] as const); const n = { ...g };
  if (k === "side") n.side = pickOf(r, SIDES.filter(x => x !== g.side)); if (k === "family") n.family = pickOf(r, FAMS.filter(x => x !== g.family));
  if (k === "adx") n.adx = pickOf(r, ADX.filter(x => x !== g.adx)); if (k === "speed") n.speed = pickOf(r, SPEED.filter(x => x !== g.speed)); if (k === "world") n.world = pickOf(r, WORLDS.filter(x => x !== g.world));
  return n;
}
const same = (a: object, b: object) => JSON.stringify(a) === JSON.stringify(b);

export interface BreedInput { gen: number; at: string; shortlists: Record<World, Shortlist[]>; markets: string[]; builderTryout: (g: BuilderGenes) => Tryout; usedNames: string[]; prev?: Guild | null; keep?: string[] }
/** Breed the next generation: keep the best, add mutants of the best and a newcomer; score everyone on the newest data. */
export function breed(x: BreedInput): Guild {
  const r = rng(x.gen * 7919 + 17); const names = [...(x.prev?.names ?? [])]; const taken = new Set([...x.usedNames, ...names]);
  const newName = () => { const free = NAMES.filter(n => !taken.has(n)); const n = free.length ? pickOf(r, free) : `${pickOf(r, NAMES)} ${x.gen}`; taken.add(n); names.push(n); return n; };
  const score = (c: Omit<Candidate, "tryout" | "text">): Candidate => c.type === "strategist"
    ? { ...c, tryout: strategistTryout(c.genes as StrategistGenes, x.shortlists[(c.genes as StrategistGenes).world] ?? []), text: describeStrategist(c.genes as StrategistGenes) }
    : { ...c, tryout: x.builderTryout(c.genes as BuilderGenes), text: describeBuilder(c.genes as BuilderGenes) };
  let n = 0; const id = () => `g${x.gen}-${++n}`;
  // The last generation, scored again on the newest data (candidates the owner has ordered stay whatever their score).
  const old = (x.prev?.candidates ?? []).map(c => score({ id: c.id, name: c.name, type: c.type, genes: c.genes, gen: c.gen, ...(c.parent ? { parent: c.parent } : {}) }));
  const rank = (cs: Candidate[]) => [...cs].sort((a, b) => b.tryout.fitness - a.tryout.fitness || (a.id < b.id ? -1 : 1));
  const oldS = rank(old.filter(c => c.type === "strategist")), oldB = rank(old.filter(c => c.type === "builder"));
  const keep = (cs: Candidate[], k: number) => cs.filter((c, i) => i < k || x.keep?.includes(c.id));
  const strat: Candidate[] = keep(oldS, 3); const build: Candidate[] = keep(oldB, 1);
  const has = (g: object) => [...strat, ...build].some(c => same(c.genes, g));
  // Mutants of the best strategists, then newcomers until there are six.
  for (let tries = 0; strat.length < 6 && tries < 60; tries++) {
    // The first generation is all newcomers; later ones breed from the best two, with the sixth place left to a newcomer.
    const parent = oldS.length && strat.length < 5 && tries < 40 ? strat[Math.floor(r() * Math.min(2, strat.length))] : null;
    // Newcomers alternate between the two worlds, so crypto and the other Lighter markets both get candidates.
    const g = parent ? mutateStrategist(parent.genes as StrategistGenes, r) : { ...randomStrategist(r), world: WORLDS[strat.length % 2] }; if (has(g)) continue;
    strat.push(score({ id: id(), name: newName(), type: "strategist", genes: g, gen: x.gen, ...(parent ? { parent: parent.name } : {}) }));
  }
  // Bot builders: the best one stays; a new market or a new bot for the others.
  for (let tries = 0; build.length < 3 && x.markets.length && tries < 40; tries++) {
    const parent = oldB.length && build[0] && tries < 20 ? build[0] : null; const pg = parent?.genes as BuilderGenes | undefined;
    const g: BuilderGenes = pg ? (r() < 0.5 ? { kind: pg.kind, sym: pickOf(r, x.markets) } : { kind: pickOf(r, KINDS.filter(k => k !== pg.kind)), sym: pg.sym }) : { kind: pickOf(r, KINDS), sym: pickOf(r, x.markets) };
    if (has(g)) continue; build.push(score({ id: id(), name: newName(), type: "builder", genes: g, gen: x.gen, ...(parent ? { parent: parent.name } : {}) }));
  }
  const all = [...rank(strat), ...rank(build)]; const top = rank(strat)[0]; // the history follows the best strategist (the two kinds score on different scales)
  const history = [...(x.prev?.history ?? []), { gen: x.gen, at: x.at, best: top?.tryout.fitness ?? 0, bestName: top?.name ?? "", avg: all.length ? +(all.reduce((t, c) => t + c.tryout.fitness, 0) / all.length).toFixed(3) : 0 }].slice(-52);
  return { gen: x.gen, at: x.at, candidates: all, history, names: names.slice(-200) };
}
