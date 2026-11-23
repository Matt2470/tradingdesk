// "Behaviour" of a symbol right now, in words a beginner can use.
import { buildCtx, I, type Bar } from "./strategies";

export interface Regime { trend: "uptrend" | "downtrend" | "sideways"; character: "trending" | "choppy"; atrPct: number; relVolume: number; efficiency: number; suits: "trend" | "mean-reversion"; note: string }

export function classify(bars: Bar[]): Regime | null {
  const x = buildCtx(bars); const i = x.n - 1; if (x.n < 210) return null;
  const c = x.c[i], s50 = I.sma(x, 50), s200 = I.sma(x, 200);
  const slope = s50[i] / s50[i - 20] - 1;
  const trend = c > s200[i] && s50[i] > s200[i] && slope > 0 ? "uptrend" : c < s200[i] && s50[i] < s200[i] && slope < 0 ? "downtrend" : "sideways";
  const er = I.er(x, 60)[i]; const character = er >= 0.25 ? "trending" : "choppy";
  const atrPct = (I.atr(x, 14)[i] / c) * 100; const va = I.volAvg(x, 20)[i]; const relVolume = va > 0 ? x.v[i] / va : 1;
  const suits = character === "trending" ? "trend" : "mean-reversion";
  const note = trend === "downtrend" ? "Below its long-term average and falling. Only the short strategies look for trades here; the long ones stay out."
    : character === "trending" ? "Moving in a fairly straight line. Trend-following rules fit this behaviour."
    : "Moving back and forth without direction. Buy-the-dip rules fit this behaviour better than breakouts.";
  return { trend, character, atrPct, relVolume, efficiency: er, suits, note };
}
