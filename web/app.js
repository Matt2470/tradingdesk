// Dashboard front end. Plain JavaScript, no libraries, works offline.
// Every value that comes from a file or the network goes through esc() before it reaches the page.
"use strict";
const $main = document.getElementById("main"), $tip = document.getElementById("tip");
const C = { strategy: "#009490", bench: "#C2611F" }; // validated pair, see CLAUDE.md "Charts"
const TFS = ["15m", "30m", "1h", "4h", "1d"];
const TF_NAME = { "1m": "1 min (scalp)", "5m": "5 min (scalp)", "15m": "15 min", "30m": "30 min", "1h": "1 hour", "4h": "4 hours", "1d": "daily" };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const api = async (p, opt) => { const r = await fetch(p, opt); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Request failed (${r.status})`); return r.json(); };
const num = (v, d = 2) => (v == null || !isFinite(v) ? "–" : Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
/** Prices: enough decimals for cheap coins, two for everything else. */
const price = v => (v == null || !isFinite(v) ? "–" : "$" + num(v, Math.abs(v) < 1 ? 4 : Math.abs(v) < 20 ? 3 : 2));
const money = (v, d = 0) => (v == null || !isFinite(v) ? "–" : (v < 0 ? "−$" : "$") + num(Math.abs(v), d));
const signed = (v, d = 0, unit = "$") => { if (v == null || !isFinite(v)) return "–"; const cls = v > 0 ? "gain" : v < 0 ? "loss" : ""; const s = (v > 0 ? "+" : v < 0 ? "−" : "") + (unit === "$" ? "$" + num(Math.abs(v), d) : num(Math.abs(v), d) + unit); return `<span class="${cls}">${s}</span>`; };
const pct = (v, d = 1) => signed(v, d, "%");
/** Bar keys: "2026-11-13" (daily) or "2026-11-13T14:30" (UTC). Shown in the PC's own time. */
const bar = d => { if (!d) return "–"; const s = String(d); const yr = y => (y !== new Date().getFullYear() ? { year: "numeric" } : {}); if (s.length === 10) { const t = new Date(s + "T12:00:00Z"); return t.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...yr(t.getFullYear()) }); } const t = new Date((s.length === 13 ? s + ":00" : s.slice(0, 16)) + ":00Z"); return t.toLocaleString("en-GB", { day: "numeric", month: "short", ...yr(t.getFullYear()), hour: "2-digit", minute: "2-digit" }); };
const when = iso => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never");
const clock = iso => (iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "–");
const pf = v => (v >= 99 ? "no losses" : num(v, 2));
const stat = (label, value) => `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`;
const safeUrl = u => (/^https?:\/\//i.test(u) ? u : null);
const links = s => (s ?? []).map(safeUrl).filter(Boolean).map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">source ${i + 1}</a>`).join(", ");
let VIEW = "market";
const q = p => p + (p.includes("?") ? "&" : "?") + "view=" + VIEW;
/** The four competition bots (from /api/bots) and the one shown on the Paper bots screen. */
let BOTS = []; let BOT = "stocks-bull";
const BOT_COLOR = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"]; // validated categorical slots 1-4 (dataviz palette), fixed order by bot
const botColor = id => BOT_COLOR[Math.max(0, BOTS.findIndex(b => b.id === id))] ?? BOT_COLOR[0];
const WORLD = b => (b.view === "crypto" ? "crypto" : "stocks and gold");
const ROLE = b => b.side === "both" ? `free on ${b.lighterCrypto ? "any Lighter crypto" : WORLD(b)}` : `${b.side === "short" ? "bearish" : "bullish"} on ${WORLD(b)}`;
/** Bot against its random twin: did it do better than chance on the same charts? */
const twinLine = (botPct, twin) => !twin ? "" : `${signed(botPct - twin.returnPct, 1, "%")} vs its random twin`;
async function loadBots() { BOTS = await api("/api/bots"); return BOTS; }
const botSwitcher = () => `<p class="switch" role="group" aria-label="Which bot">${BOTS.map(b => `<button type="button" data-bot="${esc(b.id)}" aria-pressed="${BOT === b.id}"><i class="swatch" style="background:${botColor(b.id)}"></i>${esc(b.name)} <span class="small">${esc(ROLE(b))}</span></button>`).join("")}</p>`;
const badgeRow = (n, size = 18) => n > 0 ? `<span class="badges" aria-label="${n} badge${n === 1 ? "" : "s"}">${Array.from({ length: Math.min(n, 12) }, () => `<svg width="${size}" height="${size}" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.5 7.7l5.9-.9z" fill="#C9962B" stroke="#8A6514" stroke-width="1"/></svg>`).join("")}${n > 12 ? ` ×${n}` : ""}</span>` : `<span class="small">no badges yet</span>`;
const KIND = { milestone: ["gain", "Badge"], save: ["warn", "Saved by award"], fired: ["loss", "Stopped"], interest: ["loss", "Interest"], repay: ["gain", "Repaid"], hired: ["", "Hired"], strike: ["warn", "Strike"], active: ["gain", "Busy week"], bonus: ["gain", "Prize"] };
const kindTag = k => { const [c, t] = KIND[k] ?? ["", k]; return `<span class="${c}">${esc(t)}</span>`; };
const TIER_CLS = ["rookie", "pro", "master", "expert"];
const tierTag = (level, name) => `<span class="tier ${TIER_CLS[level] ?? "rookie"}">${esc(name)}</span>`;
/** "3 of 4 badges in a row to Pro" */
function streakText(streak, toNext, tiers, names, level) { if (toNext == null) return `${streak} badges in a row: top tier reached`; const goal = streak + toNext; return `${streak} of ${goal} badges in a row to ${names[level + 1] ?? ""}`; }
const ord = n => n + (n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th");
/** Who has been checking the bots: GitHub's runs and this PC's turns. */
function checksPanel(c) {
  const k = c.checks; if (!k || !k.last?.length) return "";
  const last = k.last[0]; const age = Date.now() - Date.parse(last.at); const [cls, word] = botState(last.at);
  const who = by => (by === "PC" ? "this PC" : by);
  const day = Object.entries(k.last24h ?? {}).map(([b, n]) => `${who(b)} ${n}`).join(", ");
  const note = k.sync?.note ? ` <span class="small">(${esc(k.sync.note)})</span>` : "";
  return `<div class="panel goal" data-bot-at="${esc(last.at)}"><span class="dot ${cls}" data-bot-dot></span> <strong data-bot-word>${esc(word)}</strong> · last check ${esc(clock(last.at))} by ${esc(who(last.by))}, <span data-ago="${esc(last.at)}">${agoText(age)}</span>.
    <span class="small">Checks in the last 24 hours: ${esc(day || "none")}. ${k.shared ? "GitHub and this PC take turns: whoever checks first saves the bots' state, so they keep trading when either one is off." : ""}</span>${note}</div>`;
}
function duelsPanel(c, name) {
  const d = c.duels; if (!d?.current) return "";
  const row = p => `<div class="duel">${name(p.a)} <strong class="${p.winner === p.a ? "gain" : ""}">${pct(p.aPct, 2)}</strong><span class="vs">vs</span><strong class="${p.winner === p.b ? "gain" : ""}">${pct(p.bPct, 2)}</strong> ${name(p.b)}</div>`;
  return `<h2>This week's duels</h2><div class="panel duels">${d.current.pairs.map(row).join("")}<p class="small" style="margin:6px 0 0">Week of ${esc(new Date(d.current.week + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short" }))}. The better trading result of the week wins 3 points, a draw 1. Pairs rotate so everyone meets everyone every three weeks.</p></div>
    <details class="detail"><summary><strong>Duel league</strong>${d.table[0] && d.table[0].points ? `: ${esc(c.bots.find(b => b.id === d.table[0].id)?.name ?? "")} leads with ${d.table[0].points} points` : ""}</summary><table class="compact"><thead><tr><th>Bot</th><th class="num">Points</th><th class="num">Won</th><th class="num">Drawn</th><th class="num">Lost</th></tr></thead><tbody>${d.table.map(r => `<tr><td>${name(r.id)}</td><td class="num">${r.points}</td><td class="num">${r.won}</td><td class="num">${r.drawn}</td><td class="num">${r.lost}</td></tr>`).join("")}</tbody></table>
    ${d.past.length ? d.past.slice(0, 6).map(w => `<p class="small" style="margin:4px 0">Week of ${esc(w.week)}: ${w.pairs.map(p => p.winner ? `${esc(c.bots.find(b => b.id === p.winner)?.name ?? "")} won (${pct(p.aPct, 1)} vs ${pct(p.bPct, 1)})` : "draw").join(" · ")}</p>`).join("") : ""}</details>`;
}
/** The other three bots, seen from one bot's screen: how they are doing and the gap to the leader. */
function rivalsPanel(c, me) {
  if (!c) return ""; const others = c.bots.filter(b => b.id !== me.id); const mine = c.bots.find(b => b.id === me.id); if (!mine) return "";
  const lead = [...c.bots].sort((a, b) => b.badges - a.badges || (b.month?.returnPct ?? 0) - (a.month?.returnPct ?? 0))[0];
  const duel = c.duels?.current?.pairs.find(p => p.a === me.id || p.b === me.id); const opp = duel && c.bots.find(b => b.id === (duel.a === me.id ? duel.b : duel.a));
  const myPct = duel ? (duel.a === me.id ? duel.aPct : duel.bPct) : 0, oppPct = duel ? (duel.a === me.id ? duel.bPct : duel.aPct) : 0;
  return `<h2>The rivals</h2><div class="panel">${opp ? `<p style="margin:0 0 8px"><strong>This week's duel:</strong> ${esc(mine.name)} ${pct(myPct, 2)} against ${esc(opp.name)} ${pct(oppPct, 2)}: ${myPct > oppPct + 0.05 ? `<span class="gain">ahead</span>` : myPct < oppPct - 0.05 ? `<span class="loss">behind</span>` : "level"}.</p>` : ""}
    <table class="compact"><thead><tr><th>Bot</th><th>Tier</th><th>Badges</th><th class="num">This month</th><th class="num">Account</th><th class="num">Open</th></tr></thead><tbody>${others.map(b => `<tr class="click" data-gobot="${esc(b.id)}"><td><i class="swatch" style="background:${botColor(b.id)}"></i>${esc(b.name)}${b.id === lead.id ? ` <span class="tag in">leader</span>` : ""}</td><td>${tierTag(b.tier, b.tierName)}</td><td>${b.badges}</td><td class="num">${pct(b.month?.returnPct ?? 0, 2)}</td><td class="num">${money(b.equity, 2)}</td><td class="num">${b.positions}</td></tr>`).join("")}</tbody></table>
    ${c.bots.every(b => !b.badges && !(b.month?.returnPct)) ? `<p class="small" style="margin:6px 0 0">Nobody leads yet.</p>` : lead.id === me.id ? `<p class="small" style="margin:6px 0 0">${esc(mine.name)} leads the month.</p>` : `<p class="small" style="margin:6px 0 0">Gap to ${esc(lead.name)}: ${lead.badges - mine.badges > 0 ? `${lead.badges - mine.badges} badge${lead.badges - mine.badges === 1 ? "" : "s"} and ` : ""}${num((lead.month?.returnPct ?? 0) - (mine.month?.returnPct ?? 0), 2)} points of trading result.${mine.hungry ? " Last and behind: trading a few more charts to catch up." : ""}</p>`}</div>`;
}
const pct0money = v => `<span class="${v > 0.005 ? "gain" : v < -0.005 ? "loss" : ""}">${v < 0 ? "−" : ""}${money(Math.abs(v), 2)}</span>`;
/** Where the account sits between the bust line (half the grant) and the target (twice the grant). */
function progressBar(equity, grant) {
  const lo = grant / 2, hi = grant * 2; const at = Math.max(0, Math.min(1, (equity - lo) / (hi - lo))); const start = (grant - lo) / (hi - lo);
  return `<div class="prog" role="img" aria-label="${esc(money(equity, 2))} between the bust line ${esc(money(lo))} and the target ${esc(money(hi))}">
    <div class="track"><span class="startmark" style="left:${(start * 100).toFixed(1)}%"></span><span class="fill ${equity >= grant ? "up" : "down"}" style="left:${(Math.min(start, at) * 100).toFixed(1)}%;width:${(Math.abs(at - start) * 100).toFixed(1)}%"></span><span class="knob" style="left:${(at * 100).toFixed(1)}%"></span></div>
    <div class="ends small"><span>Bust ${money(lo)}</span><span>Badge ${money(hi)}</span></div></div>`;
}
const switcher = () => `<p class="switch" role="group" aria-label="Which bot">${[["market", "Stocks and gold"], ["crypto", "Crypto 24/7"]].map(([v, t]) => `<button type="button" data-view="${v}" aria-pressed="${VIEW === v}">${t}</button>`).join("")}</p>`;

/* ---------- charts ---------- */
// Line chart with up to two series, a legend, end labels and a hover crosshair.
/** opts.minSpan: the smallest range the value axis shows (so cents don't look like a crash); opts.ref: a dashed reference line { value, label }. */
function lineChart(series, labels, fmt = v => num(v, 2), opts = {}) {
  const W = 760, H = 250, m = { l: 54, r: 92, t: 10, b: 24 }; const n = labels.length;
  if (n < 2) return `<p class="empty">Not enough points to draw yet.</p>`;
  const all = series.flatMap(s => s.values); let lo = Math.min(...all), hi = Math.max(...all); if (opts.ref) { lo = Math.min(lo, opts.ref.value); hi = Math.max(hi, opts.ref.value); }
  if (opts.minSpan && hi - lo < opts.minSpan) { const mid = (hi + lo) / 2; lo = mid - opts.minSpan / 2; hi = mid + opts.minSpan / 2; }
  if (lo === hi) { lo -= 1; hi += 1; } const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
  const X = i => m.l + (i / (n - 1)) * (W - m.l - m.r), Y = v => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
  const ticks = [0, 1, 2, 3].map(k => lo + ((hi - lo) * k) / 3);
  const refLine = opts.ref ? `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(opts.ref.value)}" y2="${Y(opts.ref.value)}" stroke="#8796A5" stroke-dasharray="4 4"/><text x="${m.l + 4}" y="${Y(opts.ref.value) - 5}" font-size="11.5" fill="#5B6B7A">${esc(opts.ref.label)}</text>` : "";
  const grid = refLine + ticks.map(t => `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="#E4E9EE"/><text x="${m.l - 8}" y="${Y(t) + 4}" text-anchor="end" font-size="11.5" fill="#5B6B7A">${esc(fmt(t))}</text>`).join("");
  const xl = [0, Math.floor((n - 1) / 2), n - 1].map((i, k) => `<text x="${X(i)}" y="${H - 6}" text-anchor="${["start", "middle", "end"][k]}" font-size="11.5" fill="#5B6B7A">${esc(bar(labels[i]))}</text>`).join("");
  // End labels: spread apart so no two overlap (any number of series).
  const ends = series.map(s => Y(s.values[n - 1])); const ord = ends.map((y, k) => k).sort((a, b) => ends[a] - ends[b]);
  for (let j = 1; j < ord.length; j++) if (ends[ord[j]] - ends[ord[j - 1]] < 14) ends[ord[j]] = ends[ord[j - 1]] + 14;
  const paths = series.map((s, k) => `<path d="${s.values.map((v, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1)).join("")}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" ${s.dash ? 'stroke-dasharray="5 4"' : ""}/><text x="${W - m.r + 8}" y="${ends[k] + 4}" font-size="12" fill="#16202B">${esc(s.short || s.name)}</text>`).join("");
  const legend = series.length > 1 ? `<p class="legend">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}</p>` : "";
  const id = "c" + Math.random().toString(36).slice(2);
  charts[id] = { series, labels, fmt, X, n, m, W, H };
  return `${legend}<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map(s => s.name).join(" and "))} over time" data-chart="${id}">${grid}${xl}${paths}<line class="cross" y1="${m.t}" y2="${H - m.b}" stroke="#16202B" stroke-width="1" visibility="hidden"/><rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"/></svg></div>`;
}
const charts = {};
/** Bars of a signed daily result around a zero line: green above, red below. One axis; hover shows the day's numbers. */
function barChart(rows, value, fmt, tipOf) {
  const W = 760, H = 210, m = { l: 54, r: 92, t: 10, b: 24 }; const n = rows.length; if (!n) return "";
  const vals = rows.map(value); let hi = Math.max(0, ...vals), lo = Math.min(0, ...vals); if (hi === lo) { hi += 1; lo -= 1; } const pad = (hi - lo) * 0.08; hi += pad; lo -= lo < 0 ? pad : 0;
  const Y = v => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b); const slot = (W - m.l - m.r) / n; const bw = Math.max(2, Math.min(28, slot - 2));
  const ticks = [lo, 0, hi].filter((t, i, a) => a.indexOf(t) === i);
  const grid = ticks.map(t => `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="${t === 0 ? "#9AA6B2" : "#E4E9EE"}"/><text x="${m.l - 8}" y="${Y(t) + 4}" text-anchor="end" font-size="11.5" fill="#5B6B7A">${esc(fmt(t))}</text>`).join("");
  const xl = [0, Math.floor((n - 1) / 2), n - 1].filter((i, k, a) => a.indexOf(i) === k).map((i, k, a) => `<text x="${m.l + slot * (i + 0.5)}" y="${H - 6}" text-anchor="${a.length === 1 ? "middle" : ["start", "middle", "end"][k]}" font-size="11.5" fill="#5B6B7A">${esc(bar(rows[i].day))}</text>`).join("");
  const bars = rows.map((r, i) => { const v = value(r); const y0 = Y(0), y1 = Y(v); const x = m.l + slot * i + (slot - bw) / 2;
    return `<rect data-i="${i}" x="${x.toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, Math.abs(y1 - y0)).toFixed(1)}" rx="2" fill="${v > 0 ? "var(--gain)" : v < 0 ? "var(--loss)" : "#C3CBD3"}"/>`; }).join("");
  const id = "b" + Math.random().toString(36).slice(2); charts[id] = { rows, tipOf };
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Result of each day" data-bars="${id}">${grid}${xl}${bars}</svg></div>`;
}
document.addEventListener("mousemove", e => {
  const rect = e.target.closest?.("svg[data-bars] rect[data-i]"); const svg = e.target.closest?.("svg[data-bars]");
  if (!svg) return; if (!rect) { $tip.hidden = true; return; }
  const c = charts[svg.dataset.bars]; $tip.innerHTML = c.tipOf(c.rows[+rect.dataset.i]); $tip.hidden = false;
  $tip.style.left = Math.min(e.clientX + 14, innerWidth - 240) + "px"; $tip.style.top = e.clientY + 14 + "px";
});
/** "What the bot did", one look: the account value each day, each day's result, and the same as a table. */
function dailyView(b) {
  const d = b.daily ?? []; if (!d.length) return `<p class="empty">No days yet.</p>`;
  const tip = r => `<strong>${esc(bar(r.day))}</strong><br>Result of trades closed: ${signed(r.pnl, 2)}<br>Closed ${r.closed} (${r.wins} won, ${r.losses} lost), opened ${r.opened}<br>Account value at the end: ${money(r.equity, 2)}`;
  const totals = d.reduce((a, r) => ({ pnl: a.pnl + r.pnl, wins: a.wins + r.wins, losses: a.losses + r.losses }), { pnl: 0, wins: 0, losses: 0 });
  const best = d.reduce((a, r) => (r.pnl > a.pnl ? r : a), d[0]); const worst = d.reduce((a, r) => (r.pnl < a.pnl ? r : a), d[0]);
  return `<dl class="stats">${stat("Days", d.length)}${stat("Closed trades", `${totals.wins + totals.losses} (${totals.wins} won)`)}${stat("Best day", best.pnl > 0 ? `${signed(best.pnl, 2)}, ${bar(best.day)}` : "-")}${stat("Worst day", worst.pnl < 0 ? `${signed(worst.pnl, 2)}, ${bar(worst.day)}` : "-")}</dl>
  <h3>Account value at the end of each day</h3>${lineChart([{ name: "Account value", short: money(d.at(-1).equity, 0), values: d.map(r => r.equity), color: "var(--accent)" }], d.map(r => r.day), v => money(v, 0))}
  <h3>Result of each day</h3><p class="small">Money from trades (or parts of trades) closed that day. Open trades are not counted until they close.</p>${barChart(d, r => r.pnl, v => (v > 0 ? "+" : v < 0 ? "−" : "") + "$" + num(Math.abs(v), 0), tip)}
  <details class="detail"><summary>Day by day as a table</summary><table class="compact"><thead><tr><th>Day</th><th class="num">Opened</th><th class="num">Closed</th><th class="num">Won / lost</th><th class="num">Result</th><th class="num">Account value</th></tr></thead><tbody>${[...d].reverse().map(r => `<tr><td>${esc(bar(r.day))}</td><td class="num">${r.opened}</td><td class="num">${r.closed}</td><td class="num">${r.wins} / ${r.losses}</td><td class="num ${r.pnl > 0 ? "gain" : r.pnl < 0 ? "loss" : ""}">${signed(r.pnl, 2)}</td><td class="num">${money(r.equity, 2)}</td></tr>`).join("")}</tbody></table></details>`;
}
document.addEventListener("mousemove", e => {
  const svg = e.target.closest?.("svg[data-chart]"); if (!svg) { $tip.hidden = true; document.querySelectorAll(".cross").forEach(c => c.setAttribute("visibility", "hidden")); return; }
  const c = charts[svg.dataset.chart]; if (!c) return; const r = svg.getBoundingClientRect(); const x = ((e.clientX - r.left) / r.width) * c.W;
  const i = Math.max(0, Math.min(c.n - 1, Math.round(((x - c.m.l) / (c.W - c.m.l - c.m.r)) * (c.n - 1))));
  const cross = svg.querySelector(".cross"); cross.setAttribute("x1", c.X(i)); cross.setAttribute("x2", c.X(i)); cross.setAttribute("visibility", "visible");
  $tip.innerHTML = `${esc(bar(c.labels[i]))}<br>` + c.series.map(s => `${esc(s.name)}: ${esc(c.fmt(s.values[i]))}`).join("<br>");
  $tip.hidden = false; $tip.style.left = Math.min(e.clientX + 14, innerWidth - 220) + "px"; $tip.style.top = e.clientY + 14 + "px";
});

document.addEventListener("mousemove", e => {
  const el = e.target.closest?.("[data-tip]"); if (!el) { if (!e.target.closest?.("svg[data-chart], svg[data-bars]")) $tip.hidden = true; return; }
  $tip.innerHTML = el.dataset.tip; $tip.hidden = false; $tip.style.left = Math.min(e.clientX + 14, innerWidth - 320) + "px"; $tip.style.top = e.clientY + 14 + "px";
});
/* ---------- plain-language advice ---------- */
const sideWord = s => (s === "short" ? "short" : "long");
function record(r) {
  if (!r) return "";
  const rr = r.rr ? `, wins ${num(r.rr, 1)} times the size of losses` : "";
  const checks = r.fragile == null ? "" : r.fragile ? " Failed a stress check, so trust it less." : " Passed both stress checks.";
  return `${r.trades} past trades, ${num(r.winRate, 0)}% won${rr}.${r.evidence === "thin" ? " Few trades, so the record is thin." : ""}${checks}`;
}
/** One sentence that says what to do with this symbol now, and a second line with the evidence. */
const REASON = { "desk-stop": "Desk stop: the desk hit its daily loss limit", milestone: "Milestone: closed for the accountant", bust: "Bust line: closed for the accountant", weekend: "Weekend pause", tp1: "Take-profit 1", tp2: "Take-profit 2", tp3: "Take-profit 3", sl1: "Stop 1", sl2: "Stop 2", sl3: "Stop 3", trail: "Rising stop (profit kept)", stop: "Stop", target: "Target", rule: "Strategy exit", "time-stop": "Too long at a loss", "circuit-breaker": "Safety stop" };
const soldPart = p => (p.qty0 && p.qty < p.qty0 * 0.999 ? ` ${num((1 - p.qty / p.qty0) * 100, 0)}% already sold for profit.` : "");
/** "take profit at A and B, the last third rides a rising stop" */
function tpText(tps, stop) {
  if (!tps?.length) return ", exit when the strategy says";
  return `, take profit at ${tps.map((t, i) => `TP${i + 1} ${price(t)}`).join(", ")}${tps.length > 1 ? " (a third each)" : ""}`;
}
function advice(s) {
  const t = s.top; const tf = t ? TF_NAME[t.tf] : "";
  if (s.bot) {
    const b = s.bot; return [`The paper bot is ${sideWord(b.side)} on the ${TF_NAME[b.tf]} chart since ${bar(b.entryDate)}: ${signed(b.pnl, 2)}. ${b.nextStop ? `Next stop ${b.nextStop.name} ${price(b.nextStop.px)}` : `Stop ${price(b.stop)}`}${b.target ? `, next take-profit ${price(b.target)}` : ", the rest rides the rising stop"}.${soldPart(b)}`, `Opened by ${b.strategyId}.`];
  }
  if (s.order) { const o = s.order; const what = o.type === "exit" ? "close its trade" : /_short(_adx)?$/.test(o.strategyId) ? "sell short" : "buy"; return [`The paper bot will ${what} at the next ${TF_NAME[o.tf]} open.`, `Signal from ${o.strategyId}.`]; }
  if (!t || t.action === "no-data") return ["No prices yet.", ""];
  if (t.action === "enter") {
    const p = t.plan; const verb = t.side === "short" ? "Sell short" : "Buy";
    return [`<strong>${verb}</strong> at the next ${tf} open. ${p?.sls?.length > 1 ? `Stops ${p.sls.map((x, i) => `SL${i + 1} ${price(x)}`).join(", ")} (${num(p?.riskPct, 1)}% away at SL${p.sls.length})` : `Stop ${price(p?.stop)} (${num(p?.riskPct, 1)}% away)`}${p?.tps ? tpText(p.tps) : p?.target ? `, target ${price(p.target)}` : ", exit when the strategy says"}.`, `${t.bestName}: ${record(t.record)}`];
  }
  if (t.action === "exit") return [`<strong>Close</strong> any ${sideWord(t.side)} trade at the next ${tf} open.`, `${t.bestName} says the move is over.`];
  if (t.action === "hold") return [`No new entry. ${esc(t.bestName)} has been ${sideWord(t.side)} on the ${tf} chart since ${bar(t.plan?.since)}; stop ${price(t.plan?.stop)}.`, "Too late to join: the bots only take new signals."];
  if (t.action === "wait") return [`Nothing to do yet. Watching ${esc(t.bestName)} on the ${tf} chart.`, record(t.record)];
  return ["Nothing to do. No strategy has a good record on any timeframe here.", ""];
}
const CELL = { enter: (r) => (r.side === "short" ? ["Short", "go-short"] : ["Buy", "go-long"]), exit: () => ["Close", "close"], hold: (r) => [r.side === "short" ? "In short" : "In long", "in"], wait: () => ["Watch", "watch"], "no-strategy": () => ["–", "none"], "no-data": () => ["", "none"] };
function tfCell(s, tf) {
  const r = s.tfs[tf]; if (!r) return `<td class="tf"></td>`;
  const [label, cls] = CELL[r.action](r); const tip = r.action === "no-strategy" ? `${TF_NAME[tf]}: no strategy with a good record` : `${TF_NAME[tf]}: ${r.why}`;
  return `<td class="tf"><span class="cell ${cls}" title="${esc(tip)}">${esc(label)}</span></td>`;
}
const GROUP = s => (s.bot || s.order ? 0 : !s.top ? 4 : { enter: 1, exit: 1, hold: 2, wait: 3 }[s.top.action] ?? 4);
const GROUP_NAME = ["Paper bot positions and orders", "Act at the next open", "Strategies already in a trade", "Watching", "Nothing to trade"];

/* ---------- screens ---------- */
let FILTER = "all";

/* ---------- Strategies: the map and the cards ---------- */
const SHORT = { donchian_trend: "Breakout", ema_pullback: "Pullback", ma_cross: "MA cross", rsi2_dip: "Dip", bollinger_dip: "BB bounce", supertrend: "Supertrend", macd_cross: "MACD", squeeze_break: "Squeeze" };
const shortName = id => id ? `${SHORT[id.replace(/_adx$/, "").replace(/_short$/, "")] ?? id}${id.endsWith("_adx") ? " ⓐ" : ""} ${/_short(_adx)?$/.test(id) ? "▼" : "▲"}` : "";
/** Shades of one hue by profit factor: light at 1.2, dark at 3 and above (a sequential scale, not a rainbow). */
const pfShade = v => v >= 3 ? ["#0F6E6E", "#fff"] : v >= 2 ? ["#3E9A94", "#fff"] : v >= 1.5 ? ["#9CD2CD", "#16202B"] : ["#D4ECEA", "#16202B"];
function strategyMap(today, bt, board) {
  const rows = today?.rows ?? []; const notTraded = new Set(bt?.hours?.notTraded ?? []);
  const bySym = {}; for (const r of rows) (bySym[r.symbol] ??= {})[r.tf] = r;
  const pos = new Map((bt?.positions ?? []).map(p => [p.key, p]));
  const syms = Object.keys(bySym).filter(x => Object.values(bySym[x])[0]?.class !== "index");
  const goodCount = x => TFS.filter(tf => bySym[x][tf]?.allowed?.length).length;
  const order = [...syms].sort((a, b) => (notTraded.has(a) - notTraded.has(b)) || goodCount(b) - goodCount(a) || a.localeCompare(b));
  const cell = (x, tf) => {
    const r = bySym[x][tf]; if (!r) return `<td class="mc none">·</td>`;
    const id = r.allowed?.[0]; const held = pos.get(`${x}@${tf}`);
    const sig = r.action === "enter" ? (r.side === "short" ? "sell" : "buy") : held ? "in" : "";
    const tip = `<strong>${esc(x)} · ${esc(TF_NAME[tf])}</strong><br>${id ? `${esc(r.bestName)}<br>${esc(record(r.record))}` : esc(r.why ?? "No rule with a good record.")}${sig === "buy" ? "<br><strong class='gain'>Buy signal now</strong>" : sig === "sell" ? "<br><strong class='loss'>Short signal now</strong>" : held ? `<br>The bot holds it (${esc(held.side)}).` : ""}`;
    if (!id) return `<td class="mc none" data-cell="${esc(x)}/${tf}" data-tip="${esc(tip)}">–</td>`;
    const [bg, fg] = pfShade(r.record?.profitFactor ?? 0);
    return `<td class="mc ${sig}" style="background:${bg};color:${fg}" data-cell="${esc(x)}/${tf}" data-tip="${esc(tip)}"><span class="mname">${esc(shortName(id))}</span><span class="mpf">${pf(r.record?.profitFactor)}</span>${sig ? `<span class="msig">${sig === "buy" ? "BUY" : sig === "sell" ? "SELL" : "IN"}</span>` : ""}</td>`;
  };
  let wasNot = false;
  const body = order.map(x => { const nt = notTraded.has(x); const sep = nt && !wasNot ? `<tr class="grp"><td colspan="${TFS.length + 1}">Watched only: not traded by the bot (cannot trade 24/7 on Lighter)</td></tr>` : ""; wasNot = wasNot || nt;
    return `${sep}<tr${nt ? ' class="dim"' : ""}><th scope="row" class="sym">${esc(x)}</th>${TFS.map(tf => cell(x, tf)).join("")}</tr>`; }).join("");
  const legend = `<p class="legend maplegend"><span><i style="background:#D4ECEA"></i>profit factor 1.2 to 1.5</span><span><i style="background:#9CD2CD"></i>1.5 to 2</span><span><i style="background:#3E9A94"></i>2 to 3</span><span><i style="background:#0F6E6E"></i>3 or more</span><span><i style="background:#F1F3F5"></i>no good rule</span><span><b class="gain">BUY</b> / <b class="loss">SELL</b> signal now, IN: the bot holds it</span></p>`;
  return `<p class="small">Each cell is the rule the bot uses on that chart (▲ buys, ▼ sells short) and its profit factor: what it won for each 1 it lost. Hover for its record; click to open the chart below.</p>${legend}<div class="mapwrap"><table class="map"><thead><tr><th></th>${TFS.map(tf => `<th>${esc(TF_NAME[tf])}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>`;
}
/** Small bars: on how many charts a rule has a good record, per timeframe. */
function miniBars(byTf) {
  const W = 230, H = 74, bw = 30, gap = (W - TFS.length * bw) / (TFS.length + 1); const max = Math.max(1, ...TFS.map(tf => byTf[tf]?.tested ?? 0));
  return `<svg viewBox="0 0 ${W} ${H}" class="mini" role="img" aria-label="Charts with a good record per timeframe">${TFS.map((tf, i) => { const v = byTf[tf] ?? { pass: 0, tested: 0 }; const x = gap + i * (bw + gap); const full = 44; const h = Math.max(v.pass ? 2 : 0, full * v.pass / max);
    return `<rect x="${x}" y="${8 + full - full * (v.tested / max)}" width="${bw}" height="${full * (v.tested / max)}" fill="#EEF1F4" rx="2"/><rect x="${x}" y="${8 + full - h}" width="${bw}" height="${h}" fill="var(--accent)" rx="2"/><text x="${x + bw / 2}" y="${6 + full - h}" text-anchor="middle" font-size="10.5" fill="#16202B">${v.pass}</text><text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle" font-size="10.5" fill="#5B6B7A">${tf}</text>`; }).join("")}</svg>`;
}
function strategyCards(today, bt, ind, defs) {
  const rows = today?.rows ?? []; const chosen = bt?.shortlist?.chosen ?? []; const notTraded = new Set(bt?.hours?.notTraded ?? []);
  const trades = bt?.trades ?? []; const open = bt?.positions ?? [];
  const card = d => {
    const byTf = {}; for (const tf of TFS) { const a = (ind?.byTf?.[tf] ?? []).find(x => x.id === d.id); byTf[tf] = { pass: a?.symbolsPassing ?? 0, tested: a?.symbolsTested ?? 0, pf: a?.medianProfitFactor ?? 0, win: a?.medianWinRate ?? 0 }; }
    const bestTf = TFS.reduce((a, tf) => (byTf[tf].pass > (byTf[a]?.pass ?? -1) ? tf : a), "1d");
    const usedOn = rows.filter(r => r.allowed?.[0] === d.id && !notTraded.has(r.symbol) && r.class !== "index");
    const mine = trades.filter(t => t.strategyId === d.id); const ids = new Map();
    for (const t of mine) { const k = t.key + "|" + t.entryDate; ids.set(k, (ids.get(k) ?? 0) + t.pnl); }
    const openHere = open.filter(p => p.strategyId === d.id); const done = [...ids.entries()].filter(([k]) => !openHere.some(p => p.key + "|" + p.entryDate === k));
    const won = done.filter(([, v]) => v > 0).length; const pnl = mine.reduce((a, t) => a + t.pnl, 0);
    const onList = chosen.includes(d.id);
    return `<article class="scard${onList ? " on" : ""}"><header><strong>${esc(d.name)}</strong> ${onList ? `<span class="tag in">a bot uses it</span>` : ""}<br><span class="small">${esc(d.side === "short" ? "Sells short: profits if the price falls" : "Buys: profits if the price rises")}</span></header>
      <p class="small">${esc(d.plain)}</p>
      <div class="mini-wrap"><span class="small">Charts with a good record, by timeframe</span>${miniBars(byTf)}</div>
      <dl class="mstats"><div><dt>Best timeframe</dt><dd>${byTf[bestTf].pass ? `${esc(TF_NAME[bestTf])}, typical profit factor ${pf(byTf[bestTf].pf)}` : "none"}</dd></div>
      <div><dt>Used by the bot on</dt><dd>${usedOn.length ? `${usedOn.length} charts` : "no chart now"}</dd></div>
      <div><dt>Paper bot with it</dt><dd>${done.length || openHere.length ? `${done.length} closed (${won} won), ${openHere.length} open, ${signed(pnl, 2)}` : "no trades yet"}</dd></div></dl>
      ${usedOn.length ? `<p class="chips">${usedOn.slice(0, 12).map(r => `<a href="#strategies/${encodeURIComponent(r.symbol)}/${r.tf}" class="chip">${esc(r.symbol)} ${esc(r.tf)}</a>`).join("")}${usedOn.length > 12 ? `<span class="small"> +${usedOn.length - 12} more</span>` : ""}</p>` : ""}
    </article>`;
  };
  const list = defs ?? []; const on = list.filter(d => chosen.includes(d.id)); const off = list.filter(d => !chosen.includes(d.id));
  return `<p class="small">The bot uses ${on.length ? on.length : "none"} of the ${list.length} rules this week (picked on older data, checked on newer data it never saw). The others are tested on every chart too.</p>
  <div class="cards">${on.map(card).join("")}</div>${off.length ? `<details class="detail"><summary>The other ${off.length} rules</summary><div class="cards">${off.map(card).join("")}</div></details>` : ""}`;
}

async function chartDetail(s, tf, b, bt, defs) {
    const ev = await api(q(`/api/eval?key=${encodeURIComponent(s.symbol + "@" + tf)}`));
    const onList = new Set(bt?.shortlist?.chosen ?? []);
    const tabs = `<p class="switch" role="group" aria-label="Timeframe">${b.timeframes.map(t => `<button type="button" data-tf="${t}" data-sym="${esc(s.symbol)}" aria-pressed="${t === tf}">${esc(TF_NAME[t])}</button>`).join("")}</p>`;
    const head = `<div id="detail" class="detailhead"><h2>${esc(s.symbol)}, ${esc(TF_NAME[tf])} chart, in detail</h2><input type="hidden" id="pick" value="${esc(s.symbol)}"></div>${tabs}`;
    const sum = ev?.summary; if (!sum || !sum.evals.length) return `${head}<p class="empty">${esc(sum?.why ?? "No prices for this chart yet.")}</p>`;
    const sel = SEL[s.symbol + tf] ?? sum.best ?? sum.evals[0].id; const cv = ev.curves[sel]; const picked = sum.evals.find(e => e.id === sel);
    const verdict = e => e.verdict.passes ? `<span class="tag hold">Good record${e.verdict.evidence === "thin" ? ", few trades" : ""}</span>` : `<span class="tag fail" title="${esc(e.verdict.reasons.join("; "))}">Not good enough</span><br><span class="small">${esc(e.verdict.reasons[0] ?? "")}</span>`;
    const checks = e => e.robust ? `<span class="${e.robust.luck.lossPct > 20 ? "loss" : "gain"}">Luck ${e.robust.luck.lossPct > 20 ? "failed" : "passed"}</span><br><span class="${e.robust.settings.tested && e.robust.settings.profitable < e.robust.settings.tested * 0.75 ? "loss" : "gain"}">Settings ${e.robust.settings.tested && e.robust.settings.profitable < e.robust.settings.tested * 0.75 ? "failed" : "passed"}</span>` : `<span class="small">only for good records</span>`;
    return `${head}
    <div class="panel"><strong>${esc(s.symbol)} on the ${esc(TF_NAME[tf])} chart:</strong> ${sum.regime ? `${esc(sum.regime.trend)}, ${esc(sum.regime.character)}. ${esc(sum.regime.note)}` : ""} ${num(sum.bars, 0)} bars of history, last ${esc(bar(sum.lastDate))}.</div>
    ${cv && picked ? `<h3>${esc(picked.name)} against just holding ${esc(s.symbol)}</h3><div class="panel">${lineChart([{ name: "Rule", color: C.strategy, values: cv.equity }, { name: "Just holding", color: C.bench, dash: true, values: cv.buyHold }], cv.dates, v => num(v, 2) + "×")}<p class="small" style="margin:6px 0 0">Growth of 1 unit of money, after costs. ${esc(defs.find(x => x.id === sel)?.plain ?? "")}</p></div>` : ""}
    <h3>All rules on this chart</h3><p class="small">Rules with a good record come first. Select a row to draw it above.</p>
    <table class="strat"><thead><tr><th>Rule</th><th>Verdict</th><th class="num">Trades</th><th class="num">Won</th><th class="num">Win size vs loss size</th><th class="num">Profit factor</th><th class="num">Return</th><th class="num">Just holding</th><th class="num">Worst drop</th><th title="Luck check: its own trades redrawn at random 1,000 times; failed if more than 20% of the redraws lose money. Settings check: every setting moved 25% down and up; failed if fewer than 3 in 4 of those still make money.">Stress checks</th></tr></thead><tbody>
    ${[...sum.evals].sort((a, b) => (b.verdict.passes - a.verdict.passes) || b.score - a.score || b.metrics.profitFactor - a.metrics.profitFactor).map(e => { const d = defs.find(x => x.id === e.id); return `<tr class="click ${e.id === sel ? "sel" : ""}" data-strat="${esc(e.id)}" title="${esc(d?.plain ?? "")}"><td><strong>${esc(e.name)}</strong>${onList.has(e.id) ? `<br><span class="tag in" title="One of the strategies a bot of this world uses this week">a bot uses it</span>` : ""}</td><td>${verdict(e)}</td><td class="num">${e.metrics.trades}</td><td class="num">${num(e.metrics.winRate, 0)}%</td><td class="num">${e.metrics.avgLossPct < 0 && e.metrics.avgWinPct > 0 ? num(e.metrics.avgWinPct / -e.metrics.avgLossPct, 1) + " : 1" : "–"}</td><td class="num">${pf(e.metrics.profitFactor)}</td><td class="num">${pct(e.metrics.totalReturnPct, 0)}</td><td class="num">${pct(e.metrics.buyHoldReturnPct, 0)}</td><td class="num">${pct(e.metrics.maxDrawdownPct, 0)}</td><td class="small">${checks(e)}</td></tr>`; }).join("")}</tbody></table>`;
}

const screens = {
  async today() {
    const b = await api("/api/board");
    if (!b) return `<h1>Today</h1><p class="empty">The first price download is still running. This page fills in by itself in a minute or two.</p>`;
    const st = b.status; const d = st.downloads; const failed = d?.failed ?? [];
    const statusLine = `<p class="status"><span>Prices ${st.pricesAt ? `updated ${clock(st.pricesAt)}` : "not live yet"}${st.tickErrors.length ? ` <span class="loss" title="${esc(st.tickErrors.slice(0, 5).join(" | "))}">(${st.tickErrors.length} live price requests failed in the last minute)</span>` : ""}</span><span>Strategies checked ${clock(st.checkedAt)}, next check ${clock(st.nextCheck)}</span><span>${d ? `${d.ok} of ${d.total} downloads OK` : ""}${failed.length ? ` <a href="#" id="showfail">show the ${failed.length} that failed</a>` : ""}</span>${b.context.map(c => `<span>${esc(c.symbol)} ${pct(c.changePct)}</span>`).join("")}</p>
      <div id="fails" hidden>${failed.length ? `<table class="compact"><tbody>${failed.slice(0, 60).map(f => `<tr><td>${esc(f.symbol)} ${esc(f.tf)}</td><td class="small">${esc(f.error)}${f.cached ? " (older saved prices are used)" : ""}</td></tr>`).join("")}</tbody></table>` : ""}</div>`;
    const bots = b.bots.filter(Boolean).map(x => `<a href="#bot" data-gobot="${esc(x.id)}">${esc(x.name)} (${x.side === "short" ? "bear" : "bull"}, ${x.view === "crypto" ? "crypto" : "stocks"}): ${money(x.equity, 2)}${x.badges ? `, ${x.badges} badge${x.badges === 1 ? "" : "s"}` : ""}, ${x.positions} open</a>`).join("") + `<a href="#competition">Scoreboard</a>`;
    let list = b.symbols; if (FILTER === "act") list = list.filter(s => GROUP(s) <= 1);
    let last = -1; const rows = list.map(s => {
      const g = GROUP(s); const head = g !== last ? `<tr class="grp"><td colspan="${4 + b.timeframes.length}">${GROUP_NAME[g]}</td></tr>` : ""; last = g;
      const [main, sub] = advice(s);
      return `${head}<tr class="click" tabindex="0" data-symbol="${esc(s.symbol)}" data-tf="${esc(s.bot?.tf ?? s.order?.tf ?? s.top?.tf ?? "1d")}">
        <td><span class="sym">${esc(s.symbol)}</span><br><span class="small">${esc(s.group)}</span></td>
        <td class="num"><span class="px">${price(s.price)}</span><br><span class="small">${pct(s.changePct)} ${esc(s.changeLabel)}</span></td>
        <td class="todo">${main}${sub ? `<br><span class="small">${esc(sub)}</span>` : ""}</td>
        ${b.timeframes.map(tf => tfCell(s, tf)).join("")}
        <td class="small">${s.class === "index" ? "Market context" : s.allDay ? `<span class="gain">24/7</span>${s.class === "crypto" ? "" : " on Lighter"}` : "Market hours, watched only"}</td></tr>`;
    }).join("");
    const acts = b.symbols.filter(s => GROUP(s) <= 1).length;
    return `<div class="head"><div><h1>Today</h1>${statusLine}</div><button id="refresh">Check now</button></div>
    <p class="botline">${bots}</p>
    <p class="switch" role="group" aria-label="Which symbols"><button type="button" data-filter="all" aria-pressed="${FILTER === "all"}">All ${b.symbols.length} symbols</button><button type="button" data-filter="act" aria-pressed="${FILTER === "act"}">Only with something to do (${acts})</button></p>
    ${list.length ? `<table class="board"><thead><tr><th>Symbol</th><th class="num">Price</th><th>What to do</th>${b.timeframes.map(tf => `<th class="tf">${esc(tf)}</th>`).join("")}<th title="Whether the bots trade it: around the clock (crypto, or a Lighter perp with enough trading), or only watched">Bot trades</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="empty">Nothing to do right now. The list updates by itself every minute.</p>`}
    <p class="small legendline"><span class="cell go-long">Buy</span> or <span class="cell go-short">Short</span>: a new signal on that chart, act at the next open. <span class="cell in">In long</span>: the strategy is already in a trade. <span class="cell close">Close</span>: time to get out. <span class="cell watch">Watch</span>: a strategy with a good record is waiting. <span class="cell none">–</span>: nothing has a good record there. Hover a cell for the reason; select a row to see the tests.</p>`;
  },
  async bot() {
    await loadBots(); const me = BOTS.find(x => x.id === BOT) ?? BOTS[0]; BOT = me.id; VIEW = me.view === "crypto" ? "crypto" : "market";
    const [b, comp] = await Promise.all([api(`/api/bot?bot=${encodeURIComponent(BOT)}`), api("/api/competition")]); CHECKING = b?.checkingSince ?? null;
    if (!b) return `<h1>Paper bots</h1>${botSwitcher()}<p class="empty">This bot starts after its first price download.</p>`;
    const a = b.accountant;
    const ret = (b.equity / b.startEquity - 1) * 100; const s = b.trades; const wins = s.filter(t => t.pnl > 0).length; const c = b.checked;
    const idle = !s.length && !b.positions.length && !b.pending.length;
    return `<h1>Paper bots</h1>${botSwitcher()}
    <div class="panel persona" style="border-left:5px solid ${botColor(b.id)}"><div><h2 style="margin:0">${esc(b.name)}</h2><p class="small" style="margin:2px 0 0">${esc(b.motto || ROLE(b))} ${b.side === "both" ? `Free to buy or sell short${b.lighterCrypto ? ", on any crypto that trades well on Lighter (not only the six on Today)" : ""}. It never copies a chart-and-strategy pair another bot already trades.` : `Trades only ${b.side === "short" ? "short sales (it earns when prices fall)" : "buys (it earns when prices rise)"} on ${esc(WORLD(b))}.`}</p></div>
      ${a ? `<div class="persona-score">${b.tier ? tierTag(b.tier.level, b.tier.name) : ""} ${badgeRow(a.badges)}<p class="small" style="margin:4px 0 0">${b.tier ? esc(streakText(a.streak, b.tier.toNext, b.tier.tiers, b.tier.names, b.tier.level)) : ""} · <a href="#competition">scoreboard</a></p></div>` : ""}</div>
    ${b.weekend ? `<div class="notice"><strong>Weekend pause.</strong> The competition stops from Friday 22:00 to Monday 00:00 (Madrid time). Everything was closed on Friday; trading starts again on Monday.</div>` : ""}
    ${b.fired ? `<div class="notice"><strong>${esc(b.name)} has stopped trading.</strong> ${esc(b.fired.reason.replace(/^.*?: /, ""))} ${b.fired.replaceAt ? `A recruit takes the seat ${esc(when(b.fired.replaceAt))}, if the accountant has ${money(a?.startGrant ?? 250)} to lend.` : ""}</div>` : ""}
    ${a ? `<dl class="stats">${stat("Locked award", money(a.award, 2))}${stat("Loan still owed", a.debt > 0 ? `${money(a.debt, 2)} <span class="small">the accountant's money</span>` : `<span class="gain">repaid: trading its own money</span>`)}${stat("Quiet-week strikes", `${a.strikes ?? 0} <span class="small">of ${comp?.rules?.maxStrikes ?? 3}${Date.parse(a.nextInterestAt) > Date.now() ? `, next check ${esc(when(a.nextInterestAt))}` : ""}</span>`)}${stat("Funding", Math.abs(b.fundingPaid ?? 0) < 0.005 ? "none yet" : `${money(Math.abs(b.fundingPaid), 2)} <span class="small">${b.fundingPaid > 0 ? "paid" : "received"}</span>`)}${b.books ? stat("Books", Math.abs(b.books.difference) < 0.01 ? `<span class="gain">balance</span>` : `<span class="loss">off by ${money(b.books.difference, 2)}</span>`) : ""}${stat("Saves by the award", a.saves)}${b.twin ? stat("Against its random twin", `${pct((b.resultPct ?? a.index - 100) - b.twin.indexPct, 1)} <span class="small">twin ${pct(b.twin.indexPct, 1)}, ${b.twin.trades} trades</span>`) : ""}${stat("Hired", `${esc(bar(a.hiredAt))}${b.recruit > 1 ? ` <span class="small">${ord(b.recruit)} in this seat</span>` : ""}`)}</dl>` : ""}
    ${a ? `<div class="panel" style="margin-top:12px">${progressBar(b.equity, a.grant)}</div>` : ""}
    ${a ? rivalsPanel(comp, b) : ""}
    ${b.playbook ? `<h2>The charts ${esc(b.name)} chose</h2>${b.playbook.length ? `<table class="compact"><thead><tr><th>Symbol</th><th>Chart</th><th>Strategy</th><th class="num">Trades in newer data</th><th class="num">Profit factor there</th><th class="num">Average trade there</th></tr></thead><tbody>${b.playbook.map(p => `<tr><td class="sym">${esc(p.key.split("@")[0])}</td><td>${esc(TF_NAME[p.key.split("@")[1]] ?? p.key.split("@")[1])}</td><td>${esc(p.name)}</td><td class="num">${p.testTrades}</td><td class="num">${pf(p.testPF)}</td><td class="num">${pct(p.testAvgPct, 2)}</td></tr>`).join("")}</tbody></table><p class="small">Up to ${comp?.rules?.maxCharts ?? 8} charts (a few more while it is last and behind), one per symbol: the ones where its strategies made the most money on the newest 30% of the history, which the choice never saw. Re-chosen each week. Thin evidence: a few dozen trades per chart at most.</p>` : `<p class="empty">No chart passed the check on unseen data this week, so ${esc(b.name)} trades nothing until next week's choice.</p>`}` : ""}
    ${b.halted ? `<div class="notice"><strong>This bot is stopped.</strong> ${esc(b.halted.reason)} It closed every position on ${esc(bar(b.halted.at))}. <button id="resume">I have reviewed it, resume the bot</button></div>` : ""}
    ${botClock(b)}
    <div class="panel heart">${c ? `It watches ${c.markets} charts (each symbol on each timeframe); ${c.withStrategy} of them have a strategy with a good record, and only those can trade. ${c.newBars} new bars were read in this check.` : ""} ${idle ? `No new signal has appeared since it started on ${esc(bar(b.startedAt))}. It does not join trades that began before a signal.` : ""}</div>
    ${b.shortlist ? shortlistPanel(b) : ""}
    <dl class="stats">${stat("Account value", money(b.equity, 2))}${stat(a ? "Trading result since start" : "Since start", pct(b.resultPct ?? (a ? a.index - 100 : ret), 2))}${stat("Open trades", b.positions.length)}${stat("Exposure", `${num(b.equity > 0 ? b.exposure / b.equity : 0, 2)}× <span class="small">of ${num(b.maxLeverage, 1)}× allowed</span>`)}${stat("Closed trades", s.length ? `${s.length} <span class="small">(${wins} won)</span>` : "0")}</dl>
    <p class="small">Pretend money: a grant of ${money(b.startEquity)} at the start. ${num(b.riskPct, 1)}% of the account at risk per trade, one position per symbol, a new trade only on a new signal, filled at the next bar's open. ${exitWords(b.exits)} ${a ? `The accountant lends ${money(a.startGrant)}. At twice the grant the bot closes everything, earns a badge, the profit goes into its locked award (which repays the loan first) and it starts again with ${money(a.grant)}. At half the grant the award refills it, or, if the award is too small, the bot is fired and a recruit takes its place. The loan has no interest and never grows. From its second week, a week with fewer than 5 closed trades is a strike; 3 strikes in a row and it is replaced. At half the grant it stops at once and, if its award cannot refill it, a recruit takes the seat at the end of the week. Lighter funding is charged every hour on open positions. Nothing is held over the weekend. The trading result leaves the accountant's money out.` : `If the account falls ${num(b.maxDrawdownPct, 0)}% below its best value, the bot closes everything and waits for you.`}</p>
    ${a?.events?.length ? `<h2>The accountant's decisions</h2><table class="compact"><tbody>${[...a.events].reverse().slice(0, 20).map(ev => `<tr><td style="white-space:nowrap">${esc(bar(ev.d))}</td><td>${kindTag(ev.kind)}</td><td>${esc(ev.msg)}</td></tr>`).join("")}</tbody></table>` : ""}
    <h2>Open trades</h2>${b.positions.length ? `<table><thead><tr><th>Symbol</th><th>Chart</th><th>Direction</th><th>Opened</th><th class="num">Entry</th><th class="num">Now</th><th class="num">Next stop</th><th class="num">Next take-profit</th><th class="num">Still open</th><th class="num">Profit</th></tr></thead><tbody>${b.positions.map(p => `<tr><td class="sym">${esc(p.symbol)}</td><td>${esc(TF_NAME[p.tf])}</td><td>${esc(p.side)}</td><td>${esc(bar(p.entryDate))}</td><td class="num">${price(p.entry)}</td><td class="num">${price(p.price)}</td><td class="num">${p.nextStop ? `${price(p.nextStop.px)}<br><span class="small${p.legs?.hits ? " gain" : ""}">${esc(p.nextStop.name)}${p.legs?.hits ? ", profit protected" : ""}</span>` : price(p.stop)}</td><td class="num">${p.target ? price(p.target) : `<span class="small" title="Both take-profits filled. The last part has no fixed target: it closes when the price falls back to the rising stop.">none, rides the stop</span>`}</td><td class="num">${p.qty0 ? num(p.qty / p.qty0 * 100, 0) + "%" : "100%"}</td><td class="num">${signed(p.pnl, 2)}</td></tr>`).join("")}</tbody></table>` : `<p class="empty">No open trades.</p>`}
    ${b.pending.length ? `<h2>Orders for the next open</h2><table><tbody>${b.pending.map(p => `<tr><td class="sym">${esc(p.symbol)}</td><td>${esc(TF_NAME[p.tf])}</td><td>${p.type === "entry" ? (p.strategyId.endsWith("_short") ? "Sell short" : "Buy") : "Close"}</td><td>${esc(p.strategyId)}</td><td>signal ${esc(bar(p.signalDate))}</td></tr>`).join("")}</tbody></table>` : ""}
    <h2>Account value</h2>${b.equityCurve.length > 1 ? `<div class="panel">${lineChart([{ name: "Account value", short: money(b.equity), color: C.strategy, values: b.equityCurve.map(p => p.equity) }], b.equityCurve.map(p => p.d), v => money(v, 2), a ? { minSpan: a.grant * 0.04, ref: { value: a.grant, label: `Grant ${money(a.grant)}` } } : {})}</div>` : `<p class="empty">The line appears after two checks.</p>`}
    <h2>Closed trades</h2>${s.length ? `<table><thead><tr><th>Symbol</th><th>Chart</th><th>Direction</th><th>Opened</th><th>Closed</th><th>Why</th><th class="num">Return</th><th class="num">Profit</th></tr></thead><tbody>${[...s].reverse().slice(0, 100).map(t => `<tr><td class="sym">${esc(t.symbol)}</td><td>${esc(TF_NAME[t.tf])}</td><td>${esc(t.side)}</td><td>${esc(bar(t.entryDate))}</td><td>${esc(bar(t.exitDate))}</td><td>${esc(REASON[t.reason] ?? t.reason)}</td><td class="num">${pct(t.retPct, 2)}</td><td class="num">${signed(t.pnl, 2)}</td></tr>`).join("")}</tbody></table>` : `<p class="empty">No closed trades yet.</p>`}
    ${VIEW === "market" ? `<div id="lighter"></div>` : ""}
    <h2>What the bot did</h2>${dailyView(b)}
    <details class="detail"${b.daily?.length ? "" : " open"}><summary>Every action, one by one (${b.log.length})</summary>${b.log.length ? `<table class="compact"><tbody>${b.log.map(l => `<tr><td style="white-space:nowrap">${esc(bar(l.d))}</td><td>${esc(l.msg)}</td></tr>`).join("")}</tbody></table>` : `<p class="empty">Nothing yet.</p>`}</details>`;
  },
  async accountant() {
    await loadBots(); const o = await api("/api/office");
    if (!o) return `<h1>Accountant</h1><p class="empty">The accountant's reports appear after the bots' first check.</p>`;
    const nameOf = id => BOTS.find(b => b.id === id)?.name ?? id;
    const who = id => `<span class="who"><i class="swatch" style="background:${botColor(id)}"></i>${esc(nameOf(id))}</span>`;
    const dayName = d => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
    const R = o.rules; const k = o.desk; const today = o.days[0]; const open = o.approvals.filter(a => a.status === "pending");
    const ask = a => `<article class="panel approval" data-approval="${esc(a.id)}"><p style="margin:0 0 4px"><strong>${esc(a.title)}</strong> ${a.status === "pending" ? `<span class="tag hungry">waiting for you</span>` : `<span class="tag ${a.status === "yes" ? "in" : ""}">you said ${esc(a.status)}${a.answeredAt ? ` on ${esc(when(a.answeredAt + ":00Z"))}` : ""}</span>`}</p>
      <p class="small" style="margin:0 0 8px">${esc(a.detail)} <span>Asked ${esc(when(a.at + ":00Z"))}.</span></p>
      <p style="margin:0"><button type="button" class="approve" data-yes="1">${a.status === "yes" ? "Yes (chosen)" : "Yes"}</button> <button type="button" class="approve" data-yes="0">${a.status === "no" ? "No (chosen)" : "No"}</button></p></article>`;
    const guard = !k ? "" : k.stoppedDay ? `<span class="loss">Stopped for today</span>: the desk fell ${num(-(k.last?.dayPct ?? 0), 2)}% (limit ${R.dailyLossPct}%). No new trades until tomorrow.`
      : k.halved ? `<span class="warn">Half risk</span>: the desk is ${num(-(k.last?.fromHighPct ?? 0), 2)}% under its best (rule at ${R.drawdownPct}%). Full risk again within ${R.recoverPct}% of the best.`
      : `<span class="gain">Normal</span>: today ${pct(k.last?.dayPct ?? 0, 2)} (stop at −${R.dailyLossPct}%), ${num(Math.abs(k.last?.fromHighPct ?? 0), 2)}% under the desk's best (half risk at ${R.drawdownPct}%).`;
    const dayRows = o.days.map(d => `<tr><td>${esc(dayName(d.day))}${d.live ? ` <span class="small">(today)</span>` : ""}</td><td class="num">${d.deskPct == null ? "–" : pct(d.deskPct, 2)}</td><td class="num">${d.trades} <span class="small">(${d.wins})</span></td><td class="num">${signed(d.pnl, 2)}</td>${d.bots.map(b => `<td class="num" title="${esc(b.name)}: ${b.trades} trades, ${b.pnl.toFixed(2)} USD">${pct(b.pct, 2)}</td>`).join("")}<td class="small">${esc(d.text)}</td></tr>`).join("");
    const weekRows = o.weekly.map(w => `<tr><td>${esc(dayName(w.week))}${w.live ? ` <span class="small">(this week)</span>` : ""}</td><td class="num">${w.trades}</td><td class="num">${signed(w.pnl, 2)}</td><td class="num">${w.badges}</td><td class="num">${w.saves}</td><td class="num">${w.strikes}</td><td>${w.best ? esc(w.best) : "–"}</td></tr>`).join("");
    const botWeeks = BOTS.map(b => { const ws = o.weeks[b.id] ?? []; return `<details class="detail"${ws[0]?.live ? " open" : ""}><summary>${who(b.id)} <span class="small">${ws[0] ? `${ws[0].trades} trades this week, ${ws[0].returnPct > 0 ? "+" : ""}${num(ws[0].returnPct, 2)}%` : "no report yet"}</span></summary>
      ${ws.map(w => `<div class="report"><p class="small" style="margin:8px 0 2px"><strong>Week of ${esc(dayName(w.week))}</strong>${w.live ? " (so far)" : ""}</p><p style="margin:0"><strong>${esc(nameOf(b.id))}:</strong> ${esc(w.bot)}</p><p style="margin:2px 0 0"><strong>Accountant:</strong> <span class="${w.strike ? "loss" : w.badges ? "gain" : ""}">${esc(w.accountant)}</span></p></div>`).join("") || `<p class="empty">No week to report yet.</p>`}</details>`; }).join("");
    const riskRows = o.risk.map(r => `<tr class="click" data-gobot="${esc(r.id)}"><td>${who(r.id)}${r.stopped ? ` <span class="tag hungry">stopped</span>` : ""}</td><td>${esc(r.tier)} <span class="small">(${r.streak} in a row)</span></td><td class="num">${money(r.equity, 2)}</td><td class="num ${r.cushion < r.bustLine * 0.4 ? "loss" : ""}">${money(r.cushion, 2)}</td><td class="num">${money(r.award, 2)}</td><td class="num">${r.debt > 0.005 ? money(r.debt, 2) : `<span class="gain">0</span>`}</td><td class="num">${money(r.accountantAtRisk, 2)}</td><td class="num">${r.strikes}</td></tr>`).join("");
    return `<div class="head"><div><h1>Accountant</h1><p class="sub">The bots report to the accountant every week and the accountant reports to you every day. Big decisions wait here for your yes or no.</p></div></div>
    <h2>Waiting for your decision</h2>${open.length ? open.map(ask).join("") : `<p class="empty">Nothing to decide right now. When a bot is stopped, hiring its recruit waits here for your yes; a bot that becomes an Experienced trader asks here before any talk of real money.</p>`}
    <h2>Today's report</h2><div class="panel"><p style="margin:0 0 6px"><strong>${today ? esc(today.text) : "No report yet."}</strong></p>
      <p class="small" style="margin:0 0 6px">Desk guard: ${guard}</p>
      <p class="small" style="margin:0">Bank: ${money(o.bank.available, 2)} available of ${money(o.bank.start, 0)}; ${money(o.bank.owed, 2)} still lent out; the most the accountant can still lose is ${money(o.bank.atRisk, 2)}; profit so far ${signed(o.bank.profit, 2)}.</p></div>
    <h2>Money at risk, bot by bot</h2><table><thead><tr><th>Bot</th><th>Tier</th><th class="num">Account</th><th class="num" title="Account value above the stop line (half the grant)">Above the stop line</th><th class="num">Award</th><th class="num">Owes</th><th class="num" title="What the accountant itself could still lose on this bot">Accountant at risk</th><th class="num">Strikes</th></tr></thead><tbody>${riskRows}</tbody></table>
    <h2>Daily reports</h2><table class="compact"><thead><tr><th>Day</th><th class="num">Desk</th><th class="num">Trades (won)</th><th class="num">Profit</th>${(o.days[0]?.bots ?? []).map(b => `<th class="num">${esc(b.name)}</th>`).join("")}<th>Accountant</th></tr></thead><tbody>${dayRows}</tbody></table>
    <h2>Weekly reports</h2><table class="compact"><thead><tr><th>Week of</th><th class="num">Trades</th><th class="num">Profit</th><th class="num">Badges</th><th class="num">Saves</th><th class="num">Strikes</th><th>Best bot</th></tr></thead><tbody>${weekRows}</tbody></table>
    <h2>The bots' weekly reports to the accountant</h2>${botWeeks}
    <h2>Desk rules</h2><p class="small">Daily loss limit ${R.dailyLossPct}% (everything closed, no trades until the next Madrid day). Drawdown rule: ${R.drawdownPct}% under the desk's best halves the risk per trade until it is back within ${R.recoverPct}%. Correlation cap: no two bots in the same direction on the same market, or on markets whose hourly moves correlate above ${R.maxCorrelation} (last ${R.corrDays} days). Costs per side by open interest on Lighter: ${R.costTiers.map(t => `${t.bps} bps from $${t.minOiUsd >= 1e6 ? num(t.minOiUsd / 1e6, 0) + "M" : num(t.minOiUsd / 1e3, 0) + "k"}`).join(", ")}. An entry is cancelled when the open is more than ${R.maxSlipAtr} ATR from the signal close.</p>
    ${k?.log?.length ? `<details class="detail"><summary>Desk guard log</summary><ul class="small">${k.log.map(l => `<li>${esc(when(l.d + ":00Z"))}: ${esc(l.msg)}</li>`).join("")}</ul></details>` : ""}`;
  },
  async competition() {
    await loadBots(); const c = await api("/api/competition"); CHECKING = c?.checkingSince ?? null;
    if (!c) return `<h1>Competition</h1><p class="empty">The scoreboard appears after the bots' first check.</p>`;
    const by = Object.fromEntries(c.bots.map(b => [b.id, b])); const monthName = m => new Date(m + "-15T12:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    const cur = c.months.find(m => m.month === c.month); const lead = cur?.standings[0]; const R = c.rules;
    const name = id => `<span class="who"><i class="swatch" style="background:${botColor(id)}"></i>${esc(by[id]?.name ?? id)}</span>`;
    const cards = c.bots.map(b => `<article class="card bot-card click" data-gobot="${esc(b.id)}" tabindex="0" style="border-top:5px solid ${botColor(b.id)}">
      <header><strong class="botname">${esc(b.name)}</strong> ${tierTag(b.tier, b.tierName)}${lead?.id === b.id && (lead.trades || lead.badges) ? ` <span class="tag in">leads ${esc(monthName(c.month).split(" ")[0])}</span>` : ""}${b.stopped ? ` <span class="tag hungry">stopped</span>` : b.strikes ? ` <span class="tag hungry" title="Quiet weeks in a row">${b.strikes} strike${b.strikes === 1 ? "" : "s"}</span>` : ""}${b.hungry ? ` <span class="tag hungry" title="Last this month and behind: may trade a few more charts until it catches up.">hungry</span>` : ""}<br><span class="small">${esc(ROLE(b))}${b.recruit > 1 ? ` · ${ord(b.recruit)} in this seat` : ""}</span></header>
      <div class="badgeline">${badgeRow(b.badges, 20)}</div>
      <p class="small" style="margin:0 0 6px">${esc(streakText(b.streak, b.toNext, R.tiers, R.tierNames, b.tier))}</p>
      <p class="acct"><span class="px">${money(b.equity, 2)}</span> <span class="small">${b.ownMoney ? "its own money" : `owes the accountant ${money(b.debt, 0)}`}</span></p>
      ${progressBar(b.equity, b.grant)}
      <dl class="mini"><div><dt>Award</dt><dd>${money(b.award, 0)}</dd></div><div><dt>Owes</dt><dd>${b.debt > 0 ? money(b.debt, 0) : `<span class="gain">0</span>`}</dd></div><div><dt>Month</dt><dd>${pct(b.month?.returnPct ?? 0, 1)}</dd></div><div><dt>Open</dt><dd>${b.positions}</dd></div></dl>
      <p class="small" style="margin:8px 0 0">${b.twin ? `${twinLine(b.totalReturnPct, b.twin)} <span class="small">(twin ${pct(b.twin.returnPct, 1)})</span><br>` : ""}${b.playbook.length ? `Trades ${b.playbook.map(p => esc(p.key.replace("@", " "))).join(", ")}` : "No chart chosen this week"}</p></article>`).join("");
    const table = st => `<table><thead><tr><th class="num">#</th><th>Bot</th><th class="num">Badges</th><th class="num">Trading result</th><th class="num">Trades closed (won)</th><th class="num">Profit</th><th class="num">Saves</th></tr></thead><tbody>${st.map(r => `<tr class="click" data-gobot="${esc(r.id)}"><td class="num">${r.rank}</td><td>${name(r.id)}</td><td class="num">${r.badges}</td><td class="num">${pct(r.returnPct, 2)}</td><td class="num">${r.trades} <span class="small">(${r.wins})</span></td><td class="num">${signed(r.pnl, 2)}</td><td class="num">${r.saves}</td></tr>`).join("")}</tbody></table>`;
    const days = [...new Set(c.bots.flatMap(b => Object.keys(b.daily ?? {})))].sort();
    const series = c.bots.filter(b => Object.keys(b.daily ?? {}).length).map(b => { let last = 100; return { name: b.name, short: `${b.name} ${num(b.index, 1)}`, color: botColor(b.id), values: days.map(d => (last = b.daily[d] ?? last)) }; });
    const past = c.months.filter(m => m.finished);
    const feed = c.bots.flatMap(b => (b.events ?? []).map(ev => ({ ...ev, id: b.id }))).sort((x, y) => (x.d < y.d ? 1 : -1)).slice(0, 20);
    return `<div class="head"><div><h1>Competition</h1><p class="sub">Four paper bots compete for the title of Experienced trader. Each trades a ${money(c.startGrant)} loan from the accountant. Twice the grant earns a badge and locks the profit away; ${R.tiers[0]}, ${R.tiers[1]} and ${R.tiers[2]} badges in a row make a ${esc(R.tierNames[1])}, a ${esc(R.tierNames[2])} and an ${esc(R.tierNames[3])}. Half the grant costs the award a refill, or the bot its seat.</p></div></div>
    ${c.weekend ? `<div class="notice"><strong>Weekend pause.</strong> No trading from Friday 22:00 to Monday 00:00 (Madrid time). Everything was closed on Friday.</div>` : ""}
    <div class="panel goal"><strong>Experienced traders found: ${c.experienced} of 4.</strong> <span class="small">Recruits tried so far: ${c.recruitsTried}. The more recruits it takes, the more likely the winners are lucky rather than good: count this before trusting a title.</span></div>
    ${checksPanel(c)}
    <div class="botgrid">${cards}</div>
    ${duelsPanel(c, name)}
    <h2>${esc(monthName(c.month))} so far</h2>${cur ? table(cur.standings) : ""}
    <p class="small">The month goes to the most badges, ties to the best trading result. Trading result counts only what the bot made or lost by trading, never the accountant's money.</p>
    <h2>The ladder</h2><table><thead><tr><th class="num">#</th><th>Bot</th><th>Tier</th><th class="num">In a row now</th><th class="num">Best run</th><th>Badges</th><th class="num">Award</th><th class="num">Owes</th><th class="num">Strikes</th><th class="num">Trading result</th><th class="num" title="The bot's trading result minus its random twin's: same charts and rules, random entries. Below 0 means chance did as well.">Against chance</th></tr></thead><tbody>${c.ladder.map(r => { const b = by[r.id]; return `<tr class="click" data-gobot="${esc(r.id)}"><td class="num">${r.rank}</td><td>${name(r.id)}</td><td>${tierTag(b.tier, b.tierName)}</td><td class="num">${b.streak}</td><td class="num">${b.bestStreak}</td><td>${badgeRow(b.badges, 14)}</td><td class="num">${money(b.award, 2)}</td><td class="num">${money(b.debt, 2)}</td><td class="num">${b.strikes}</td><td class="num">${pct(b.totalReturnPct, 2)}</td><td class="num">${b.twin ? pct(b.totalReturnPct - b.twin.returnPct, 2) : "–"}</td></tr>`; }).join("")}</tbody></table>
    <p class="small">Each bot has a random twin: it trades the same charts with the same sizes, stops, take-profits and weekend rule, but enters at random, as often as the bot's strategy did. A bot only shows skill if it stays clearly ahead of its twin over many trades.</p>
    <h2>Trading result since each bot was hired</h2>${series.length && days.length > 1 ? `<div class="panel">${lineChart(series, days, v => num(v, 1))}<p class="small" style="margin:6px 0 0">100 is where each bot started. 110 means 10% made by trading, whatever the accountant did.</p></div>` : `<p class="empty">The lines appear after the bots' second day.</p>`}
    ${past.length ? `<h2>Past months</h2>${past.map(m => `<details class="detail"><summary><strong>${esc(monthName(m.month))}</strong>: won by ${esc(by[m.standings[0].id]?.name ?? m.standings[0].id)}${m.fired.length ? ` · fired: ${m.fired.map(esc).join(", ")}` : ""}</summary>${table(m.standings)}</details>`).join("")}` : ""}
    <h2>Replaced</h2>${c.fired.length ? `<table><thead><tr><th>Bot</th><th>Seat</th><th>Hired</th><th>Fired</th><th>Tier reached</th><th class="num">Badges</th><th class="num">Trades</th><th class="num">Trading result</th><th class="num">Paid back</th><th class="num">Loan lost</th></tr></thead><tbody>${c.fired.map(f => `<tr><td><strong>${esc(f.name)}</strong></td><td>${esc(ROLE(BOTS.find(x => x.id === f.slot) ?? { view: "market", side: "long" }))}</td><td>${esc(bar(f.hiredAt))}</td><td>${esc(bar(f.firedAt))}</td><td>${esc(f.tier)}</td><td class="num">${f.badges}</td><td class="num">${f.trades}</td><td class="num">${pct(f.returnPct, 2)}</td><td class="num">${money(f.repaid, 2)}</td><td class="num">${money(f.debtLeft, 2)}</td></tr>`).join("")}</tbody></table><p class="small">A fired bot never trades again. What was left in its account and award went back to the accountant against its loan. Its recruit must try other charts or strategies than the ones it used.</p>` : `<p class="empty">Nobody has been replaced yet.</p>`}
    ${c.books ? `<h2>The accountant's books</h2><dl class="stats">${stat("Started with", money(c.books.start, 2))}${stat("Lent", money(c.books.lent, 2))}${stat("Paid back", money(c.books.repaid, 2))}${c.books.returned ? stat("Handed back by replaced bots", money(c.books.returned, 2)) : ""}${stat("Prizes paid", money(c.books.prizes, 2))}${stat("Available to lend", `<span class="${c.books.available >= c.startGrant ? "gain" : "loss"}">${money(c.books.available, 2)}</span>`)}${stat("Most it can still lose", money(c.books.atRisk ?? 0, 2))}${stat("Accountant's profit", pct0money(c.books.profit ?? 0))}${stat("Still owed", money(c.books.owed, 2))}${stat("Lost on stopped bots", money(c.books.lost, 2))}${stat("Funding paid by bots", money(c.books.funding ?? 0, 2))}${stat("Loans check", Math.abs(c.books.difference) < 0.05 ? `<span class="gain">balanced</span>` : `<span class="loss">off by ${money(c.books.difference, 2)}</span>`)}</dl><p class="small">The accountant is not an infinite bank: it started with ${money(c.books.start)}. Every bot ever hired borrowed ${money(c.startGrant)} from it; repayments and money recovered from stopped bots come back. A recruit is hired only if the money is there, and a prize is paid only out of the accountant's profit. A bot repays its whole loan out of its first badge, so from then on it trades its own money and the accountant cannot lose on it; until then, the most it can lose on a bot is half the grant. Lent = paid back + lost + still owed. Loans have no interest.</p>` : ""}
    <h2>Locker room</h2>${c.locker?.length ? `<ul class="locker">${c.locker.map(m => `<li><span class="when small">${esc(bar(m.d))}</span> ${name(m.id)} <q>${esc(m.text)}</q></li>`).join("")}</ul>` : `<p class="empty">Quiet so far. The bots talk when something happens: a badge, a save, a big trade, a duel.</p>`}
    <h2>The accountant's book</h2>${feed.length ? `<table class="compact"><tbody>${feed.map(ev => `<tr><td style="white-space:nowrap">${esc(bar(ev.d))}</td><td>${name(ev.id)}</td><td>${kindTag(ev.kind)}</td><td>${esc(ev.msg)}</td></tr>`).join("")}</tbody></table>` : `<p class="empty">Nothing yet. The first bot to reach ${money(c.startGrant * 2)} gets the first badge.</p>`}
    <p class="small">Pretend money only. ${num(c.riskPct, 1)}% of the account at risk per trade; exposure stays under the leverage limit. Loans have no interest; ${R.maxStrikes ?? 3} quiet weeks in a row (fewer than ${R.minTradesPerWeek ?? 5} closed trades) and a bot is replaced. Real money waits until a bot has proven itself.</p>`;
  },
  async strategies(arg) {
    const [want, wantTf] = (arg ?? "").split("/").map(decodeURIComponent);
    const board = await api("/api/board"); if (!board) return `<h1>Strategies</h1><p class="empty">No data yet.</p>`;
    const pickSym = board.symbols.find(x => x.symbol === want); if (pickSym) VIEW = pickSym.class === "crypto" ? "crypto" : "market";
    await loadBots();
    const [today, ind, defs, ...mine] = await Promise.all([api(q("/api/today")), api(q("/api/indicators")), api("/api/strategies"), ...BOTS.filter(x => (x.view === "crypto" ? "crypto" : "market") === VIEW).map(x => api(`/api/bot?bot=${encodeURIComponent(x.id)}`))]);
    // Both bots of this world together: their short lists, open trades and orders.
    const got = mine.filter(Boolean); const bt = got.length ? { ...got[0], positions: got.flatMap(x => x.positions), pending: got.flatMap(x => x.pending), shortlist: { ...(got[0].shortlist ?? {}), chosen: got.flatMap(x => x.shortlist?.chosen ?? []), candidates: got.flatMap(x => x.shortlist?.candidates ?? []) } } : null;
    const head = `<div class="head"><div><h1>Strategies</h1><p class="sub">Information only: the bots choose and trade by themselves. A rule counts as good on a chart if it made at least 10 trades, won 1.2 times what it lost, and made money in both halves of the history, after costs.</p></div></div>${switcher()}`;
    const map = strategyMap(today, bt, board);
    const cards = strategyCards(today, bt, ind, defs);
    const detail = pickSym ? await chartDetail(pickSym, TFS.includes(wantTf) ? wantTf : pickSym.top?.tf ?? "1d", board, bt, defs) : `<p class="small" id="detail">Select a cell in the map to see that chart and every rule tested on it.</p>`;
    return `${head}<h2>Every symbol on every timeframe</h2>${map}<h2>The strategies</h2>${cards}${detail}`;
  },
  async feedback() {
    const f = await api("/api/feedback"); const done = f.checklist.filter(c => f.answers[c.id]).length;
    return `<h1>Test and feedback</h1><p class="sub">Things to try after this update. Mark each one and add a note when something is wrong or hard to understand. Claude reads this the next time you ask for changes. ${done} of ${f.checklist.length} answered.</p>
    <table><thead><tr><th>Screen</th><th style="min-width:300px">What to check</th><th>Your answer</th><th style="min-width:260px">Note</th></tr></thead><tbody>${f.checklist.map(c => { const a = f.answers[c.id]; return `<tr data-check="${esc(c.id)}"><td>${esc(c.screen)}</td><td><strong>${esc(c.title)}</strong><br><span class="small">${esc(c.how)}</span></td><td style="white-space:nowrap"><button type="button" class="ans ${a?.status === "ok" ? "on" : ""}" data-status="ok">Works</button> <button type="button" class="ans ${a?.status === "problem" ? "on bad" : ""}" data-status="problem">Problem</button>${a ? `<br><span class="small">saved ${esc(when(a.at))}</span>` : ""}</td><td><textarea rows="2" aria-label="Note for ${esc(c.title)}">${esc(a?.note ?? "")}</textarea></td></tr>`; }).join("")}</tbody></table>
    <h2>Anything else</h2><div class="panel"><textarea id="free" rows="4" aria-label="Free note" placeholder="What is confusing, what is missing, what you would change"></textarea><button id="sendnote" type="button">Save note</button></div>
    ${f.notes.length ? `<h2>Your saved notes</h2><table><tbody>${[...f.notes].reverse().map(n => `<tr><td style="white-space:nowrap">${esc(when(n.at))}</td><td>${esc(n.text)}</td></tr>`).join("")}</tbody></table>` : ""}`;
  },
};
const SEL = {};
// ---- the bot clock: a live clock and a light that says whether the bot is still checking
const MIN = 60000;
function agoText(ms) { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 3600)} h ${Math.floor(s % 3600 / 60)} min ago`; }
function untilText(ms) { const s = Math.round(ms / 1000); return s <= 0 ? "now" : s < 60 ? `in ${s} s` : `in ${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`; }
/** green: checked in the last 17 minutes; amber: up to 35; red: longer (the app is closed, the PC asleep or the check failing). */
let CHECKING = null; // when this PC's check now running started
function botState(at) { const age = Date.now() - Date.parse(at); if (CHECKING && Date.now() - Date.parse(CHECKING) < 20 * MIN) return ["late", `Checking now (started ${clock(CHECKING)})`]; return !at ? ["down", "Not checked yet"] : age < 17 * MIN ? ["ok", "Working"] : age < 35 * MIN ? ["late", "Late: last check over 17 minutes ago"] : ["down", "Stopped: no check for over 35 minutes"]; }
function botClock(b) {
  const at = b.checked?.at; const h = b.hours; const [cls, word] = botState(at);
  const left = h?.notTraded?.length ? ` Not traded, because they cannot trade around the clock on Lighter (not listed, or too thin there): ${h.notTraded.map(esc).join(", ")}. They stay on Today to watch, and join by themselves once Lighter trades them properly.` : "";
  const hoursLine = !h ? "" : h.marketHoursOnly.length === 0 ? `<strong>Trades 24/7:</strong> all ${h.total} charts it trades run around the clock${VIEW === "market" ? " on Lighter's prices" : ""}.${left}` :
    `<strong>Trades 24/7</strong> on ${h.allDay} of ${h.total} charts. Still on market hours: ${h.marketHoursOnly.map(esc).join(", ")}.${left}`;
  return `<div class="panel botclock" data-bot-at="${esc(at ?? "")}">
    <div class="clockrow"><span class="dot ${cls}" data-bot-dot></span><strong data-bot-word>${esc(word)}</strong><span class="bigclock" data-clock>${new Date().toLocaleTimeString("en-GB")}</span></div>
    <p class="small" style="margin:6px 0 0">Last check ${at ? `${esc(clock(at))}${b.checked?.by ? ` by ${b.checked.by === "PC" ? "this PC" : esc(b.checked.by)}` : ""}, <span data-ago="${esc(at)}">${agoText(Date.now() - Date.parse(at))}</span>` : "not yet"} · next check <span data-until="${esc(b.nextCheck ?? "")}">${b.nextCheck ? untilText(Date.parse(b.nextCheck) - Date.now()) : "-"}</span> · prices updated ${b.pricesAt ? `<span data-ago="${esc(b.pricesAt)}">${agoText(Date.now() - Date.parse(b.pricesAt))}</span>` : "-"}</p>
    ${hoursLine ? `<p class="small" style="margin:6px 0 0">${hoursLine}</p>` : ""}
  </div>`;
}
setInterval(() => {
  for (const el of document.querySelectorAll("[data-clock]")) el.textContent = new Date().toLocaleTimeString("en-GB");
  for (const el of document.querySelectorAll("[data-ago]")) if (el.dataset.ago) el.textContent = agoText(Date.now() - Date.parse(el.dataset.ago));
  for (const el of document.querySelectorAll("[data-until]")) if (el.dataset.until) el.textContent = untilText(Date.parse(el.dataset.until) - Date.now());
  for (const card of document.querySelectorAll("[data-bot-at]")) { const [cls, word] = botState(card.dataset.botAt); const d = card.querySelector("[data-bot-dot]"); if (d) d.className = "dot " + cls; const w = card.querySelector("[data-bot-word]"); if (w) w.textContent = word; }
}, 1000);
function exitWords(e) {
  if (!e || e.mode !== "ladder") return "Each trade closes all at once: at its stop, its target, or when its strategy says.";
  const parts = e.tpR.map((r, i) => `TP${i + 1} sells ${num(e.fractions[i] * 100, 0)}% at ${num(r, 1)} times the risk`).join(", ");
  const rest = 1 - e.fractions.reduce((a, b) => a + b, 0);
  const sl = e.slR?.length ? ` Losses are cut in steps too: ${e.slR.map((r, i) => `SL${i + 1} closes ${num(e.slFractions[i] * 100, 0)}% at a loss of ${num(r, 2)} times the risk`).join(", ")}, and SL${e.slR.length + 1} closes the rest at the full stop.` : "";
  return `Profits are taken in steps: ${parts}. After TP1 the stop moves to the entry price, so the trade can no longer lose, and then rises ${num(e.trailAtr, 1)} ATR below the best close.${rest > 0.01 ? ` The last ${num(rest * 100, 0)}% has no fixed target and rides that rising stop.` : ""}${sl}`;
}
function shortlistPanel(b) {
  const sl = b.shortlist; const ch = sl.candidates.filter(c => c.chosen); const rest = sl.candidates.filter(c => !c.chosen && c.pickPass);
  return `<h2>Strategies this bot uses this week</h2>
  <div class="panel"><p class="small" style="margin-top:0">Picked ${esc(when(sl.pickedAt))} on the older ${num((1 - sl.testShare) * 100, 0)}% of every chart's history, then checked on the newest ${num(sl.testShare * 100, 0)}%, which the choice never saw. Competition bots trade them only on the charts they chose.</p>
  ${ch.length ? `<table class="compact"><thead><tr><th>Strategy</th><th class="num">Charts where it worked (older data)</th><th class="num">Trades in newer data</th><th class="num">Profit factor in newer data</th></tr></thead><tbody>${ch.map(c => `<tr><td><strong>${esc(c.name)}</strong></td><td class="num">${c.pickPass} of ${c.pickTested}</td><td class="num">${c.testTrades}</td><td class="num">${pf(c.testPF)}</td></tr>`).join("")}</tbody></table>` : `<p class="loss"><strong>No strategy made money in the newer data, so this bot trades nothing this week.</strong></p>`}
  ${rest.length ? `<details class="detail"><summary>Left out (${rest.length})</summary><table class="compact"><tbody>${rest.map(c => `<tr><td>${esc(c.name)}</td><td class="small">${esc(c.why)}</td></tr>`).join("")}</tbody></table></details>` : ""}</div>`;
}
async function lighterPanel() {
  const el = document.getElementById("lighter"); if (!el) return;
  const L = await api("/api/lighter"); const s = L?.snapshot; const r = L?.readiness ?? []; const ok = r.filter(x => x.ok);
  const acct = s?.account;
  el.innerHTML = `<h2>Lighter (read-only)</h2><div class="panel">
  <p style="margin-top:0">${s ? `Read ${esc(when(s.at))}${s.ok ? "" : `, <span class="loss">failed: ${esc(s.error)}</span>`}. ` : "Not read yet; it is read at each strategy check. "}The app only reads public Lighter data. It sends no orders.</p>
  ${L?.settings?.accountIndex == null ? `<p class="small">No Lighter account linked yet. When your 500 USDC sub-account exists, put its account index (a number, not a key) in <code>config/settings.json</code> under <code>lighter.accountIndex</code> and the balance and positions will show here.</p>` : acct ? `<p><strong>Account ${acct.index}:</strong> ${money(acct.totalValue ?? acct.collateral, 2)} in the account, ${money(acct.available, 2)} free. ${acct.positions.length} open positions.</p>${acct.positions.length ? `<table class="compact"><tbody>${acct.positions.map(p => `<tr><td class="sym">${esc(p.symbol)}</td><td>${esc(p.side)}</td><td class="num">${num(p.size, 4)}</td><td class="num">entry ${price(p.entry)}</td><td class="num">${signed(p.unrealizedPnl, 2)}</td><td class="small">liquidation ${price(p.liquidationPrice)}</td></tr>`).join("")}</tbody></table>` : ""}` : `<p class="loss">${esc(s?.accountError ?? "Account not read yet.")}</p>`}
  ${r.length ? `<p><strong>${ok.length} of ${r.length}</strong> symbols this bot trades can go live on Lighter with a ${money(L.settings.budgetUsd)} budget.</p><details class="detail"><summary>Symbol by symbol</summary><table class="compact"><tbody>${r.map(x => `<tr><td class="sym">${esc(x.symbol)}</td><td>${x.ok ? `<span class="gain">ready</span>` : `<span class="loss">no</span>`}</td><td class="num">${price(x.price)}</td><td class="small">${esc(x.why)}</td></tr>`).join("")}</tbody></table></details>` : ""}
  </div>`;
}

/* ---------- routing ---------- */
async function render() {
  const parts = location.hash.slice(1).split("/"); const name = screens[parts[0]] && !["today", "feedback"].includes(parts[0]) ? parts[0] : "competition"; /* Today and Test and feedback were removed from the menu (owner, 2026-11-24) */ const arg = parts.slice(1).map(decodeURIComponent).join("/") || null;
  document.querySelectorAll(".rail a").forEach(a => a.dataset.tab === name ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  const y = scrollY;
  let jumped = false;
  try { $main.innerHTML = await screens[name](arg); if (name === "bot") lighterPanel().catch(() => undefined); if (name === "strategies" && arg && JUMP) { document.getElementById("detail")?.scrollIntoView({ block: "start" }); jumped = true; } } catch (e) { $main.innerHTML = `<h1>Something went wrong</h1><div class="notice"><strong>This screen could not load.</strong> ${esc(e.message)}. If it keeps happening, run restart.bat.</div>`; }
  JUMP = false; if (!jumped) scrollTo(0, y);
}
/** Set when a map cell or chip opens a chart, so the page scrolls down to it once (not on later refreshes). */
let JUMP = false;
addEventListener("hashchange", () => { scrollTo(0, 0); JUMP = location.hash.startsWith("#strategies/"); render(); });
$main.addEventListener("click", async e => {
  const t = e.target;
  if (t.closest("#showfail")) { e.preventDefault(); const f = document.getElementById("fails"); f.hidden = !f.hidden; return; }
  const gv = t.closest("a[data-goview]"); if (gv) { VIEW = gv.dataset.goview; return; }
  const gb = t.closest("[data-gobot]"); if (gb) { BOT = gb.dataset.gobot; if (gb.tagName !== "A") location.hash = "#bot"; return; }
  const bb = t.closest("button[data-bot]"); if (bb) { BOT = bb.dataset.bot; render(); return; }
  const fb = t.closest("button[data-filter]"); if (fb) { FILTER = fb.dataset.filter; render(); return; }
  const tb = t.closest("button[data-tf]"); if (tb) { const sym = tb.dataset.sym ?? document.getElementById("pick")?.value; location.hash = `#strategies/${encodeURIComponent(sym)}/${tb.dataset.tf}`; return; }
  const mc = t.closest("td[data-cell]"); if (mc) { location.hash = "#strategies/" + mc.dataset.cell.split("/").map(encodeURIComponent).join("/"); return; }
  const sr = t.closest("tr[data-strat]"); if (sr) { const sym = document.getElementById("pick").value; const tf = document.querySelector("button[data-tf][aria-pressed=true]")?.dataset.tf; SEL[sym + tf] = sr.dataset.strat; render(); return; }
  const row = t.closest("tr[data-symbol]"); if (row && !t.closest("a")) { location.hash = `#strategies/${encodeURIComponent(row.dataset.symbol)}/${row.dataset.tf}`; return; }
  const ans = t.closest("button.ans"); if (ans) { const tr = ans.closest("tr[data-check]"); try { await api("/api/feedback", { method: "POST", body: JSON.stringify({ id: tr.dataset.check, status: ans.dataset.status, note: tr.querySelector("textarea").value }) }); } catch (err) { alertMsg(err.message); return; } render(); return; }
  if (t.closest("#sendnote")) { const v = document.getElementById("free").value; if (v.trim()) { try { await api("/api/feedback", { method: "POST", body: JSON.stringify({ text: v }) }); } catch (err) { alertMsg(err.message); return; } render(); } return; }
  const sw = t.closest("button[data-view]"); if (sw) { VIEW = sw.dataset.view; if (location.hash.startsWith("#strategies/")) location.hash = "#strategies"; else render(); return; }
  const ap = t.closest("button.approve"); if (ap) { const id = ap.closest("[data-approval]").dataset.approval; ap.disabled = true; try { await api("/api/approve", { method: "POST", body: JSON.stringify({ id, yes: ap.dataset.yes === "1" }) }); } catch (err) { alertMsg(err.message); } render(); return; }
  if (t.closest("#resume")) { try { await api(`/api/resume?bot=${encodeURIComponent(BOT)}`, { method: "POST" }); } catch (err) { alertMsg(err.message); } render(); return; }
  const btn = t.closest("#refresh"); if (btn) { btn.disabled = true; btn.textContent = "Checking…"; try { await api("/api/refresh", { method: "POST" }); } catch (err) { alertMsg(err.message); } render(); }
});
$main.addEventListener("keydown", e => { if (e.key === "Enter") e.target.closest("tr[data-symbol], tr[data-strat]")?.click(); });
$main.addEventListener("change", e => { if (e.target.id === "pick") location.hash = "#strategies/" + encodeURIComponent(e.target.value); });
function alertMsg(m) { const d = document.createElement("div"); d.className = "notice"; d.textContent = "That did not work: " + m; $main.prepend(d); }
render();
// Today and the bots refresh themselves every 30 seconds; screens where you type or choose are left alone.
setInterval(() => { const name = location.hash.slice(1).split("/")[0] || "competition"; if (document.visibilityState === "visible" && (name === "today" || name === "bot" || name === "competition" || name === "accountant") && !document.querySelector("#refresh:disabled") && !(document.getElementById("fails") && !document.getElementById("fails").hidden)) render(); }, 30000);
