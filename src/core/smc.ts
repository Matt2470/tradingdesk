// Port of the owner's TradingView "SMC Indicator" (docs/smc-indicator.pine): a liquidity sweep followed by a
// break of structure, and the order block (OB) that started the breaking move.
// Only the signal logic is ported; lines, labels and boxes are drawing and are not needed here.
// Like the Pine script, a pivot is only known `len` bars after it happened, so nothing here looks ahead.
import type { Series } from "./indicators";

export interface SmcParams { slen: number; len: number; maxBars: number }
export const SMC_DEFAULTS: SmcParams = { slen: 20, len: 15, maxBars: 50 }; // the script's own defaults
const WICK_PCT = 50, OB_EXT = 200, OB_LOOKBACK = 100, OB_MAX = 100;          // script defaults for the order block
export interface SmcSignals {
  /** 1 at the bar whose close completes sweep + break of structure. */ bull: Series; bear: Series;
  /** Extreme of the sweep leg at that bar: lowest low (bull) or highest high (bear). */ stop: Series;
  /** 1 at the first bar where price comes back into a still-valid order block and closes on the right side of its far edge. */ obBull: Series; obBear: Series;
  /** Far edge of the touched order block: its bottom (bull) or top (bear). */ obStop: Series;
}

/** Value of the pivot confirmed at bar i (the pivot itself sits at i-len), or NaN. Same rule as ta.pivothigh / ta.pivotlow. */
function pivot(v: Series, len: number, i: number, high: boolean): number {
  const c = i - len; if (c - len < 0) return NaN; const p = v[c];
  for (let j = c - len; j < c; j++) if (high ? v[j] > p : v[j] < p) return NaN;
  for (let j = c + 1; j <= i; j++) if (high ? v[j] >= p : v[j] <= p) return NaN;
  return p;
}

/** Settings fixed as in the script defaults: sweep candle must close back inside; break confirmed by a close; OB zone "Auto". */
export function smcSignals(o: Series, h: Series, l: Series, c: Series, p: SmcParams = SMC_DEFAULTS): SmcSignals {
  const n = c.length; const z = () => new Array(n).fill(0), q = () => new Array(n).fill(NaN);
  const bull = z(), bear = z(), stop = q(), obBull = z(), obBear = z(), obStop = q();
  let sHigh = NaN, sLow = NaN, sHighBrk = false, sLowBrk = false, trend = 0;
  let lastPH = NaN, lastPL = NaN, phUsed = false, plUsed = false, iHighBrk = false, iLowBrk = false, iTrend = 0;
  let bPend = false, bSwBar = 0, bSwExt = NaN, bBos = NaN, sPend = false, sSwBar = 0, sSwExt = NaN, sBos = NaN;
  let boxes: { dir: 1 | -1; top: number; bot: number; start: number }[] = [];
  // OB = last opposite candle at or before the extreme of the leg that makes the break (makeOB in the script).
  const makeOB = (dir: 1 | -1, fromBar: number, i: number) => {
    let ext = i; for (let k = i; k >= fromBar; k--) if (dir === 1 ? l[k] < l[ext] : h[k] > h[ext]) ext = k;
    for (let j = ext; j >= Math.max(0, ext - OB_LOOKBACK); j--) {
      if (dir === 1 ? c[j] < o[j] : c[j] > o[j]) {
        const bTop = Math.max(o[j], c[j]), bBot = Math.min(o[j], c[j]), body = bTop - bBot;
        const top = h[j] - bTop > (body * WICK_PCT) / 100 ? bTop : h[j], bot = bBot - l[j] > (body * WICK_PCT) / 100 ? bBot : l[j];
        boxes.push({ dir, top, bot, start: i }); if (boxes.length > OB_MAX) boxes.shift();
        return;
      }
    }
  };
  for (let i = 0; i < n; i++) {
    const sph = pivot(h, p.slen, i, true), spl = pivot(l, p.slen, i, false);
    if (!isNaN(sph)) { sHigh = sph; sHighBrk = false; }
    if (!isNaN(spl)) { sLow = spl; sLowBrk = false; }
    if (!isNaN(sHigh) && !sHighBrk && c[i] > sHigh) { trend = 1; sHighBrk = true; }
    if (!isNaN(sLow) && !sLowBrk && c[i] < sLow) { trend = -1; sLowBrk = true; }
    const ph = pivot(h, p.len, i, true), pl = pivot(l, p.len, i, false);
    if (!isNaN(ph)) { lastPH = ph; phUsed = false; iHighBrk = false; }
    if (!isNaN(pl)) { lastPL = pl; plUsed = false; iLowBrk = false; }
    if (!isNaN(lastPH) && !iHighBrk && c[i] > lastPH) { iTrend = 1; iHighBrk = true; }
    if (!isNaN(lastPL) && !iLowBrk && c[i] < lastPL) { iTrend = -1; iLowBrk = true; }
    const bullTrend = trend === 1 && iTrend === 1, bearTrend = trend === -1 && iTrend === -1;
    // Order blocks made on earlier bars: a touch retires the box; so does old age.
    boxes = boxes.filter(b => {
      const touched = i > b.start && (b.dir === 1 ? l[i] <= b.top : h[i] >= b.bot);
      if (touched && (b.dir === 1 ? c[i] > b.bot : c[i] < b.top)) { if (b.dir === 1) { obBull[i] = 1; obStop[i] = b.bot; } else { obBear[i] = 1; obStop[i] = b.top; } }
      return !(touched || i - b.start >= OB_EXT);
    });
    // Bullish: sell-side sweep, then a close above the last internal pivot high.
    if (bPend && i > bSwBar) {
      if (c[i] > bBos) { bull[i] = 1; let m = Infinity; for (let j = bSwBar; j <= i; j++) if (l[j] < m) m = l[j]; stop[i] = m; bPend = false; makeOB(1, bSwBar, i); }
      else if (c[i] < bSwExt || i - bSwBar >= p.maxBars || trend !== 1) bPend = false;
    }
    if (!plUsed && !isNaN(lastPL) && l[i] < lastPL) {
      plUsed = true;
      if (bullTrend && c[i] > lastPL && !isNaN(lastPH)) { bPend = true; bSwBar = i; bSwExt = l[i]; bBos = lastPH; }
    }
    // Bearish: buy-side sweep, then a close below the last internal pivot low.
    if (sPend && i > sSwBar) {
      if (c[i] < sBos) { bear[i] = 1; let m = -Infinity; for (let j = sSwBar; j <= i; j++) if (h[j] > m) m = h[j]; stop[i] = m; sPend = false; makeOB(-1, sSwBar, i); }
      else if (c[i] > sSwExt || i - sSwBar >= p.maxBars || trend !== -1) sPend = false;
    }
    if (!phUsed && !isNaN(lastPH) && h[i] > lastPH) {
      phUsed = true;
      if (bearTrend && c[i] < lastPH && !isNaN(lastPL)) { sPend = true; sSwBar = i; sSwExt = h[i]; sBos = lastPL; }
    }
  }
  return { bull, bear, stop, obBull, obBear, obStop };
}
