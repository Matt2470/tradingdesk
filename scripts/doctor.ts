// Health check for this machine. Run with: bun run doctor
// Local problems (config, folders) make it exit with code 1. Network problems are reported but do not fail it.
import { join } from "node:path";
import { existsSync, mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { ROOT, DATA, P, settings, universe } from "../src/config";
import { fetchSymbol } from "../src/data/prices";
import { STRATEGIES } from "../src/core/strategies";

let failed = false; const line = (ok: boolean | null, msg: string) => { console.log(`${ok === null ? "[warn]" : ok ? "[ ok ]" : "[FAIL]"} ${msg}`); if (ok === false) failed = true; };
console.log(`TradingDesk doctor\nBun ${Bun.version} on ${process.platform}\nProject: ${ROOT}\n`);
try { const s = settings(), u = universe(); line(true, `Config readable: ${u.length} symbols, ${STRATEGIES.length} strategies, port ${s.port}.`); const dup = u.map(x => x.symbol).filter((x, i, a) => a.indexOf(x) !== i); if (dup.length) line(false, `Duplicate symbols in config/universe.json: ${dup.join(", ")}`); } catch (e) { line(false, (e as Error).message); }
try { mkdirSync(DATA, { recursive: true }); const t = join(DATA, ".write-test"); writeFileSync(t, "x"); rmSync(t); line(true, `Data folder is writable: ${DATA}`); } catch (e) { line(false, `Cannot write to ${DATA}: ${(e as Error).message}`); }
const csv = existsSync(P.imports) ? readdirSync(P.imports, { recursive: true }).filter(f => String(f).toLowerCase().endsWith(".csv")).length : 0;
line(csv ? true : null, csv ? `${csv} trade export file(s) in data/imports.` : "No trade exports in data/imports yet. The My trades screen stays empty until you add them.");
const briefs = existsSync(P.briefs) ? readdirSync(P.briefs).filter(f => f.endsWith(".json")).length : 0;
line(briefs ? true : null, briefs ? `${briefs} morning brief(s) in data/briefs.` : "No morning brief yet. The Claude scheduled task writes the first one on its next morning run.");
if (!process.argv.includes("--offline")) {
  console.log("\nChecking market data (needs internet)...");
  for (const sym of ["NVDA", "BTC", "XAU"]) {
    const s = universe().find(x => x.symbol === sym); if (!s) continue; const r = await fetchSymbol(s);
    line(r.ok ? true : null, r.ok ? `${sym}: ${r.bars} daily bars from ${r.source}, last ${r.lastBar}.` : `${sym}: download failed (${r.error}).`);
  }
}
console.log(failed ? "\nSomething local needs fixing (see FAIL lines)." : "\nLocal setup is fine.");
process.exit(failed ? 1 : 0);
