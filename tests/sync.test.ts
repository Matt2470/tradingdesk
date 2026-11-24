import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path"; import { tmpdir } from "node:os"; import { spawnSync } from "node:child_process";

// The PC and GitHub take turns through bot-data: a push is accepted only if bot-data is still the commit it started from.
test("taking turns: a stale push is refused, a fresh one is accepted, and nothing is stepped twice", async () => {
  const root = mkdtempSync(join(tmpdir(), "td-sync-")); const bare = join(root, "me", "td.git"); mkdirSync(join(root, "me"));
  const g = (args: string[], cwd = root) => spawnSync("git", args, { cwd, encoding: "utf8" });
  if (g(["--version"]).status !== 0) return; // no git on this machine: nothing to test
  g(["init", "-q", "--bare", bare]); const seed = join(root, "seed"); mkdirSync(join(seed, "bot"), { recursive: true });
  g(["init", "-q"], seed); g(["checkout", "-q", "-b", "bot-data"], seed); writeFileSync(join(seed, "bot", "roster.json"), '{"v":1}');
  g(["add", "-A"], seed); g(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "seed"], seed); g(["push", "-q", bare, "bot-data"], seed);
  process.env.TD_SYNC_BASE = root + "/"; process.env.TD_SYNC_DIR = join(root, "sync");
  const { syncPull, syncPush } = await import(`../src/data/sync.ts?${Date.now()}`);
  const local = join(root, "data", "bot", "roster.json"); const files: [string, string][] = [["bot/roster.json", local]];
  const a = syncPull("me/td", "bot-data", files); expect(a.sha).toBeTruthy(); expect(readFileSync(local, "utf8").trim()).toBe('{"v":1}');
  const gh = join(root, "gh"); g(["clone", "-q", "-b", "bot-data", bare, gh]); writeFileSync(join(gh, "bot", "roster.json"), '{"v":"github"}');
  g(["-c", "user.name=g", "-c", "user.email=g@g", "commit", "-qam", "gh"], gh);
  expect(g(["push", "-q", `--force-with-lease=refs/heads/bot-data:${a.sha}`, "origin", "bot-data"], gh).status).toBe(0);
  writeFileSync(local, '{"v":"pc"}'); expect(syncPush("me/td", "bot-data", a.sha, files, {}).pushed).toBe(false);
  const b = syncPull("me/td", "bot-data", files); expect(readFileSync(local, "utf8").trim()).toBe('{"v":"github"}');
  writeFileSync(local, '{"v":"pc2"}'); expect(syncPush("me/td", "bot-data", b.sha, files, {}).pushed).toBe(true);
  expect(g(["--git-dir", bare, "show", "bot-data:bot/roster.json"]).stdout.trim()).toBe('{"v":"pc2"}');
  delete process.env.TD_SYNC_BASE; delete process.env.TD_SYNC_DIR;
});
