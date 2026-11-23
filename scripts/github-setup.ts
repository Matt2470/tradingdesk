// Puts TradingDesk on the owner's public GitHub repository and hands the four bots over to GitHub (every 15 minutes).
//   bun run scripts/github-setup.ts https://github.com/<owner>/<repo>    first time (github-setup.bat asks for the address)
//   bun run scripts/github-setup.ts --update                             later: publish code changes (github-update.bat)
// What it does, in order, and it stops at the first problem:
//   1. checks that Git is installed (sign-in to GitHub happens in Git's own window: no password or key is stored here);
//   2. copies deploy/github-workflow-bots.yml to .github/workflows/bots.yml;
//   3. stages files with the allow-list .gitignore and REFUSES to publish if anything outside the allowed folders, or
//      anything that looks like a key or password, is in the list;
//   4. commits and pushes to the main branch;
//   5. (first time) pushes the bots' current state to the bot-data branch so GitHub continues the same bots;
//   6. (first time) sets settings.remote so this PC only shows the bots and never trades them a second time.
// Nothing here can place an order. It never reads or sends data/imports, data/feedback.json or scout-to-alert/.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(import.meta.dir, "..");
const ALLOWED = [".gitignore", "CLAUDE.md", "README.md", "package.json", "start.vbs", "setup.bat", "restart.bat", "remove-from-startup.bat", "github-setup.bat", "github-update.bat"];
const ALLOWED_DIRS = ["config/", "docs/", "scripts/", "src/", "tests/", "web/", "deploy/", ".github/"];
const SECRET = /(sk-ant-[A-Za-z0-9_-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|(api|secret)[_-]?key\s*[=:]\s*["']?[A-Za-z0-9_\-]{16,}|password\s*[=:]\s*["']?[^\s"']{6,})/i;

function git(args: string[], cwd = ROOT, quiet = false): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", stdio: quiet ? "pipe" : ["inherit", "pipe", "pipe"] });
  if (r.error) throw new Error(`Git could not be started (${r.error.message}). Install Git for Windows first: open PowerShell and run  winget install --id Git.Git -e  then try again.`);
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed:\n${(r.stderr || r.stdout || "").trim()}`);
  return (r.stdout ?? "").trim();
}
const say = (m: string) => console.log(m);
function stop(m: string): never { console.error("\nSTOPPED: " + m + "\nNothing was published."); process.exit(1); }

const update = process.argv.includes("--update");
const url = process.argv.slice(2).find(a => a.startsWith("http"));
try { git(["--version"], ROOT, true); } catch (e) { stop((e as Error).message); }

// 1. Which repository
let repo = "";
if (!update) {
  const m = url?.trim().replace(/\.git$/, "").replace(/\/$/, "").match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!m) stop("Give the repository address like https://github.com/your-name/tradingdesk (create it on github.com first: Public, no README).");
  repo = `${m[1]}/${m[2]}`;
}

// 2. The workflow file
const wf = join(ROOT, ".github", "workflows", "bots.yml"); mkdirSync(dirname(wf), { recursive: true });
cpSync(join(ROOT, "deploy", "github-workflow-bots.yml"), wf);

// 3. Stage and check
if (!existsSync(join(ROOT, ".git"))) { git(["init", "-q"]); git(["checkout", "-q", "-b", "main"]); }
const has = (args: string[]) => { try { return git(args, ROOT, true).length > 0; } catch { return false; } };
if (!has(["config", "user.email"])) { git(["config", "user.name", "TradingDesk owner"]); git(["config", "user.email", "tradingdesk-owner@users.noreply.github.com"]); }
git(["add", "-A"]);
const staged = git(["diff", "--cached", "--name-only"], ROOT, true).split(/\r?\n/).filter(Boolean);
const all = git(["ls-files"], ROOT, true).split(/\r?\n/).filter(Boolean);
const outside = all.filter(f => !ALLOWED.includes(f) && !ALLOWED_DIRS.some(d => f.startsWith(d)));
const forbidden = all.filter(f => /^data\//.test(f) || /^scout-to-alert\//.test(f) || /(^|\/)\.env/.test(f));
if (outside.length || forbidden.length) { git(["reset", "-q"]); stop(`these files are not allowed in the public repository:\n  ${[...new Set([...forbidden, ...outside])].slice(0, 20).join("\n  ")}`); }
const leaks = all.filter(f => { try { if (statSync(join(ROOT, f)).size > 2_000_000) return false; return SECRET.test(readFileSync(join(ROOT, f), "utf8")); } catch { return false; } });
if (leaks.length) { git(["reset", "-q"]); stop(`these files contain something that looks like a key or a password; remove it first:\n  ${leaks.join("\n  ")}`); }
say(`Checked ${all.length} files: only the app's own folders, no data, no keys.`);

// 4. Commit and push the code
if (staged.length) git(["commit", "-q", "-m", update ? "Update TradingDesk" : "TradingDesk"]);
if (!update) { const remotes = git(["remote"], ROOT, true).split(/\s+/); git(remotes.includes("origin") ? ["remote", "set-url", "origin", `https://github.com/${repo}.git`] : ["remote", "add", "origin", `https://github.com/${repo}.git`]); }
git(["branch", "-M", "main"]);
say("Sending the code to GitHub (a GitHub sign-in window may open the first time)...");
git(["push", "-u", "origin", "main"]);
if (update) { say("\nDone: GitHub runs the new code from its next check."); process.exit(0); }

// 5. Hand the bots over: their current state goes to the bot-data branch, so GitHub continues the same bots.
const { publishedFiles } = await import("../src/pipeline");
const out = join(tmpdir(), `td-bot-data-${Date.now()}`); mkdirSync(out, { recursive: true }); let n = 0;
for (const [path, local] of publishedFiles()) if (existsSync(local)) { const dest = join(out, path); mkdirSync(dirname(dest), { recursive: true }); cpSync(local, dest); n++; }
writeFileSync(join(out, "heartbeat.json"), JSON.stringify({ at: new Date().toISOString(), seededFrom: "the owner's PC" }, null, 1));
writeFileSync(join(out, "README.md"), "# TradingDesk bot data\n\nThe four paper bots' state and the competition scoreboard, written by the Bots workflow every 15 minutes. Pretend money only.\n");
git(["init", "-q"], out); git(["checkout", "-q", "-b", "bot-data"], out);
git(["config", "user.name", "TradingDesk owner"], out); git(["config", "user.email", "tradingdesk-owner@users.noreply.github.com"], out);
git(["add", "-A"], out); git(["commit", "-q", "-m", "Bots handed over from the PC"], out);
git(["push", "-q", "-f", `https://github.com/${repo}.git`, "bot-data"], out);
rmSync(out, { recursive: true, force: true });
say(`Handed over ${n} bot files to the bot-data branch.`);

// 6. This PC now only shows the bots.
const sp = join(ROOT, "config", "settings.json"); const settings = JSON.parse(readFileSync(sp, "utf8"));
settings.remote = { repo, branch: "bot-data" }; writeFileSync(sp, JSON.stringify(settings, null, 2) + "\n");
say(`\nDone. The bots now trade on GitHub every 15 minutes; this PC only shows them.
Next:
  1. Open https://github.com/${repo}/actions , click "Bots", then "Run workflow" to start the first check now.
  2. Run restart.bat on this PC.
(config/settings.json now has "remote"; to bring the bots back to this PC, set it to null and restart.)`);
