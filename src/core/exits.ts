// How an open position is closed. One engine, used by the backtester AND the paper bots, so they agree.
// Two plans (settings.exits.mode):
//  - "single": the old behaviour. Everything closes at the stop, at the strategy's own target (if it has one), or on its exit rule.
//  - "ladder": take profit in steps. R is the risk at entry (distance from the entry price to the first stop).
//      at tpR[0] (1R) sell fractions[0] of the position and move the stop to the entry price (the trade can no longer lose);
//      at tpR[1] (2R) sell fractions[1] and move the stop up to the first take-profit;
//      at tpR[2] (3R) sell what is left. If the fractions add up to less than 1, what remains after the last
//      take-profit is a runner with no target: it closes on the trailing stop or on the strategy's exit rule.
//    After the first take-profit the stop also trails: at each close it moves to (best close - trailAtr x ATR(14))
//    if that is better. It never moves back.
//    Optional stepped stops (slR/slFractions), only before the first take-profit: e.g. sell a third when the loss reaches
//    0.5R, another third at 0.75R, and the rest at the full stop (1R). A bar that touches a stepped stop takes no profit.
// Rules that keep the results honest (tests/exits.test.ts):
//  1. Inside one bar the stop is checked first, with the stop as it was when the bar opened (the cautious choice).
//  2. A stop moved by a take-profit or by the trail only counts from the NEXT bar.
//  3. A stop fills at the stop price, or at the open if the bar gapped through it. A take-profit fills at its price, never better.
//  4. The strategy's own exit rule and the time stop still close everything left, at the next open (the caller handles those).
export interface ExitPlan { mode: "single" | "ladder"; tpR: number[]; fractions: number[]; trailAtr: number;
  /** Optional stepped stops (ladder only, before the first take-profit): sell slFractions[k] of the position when the loss reaches slR[k] x R (e.g. 0.5 = half the risk). The full stop at 1R sells the rest. */
  slR?: number[]; slFractions?: number[] }
// Chosen on 2026-11-20 after scripts/compare-exits.ts on 5 years of real prices: TP1 and TP2 take a third each, the last third
// runs with a 3 ATR trailing stop. Against "single" it cut the median drawdown from 20% to 16.5% (stocks) and 31% to 22.5% (crypto),
// kept about as many strategies passing, and gave up some profit (median 38% -> 29% on stocks).
// Stepped stops added the same evening at the owner's request ("SL1, SL2 and out"): a third out at a loss of 0.5R, a third
// at 0.75R, the rest at 1R. On real prices the typical loss fell (stocks -3.0% to -2.3%, crypto -1.6% to -1.3%), the median
// drawdown fell (stocks 16.5% to 14.8%, crypto 22.5% to 18.3%), the median return stayed the same, and on the newer data the
// short-listed strategies did better (stocks: average trade +0.13% to +0.30%).
// TP3 at 3R added on 2026-11-21 at the owner's request: the last third now has a target (3R) and still the rising stop.
// On real prices it did about the same as the open-ended last third (stocks, newer data: +0.27% vs +0.30% per trade;
// crypto +0.20% vs +0.21%) with a slightly smaller drawdown.
export const DEFAULT_EXITS: ExitPlan = { mode: "ladder", tpR: [1, 2, 3], fractions: [1 / 3, 1 / 3, 1 / 3], trailAtr: 3, slR: [0.5, 0.75], slFractions: [1 / 3, 1 / 3] };

export interface Legs {
  dir: 1 | -1;
  /** Raw entry price (before costs). R and the breakeven stop are measured from it. */
  ref: number;
  /** Risk per unit at entry: distance from ref to the first stop. */
  risk: number;
  stop: number;
  /** "single" plan only: the strategy's own target, or null. */
  target: number | null;
  /** How many take-profits have filled (ladder). */
  hits: number;
  /** Fraction of the original size still open (1 = all of it). */
  left: number;
  /** Best close since entry, for the trailing stop. */
  best: number;
  /** How many stepped stops have filled. */
  slHits?: number;
}
export type ExitReason = "stop" | "target" | "tp1" | "tp2" | "tp3" | "sl1" | "sl2" | "sl3" | "trail";
/** A partial or full close. `frac` is a fraction of the ORIGINAL size. */
export interface Fill { reason: ExitReason; px: number; frac: number }

export function openLegs(plan: ExitPlan, dir: 1 | -1, ref: number, stop: number, strategyTargetR?: number): Legs {
  const risk = dir * (ref - stop);
  const target = plan.mode === "single" && strategyTargetR ? ref + dir * strategyTargetR * risk : null;
  return { dir, ref, risk, stop, target, hits: 0, left: 1, best: ref };
}
/** Price of take-profit number k (0-based), or null when the plan has none. */
export const tpPrice = (L: Legs, plan: ExitPlan, k: number) => (plan.mode === "ladder" && k < plan.tpR.length ? L.ref + L.dir * plan.tpR[k] * L.risk : null);
/** The next price at which part of the position will be sold for a profit (for the screens). */
export const nextTarget = (L: Legs, plan: ExitPlan) => (plan.mode === "ladder" ? tpPrice(L, plan, L.hits) : L.target);

/** The next price at which part of the position closes at a loss (SL1, SL2, then the full stop), for the screens. */
export function nextStop(L: Legs, plan: ExitPlan): { px: number; name: string } {
  const k = L.slHits ?? 0;
  if (plan.mode === "ladder" && L.hits === 0 && plan.slR?.length && k < plan.slR.length) return { px: L.ref - L.dir * plan.slR[k] * L.risk, name: `SL${k + 1}` };
  return { px: L.stop, name: L.hits > 0 ? "rising stop" : plan.slR?.length ? `SL${plan.slR.length + 1}` : "stop" };
}
/** What happens inside one bar. Mutates L (left, hits, and the stop for later bars) and returns the fills in order. */
export function onBar(L: Legs, plan: ExitPlan, o: number, h: number, l: number): Fill[] {
  const fills: Fill[] = []; const d = L.dir;
  // Stepped stops: nearer partial stops first, each at its price or at the open if the bar gapped through it.
  if (plan.mode === "ladder" && L.hits === 0 && plan.slR?.length) {
    while ((L.slHits ?? 0) < plan.slR.length && L.left > 1e-9) {
      const k = L.slHits ?? 0; const lvl = L.ref - d * plan.slR[k] * L.risk;
      if (!(d > 0 ? l <= lvl : h >= lvl) || (d > 0 ? lvl <= L.stop : lvl >= L.stop)) break;
      const frac = Math.min(L.left, plan.slFractions?.[k] ?? 0); if (!(frac > 0)) break;
      fills.push({ reason: `sl${k + 1}` as ExitReason, px: d > 0 ? Math.min(o, lvl) : Math.max(o, lvl), frac }); L.left -= frac; L.slHits = k + 1;
    }
    if (L.left < 1e-6) { L.left = 0; return fills; }
  }
  if (d > 0 ? l <= L.stop : h >= L.stop) {
    // Names: with stepped stops, the full stop before TP1 is SL3; after TP1 the stop protects profit ("trail").
    const reason: ExitReason = plan.mode === "ladder" && L.hits > 0 ? "trail" : plan.mode === "ladder" && plan.slR?.length ? "sl3" : "stop";
    fills.push({ reason, px: d > 0 ? Math.min(o, L.stop) : Math.max(o, L.stop), frac: L.left }); L.left = 0; return fills;
  }
  if (fills.length) return fills; // a bar that touched a stepped stop takes no profit as well (the cautious choice)
  if (plan.mode === "single") {
    if (L.target != null && (d > 0 ? h >= L.target : l <= L.target)) { fills.push({ reason: "target", px: L.target, frac: L.left }); L.left = 0; }
    return fills;
  }
  let newStop = L.stop;
  while (L.left > 1e-9 && L.hits < plan.tpR.length) {
    const tp = tpPrice(L, plan, L.hits)!;
    if (!(d > 0 ? h >= tp : l <= tp)) break;
    // If the fractions add up to less than 1, the rest is a "runner": no fixed target, it closes on the trailing stop or the strategy's exit rule.
    const frac = Math.min(L.left, plan.fractions[L.hits] ?? L.left);
    fills.push({ reason: `tp${L.hits + 1}` as ExitReason, px: tp, frac }); L.left -= frac; L.hits++;
    // After TP1 the stop goes to the entry price; after TP2 to TP1's price. Never backwards.
    const lock = L.hits === 1 ? L.ref : tpPrice(L, plan, L.hits - 2)!;
    newStop = d > 0 ? Math.max(newStop, lock) : Math.min(newStop, lock);
  }
  if (L.left < 1e-6) L.left = 0;
  L.stop = newStop;
  return fills;
}
/** At the close of a bar: move the trailing stop (ladder, after the first take-profit). It only counts from the next bar. */
export function onClose(L: Legs, plan: ExitPlan, c: number, atr: number): void {
  L.best = L.dir > 0 ? Math.max(L.best, c) : Math.min(L.best, c);
  if (plan.mode !== "ladder" || L.hits < 1 || !(plan.trailAtr > 0) || !(atr > 0)) return;
  const trail = L.best - L.dir * plan.trailAtr * atr;
  L.stop = L.dir > 0 ? Math.max(L.stop, trail) : Math.min(L.stop, trail);
}
