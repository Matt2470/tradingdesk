// Strategy library. A strategy only answers two questions at the close of bar i:
// "enter?" and "exit?". Orders are filled by the engine at the NEXT bar's open.
// Every strategy is defined by a rule (`build`) and its settings (`params`). The settings are fixed textbook
// values (or the owner's indicator defaults) and are never tuned to past data. `variants()` moves each setting
// 25% down and up, one at a time, ONLY to show how fragile a result is; a variant is never traded.
import { sma, ema, rsi, atr, highest, lowest, stdev, efficiency, supertrend, macd, type Series } from "./indicators";

export interface Bar { d: string; o: number; h: number; l: number; c: number; v: number }
export interface Ctx { n: number; d: string[]; o: Series; h: Series; l: Series; c: Series; v: Series; ind: (key: string, make: () => Series) => Series; memo: <T>(key: string, make: () => T) => T }

export function buildCtx(bars: Bar[]): Ctx {
  const cache = new Map<string, unknown>();
  const memo = <T,>(key: string, make: () => T): T => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key) as T; };
  return { n: bars.length, d: bars.map(b => b.d), o: bars.map(b => b.o), h: bars.map(b => b.h), l: bars.map(b => b.l), c: bars.map(b => b.c), v: bars.map(b => b.v), ind: memo, memo };
}
export const I = {
  sma: (x: Ctx, p: number) => x.ind("sma" + p, () => sma(x.c, p)),
  ema: (x: Ctx, p: number) => x.ind("ema" + p, () => ema(x.c, p)),
  rsi: (x: Ctx, p: number) => x.ind("rsi" + p, () => rsi(x.c, p)),
  atr: (x: Ctx, p: number) => x.ind("atr" + p, () => atr(x.h, x.l, x.c, p)),
  hh: (x: Ctx, p: number) => x.ind("hh" + p, () => highest(x.h, p)),
  ll: (x: Ctx, p: number) => x.ind("ll" + p, () => lowest(x.l, p)),
  sd: (x: Ctx, p: number) => x.ind("sd" + p, () => stdev(x.c, p)),
  er: (x: Ctx, p: number) => x.ind("er" + p, () => efficiency(x.c, p)),
  volAvg: (x: Ctx, p: number) => x.ind("vavg" + p, () => sma(x.v, p)),
  st: (x: Ctx, p: number, m: number) => x.ind(`st${p}:${m}`, () => supertrend(x.h, x.l, x.c, p, m)),
  macd: (x: Ctx, f: number, s: number, g: number) => x.memo(`macd${f}:${s}:${g}`, () => macd(x.c, f, s, g)),
  /** Bollinger bandwidth: band width as a share of the middle line. */
  bw: (x: Ctx, p: number) => x.ind("bw" + p, () => { const m = I.sma(x, p), d = I.sd(x, p); return m.map((v, i) => (4 * d[i]) / v); }),
  bwLow: (x: Ctx, p: number, look: number) => x.ind(`bwlow${p}:${look}`, () => lowest(I.bw(x, p), look)),
};

type P = Record<string, number>;
interface Rule { warmup: number; entry(x: Ctx, i: number): boolean; exit(x: Ctx, i: number, barsHeld: number): boolean; stopPrice?(x: Ctx, i: number): number }
export interface Strategy extends Rule {
  id: string; name: string; family: "trend" | "mean-reversion";
  /** "long" profits when price rises, "short" when it falls. Short ids end in _short. */
  side: "long" | "short";
  /** One plain sentence a beginner can follow. */
  plain: string;
  indicators: string[];
  /** Stop distance in ATR(14) multiples, measured at the signal bar. Used unless stopPrice is given. */
  stopAtr: number;
  /** Optional: take profit when the trade has earned this many times its initial risk (3 = reward 3 for each 1 risked). */
  targetR?: number;
  /** The settings this strategy runs with. */
  params: P;
}
interface Def extends Omit<Strategy, keyof Rule | "side"> { /** Settings that are not whole numbers of bars. */ floats?: string[]; build(p: P): Rule }

const LONG: Def[] = [
  {
    id: "donchian_trend", name: "20-bar breakout", family: "trend", stopAtr: 3, params: { entry: 20, exit: 10, trend: 200 },
    plain: "Buy when price closes above its highest high of the last 20 bars while above the 200-bar average; sell when it closes below the 10-bar low.",
    indicators: ["Donchian channel 20/10", "SMA 200"],
    build: p => ({ warmup: Math.max(p.trend, p.entry) + 1, entry: (x, i) => x.c[i] > I.hh(x, p.entry)[i - 1] && x.c[i] > I.sma(x, p.trend)[i], exit: (x, i) => x.c[i] < I.ll(x, p.exit)[i - 1] }),
  },
  {
    id: "ema_pullback", name: "Pullback to the 20-bar average", family: "trend", stopAtr: 2.5, params: { fast: 20, slow: 50 },
    plain: "In an uptrend (20-bar average above the 50-bar), buy when price dips to the 20-bar average and closes back above it; sell on a close below the 50-bar average.",
    indicators: ["EMA 20", "EMA 50"],
    build: p => ({ warmup: p.slow + 10, entry: (x, i) => { const f = I.ema(x, p.fast), s = I.ema(x, p.slow); return f[i] > s[i] && x.l[i] <= f[i] && x.c[i] > f[i] && x.c[i] > x.o[i]; }, exit: (x, i) => x.c[i] < I.ema(x, p.slow)[i] }),
  },
  {
    id: "ma_cross", name: "20/50 average crossover", family: "trend", stopAtr: 3, params: { fast: 20, slow: 50 },
    plain: "Buy when the 20-bar average crosses above the 50-bar average; sell when it crosses back below.",
    indicators: ["SMA 20", "SMA 50"],
    build: p => ({ warmup: p.slow + 2, entry: (x, i) => { const a = I.sma(x, p.fast), b = I.sma(x, p.slow); return a[i] > b[i] && a[i - 1] <= b[i - 1]; }, exit: (x, i) => I.sma(x, p.fast)[i] < I.sma(x, p.slow)[i] }),
  },
  {
    id: "rsi2_dip", name: "Short-term dip in an uptrend", family: "mean-reversion", stopAtr: 3, params: { rsi: 2, extreme: 10, trend: 200, exitAvg: 5, maxHold: 10 }, floats: ["extreme"],
    plain: "While price is above its 200-bar average, buy after a sharp 2-bar drop (RSI(2) under 10); sell when price closes above its 5-bar average, or after 10 bars.",
    indicators: ["RSI 2", "SMA 200", "SMA 5"],
    build: p => ({ warmup: p.trend + 1, entry: (x, i) => x.c[i] > I.sma(x, p.trend)[i] && I.rsi(x, p.rsi)[i] < p.extreme, exit: (x, i, held) => x.c[i] > I.sma(x, p.exitAvg)[i] || held >= p.maxHold }),
  },
  {
    id: "bollinger_dip", name: "Lower Bollinger band bounce", family: "mean-reversion", stopAtr: 3, params: { length: 20, bands: 2, trend: 200, maxHold: 15 }, floats: ["bands"],
    plain: "While price is above its 200-bar average, buy when it closes under the lower Bollinger band (20 bars, 2 deviations); sell at the 20-bar average, or after 15 bars.",
    indicators: ["Bollinger bands 20/2", "SMA 200"],
    build: p => ({ warmup: p.trend + 1, entry: (x, i) => x.c[i] > I.sma(x, p.trend)[i] && x.c[i] < I.sma(x, p.length)[i] - p.bands * I.sd(x, p.length)[i], exit: (x, i, held) => x.c[i] >= I.sma(x, p.length)[i] || held >= p.maxHold }),
  },
  // Added 2026-11-22 in place of the four SMC rules (owner: remove them and add what is worth testing). Three families
  // the list did not have: an ATR trend-follower, a momentum cross, and a breakout after a quiet spell. Textbook settings.
  {
    id: "supertrend", name: "Supertrend turns up", family: "trend", stopAtr: 3, params: { atr: 10, mult: 3, trend: 200 },
    plain: "Buy when the Supertrend line (10 bars, 3 times the average range) flips from above price to below it, while price is above its 200-bar average; sell when it flips back.",
    indicators: ["Supertrend 10/3", "SMA 200"], floats: ["mult"],
    build: p => ({ warmup: p.trend + 2, entry: (x, i) => { const d = I.st(x, p.atr, p.mult); return d[i] === 1 && d[i - 1] === -1 && x.c[i] > I.sma(x, p.trend)[i]; }, exit: (x, i) => I.st(x, p.atr, p.mult)[i] === -1 }),
  },
  {
    id: "macd_cross", name: "MACD momentum cross", family: "trend", stopAtr: 3, params: { fast: 12, slow: 26, signal: 9 },
    plain: "Buy when the MACD line (12/26) crosses above its 9-bar signal line while both are above zero (rising momentum in an uptrend); sell when it crosses back below.",
    indicators: ["MACD 12/26/9"],
    build: p => ({ warmup: p.slow + p.signal + 5, entry: (x, i) => { const m = I.macd(x, p.fast, p.slow, p.signal); return m.line[i] > m.signal[i] && m.line[i - 1] <= m.signal[i - 1] && m.signal[i] > 0; }, exit: (x, i) => { const m = I.macd(x, p.fast, p.slow, p.signal); return m.line[i] < m.signal[i]; } }),
  },
  {
    id: "squeeze_break", name: "Breakout after a quiet spell", family: "trend", stopAtr: 2.5, params: { length: 20, look: 120, recent: 5, trend: 200 },
    plain: "When the Bollinger bands (20 bars) have just been at their narrowest of the last 120 bars, buy the first close above the upper band while price is above its 200-bar average; sell on a close below the 20-bar average.",
    indicators: ["Bollinger bandwidth 20, lowest of 120", "SMA 200"],
    build: p => ({ warmup: Math.max(p.trend, p.look + p.length) + 2, entry: (x, i) => { const bw = I.bw(x, p.length), low = I.bwLow(x, p.length, p.look); let quiet = false; for (let k = 1; k <= p.recent; k++) if (bw[i - k] <= low[i - k] * 1.0001) quiet = true; return quiet && x.c[i] > I.sma(x, p.length)[i] + 2 * I.sd(x, p.length)[i] && x.c[i] > I.sma(x, p.trend)[i]; }, exit: (x, i) => x.c[i] < I.sma(x, p.length)[i] }),
  },
];
// Short versions: the same rules turned upside down.
const SHORT: Def[] = [
  {
    id: "donchian_trend_short", name: "20-bar breakdown (short)", family: "trend", stopAtr: 3, params: { entry: 20, exit: 10, trend: 200 },
    plain: "Sell short when price closes below its lowest low of the last 20 bars while below the 200-bar average; close when it closes above the 10-bar high.",
    indicators: ["Donchian channel 20/10", "SMA 200"],
    build: p => ({ warmup: Math.max(p.trend, p.entry) + 1, entry: (x, i) => x.c[i] < I.ll(x, p.entry)[i - 1] && x.c[i] < I.sma(x, p.trend)[i], exit: (x, i) => x.c[i] > I.hh(x, p.exit)[i - 1] }),
  },
  {
    id: "ema_pullback_short", name: "Bounce to the 20-bar average (short)", family: "trend", stopAtr: 2.5, params: { fast: 20, slow: 50 },
    plain: "In a downtrend (20-bar average below the 50-bar), sell short when price bounces up to the 20-bar average and closes back below it; close on a close above the 50-bar average.",
    indicators: ["EMA 20", "EMA 50"],
    build: p => ({ warmup: p.slow + 10, entry: (x, i) => { const f = I.ema(x, p.fast), s = I.ema(x, p.slow); return f[i] < s[i] && x.h[i] >= f[i] && x.c[i] < f[i] && x.c[i] < x.o[i]; }, exit: (x, i) => x.c[i] > I.ema(x, p.slow)[i] }),
  },
  {
    id: "ma_cross_short", name: "20/50 average cross down (short)", family: "trend", stopAtr: 3, params: { fast: 20, slow: 50 },
    plain: "Sell short when the 20-bar average crosses below the 50-bar average; close when it crosses back above.",
    indicators: ["SMA 20", "SMA 50"],
    build: p => ({ warmup: p.slow + 2, entry: (x, i) => { const a = I.sma(x, p.fast), b = I.sma(x, p.slow); return a[i] < b[i] && a[i - 1] >= b[i - 1]; }, exit: (x, i) => I.sma(x, p.fast)[i] > I.sma(x, p.slow)[i] }),
  },
  {
    id: "rsi2_dip_short", name: "Short-term spike in a downtrend (short)", family: "mean-reversion", stopAtr: 3, params: { rsi: 2, extreme: 10, trend: 200, exitAvg: 5, maxHold: 10 }, floats: ["extreme"],
    plain: "While price is below its 200-bar average, sell short after a sharp 2-bar rise (RSI(2) over 90); close when price closes below its 5-bar average, or after 10 bars.",
    indicators: ["RSI 2", "SMA 200", "SMA 5"],
    build: p => ({ warmup: p.trend + 1, entry: (x, i) => x.c[i] < I.sma(x, p.trend)[i] && I.rsi(x, p.rsi)[i] > 100 - p.extreme, exit: (x, i, held) => x.c[i] < I.sma(x, p.exitAvg)[i] || held >= p.maxHold }),
  },
  {
    id: "bollinger_dip_short", name: "Upper Bollinger band fade (short)", family: "mean-reversion", stopAtr: 3, params: { length: 20, bands: 2, trend: 200, maxHold: 15 }, floats: ["bands"],
    plain: "While price is below its 200-bar average, sell short when it closes above the upper Bollinger band (20 bars, 2 deviations); close at the 20-bar average, or after 15 bars.",
    indicators: ["Bollinger bands 20/2", "SMA 200"],
    build: p => ({ warmup: p.trend + 1, entry: (x, i) => x.c[i] < I.sma(x, p.trend)[i] && x.c[i] > I.sma(x, p.length)[i] + p.bands * I.sd(x, p.length)[i], exit: (x, i, held) => x.c[i] <= I.sma(x, p.length)[i] || held >= p.maxHold }),
  },
  {
    id: "supertrend_short", name: "Supertrend turns down (short)", family: "trend", stopAtr: 3, params: { atr: 10, mult: 3, trend: 200 },
    plain: "Sell short when the Supertrend line (10 bars, 3 times the average range) flips from below price to above it, while price is below its 200-bar average; close when it flips back.",
    indicators: ["Supertrend 10/3", "SMA 200"], floats: ["mult"],
    build: p => ({ warmup: p.trend + 2, entry: (x, i) => { const d = I.st(x, p.atr, p.mult); return d[i] === -1 && d[i - 1] === 1 && x.c[i] < I.sma(x, p.trend)[i]; }, exit: (x, i) => I.st(x, p.atr, p.mult)[i] === 1 }),
  },
  {
    id: "macd_cross_short", name: "MACD momentum cross down (short)", family: "trend", stopAtr: 3, params: { fast: 12, slow: 26, signal: 9 },
    plain: "Sell short when the MACD line (12/26) crosses below its 9-bar signal line while both are below zero (falling momentum in a downtrend); close when it crosses back above.",
    indicators: ["MACD 12/26/9"],
    build: p => ({ warmup: p.slow + p.signal + 5, entry: (x, i) => { const m = I.macd(x, p.fast, p.slow, p.signal); return m.line[i] < m.signal[i] && m.line[i - 1] >= m.signal[i - 1] && m.signal[i] < 0; }, exit: (x, i) => { const m = I.macd(x, p.fast, p.slow, p.signal); return m.line[i] > m.signal[i]; } }),
  },
  {
    id: "squeeze_break_short", name: "Breakdown after a quiet spell (short)", family: "trend", stopAtr: 2.5, params: { length: 20, look: 120, recent: 5, trend: 200 },
    plain: "When the Bollinger bands (20 bars) have just been at their narrowest of the last 120 bars, sell short the first close below the lower band while price is below its 200-bar average; close on a close above the 20-bar average.",
    indicators: ["Bollinger bandwidth 20, lowest of 120", "SMA 200"],
    build: p => ({ warmup: Math.max(p.trend, p.look + p.length) + 2, entry: (x, i) => { const bw = I.bw(x, p.length), low = I.bwLow(x, p.length, p.look); let quiet = false; for (let k = 1; k <= p.recent; k++) if (bw[i - k] <= low[i - k] * 1.0001) quiet = true; return quiet && x.c[i] < I.sma(x, p.length)[i] - 2 * I.sd(x, p.length)[i] && x.c[i] < I.sma(x, p.trend)[i]; }, exit: (x, i) => x.c[i] > I.sma(x, p.length)[i] }),
  },
];
const DEFS: (Def & { side: "long" | "short" })[] = [...LONG.map(d => ({ ...d, side: "long" as const })), ...SHORT.map(d => ({ ...d, side: "short" as const }))];
const make = (d: (typeof DEFS)[number], p: P): Strategy => { const { build, floats: _f, ...meta } = d; return { ...meta, params: p, ...build(p) }; };
export const STRATEGIES: Strategy[] = DEFS.map(d => make(d, d.params));
export const strategyById = (id: string) => STRATEGIES.find(s => s.id === id);

/** The same rule with one setting moved 25% down or up. For the settings test only; never traded. */
export function variants(id: string): { label: string; strategy: Strategy }[] {
  const d = DEFS.find(q => q.id === id); if (!d) return []; const out: { label: string; strategy: Strategy }[] = [];
  for (const [k, v] of Object.entries(d.params)) for (const f of [0.75, 1.25]) {
    const nv = d.floats?.includes(k) ? +(v * f).toFixed(4) : Math.max(2, Math.round(v * f));
    if (nv !== v) out.push({ label: `${k} ${v} -> ${nv}`, strategy: make(d, { ...d.params, [k]: nv }) });
  }
  return out;
}
