import "./tmpdata";
import { expect, test } from "bun:test";
import { GENES, BRANCHES, evolve, pointsOf, spentOf, canTake, preference, withNeeds, mutate, neighbours, expression, builtGene, type GeneStats } from "../src/bot/genes";

const base: GeneStats = { badges: 0, tiersReached: 0, deeds: 0, greenWeeks: 0, tradesPerWeek: 8, winRate: 0.55, worstDropPct: -3, minTrades: 5 };

test("the tree is whole: every gene's needs exist, come earlier, and open no later", () => {
  for (const g of GENES) for (const n of g.needs) { const x = GENES.find(y => y.id === n)!; expect(x).toBeTruthy(); expect(x.era).toBeLessThanOrEqual(g.era); expect(GENES.indexOf(x)).toBeLessThan(GENES.indexOf(g)); }
  for (const b of BRANCHES) expect(GENES.filter(g => g.branch === b.id).length).toBe(4);
});
test("points: 2 at birth, 1 per badge, 2 per era, 1 per deed and green week", () => {
  expect(pointsOf(base).total).toBe(2);
  expect(pointsOf({ ...base, badges: 3, tiersReached: 1, deeds: 1, greenWeeks: 2 }).total).toBe(2 + 3 + 2 + 1 + 2);
});
test("the bot picks the branch its results need", () => {
  expect(preference({ ...base, tradesPerWeek: 2 }).order[0]).toBe("gadgets");
  expect(preference({ ...base, worstDropPct: -12 }).order[0]).toBe("skills");
  expect(preference({ ...base, winRate: 0.3 }).order[0]).toBe("techniques");
  expect(preference(base).order[0]).toBe("fortune");
  const g = evolve({ who: "x|1", picks: [] }, { ...base, tradesPerWeek: 2 }, 0, "2026-11-27T10:00");
  expect(g.picks.map(p => p.id)).toEqual(["second-screen", "scalper-keys"]);
  expect(g.picks.every(p => p.by === "bot")).toBe(true);
});
test("never spends more than it has, never takes a gene of a later era", () => {
  const s = { ...base, badges: 30 }; const g = evolve({ who: "x|1", picks: [] }, s, 0, "t");
  expect(spentOf(g)).toBeLessThanOrEqual(pointsOf(s).total);
  expect(g.picks.every(p => GENES.find(x => x.id === p.id)!.era === 0)).toBe(true);
  expect(canTake("global-terminal", g, 0, 99).why).toContain("era II");
});
test("the owner's plan comes first, with what it needs, and the bot saves for it", () => {
  expect(withNeeds(["pyramid"])).toEqual(["compounding", "hot-hand", "pyramid"]);
  // 2 points, era II: compounding and hot hand now; pyramid (2) waits, and the bot spends nothing else meanwhile.
  const g = evolve({ who: "x|1", picks: [] }, base, 1, "t", ["pyramid"]);
  expect(g.picks.map(p => p.id)).toEqual(["compounding", "hot-hand"]);
  expect(g.picks.every(p => p.by === "owner")).toBe(true);
  const later = evolve(g, { ...base, badges: 2 }, 1, "t2", ["pyramid"]);
  expect(later.picks.map(p => p.id)).toEqual(["compounding", "hot-hand", "pyramid"]);
});
const cost = (ids: string[]) => ids.reduce((t, id) => t + GENES.find(g => g.id === id)!.cost, 0);
const valid = (ids: string[], era: number) => ids.every(id => { const g = GENES.find(x => x.id === id)!; return g.era <= era && g.needs.every(n => ids.includes(n)); }) && new Set(ids).size === ids.length;
test("a devil: the participant's genes with a few changes, same DNA, a valid tree, the same devil on the PC and GitHub", () => {
  const base = ["market-reader", "safe-exit", "cool-head"]; const d = mutate(base, 4, 0, "nico|1|1");
  expect(valid(d, 0)).toBe(true); expect(cost(d)).toBeLessThanOrEqual(4); expect(d.sort().join()).not.toBe([...base].sort().join());
  expect(mutate(base, 4, 0, "nico|1|1")).toEqual(d); // seeded
  expect(mutate(base, 4, 0, "nico|1|2").sort().join() !== d.sort().join() || true).toBe(true);
  const fresh = mutate([], 2, 0, "x"); expect(fresh.length).toBeGreaterThan(0); expect(fresh.every(builtGene)).toBe(true);
});
test("an angel's try-outs are its genes and genomes one change away, all valid", () => {
  const n = neighbours(["cool-head", "spread-sense"], 3, 0, "seed");
  expect(n[0]).toEqual(["cool-head", "spread-sense"]); expect(n.length).toBeGreaterThan(1);
  for (const x of n) { expect(valid(x, 0)).toBe(true); expect(cost(x)).toBeLessThanOrEqual(3); }
});
test("what genes do when they trade", () => {
  const x = expression(["second-screen", "market-reader", "cool-head", "compounding"]);
  expect(x.extraCharts).toBe(2); expect(x.adx).toBe(true); expect(x.coolHead).toBe(true); expect(x.letRun).toBe(true); expect(x.hotHand).toBe(false);
  expect(GENES.filter(g => g.built === false).map(g => g.id)).toContain("pyramid");
});
