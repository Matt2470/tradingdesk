// Deterministic synthetic price history for tests and the smoke run. NEVER used by the real app:
// it only writes into the directory given as TD_DATA_DIR, and refuses to write into the real data folder.
import { join, resolve } from "node:path";
import { ROOT, universe, writeJson } from "../src/config";
import type { Bar } from "../src/core/strategies";

import { rng } from "../src/core/robust";
export function synthBars(seed: number, n: number, endDate: string, weekdaysOnly: boolean, drift = 0.0004, vol = 0.02): Bar[] {
  const r = rng(seed); const gauss = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
  const dates: string[] = []; const d = new Date(endDate + "T00:00:00Z");
  while (dates.length < n) { const wd = d.getUTCDay(); if (!weekdaysOnly || (wd !== 0 && wd !== 6)) dates.unshift(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() - 1); }
  const bars: Bar[] = []; let c = 50 + r() * 100; let regime = drift;
  for (let i = 0; i < n; i++) {
    if (i % 120 === 0) regime = drift * (r() < 0.3 ? -2 : 2.5);
    const o = c * (1 + gauss() * vol * 0.3); c = o * (1 + regime + gauss() * vol);
    const h = Math.max(o, c) * (1 + Math.abs(gauss()) * vol * 0.4), l = Math.min(o, c) * (1 - Math.abs(gauss()) * vol * 0.4);
    bars.push({ d: dates[i], o, h, l, c, v: 1e6 * (0.5 + r()) });
  }
  return bars;
}
export function writeFixtures(dataDir: string, endDate = "2026-11-13", n = 1000) {
  if (resolve(dataDir) === join(ROOT, "data")) throw new Error("Refusing to write synthetic prices into the real data folder.");
  universe().forEach((s, k) => writeJson(join(dataDir, "cache", "bars", s.symbol + ".json"), { symbol: s.symbol, source: "synthetic-test-data", fetchedAt: new Date().toISOString(), meta: { gmtoffset: 0, regularEnd: null, price: null, currency: "USD" }, bars: synthBars(1000 + k, n, endDate, s.class !== "crypto", 0.0004, s.class === "crypto" ? 0.035 : 0.022) }));
}
/** Synthetic intraday bars (15m, 30m, 1h) for every symbol except the benchmarks. Keys like "2026-11-13T07:15" (UTC). */
export function writeIntradayFixtures(dataDir: string, end = "2026-11-13T23:45", n = 1500) {
  if (resolve(dataDir) === join(ROOT, "data")) throw new Error("Refusing to write synthetic prices into the real data folder.");
  const t1 = Date.parse(end + ":00Z");
  for (const [tf, min] of [["15m", 15], ["30m", 30], ["1h", 60]] as const) universe().filter(s => s.class !== "index").forEach((s, k) => {
    const last = Math.floor(t1 / (min * 60000)) * min * 60000;
    const bars = synthBars(5000 + k * 7 + min, n, "2026-01-01", false, 0.0002, s.class === "crypto" ? 0.008 : 0.005).map((b, i) => ({ ...b, d: new Date(last - (n - 1 - i) * min * 60000).toISOString().slice(0, 16) }));
    writeJson(join(dataDir, "cache", "bars", `${s.symbol}.${tf}.json`), { symbol: s.symbol, source: "synthetic-test-data", fetchedAt: new Date().toISOString(), meta: { gmtoffset: 0, regularEnd: null, price: null, currency: "USD" }, bars });
  });
}
if (import.meta.main) { const dir = process.env.TD_DATA_DIR; if (!dir) throw new Error("Set TD_DATA_DIR to a temp folder first."); writeFixtures(dir); writeIntradayFixtures(dir); console.log("Synthetic fixtures written to " + dir); }
