import { test, expect, describe } from "bun:test";
import { strategyFits, chartFits, strategistTryout, breed, describeStrategist, type StrategistGenes, type Guild } from "../src/bot/guild";
import { STRATEGIES } from "../src/core/strategies";
import type { Shortlist } from "../src/core/select";

const g = (o: Partial<StrategistGenes> = {}): StrategistGenes => ({ side: "both", family: "any", adx: "any", speed: "any", world: "crypto", ...o });
const sl = (): Shortlist => ({ pickedAt: "2026-11-23T00:00", testShare: 0.3, maxStrategies: 6, charts: 10, chosen: [], candidates: STRATEGIES.map((s, i) => ({ id: s.id, name: s.name, side: s.side, pickPass: 1, pickTested: 1, pickMedianPF: 1.2, testTrades: 10, testPF: 1.3, testAvgPct: 0.2, chosen: true, why: "",
  charts: ["BTC@1h", "ETH@15m", "SOL@4h", "ADA@5m", "XRP@1d"].map((key, j) => ({ key, testTrades: 5 + ((i + j) % 7), testPF: 1 + ((i * 3 + j) % 9) / 10, testAvgPct: 0.1 + ((i + 2 * j) % 5) / 10, testBars: 300 })) })) });

describe("the players guild", () => {
  test("genes choose strategies and charts", () => {
    const short = STRATEGIES.find(s => s.side === "short")!.id, adx = STRATEGIES.find(s => /_adx$/.test(s.id))!.id;
    expect(strategyFits(short, g({ side: "long" }))).toBe(false); expect(strategyFits(short, g({ side: "short" }))).toBe(true);
    expect(strategyFits(adx, g({ adx: "never" }))).toBe(false); expect(strategyFits(adx, g({ adx: "only" }))).toBe(true);
    expect(chartFits("BTC@5m", g({ speed: "scalp" }))).toBe(true); expect(chartFits("BTC@4h", g({ speed: "scalp" }))).toBe(false);
    expect(describeStrategist(g({ side: "short", family: "trend", speed: "swing" }))).toContain("only sells short with trend strategies");
  });
  test("a try-out: one chart per symbol, only what the genes allow, scored on the newer data", () => {
    const t = strategistTryout(g({ speed: "intraday" }), [sl()]);
    expect(t.charts).toBe(2); expect(t.playbook!.every(p => /@(15m|1h)$/.test(p.key))).toBe(true); expect(new Set(t.playbook!.map(p => p.key.split("@")[0])).size).toBe(t.charts);
    expect(t.fitness).toBeGreaterThan(0); expect(strategistTryout(g({ speed: "scalp", world: "market" }), []).charts).toBe(0);
  });
  const input = (gen: number, prev?: Guild | null, keep?: string[]) => ({ gen, at: `2026-11-${10 + gen}T08:00`, shortlists: { crypto: [sl()], market: [sl()] }, markets: ["BTC", "ETH", "SOL"],
    builderTryout: (b: { kind: string; sym: string }) => ({ fitness: b.sym.length + b.kind.length / 10, trades: 3, avgPct: 0.1, pf: 0, charts: 1, resultPct: 2, worstDropPct: -1, stops: 0 }), usedNames: ["Nico", "Lucas"], prev, keep });
  test("a generation: six strategists and three bot builders, all different, the same on every machine", () => {
    const a = breed(input(1)), b = breed(input(1));
    expect(a).toEqual(b); expect(a.candidates.filter(c => c.type === "strategist")).toHaveLength(6); expect(a.candidates.filter(c => c.type === "builder")).toHaveLength(3);
    expect(new Set(a.candidates.map(c => JSON.stringify(c.genes))).size).toBe(9); expect(new Set(a.candidates.map(c => c.name)).size).toBe(9); expect(a.candidates.some(c => c.name === "Nico")).toBe(false);
  });
  test("the next generation keeps the best three strategists, learns from them, and keeps the candidates the owner ordered", () => {
    const one = breed(input(1)); const best = [...one.candidates.filter(c => c.type === "strategist")].sort((x, y) => y.tryout.fitness - x.tryout.fitness).slice(0, 3).map(c => c.id);
    const worst = one.candidates.filter(c => c.type === "strategist").sort((x, y) => x.tryout.fitness - y.tryout.fitness)[0].id;
    const two = breed(input(2, one, [worst]));
    for (const id of best) expect(two.candidates.some(c => c.id === id)).toBe(true);
    expect(two.candidates.some(c => c.id === worst)).toBe(true);
    expect(two.candidates.some(c => c.gen === 2 && c.parent)).toBe(true); expect(two.history.map(h => h.gen)).toEqual([1, 2]);
  });
});
