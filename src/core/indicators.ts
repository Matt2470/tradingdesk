// Pure indicator functions. Each returns an array aligned with its input;
// positions before the warm-up period are NaN. Value at index i uses data up to and including i only.
export type Series = number[];
const nan = (n: number): Series => new Array(n).fill(NaN);

export function sma(x: Series, p: number): Series {
  const out = nan(x.length); let sum = 0;
  for (let i = 0; i < x.length; i++) { sum += x[i]; if (i >= p) sum -= x[i - p]; if (i >= p - 1) out[i] = sum / p; }
  return out;
}
export function ema(x: Series, p: number): Series {
  const out = nan(x.length); const k = 2 / (p + 1); let prev = NaN; let sum = 0;
  for (let i = 0; i < x.length; i++) {
    if (i < p - 1) { sum += x[i]; continue; }
    if (i === p - 1) { sum += x[i]; prev = sum / p; } else prev = x[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}
/** Wilder RSI. */
export function rsi(x: Series, p: number): Series {
  const out = nan(x.length); let g = 0, l = 0;
  for (let i = 1; i < x.length; i++) {
    const ch = x[i] - x[i - 1]; const up = Math.max(ch, 0), dn = Math.max(-ch, 0);
    if (i <= p) { g += up; l += dn; if (i === p) { g /= p; l /= p; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } }
    else { g = (g * (p - 1) + up) / p; l = (l * (p - 1) + dn) / p; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
  }
  return out;
}
/** Wilder ATR. */
export function atr(h: Series, l: Series, c: Series, p: number): Series {
  const out = nan(c.length); let a = 0;
  for (let i = 1; i < c.length; i++) {
    const tr = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
    if (i <= p) { a += tr; if (i === p) { a /= p; out[i] = a; } } else { a = (a * (p - 1) + tr) / p; out[i] = a; }
  }
  return out;
}
export function highest(x: Series, p: number): Series {
  const out = nan(x.length);
  for (let i = p - 1; i < x.length; i++) { let m = -Infinity; for (let j = i - p + 1; j <= i; j++) if (x[j] > m) m = x[j]; out[i] = m; }
  return out;
}
export function lowest(x: Series, p: number): Series {
  const out = nan(x.length);
  for (let i = p - 1; i < x.length; i++) { let m = Infinity; for (let j = i - p + 1; j <= i; j++) if (x[j] < m) m = x[j]; out[i] = m; }
  return out;
}
export function stdev(x: Series, p: number): Series {
  const out = nan(x.length); const m = sma(x, p);
  for (let i = p - 1; i < x.length; i++) { let s = 0; for (let j = i - p + 1; j <= i; j++) s += (x[j] - m[i]) ** 2; out[i] = Math.sqrt(s / p); }
  return out;
}
/** Kaufman efficiency ratio: 1 = straight line, 0 = pure noise. */
export function efficiency(x: Series, p: number): Series {
  const out = nan(x.length);
  for (let i = p; i < x.length; i++) { let path = 0; for (let j = i - p + 1; j <= i; j++) path += Math.abs(x[j] - x[j - 1]); out[i] = path === 0 ? 0 : Math.abs(x[i] - x[i - p]) / path; }
  return out;
}

/** Supertrend (ATR p, multiplier m): +1 while price rides above the lower band, -1 below the upper band, 0 while warming up. */
export function supertrend(h: Series, l: Series, c: Series, p: number, m: number): Series {
  const a = atr(h, l, c, p); const n = c.length; const dir: Series = new Array(n).fill(0);
  let fu = NaN, fl = NaN, d = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(a[i])) continue;
    const mid = (h[i] + l[i]) / 2, ub = mid + m * a[i], lb = mid - m * a[i];
    const pu = fu, pl = fl;
    fu = !Number.isFinite(pu) || ub < pu || c[i - 1] > pu ? ub : pu;
    fl = !Number.isFinite(pl) || lb > pl || c[i - 1] < pl ? lb : pl;
    if (d === 0) d = c[i] >= mid ? 1 : -1;
    else if (d === -1 && c[i] > fu) d = 1;
    else if (d === 1 && c[i] < fl) d = -1;
    dir[i] = d;
  }
  return dir;
}
/** MACD line (fast EMA minus slow EMA) and its signal line (EMA of the MACD line). */
export function macd(c: Series, fast: number, slow: number, sig: number): { line: Series; signal: Series } {
  const f = ema(c, fast), s = ema(c, slow); const line = c.map((_, i) => f[i] - s[i]);
  const first = line.findIndex(Number.isFinite); const signal: Series = new Array(c.length).fill(NaN);
  if (first >= 0) { const e = ema(line.slice(first), sig); for (let i = 0; i < e.length; i++) signal[first + i] = e[i]; }
  return { line, signal };
}
