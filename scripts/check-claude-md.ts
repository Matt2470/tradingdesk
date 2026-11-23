// Keeps CLAUDE.md honest: every file path, bun command, strategy id and API route it names must exist.
// Run with: bun run check:docs   (also part of: bun run check)
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../src/config";
import { STRATEGIES } from "../src/core/strategies";

const md = readFileSync(join(ROOT, "CLAUDE.md"), "utf8"); const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")); const server = readFileSync(join(ROOT, "src", "server.ts"), "utf8");
const problems: string[] = []; const ticks = [...md.matchAll(/`([^`\n]+)`/g)].map(m => m[1]);
for (const t of ticks) {
  const run = /^bun run ([\w:-]+)/.exec(t); if (run && !pkg.scripts[run[1]] && !existsSync(join(ROOT, run[1]))) problems.push(`command \`${t}\`: no script "${run[1]}" in package.json`);
  if (/^(src|scripts|tests|web|config|docs|data)\/[\w./-]+$/.test(t) && !t.includes("YYYY") && !t.startsWith("data/") && !existsSync(join(ROOT, t))) problems.push(`path \`${t}\` does not exist`);
  if (/^(CLAUDE\.md|README\.md|package\.json|setup\.bat|start\.vbs|remove-from-startup\.bat)$/.test(t) && !existsSync(join(ROOT, t))) problems.push(`file \`${t}\` does not exist`);
  if (/^\/api\/[\w-]+$/.test(t) && !server.includes(`"${t}"`)) problems.push(`route \`${t}\` is not defined in src/server.ts`);
}
for (const s of STRATEGIES) if (!md.includes("`" + s.id + "`")) problems.push(`strategy \`${s.id}\` exists in code but is not listed in CLAUDE.md`);
for (const id of [...md.matchAll(/^\| `([a-z0-9_]+)` \|/gm)].map(m => m[1])) if (!STRATEGIES.some(s => s.id === id)) problems.push(`CLAUDE.md lists strategy \`${id}\` that is not in src/core/strategies.ts`);
for (const sec of ["## Definition of done", "## Checks to run before saying a task is finished", "## Invariants", "## Stop and ask"]) if (!md.includes(sec)) problems.push(`section "${sec}" is missing`);
if (problems.length) { console.error("CLAUDE.md is out of date:\n - " + problems.join("\n - ")); process.exit(1); }
console.log(`CLAUDE.md check passed: ${ticks.length} references verified against the project.`);
