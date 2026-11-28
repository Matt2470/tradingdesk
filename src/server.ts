import { readdirSync } from "node:fs";
// Local dashboard server. Listens on 127.0.0.1 only: nothing here is reachable from the network.
import { join, normalize } from "node:path";
import { ROOT, P, settings, readJson, writeJson, universe } from "./config";
import { refresh, tick, resumeBot, files, viewOf, evalFile, writeBoard, botFiles, botById, competitors, COMPETITION, checkingSince, OFFICE, TWINS, GUILD, bankOf, readRoster, participants, writeCompetition } from "./pipeline";
import { answer, ANSWERS } from "./bot/office";
import { STRATEGIES } from "./core/strategies";
import { GENES } from "./bot/genes";
import { readFeedback, saveFeedback } from "./feedback";
import { lighterFile, readiness, type LighterSnapshot } from "./data/lighter";

const offline = process.argv.includes("--offline");
const st = settings(); const port = Number(process.env.TD_PORT ?? st.port); const url = `http://127.0.0.1:${port}`;
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

function openWindow() {
  if (process.platform !== "win32") return console.log(`Open ${url}`);
  try { Bun.spawn(["cmd", "/c", "start", "", "msedge", `--app=${url}`], { stdout: "ignore", stderr: "ignore" }); } catch { console.log(`Open ${url} in your browser.`); }
}
async function alreadyRunning() { try { const r = await fetch(url + "/api/ping", { signal: AbortSignal.timeout(1500) }); return (await r.json()).app === "tradingdesk"; } catch { return false; } }

const routes: Record<string, (u: URL, req: Request) => unknown | Promise<unknown>> = {
  "/api/ping": () => ({ app: "tradingdesk" }),
  "/api/board": () => readJson(join(P.derived, "board.json"), null),
  "/api/today": u => ({ ...readJson(files(viewOf(u.searchParams.get("view"))).today, { at: null, rows: [] }), settings: { risk: st.risk, bot: st.bot, backtest: st.backtest, competition: st.competition } }),
  "/api/eval": u => readJson(evalFile(viewOf(u.searchParams.get("view")), u.searchParams.get("key") ?? ""), null),
  "/api/indicators": u => readJson(files(viewOf(u.searchParams.get("view"))).indicators, { at: null, byTf: {} }),
  "/api/strategies": () => STRATEGIES.map(({ id, name, family, side, plain, indicators, stopAtr, targetR }) => ({ id, name, family, side, plain, indicators, stopAtr, targetR: targetR ?? null })),
  // One competition bot: ?bot=stocks-bull (or ?view=crypto for that world's first bot).
  "/api/bot": u => { const id = u.searchParams.get("bot"); const v = u.searchParams.get("view"); const cur = settings();
    const b = id ? botById(id, cur) : competitors(cur).find(x => x.view === viewOf(v)) ?? botById(null, cur); const view = readJson<Record<string, unknown> | null>(botFiles(b.id).view, null); return view && { ...view, checkingSince: checkingSince() }; },
  // Current names: a fired bot's seat shows its recruit's name.
  "/api/bots": () => competitors(settings()).map(({ id, name, view, side, motto, lighterCrypto, evil, kin, kinOf }) => ({ id, name: readJson<{ name?: string } | null>(botFiles(id).view, null)?.name ?? name, view, side, motto: motto ?? "", lighterCrypto: !!lighterCrypto, evil: evil ?? null, kin: kin ?? null, kinOf: kinOf ?? null })),
  "/api/competition": () => { const c = readJson<Record<string, unknown> | null>(COMPETITION(), null); return c && { ...c, checkingSince: checkingSince() }; },
  // The Accountant screen, and the owner's yes or no on a decision waiting there.
  "/api/office": () => readJson(OFFICE(), null),
  "/api/twins": () => readJson(TWINS(), null),
  // The Players Guild: this generation's candidates, the bank, the owner's orders and the guild's hires.
  "/api/guild": () => { const g = readJson(GUILD(), null); const answers = readJson<Record<string, { answer: string }>>(ANSWERS(), {}); const r = readRoster();
    return { guild: g, bank: bankOf(), grant: settings().competition.startGrant, ordered: Object.keys(answers).filter(k => k.startsWith("hire-guild-") && answers[k].answer === "yes").map(k => k.slice(11)),
      hired: [...(r.guild ?? []).filter(h => !h.kin).map(h => ({ id: h.id, cand: h.cand, name: h.name, hiredAt: h.hiredAt, firedAt: h.firedAt ?? null, type: "strategist" })), ...(r.evil ?? []).filter(h => h.style === "angel").map(h => ({ id: h.id, cand: h.key.slice(11), name: h.name, hiredAt: h.hiredAt, firedAt: h.firedAt ?? null, type: "builder" }))] }; },
  // Pictures the owner put in web/portraits/ to replace the drawn portraits.
  "/api/portraits": () => { try { return readdirSync(join(ROOT, "web", "portraits")).filter(f => /\.(png|jpe?g|webp)$/i.test(f)); } catch { return []; } },
  // The owner hires an evil twin (or takes the order back before the next check). Kept with the owner's answers on this PC.
  "/api/hire": async (_u, req) => { if (req.method !== "POST") return { error: "use POST" }; const b = await req.json().catch(() => null) as { key?: string; yes?: boolean } | null;
    if (!b || typeof b.key !== "string" || !/^hire-(evil-[a-z-]+-\d+(-g\d+)?|guild-g\d+-\d+|(devil|angel)-[a-z0-9-]+-\d+-\d+)$/.test(b.key) || typeof b.yes !== "boolean") return { error: "send {key, yes}" };
    const answers = readJson<Record<string, { answer: string; at: string }>>(ANSWERS(), {}); answers[b.key] = { answer: b.yes ? "yes" : "no", at: new Date().toISOString().slice(0, 16) }; writeJson(ANSWERS(), answers); return { ok: true, key: b.key, answer: answers[b.key].answer }; },
  // The owner plans a gene for a player (or takes the plan back). Kept with the owner's answers on this PC; the next trading
  // check copies the plans into bot/genes.json, and the player saves its DNA for it (src/bot/genes.ts).
  "/api/gene": async (_u, req) => { if (req.method !== "POST") return { error: "use POST" }; const b = await req.json().catch(() => null) as { bot?: string; gene?: string; yes?: boolean } | null;
    if (!b || typeof b.bot !== "string" || !participants(settings()).some(p => p.id === b.bot) || typeof b.gene !== "string" || !GENES.some(g => g.id === b.gene) || typeof b.yes !== "boolean") return { error: "send {bot, gene, yes}" };
    const key = `gene-${b.bot}-${b.gene}`; const answers = readJson<Record<string, { answer: string; at: string }>>(ANSWERS(), {}); if (b.yes) answers[key] = { answer: "yes", at: new Date().toISOString().slice(0, 16) }; else delete answers[key];
    writeJson(ANSWERS(), answers); writeCompetition(); return { ok: true, key, planned: b.yes }; },
  "/api/approve": async (_u, req) => { if (req.method !== "POST") return { error: "use POST" }; const b = await req.json().catch(() => null) as { id?: string; yes?: boolean } | null;
    if (!b || typeof b.id !== "string" || typeof b.yes !== "boolean") return { error: "send {id, yes}" }; const a = answer(b.id, b.yes); return a ? { ok: true, approval: a } : { error: "no such decision" }; },
  "/api/resume": (u, req) => (req.method === "POST" ? { resumed: resumeBot(botById(u.searchParams.get("bot")).id) } : { error: "use POST" }),
  "/api/lighter": () => { const snap = readJson<LighterSnapshot | null>(lighterFile(), null); const cur = settings();
    return { snapshot: snap, settings: cur.lighter, readiness: readiness(snap, universe().filter(x => x.class === "stock" || x.class === "metal"), cur) }; },
  "/api/feedback": async (_u, req) => (req.method === "POST" ? saveFeedback(await req.json().catch(() => null)) : readFeedback()),
  "/api/status": () => ({ status: readJson(join(P.derived, "status.json"), null), dataDir: P.derived, port }),
  "/api/refresh": async (_u, req) => { if (req.method !== "POST") return { error: "use POST" }; await tick().catch(() => null); return refresh({ fetch: !offline }); },
};

if (await alreadyRunning()) { if (process.argv.includes("--open")) openWindow(); console.log("TradingDesk is already running."); process.exit(0); }

Bun.serve({
  port, hostname: "127.0.0.1", idleTimeout: 180, // a full price update takes longer than Bun's 10 s default
  async fetch(req) {
    const u = new URL(req.url);
    const h = routes[u.pathname];
    if (h) { try { return json(await h(u, req)); } catch (e) { return json({ error: (e as Error).message }, 500); } }
    if (u.pathname.startsWith("/api/")) return json({ error: "unknown route" }, 404);
    const rel = normalize(u.pathname === "/" ? "/index.html" : u.pathname).replace(/^([/\\])+/, "");
    if (rel.includes("..")) return new Response("Not found", { status: 404 });
    const f = Bun.file(join(ROOT, "web", rel));
    if (!(await f.exists())) return new Response("Not found", { status: 404 });
    return new Response(f, { headers: { "content-type": TYPES[rel.slice(rel.lastIndexOf("."))] ?? "application/octet-stream", "cache-control": "no-store" } });
  },
});
console.log(`TradingDesk running at ${url}`);
// Every tick: live prices. When a 15-minute bar has closed (checked one minute later, so the price server has it): a full refresh.
const SLOT = 15 * 60000; let slot = -1; let busy = false;
async function loop() {
  if (busy) return; busy = true;
  try {
    const now = Date.now(); const s = Math.floor((now - 60000) / SLOT);
    if (!offline) await tick(now).catch(e => console.error("Live prices failed:", e.message));
    if (s !== slot) { slot = s; await refresh({ fetch: !offline, now }); } else if (offline) writeBoard(now);
  } catch (e) { console.error("Refresh failed:", (e as Error).message); } finally { busy = false; }
}
loop(); setInterval(loop, Math.max(15, st.tickSeconds) * 1000);
if (process.argv.includes("--open")) openWindow();
