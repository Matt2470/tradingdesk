// Shared bot state on GitHub (owner, 2026-11-24: "github is working but I can't see if they are working"). GitHub's
// 15-minute schedule runs late or not at all for hours, so the PC trades the bots too whenever it is on, and both
// pass the bots' state through the repository's bot-data branch with a compare-and-swap:
//   1. fetch bot-data and note its commit S; copy the bots' files from exactly that commit;
//   2. step the bots;
//   3. push a new single commit with `--force-with-lease=bot-data:S`. If someone else (GitHub or the PC) pushed in the
//      meantime the push is refused, this run's result is thrown away and the next run starts from theirs.
// So the bots are never stepped twice from the same state and no trade is lost. Git signs in with the credentials the
// owner gave it during github-setup (Git Credential Manager); nothing is stored in the project. Paper money only.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { DATA } from "../config";

export const SYNC_DIR = () => process.env.TD_SYNC_DIR ?? join(DATA, "sync"); // TD_SYNC_DIR: tests only
const ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" }; // never hang waiting for a window

function git(args: string[], cwd = SYNC_DIR()): { ok: boolean; out: string; err: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: ENV, timeout: 90_000, windowsHide: true });
  return { ok: !r.error && r.status === 0, out: (r.stdout ?? "").trim(), err: (r.error?.message ?? r.stderr ?? "").trim() };
}

function ensureRepo(repo: string): string | null {
  const dir = SYNC_DIR(); mkdirSync(dir, { recursive: true });
  if (!existsSync(join(dir, ".git"))) { const i = git(["init", "-q"]); if (!i.ok) return `git is not available: ${i.err}`; }
  git(["config", "user.name", "TradingDesk PC"]); git(["config", "user.email", "tradingdesk-owner@users.noreply.github.com"]);
  const url = `${process.env.TD_SYNC_BASE ?? "https://github.com/"}${repo}.git`; // TD_SYNC_BASE: tests only
  if (!git(["remote", "set-url", "origin", url]).ok) git(["remote", "add", "origin", url]);
  return null;
}

/** Copy the bots' files from the newest bot-data commit. Returns that commit (the lease for the push) or an error. */
export function syncPull(repo: string, branch: string, files: [string, string][]): { sha: string | null; error?: string; copied: number } {
  const bad = ensureRepo(repo); if (bad) return { sha: null, error: bad, copied: 0 };
  const f = git(["fetch", "-q", "--depth=1", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
  if (!f.ok) return { sha: null, error: `fetch failed: ${f.err.slice(0, 200)}`, copied: 0 };
  const sha = git(["rev-parse", `refs/remotes/origin/${branch}`]).out; if (!sha) return { sha: null, error: "bot-data branch not found", copied: 0 };
  let copied = 0;
  for (const [path, local] of files) {
    const r = git(["show", `${sha}:${path}`]); if (!r.ok) continue;
    mkdirSync(dirname(local), { recursive: true }); writeFileSync(local, r.out + "\n"); copied++;
  }
  return { sha, copied };
}

/** Publish the bots' files as one new commit, only if bot-data is still at `lease`. */
export function syncPush(repo: string, branch: string, lease: string, files: [string, string][], extra: Record<string, string>): { pushed: boolean; sha?: string; error?: string } {
  const bad = ensureRepo(repo); if (bad) return { pushed: false, error: bad };
  const dir = SYNC_DIR();
  git(["read-tree", "--empty"]); // a fresh index: only these files go in
  for (const [path, local] of files) {
    if (!existsSync(local)) continue; const dest = join(dir, path); mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, readFileSync(local));
    git(["add", "-f", path]);
  }
  for (const [path, text] of Object.entries(extra)) { const dest = join(dir, path); mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, text); git(["add", "-f", path]); }
  const tree = git(["write-tree"]); if (!tree.ok) return { pushed: false, error: `write-tree failed: ${tree.err}` };
  const commit = git(["commit-tree", tree.out, "-m", `Bots (PC) ${new Date().toISOString().slice(0, 16)}Z`]); if (!commit.ok) return { pushed: false, error: `commit failed: ${commit.err}` };
  const p = git(["push", "-q", `--force-with-lease=refs/heads/${branch}:${lease}`, "origin", `${commit.out}:refs/heads/${branch}`]);
  if (!p.ok) return { pushed: false, error: /stale info|rejected|fetch first/i.test(p.err) ? "someone else stepped the bots first; theirs is kept" : `push failed: ${p.err.slice(0, 200)}` };
  return { pushed: true, sha: commit.out };
}
