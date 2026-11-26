// Smoke run: start the real server against synthetic data in a temp folder and check every route and page.
// It never touches the real data folder and never uses the network.
import { mkdtempSync, rmSync, cpSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "../src/config";

const dir = mkdtempSync(join(tmpdir(), "td-smoke-")); const port = 4790 + Math.floor(Math.random() * 100);
process.env.TD_DATA_DIR = dir;
const { writeFixtures, writeIntradayFixtures } = await import("./make-fixtures");
writeFixtures(dir); writeIntradayFixtures(dir);
mkdirSync(join(dir, "imports"), { recursive: true }); cpSync(join(ROOT, "tests", "fixtures"), join(dir, "imports"), { recursive: true });
mkdirSync(join(dir, "briefs"), { recursive: true });
writeFileSync(join(dir, "briefs", "2026-11-13.json"), JSON.stringify({ date: "2026-11-13", generatedAt: "2026-11-13T07:30:00Z", marketSummary: "Smoke-test brief.", items: [{ symbol: "NVDA", type: "news", headline: "Test headline", why: "Test", sources: ["https://example.com/a"] }], earnings: [{ symbol: "NVDA", date: "2026-11-18", when: "after close" }], fundamentals: { NVDA: { revenueGrowthYoYPct: 10, netMarginPct: 20, peRatio: 30, note: "test", asOf: "2026-11-01", sources: ["https://example.com/b"] } }, strategyOfDay: { strategyId: "rsi2_dip", symbols: ["NVDA"], reasoning: "Test reasoning.", risks: "Test risks." } }));

// Lighter fixtures: NVDA is listed, with 2,000 fifteen-minute candles around the clock, so its 15m and 30m charts use them.
{
  const { writeFileSync, mkdirSync } = await import("node:fs");
  mkdirSync(join(dir, "derived"), { recursive: true }); mkdirSync(join(dir, "cache", "bars"), { recursive: true });
  writeFileSync(join(dir, "derived", "lighter.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, funding: {}, account: null, markets: { NVDA: { symbol: "NVDA", marketId: 77, status: "active", lastPrice: 190, markPrice: 190, minBase: 0.01, minQuote: 10, sizeDecimals: 2, priceDecimals: 2, maxLeverage: 10, dailyChangePct: null, openInterestUsd: 5000000, frozen: false } } }));
  const t0 = Math.floor(Date.now() / 900000) * 900000 - 2000 * 900000; let px = 180;
  const bars = Array.from({ length: 2000 }, (_, k) => { const o = px; px = Math.max(50, px * (1 + Math.sin(k / 37) * 0.002 + ((k * 7919) % 13 - 6) * 0.0004)); return { d: new Date(t0 + k * 900000).toISOString().slice(0, 16), o, h: Math.max(o, px) * 1.001, l: Math.min(o, px) * 0.999, c: px, v: 10 }; });
  // and 200 hourly candles (too few to stand alone, so 1h, 4h and daily join them after Yahoo's older bars).
  const hourly = bars.filter((_, k) => k % 4 === 0).slice(-200).map(b => ({ ...b, d: b.d.slice(0, 13) + ":00" }));
  writeFileSync(join(dir, "cache", "bars", "NVDA.lighter.1h.json"), JSON.stringify({ symbol: "NVDA", source: "lighter 1h", fetchedAt: new Date().toISOString(), meta: { gmtoffset: 0, regularEnd: null, price: px, currency: "USD" }, bars: hourly, marketId: 77, backfillDone: true }));
  // 1,500 one-minute candles (enough to scalp) and 300 five-minute ones (too few): the bots get NVDA@1m only.
  const m1 = bars.slice(-1500).map((b, k) => ({ ...b, d: new Date(Math.floor(Date.now() / 60000) * 60000 - (1500 - k) * 60000).toISOString().slice(0, 16) }));
  writeFileSync(join(dir, "cache", "bars", "NVDA.lighter.1m.json"), JSON.stringify({ symbol: "NVDA", source: "lighter 1m", fetchedAt: new Date().toISOString(), meta: { gmtoffset: 0, regularEnd: null, price: px, currency: "USD" }, bars: m1, marketId: 77, backfillDone: true }));
  writeFileSync(join(dir, "cache", "bars", "NVDA.lighter.5m.json"), JSON.stringify({ symbol: "NVDA", source: "lighter 5m", fetchedAt: new Date().toISOString(), meta: { gmtoffset: 0, regularEnd: null, price: px, currency: "USD" }, bars: m1.slice(-300), marketId: 77, backfillDone: true }));
  writeFileSync(join(dir, "cache", "bars", "NVDA.lighter.15m.json"), JSON.stringify({ symbol: "NVDA", source: "lighter 15m", fetchedAt: new Date().toISOString(), meta: { gmtoffset: 0, regularEnd: null, price: px, currency: "USD" }, bars, marketId: 77, backfillDone: true }));
}
const proc = Bun.spawn(["bun", "run", join(ROOT, "src", "server.ts"), "--offline"], { env: { ...process.env, TD_DATA_DIR: dir, TD_PORT: String(port) }, stdout: "pipe", stderr: "pipe" });
const base = `http://127.0.0.1:${port}`; const fails: string[] = [];
const ok = (cond: unknown, msg: string) => { if (!cond) fails.push(msg); };
try {
  let up = false; for (let i = 0; i < 120 && !up; i++) { await Bun.sleep(250); up = await fetch(base + "/api/ping").then(r => r.ok).catch(() => false); }
  if (!up) throw new Error("server did not start within 15 s");
  let today: any; for (let i = 0; i < 160; i++) { today = await (await fetch(base + "/api/today")).json(); if (today.rows.length) break; await Bun.sleep(250); }
  const TF = ["15m", "30m", "1h", "4h", "1d"];
  ok(today.rows.length === 31 * 5 + 3, `market view has ${today.rows.length} rows, expected 31 symbols x 5 timeframes + 3 benchmarks`);
  ok(today.rows.every((r: any) => TF.includes(r.tf) && r.key === `${r.symbol}@${r.tf}` && r.evals === undefined && typeof r.passing === "number"), "rows are compact, one per symbol and timeframe");
  ok(TF.every(tf => today.rows.some((r: any) => r.tf === tf && r.bars >= 260)), "every timeframe has rows with enough history");
  ok(today.rows.some((r: any) => r.passing > 0), "at least one row has a strategy that passes the gate");
  const ev = await (await fetch(base + "/api/eval?key=NVDA@15m")).json(); ok(ev?.summary?.evals.length === 30 && ev.summary.tf === "15m" && ev.curves.rsi2_dip?.equity.length === ev.curves.rsi2_dip.dates.length, "full test results per symbol and timeframe");
  ok(ev.summary.evals.filter((e: any) => e.verdict.passes).every((e: any) => e.robust && e.robust.luck.runs === 1000), "every passing strategy has its stress tests");
  const ind = await (await fetch(base + "/api/indicators")).json(); ok(TF.every(tf => ind.byTf[tf]?.length === 30 && ind.byTf[tf].every((a: any) => a.symbolsTested <= 1)), "rule summaries for every timeframe, over the charts the bot trades (NVDA only in the fixtures)");
  const ct = await (await fetch(base + "/api/today?view=crypto")).json(); ok(ct.view === "crypto" && ct.rows.length === 30 && ct.rows.every((r: any) => r.class === "crypto"), "crypto view has 6 symbols x 5 timeframes");
  const CRYPTO = ["BTC", "ETH", "SOL", "NEAR", "ADA", "QNT"];
  const bots = await (await fetch(base + "/api/bots")).json(); ok(bots.length === 4 && bots.map((b: any) => b.id).join() === "stocks-bull,stocks-bear,crypto-bull,crypto-bear", "four competition bots");
  const bot = await (await fetch(base + "/api/bot?bot=stocks-bull")).json(); ok(bot && bot.startEquity === 250 && bot.accountant?.grant >= 250 && bot.exposure <= bot.maxLeverage * bot.equity * 1.2 && bot.checked?.markets === 6 && bot.hours?.total === 5 && bot.hours.allDay >= 2 && bot.hours.notTraded.length === 30 && !bot.hours.notTraded.includes("NVDA"), "stocks bots watch NVDA's 1m scalping chart too (5m has too few candles); they trade only what Lighter trades around the clock (NVDA in the fixtures), the other 30 stocks are listed as not traded");
  ok(Array.isArray(bot.daily) && bot.daily.length >= 1 && bot.daily.every((r: any) => /^\d{4}-\d{2}-\d{2}$/.test(r.day) && Number.isFinite(r.equity)), "bot view has a day-by-day summary");
  const bear = await (await fetch(base + "/api/bot?bot=stocks-bear")).json();
  const cb = await (await fetch(base + "/api/bot?bot=crypto-bull")).json(); ok(cb && cb.view === "crypto" && cb.startEquity === 250 && cb.checked?.markets === 30, "crypto bots watch every crypto chart");
  const cbear = await (await fetch(base + "/api/bot?bot=crypto-bear")).json();
  ok(![bot, bear].some(b => b.positions.concat(b.pending).some((p: any) => CRYPTO.includes(p.symbol))) && [cb, cbear].every(b => b.positions.concat(b.pending).every((p: any) => CRYPTO.includes(p.symbol))), "each bot trades only its own world");
  ok([bear, cbear].every(b => b.positions.every((p: any) => p.side === "short") && b.trades.every((t: any) => t.side === "short")) && cb.side === "both" && bot.side === "both", "Lucas and Valeria only sell short, Nico and Catalina are free");
  ok(!bot.playbook.some((p: any) => bear.playbook.some((q: any) => q.key === p.key && q.id === p.id)), "Nico never copies a chart-and-strategy pair that Lucas trades");
  ok(new Set(bot.positions.map((p: any) => p.symbol)).size === bot.positions.length, "one position per symbol");
  ok([bot, bear, cb, cbear].every(b => Array.isArray(b.shortlist?.chosen) && b.shortlist.chosen.length <= 4 && b.shortlist.candidates.length === (b.side === "both" ? 30 : 15) && (b.side === "both" || b.shortlist.candidates.every((c: any) => c.side === b.side)) && b.exits?.mode === "ladder"), "each bot has its own weekly short list (of its own side, or of both for Nova), and stepped exits");
  const union = [...bot.shortlist.chosen, ...bear.shortlist.chosen];
  ok(today.rows.every((r: any) => r.allowed.length <= 2 && new Set(r.allowed.map((id: string) => /_short(_adx)?$/.test(id))).size === r.allowed.length && r.allowed.every((id: string) => union.includes(id))), "each chart keeps at most one long and one short strategy, from the bots' short lists");
  ok([bot, bear, cb, cbear].every(b => b.twin && Number.isFinite(b.twin.equity) && b.twin.trades >= 0), "every bot has a random twin");
  const comp = await (await fetch(base + "/api/competition")).json();
  ok(comp.duels?.current?.pairs.length === 2 && comp.duels.table.length === 4 && Array.isArray(comp.locker) && comp.locker.some((m: any) => /New on the desk/.test(m.text)), "weekly duels, the duel league and the locker room are on the scoreboard");
  ok(comp.books && comp.books.lent === 1000 && comp.books.owed === 1000 && comp.books.start === 1500 && comp.books.available === 500 && comp.books.atRisk === 500 && comp.books.profit === 0 && Math.abs(comp.books.difference) < 0.01 && [bot, bear, cb, cbear].every(b => Math.abs(b.books.difference) < 0.01), "the accountant's books and every bot's books balance");
  ok(comp && comp.startGrant === 250 && comp.bots.length === 4 && comp.bots.every((b: any) => b.bustLine === 125 && b.target === 500 && b.debt === 250 && b.award === 0 && b.tierName === "Rookie" && Number.isFinite(b.index)) && comp.months[0]?.standings.length === 4 && comp.ladder.length === 4 && comp.recruitsTried === 4 && comp.rules.tiers.join() === "4,8,12", "competition scoreboard: fixed grants, loans, awards, tiers, this month's standings, the ladder");
  ok([bot, bear, cb, cbear].every(b => Array.isArray(b.playbook) && b.playbook.length <= 6 && b.playbook.every((p: any) => b.shortlist.chosen.includes(p.id) && new Set(b.playbook.map((q: any) => q.key.split("@")[0])).size === b.playbook.length)), "each bot chose at most 6 charts, one per symbol, each with a strategy from its own short list");

  const tw = await (await fetch(base + "/api/twins")).json();
  ok(tw && tw.bots.length === 4 && tw.bots.map((b: any) => b.evil?.kind).join() === "neutral-grid,short-grid,trailing,dca-short" && tw.bots.every((b: any) => b.participant && Number.isFinite(b.evil.resultPct) && b.evil.trades >= 0 && b.evil.stops >= 0 && Array.isArray(b.evil.curve)), "the Twins screen: every participant against its random twin and its Pionex-style evil twin");
  ok(comp.bots.every((b: any) => typeof b.thought === "string" && b.thought.length > 10 && b.character && b.evil?.taunt), "every participant has a thought about the week and an evil twin with a taunt");
  for (const p of ["/portraits.js"]) ok((await fetch(base + p)).status === 200, `GET ${p} is 200`);
  const off = await (await fetch(base + "/api/office")).json();
  ok(off && off.days.length >= 1 && off.days[0].bots.length === 4 && off.weekly.length >= 1 && Object.keys(off.weeks).length === 4 && off.risk.length === 4 && off.risk.every((r: any) => r.cushion === 125 && r.accountantAtRisk === 125) && off.bank.available === 500 && off.desk && off.desk.stoppedDay === null && off.desk.halved === false && Array.isArray(off.approvals) && off.rules.dailyLossPct === 3 && off.rules.costTiers.length === 6, "the Accountant screen: daily and weekly reports, every bot's weekly report, money at risk, the desk guard, decisions");
  const ap = (b: unknown) => fetch(base + "/api/approve", { method: "POST", body: JSON.stringify(b) }).then(r => r.json());
  ok((await ap({ id: "nope", yes: true })).error === "no such decision" && (await ap({ id: 3 })).error === "send {id, yes}", "approvals reject unknown decisions and bad input");
  const st0 = (await (await fetch(base + "/api/status")).json()).status; const nv = (tf: string) => (st0?.fetch ?? []).find((f: any) => f.symbol === "NVDA" && f.tf === tf);
  ok(nv("15m")?.source === "lighter 15m" && nv("30m")?.source?.startsWith("lighter 30m") && /yahoo until .*, then lighter 1h/.test(nv("1h")?.source ?? "") && /then lighter 1d/.test(nv("1d")?.source ?? ""), "NVDA: Lighter alone for 15m and 30m (enough saved); Yahoo's older history then Lighter's bars for 1h and daily");
  const lt = await (await fetch(base + "/api/lighter")).json(); ok(Array.isArray(lt.readiness) && lt.readiness.length === 31 && lt.settings.live === false, "Lighter panel answers read-only, one line per stock and gold symbol");
  ok((await (await fetch(base + "/api/resume?bot=stocks-bull", { method: "POST" })).json()).resumed === false, "resume on a running bot does nothing");
  const board = await (await fetch(base + "/api/board")).json();
  ok(board.symbols.length === 37 && board.symbols.every((s: any) => s.price > 0 && Object.keys(s.tfs).length === 5) && board.context.length === 3, "board lists every symbol with a price and five timeframes");
  ok(board.symbols.find((s: any) => s.symbol === "NVDA").allDay === true && board.symbols.find((s: any) => s.symbol === "MCHP").allDay === false && !("news" in board.symbols[0]), "board says which symbols trade 24/7, and carries no brief news");
  ok(board.status.downloads.total > 150 && board.status.nextCheck > board.at, "board carries the status line");
  ok((await fetch(base + "/api/brief")).status === 404, "the morning brief route is gone");
  const fb0 = await (await fetch(base + "/api/feedback")).json(); ok(fb0.checklist.length >= 5 && Object.keys(fb0.answers).length === 0, "feedback checklist loads empty");
  const post = (b: unknown) => fetch(base + "/api/feedback", { method: "POST", body: JSON.stringify(b) });
  ok((await post({ id: fb0.checklist[0].id, status: "problem", note: "smoke note" })).ok && (await post({ text: "free note" })).ok && (await post({ id: "nope", status: "ok" })).status === 500 && (await post({})).status === 500, "feedback saves answers and notes and rejects bad input");
  const fb1 = await (await fetch(base + "/api/feedback")).json(); ok(fb1.answers[fb0.checklist[0].id]?.note === "smoke note" && fb1.notes[0]?.text === "free note", "feedback is read back");
  const st = await (await fetch(base + "/api/status")).json(); ok(st.status?.fetch.length > 150, "status lists every download");
  for (const p of ["/", "/app.js", "/app.css"]) ok((await fetch(base + p)).status === 200, `GET ${p} is 200`);
  ok((await fetch(base + "/../package.json")).status === 404 && (await fetch(base + "/api/nope")).status === 404, "unknown paths are 404");
  ok((await fetch(base + "/api/refresh")).ok, "GET refresh answers without refreshing");
} catch (e) { fails.push((e as Error).message); }
finally { proc.kill(); await proc.exited; if (!process.argv.includes("--keep")) rmSync(dir, { recursive: true, force: true }); else console.log("kept " + dir); }
if (fails.length) { console.error("SMOKE FAILED\n - " + fails.join("\n - ")); process.exit(1); }
console.log("Smoke run passed: server, all API routes and static files answer correctly on synthetic data.");
