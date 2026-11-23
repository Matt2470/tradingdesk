// Headless run of the bots, for GitHub Actions (every 15 minutes): live prices, then one full refresh
// (downloads, strategy checks, the four competition bots, the scoreboard), then the files to publish are copied into
// an output folder. No server, no browser. Paper money only: nothing here can send an order.
//   bun run engine                   run once
//   bun run engine --publish <dir>   also copy the bots' public files into <dir> (the workflow pushes it to the data branch)
import { cpSync, mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { settings, P } from "../src/config";
import { refresh, tick, publishedFiles } from "../src/pipeline";

const st = settings();
if (st.remote?.repo) { console.error("settings.remote is set: this PC only reads the bots, GitHub trades them. (GitHub runs the engine with TD_ENGINE=1.)"); process.exit(1); }
const t0 = Date.now(); const now = Date.now();
const tk = await tick(now).catch(e => ({ updated: 0, errors: [String(e.message ?? e)] }));
const r = await refresh({ fetch: true, now });
const bad = r.fetch.filter(f => !f.ok);
console.log(`Live prices: ${tk.updated} updated${tk.errors.length ? `, ${tk.errors.length} errors` : ""}. Refresh: ${r.symbolsWithData} symbols, ${r.retested} charts re-tested, ${bad.length} downloads failed, ${((Date.now() - t0) / 1000).toFixed(0)} s.`);

const i = process.argv.indexOf("--publish");
if (i > 0) {
  const out = process.argv[i + 1]; if (!out) throw new Error("--publish needs a folder");
  // Only these files leave the machine: the bots' state, their screens' data and the scoreboard. Never data/imports or feedback.
  for (const [path, local] of [...publishedFiles(st), ["derived/status.json", join(P.derived, "status.json")] as [string, string]]) {
    if (!existsSync(local)) continue; const dest = join(out, path); mkdirSync(dirname(dest), { recursive: true }); cpSync(local, dest);
  }
  writeFileSync(join(out, "heartbeat.json"), JSON.stringify({ at: new Date().toISOString(), tookMs: Date.now() - t0, symbols: r.symbolsWithData, failedDownloads: bad.length, liveErrors: tk.errors.length }, null, 1));
  writeFileSync(join(out, "README.md"), "# TradingDesk bot data\n\nWritten by the Bots workflow every 15 minutes: the four paper bots' state and the competition scoreboard.\nPretend money only. The TradingDesk app on the owner's PC reads these files when `remote` is set in config/settings.json.\n");
  console.log(`Published to ${out}.`);
}
