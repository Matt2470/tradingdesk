// Portraits of the participants (owner, 2026-11-27: "the traders must be kids ... like these [chibi game characters] but
// tech kids from Silicon Valley"). Original characters in a chunky chibi style: big heads, thick outlines, flat colours
// with one cel shadow, each kid with a gadget beside them. Drawn in SVG, no image files, works offline. A recruit is a
// new kid in the seat's colours; an evil twin is the same kid in a black hood with little horns and red eyes. If the owner
// drops a picture in web/portraits/ (stocks-bull.png, crypto-bear-evil.png, stocks-bull-2.webp, ...) it is used instead.
(() => {
  const INK = "#2B1B12";
  const SEATS = {
    // Nico: the bold one. Spiky hair, headphones, blue hoodie, a laptop covered in stickers.
    "stocks-bull": { skin: "#E8B48F", hair: "#2E1F16", style: "spiky", top: "hoodie", main: "#2F6FD0", accent: "#F2C14E", legs: "#2B3A55", shoe: "#F4F1EA", stripe: "#2F6FD0", item: "laptop", extra: "headphones", mouth: "grin", brows: "bold", bg: ["#3D6EA8", "#14243A"] },
    // Lucas: the grumpy bear. Bear-ear beanie, thick glasses, grey hoodie, a tablet with a falling chart.
    "stocks-bear": { skin: "#F0C9A6", hair: "#B8642E", style: "beanie", top: "hoodie", main: "#7A7F87", accent: "#C0392B", legs: "#4A3A2C", shoe: "#3A3A40", stripe: "#C0392B", item: "tablet", extra: "glasses", mouth: "frown", brows: "grumpy", bg: ["#7A5E48", "#1E1712"] },
    // Catalina: the curious one. Long red hair, VR goggles on her head, green bomber jacket, a drone.
    "crypto-bull": { skin: "#D9A07A", hair: "#B5401E", style: "long", top: "bomber", main: "#2E8B57", accent: "#F2C14E", legs: "#6B4FA0", shoe: "#F4F1EA", stripe: "#2E8B57", item: "drone", extra: "goggles", mouth: "smile", brows: "soft", freckles: true, bg: ["#3F8A6B", "#12271F"] },
    // Valeria: the cold one. Black top bun, black turtleneck, crimson trousers, a phone she never puts down.
    "crypto-bear": { skin: "#F2D2B6", hair: "#17161C", style: "bun", top: "turtleneck", main: "#1E1E24", accent: "#C8283C", legs: "#8E1F2F", shoe: "#1E1E24", stripe: "#C8283C", item: "phone", extra: "none", mouth: "flat", brows: "sharp", bg: ["#8A3340", "#220C11"] },
  };
  const SKINS = ["#F2D2B6", "#E8B48F", "#D9A07A", "#B97D55", "#8E5B3C", "#6A4029"];
  const HAIRS = ["#17161C", "#2E1F16", "#5A3520", "#B5401E", "#D9A441", "#8A8F96"];
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
  const shade = (hex, f) => { const n = parseInt(hex.slice(1), 16); const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)))); return "#" + c.map(v => v.toString(16).padStart(2, "0")).join(""); };
  const ol = (w = 5) => `stroke="${INK}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;

  function look(id, recruit, evil) {
    let L = { ...(SEATS[id] ?? SEATS["stocks-bull"]) };
    if (recruit > 1) {
      const h = hash(`${id}#${recruit}`);
      L = { ...L, skin: SKINS[h % SKINS.length], hair: HAIRS[(h >> 3) % HAIRS.length], style: ["spiky", "long", "bun", "curly", "short", "beanie"][(h >> 6) % 6],
        extra: ["none", "glasses", "headphones", "goggles", "cap"][(h >> 9) % 5], mouth: ["grin", "smile", "flat", "frown"][(h >> 12) % 4], brows: ["bold", "soft", "sharp", "grumpy"][(h >> 14) % 4], freckles: (h >> 16) % 3 === 0 };
    }
    if (evil) L = { ...L, top: "hood", main: "#18171C", accent: "#D6283A", legs: "#24232A", shoe: "#18171C", stripe: "#D6283A", eyes: "#FF3344", mouth: "smirk", brows: "evil", bg: ["#5A1018", "#0B0507"], evil: true, extra: L.extra === "glasses" ? "glasses" : "none" };
    return L;
  }

  // ---- the gadget beside each kid (left side, like the weapons on a character sheet) ----
  function item(L) {
    const a = L.accent;
    switch (L.item) {
      case "laptop": return `<g transform="translate(18 236) rotate(-8)"><rect x="0" y="0" width="58" height="40" rx="5" fill="#C9CED6" ${ol(4)}/><rect x="6" y="6" width="46" height="28" rx="2" fill="${L.evil ? "#3A0A10" : "#1D2733"}"/>
        <path d="M10 28 L20 18 L28 22 L42 10" stroke="${L.evil ? "#FF3344" : "#5FD39A"}" stroke-width="3" fill="none"/><circle cx="12" cy="10" r="4" fill="${a}"/><rect x="34" y="27" width="12" height="5" rx="2" fill="#E5484D"/>
        <path d="M-6 44 L64 44 L58 52 L0 52Z" fill="#AEB5BF" ${ol(4)}/></g>`;
      case "tablet": return `<g transform="translate(20 222) rotate(-10)"><rect x="0" y="0" width="46" height="62" rx="7" fill="#33363C" ${ol(4)}/><rect x="5" y="6" width="36" height="48" rx="2" fill="#F4F1EA"/>
        <path d="M9 14 L17 22 L24 18 L36 42" stroke="${L.evil ? "#FF3344" : "#C0392B"}" stroke-width="3.5" fill="none"/><path d="M30 42 L36 42 L36 35" stroke="${L.evil ? "#FF3344" : "#C0392B"}" stroke-width="3.5" fill="none"/></g>`;
      case "drone": return `<g transform="translate(14 120)"><rect x="12" y="14" width="40" height="14" rx="6" fill="${L.evil ? "#2A2A30" : "#E9EEF2"}" ${ol(4)}/><circle cx="32" cy="27" r="5" fill="${L.evil ? "#FF3344" : "#2E8B57"}" ${ol(3)}/>
        <path d="M14 14 L6 6 M50 14 L58 6" ${ol(4)}/><ellipse cx="6" cy="5" rx="12" ry="3" fill="#BFC6CE" ${ol(3)}/><ellipse cx="58" cy="5" rx="12" ry="3" fill="#BFC6CE" ${ol(3)}/>
        <path d="M24 36 Q32 42 40 36" stroke="#9AA5B1" stroke-width="2" fill="none" stroke-dasharray="3 3"/></g>`;
      case "phone": return `<g transform="translate(26 226) rotate(-12)"><rect x="0" y="0" width="32" height="58" rx="7" fill="#1E1E24" ${ol(4)}/><rect x="4" y="7" width="24" height="42" rx="2" fill="${L.evil ? "#3A0A10" : "#1D2733"}"/>
        ${[0, 1, 2, 3].map(i => `<rect x="${7 + i * 5}" y="${36 - [10, 18, 8, 26][i]}" width="3.5" height="${[10, 18, 8, 26][i]}" fill="${i % 2 ? "#C8283C" : "#5FD39A"}"/>`).join("")}<circle cx="16" cy="53" r="2" fill="#555"/></g>`;
      default: return "";
    }
  }
  function body(L) {
    const m = L.main, d = shade(m, -0.3), a = L.accent;
    const legs = `<path d="M124 318 L122 352 L146 352 L148 318Z M152 318 L154 352 L178 352 L176 318Z" fill="${L.legs}" ${ol()}/>
      <path d="M114 350 C114 340 148 340 150 352 L150 364 L112 364Z" fill="${L.shoe}" ${ol()}/><path d="M150 352 C152 340 186 340 186 350 L188 364 L150 364Z" fill="${L.shoe}" ${ol()}/>
      <path d="M118 358 L146 358 M154 358 L182 358" stroke="${L.stripe}" stroke-width="3"/>`;
    const arms = `<path d="M108 238 C94 252 92 280 100 296 L114 292 C110 278 112 262 118 252Z" fill="${m}" ${ol()}/><path d="M192 238 C206 252 208 280 200 296 L186 292 C190 278 188 262 182 252Z" fill="${d}" ${ol()}/>
      <circle cx="106" cy="298" r="10" fill="${L.skin}" ${ol(4)}/><circle cx="194" cy="298" r="10" fill="${shade(L.skin, -0.12)}" ${ol(4)}/>`;
    const torso = `<path d="M112 230 C118 220 182 220 188 230 L194 322 L106 322Z" fill="${m}" ${ol()}/><path d="M160 226 C176 226 186 228 188 230 L194 322 L162 322Z" fill="${d}" opacity=".55"/>`;
    let det = "";
    if (L.top === "hoodie") det = `<path d="M132 224 Q150 246 168 224" fill="none" ${ol(4)}/><path d="M142 236 L140 262 M158 236 L160 262" stroke="#F4F1EA" stroke-width="3"/><path d="M124 284 L176 284 L172 306 L128 306Z" fill="${d}" ${ol(4)}/>`;
    if (L.top === "bomber") det = `<path d="M150 226 L150 322" ${ol(4)}/><path d="M136 224 L150 250 L164 224" fill="#F4F1EA" ${ol(4)}/><path d="M106 312 L194 312 L194 322 L106 322Z" fill="${a}" ${ol(4)}/><rect x="166" y="262" width="16" height="12" rx="2" fill="${a}" ${ol(3)}/>`;
    if (L.top === "turtleneck") det = `<path d="M128 220 C128 208 172 208 172 220 L170 234 C160 240 140 240 130 234Z" fill="${shade(m, 0.12)}" ${ol(4)}/><circle cx="150" cy="262" r="5" fill="${a}" ${ol(3)}/>`;
    if (L.top === "hood") det = `<path d="M150 236 L150 322" stroke="${a}" stroke-width="3"/><path d="M124 284 L176 284 L172 306 L128 306Z" fill="${shade(m, 0.15)}" ${ol(4)}/><path d="M139 296 L145 290 L150 298 L156 290 L162 296" stroke="${a}" stroke-width="3" fill="none"/>`;
    return `${legs}${arms}${torso}${det}`;
  }
  function hairBack(L) {
    const c = L.hair;
    if (L.style === "long") return `<path d="M80 130 C70 190 76 250 92 272 L122 262 L118 200 L182 200 L178 262 L208 272 C224 250 230 190 220 130Z" fill="${c}" ${ol()}/>`;
    if (L.style === "curly") return `<g fill="${c}" ${ol(4)}>${[[88, 150], [84, 180], [212, 150], [216, 180]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="18"/>`).join("")}</g>`;
    return "";
  }
  function head(L, u) {
    const s = L.skin, sd = shade(s, -0.16);
    const H = "M86 142 C84 94 112 72 150 72 C188 72 216 94 214 142 C214 184 188 206 150 206 C112 206 86 184 86 142Z";
    const ears = `<circle cx="86" cy="150" r="14" fill="${s}" ${ol()}/><circle cx="214" cy="150" r="14" fill="${sd}" ${ol()}/>`;
    const eyeC = L.eyes ?? INK;
    const eyes = [124, 176].map(x => `<ellipse cx="${x}" cy="152" rx="6.5" ry="8.5" fill="${eyeC}"/><circle cx="${x + 2}" cy="148" r="2.4" fill="#fff"/>${L.evil ? `<ellipse cx="${x}" cy="152" rx="11" ry="12" fill="#FF3344" opacity=".25"/>` : ""}`).join("");
    const browY = 134;
    const brows = { bold: [`M110 ${browY} L136 ${browY + 4}`, `M190 ${browY} L164 ${browY + 4}`], soft: [`M112 ${browY + 2} Q124 ${browY - 4} 136 ${browY + 2}`, `M164 ${browY + 2} Q176 ${browY - 4} 188 ${browY + 2}`],
      sharp: [`M112 ${browY - 2} L136 ${browY + 6}`, `M188 ${browY - 2} L164 ${browY + 6}`], grumpy: [`M110 ${browY - 4} L138 ${browY + 8}`, `M190 ${browY - 4} L162 ${browY + 8}`],
      evil: [`M108 ${browY - 6} L138 ${browY + 9}`, `M192 ${browY - 6} L162 ${browY + 9}`] }[L.brows] ?? [];
    const browW = L.brows === "soft" ? 5 : 7;
    const mouth = { grin: `<path d="M136 176 Q150 190 164 176 Z" fill="#7A2A22" ${ol(4)}/><path d="M140 177 L160 177" stroke="#fff" stroke-width="3"/>`, smile: `<path d="M138 178 Q150 188 162 178" fill="none" ${ol(4)}/>`,
      flat: `<path d="M140 181 L160 180" ${ol(4)}/>`, frown: `<path d="M138 184 Q150 175 162 184" fill="none" ${ol(4)}/>`, smirk: `<path d="M138 182 Q152 186 164 174" fill="none" ${ol(4)}/><path d="M156 180 L158 186 L161 179" fill="#fff" stroke="${INK}" stroke-width="1.5"/>` }[L.mouth];
    return `${ears}<path d="${H}" fill="${s}" ${ol()}/>
      <clipPath id="${u}h"><path d="${H}"/></clipPath><g clip-path="url(#${u}h)"><path d="M170 72 C206 90 220 140 204 190 C196 206 176 212 160 212 C196 180 200 120 170 72Z" fill="${sd}"/></g>
      <ellipse cx="114" cy="170" rx="9" ry="5" fill="#F08A7A" opacity=".55"/><ellipse cx="186" cy="170" rx="9" ry="5" fill="#F08A7A" opacity=".45"/>
      ${L.freckles ? [[110, 163], [117, 166], [124, 163], [176, 163], [183, 166], [190, 163]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.5" fill="${shade(s, -0.45)}"/>`).join("") : ""}
      ${eyes}${brows.map(p => `<path d="${p}" stroke="${L.style === "beanie" ? shade(L.hair, -0.2) : shade(L.hair, -0.1)}" stroke-width="${browW}" stroke-linecap="round"/>`).join("")}
      <path d="M147 164 Q150 168 153 164" fill="none" stroke="${shade(s, -0.45)}" stroke-width="2.5" stroke-linecap="round"/>${mouth}`;
  }
  function hairFront(L) {
    const c = L.hair, hl = shade(c, 0.3);
    switch (L.style) {
      case "spiky": return `<path d="M84 136 L80 104 L98 110 L96 82 L118 94 L124 66 L142 86 L156 62 L166 88 L186 72 L186 98 L208 92 L202 114 L220 122 L214 138 C204 118 186 106 168 108 C150 116 120 112 102 116 C94 122 88 128 84 136Z" fill="${c}" ${ol()}/><path d="M128 84 L138 96 M160 76 L162 94" stroke="${hl}" stroke-width="3"/>`;
      case "beanie": return `<circle cx="104" cy="76" r="15" fill="${L.main}" ${ol()}/><circle cx="196" cy="76" r="15" fill="${L.main}" ${ol()}/><circle cx="104" cy="76" r="7" fill="${shade(L.main, -0.3)}"/><circle cx="196" cy="76" r="7" fill="${shade(L.main, -0.3)}"/>
        <path d="M84 128 C82 86 112 64 150 64 C188 64 218 86 216 128Z" fill="${L.main}" ${ol()}/><path d="M80 120 L220 120 L220 136 L80 136Z" fill="${shade(L.main, -0.2)}" ${ol()}/>
        <path d="M92 136 L98 146 L104 136 M196 136 L202 146 L208 136" fill="${c}" ${ol(3)}/>${[96, 112, 128, 144, 160, 176, 192, 208].map(x => `<path d="M${x} 122 L${x} 134" stroke="${shade(L.main, -0.4)}" stroke-width="2"/>`).join("")}`;
      case "long": return `<path d="M84 140 C80 92 110 66 150 66 C192 66 222 94 216 140 C208 116 190 100 166 98 C146 112 116 118 98 116 C90 124 86 132 84 140Z" fill="${c}" ${ol()}/><path d="M120 84 Q140 74 160 78" stroke="${hl}" stroke-width="3" fill="none"/>`;
      case "bun": return `<circle cx="150" cy="54" r="22" fill="${c}" ${ol()}/><path d="M84 142 C80 92 112 70 150 70 C190 70 220 92 216 142 C206 112 184 98 150 98 C130 98 120 112 104 118 C94 126 88 132 84 142Z" fill="${c}" ${ol()}/>
        <path d="M150 98 C140 110 118 120 104 120" stroke="${hl}" stroke-width="3" fill="none"/>`;
      case "curly": return `<g fill="${c}" ${ol(4)}>${[[100, 104], [120, 84], [144, 74], [168, 76], [190, 88], [206, 110], [88, 126], [212, 130]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="20"/>`).join("")}</g>`;
      case "short": return `<path d="M86 134 C84 92 112 70 150 70 C188 70 216 92 214 134 C204 112 184 104 150 104 C118 104 96 112 86 134Z" fill="${c}" ${ol()}/>`;
      default: return "";
    }
  }
  function extras(L) {
    if (L.evil) return `<path d="M80 150 C72 92 108 58 150 58 C192 58 228 92 220 150 L208 150 C210 104 186 80 150 80 C114 80 90 104 92 150Z" fill="${L.main}" ${ol()}/>
      <path d="M100 82 L94 54 L118 72Z M200 82 L206 54 L182 72Z" fill="${L.accent}" ${ol(4)}/>`;
    switch (L.extra) {
      case "headphones": return `<path d="M82 136 C80 76 220 76 218 136" fill="none" stroke="${INK}" stroke-width="12" stroke-linecap="round"/><path d="M82 136 C80 76 220 76 218 136" fill="none" stroke="${L.accent}" stroke-width="5" stroke-linecap="round"/>
        <rect x="68" y="128" width="22" height="36" rx="10" fill="${L.accent}" ${ol()}/><rect x="210" y="128" width="22" height="36" rx="10" fill="${shade(L.accent, -0.2)}" ${ol()}/>`;
      case "glasses": return `<g fill="none" ${ol(5)}><circle cx="124" cy="152" r="16"/><circle cx="176" cy="152" r="16"/><path d="M140 150 Q150 144 160 150"/></g><g fill="#fff" opacity=".18"><circle cx="124" cy="152" r="13"/><circle cx="176" cy="152" r="13"/></g>`;
      case "goggles": return `<path d="M86 108 L214 108" stroke="${INK}" stroke-width="10"/><path d="M86 108 L214 108" stroke="#6B4FA0" stroke-width="4"/><rect x="110" y="92" width="80" height="30" rx="14" fill="#6B4FA0" ${ol()}/><rect x="118" y="98" width="64" height="18" rx="9" fill="#7FD6E8" opacity=".85"/><path d="M126 102 L138 102" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`;
      case "cap": return `<path d="M88 118 C88 80 116 66 150 66 C186 66 212 82 212 118Z" fill="${L.accent}" ${ol()}/><path d="M150 118 L232 118 C230 128 214 132 196 130 L150 128Z" fill="${shade(L.accent, -0.2)}" ${ol()}/>`;
      default: return "";
    }
  }

  /** Is there a picture for this portrait in web/portraits/ (listed by the server)? */
  const custom = (id, recruit, evil) => { const files = window.PORTRAIT_FILES || []; const base = `${id}${recruit > 1 ? "-" + recruit : ""}${evil ? "-evil" : ""}`;
    return files.find(f => f.replace(/\.(png|jpe?g|webp)$/i, "") === base); };

  /** The portrait as an SVG string (or an <img> when the owner supplied a picture). */
  window.portrait = function (id, recruit = 1, opts = {}) {
    const pic = custom(id, recruit, !!opts.evil); if (pic) return `<img class="portrait-img" src="portraits/${encodeURIComponent(pic)}" alt="${opts.label ?? "portrait"}">`;
    const L = look(id, recruit, !!opts.evil); const u = `p${hash(`${id}|${recruit}|${!!opts.evil}`).toString(36)}`;
    return `<svg viewBox="0 20 300 380" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${opts.label ?? "portrait"}" preserveAspectRatio="xMidYMid slice"><defs>
      <radialGradient id="${u}bg" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="${L.bg[0]}"/><stop offset="1" stop-color="${L.bg[1]}"/></radialGradient></defs>
      <rect y="20" width="300" height="380" fill="url(#${u}bg)"/>
      <g fill="#fff" opacity=".06">${[[40, 60, 3], [250, 90, 2], [230, 300, 3], [60, 330, 2], [270, 200, 2]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join("")}</g>
      <ellipse cx="150" cy="366" rx="70" ry="10" fill="#000" opacity=".3"/>
      <g transform="translate(${L.item === "drone" ? 18 : 46} ${L.item === "drone" ? 124 : 262}) scale(1.4) translate(-${L.item === "drone" ? 18 : 46} -${L.item === "drone" ? 124 : 262})">${item(L)}</g>${hairBack(L)}${body(L)}${head(L, u)}${hairFront(L)}${extras(L)}</svg>`;
  };
})();
