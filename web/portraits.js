// Portraits of the participants (owner, 2026-11-26: "a more game like UX ... their pictures"). Original characters drawn
// in code: no image files, works offline. Each seat has its own face; a recruit gets a variation of the seat's look, and
// an evil twin is the same face gone bad (red eyes, a goatee, a darker suit). portrait(id, recruit, {evil}) returns SVG.
(() => {
  const SEATS = {
    "stocks-bull": { sex: "m", skin: "#C68E64", hair: "#2B1D14", style: "quiff", beard: "stubble", suit: "#1F3A5F", trim: "#D9B45A", shirt: "#EEF0F2", bg: ["#3E6E9E", "#14243A"], brows: "bold", mouth: "grin", eyes: "#4B3621" },
    "stocks-bear": { sex: "m", skin: "#E2B999", hair: "#A3A8AE", style: "receding", beard: "full", suit: "#2E3138", trim: "#7A2333", shirt: "#D8D2C4", bg: ["#6B5A4A", "#1E1A17"], brows: "heavy", mouth: "frown", eyes: "#5A6B73", glasses: true },
    "crypto-bull": { sex: "f", skin: "#D9A27E", hair: "#7A3B1E", style: "waves", suit: "#2F6B4F", trim: "#E3C27A", shirt: "#F3E9D8", bg: ["#3F8A6B", "#12271F"], brows: "soft", mouth: "smile", eyes: "#3D6B3A", earrings: "hoop", freckles: true },
    "crypto-bear": { sex: "f", skin: "#F0C8A8", hair: "#16161B", style: "bun", suit: "#8E1F2F", trim: "#1A1A1F", shirt: "#F4F1EE", bg: ["#8A3340", "#220C11"], brows: "sharp", mouth: "smirk", eyes: "#2E2A3A", earrings: "stud", lips: "#A3263A" },
  };
  const SKINS = ["#F2D0B5", "#E8B894", "#D49A72", "#B87A52", "#8D5A3A", "#6B4128"];
  const HAIRS = ["#16161B", "#2B1D14", "#4A2E1C", "#7A3B1E", "#B8862F", "#A3A8AE", "#5B3A29"];
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
  const shade = (hex, f) => { const n = parseInt(hex.slice(1), 16); const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)))); return "#" + c.map(v => v.toString(16).padStart(2, "0")).join(""); };

  function look(id, recruit, evil) {
    const base = SEATS[id] ?? SEATS["stocks-bull"]; let L = { ...base };
    if (recruit > 1) { // a recruit: same seat colours, a new face
      const h = hash(`${id}#${recruit}`); const sex = h % 2 ? "m" : "f";
      L = { ...L, sex, skin: SKINS[h % SKINS.length], hair: HAIRS[(h >> 3) % HAIRS.length], eyes: ["#4B3621", "#3D6B3A", "#5A6B73", "#2E2A3A"][(h >> 5) % 4],
        style: sex === "m" ? ["quiff", "short", "receding", "curls"][(h >> 7) % 4] : ["waves", "bun", "bob", "curls"][(h >> 7) % 4],
        beard: sex === "m" ? ["none", "stubble", "full", "none"][(h >> 9) % 4] : "none", glasses: (h >> 11) % 4 === 0, earrings: sex === "f" ? ["hoop", "stud", "none"][(h >> 12) % 3] : "none",
        freckles: (h >> 14) % 5 === 0, mouth: ["grin", "smile", "smirk", "flat"][(h >> 15) % 4], brows: ["bold", "soft", "sharp", "heavy"][(h >> 17) % 4], lips: sex === "f" && (h >> 19) % 2 ? "#A3263A" : undefined };
    }
    if (evil) L = { ...L, suit: "#141418", trim: "#B3232F", shirt: "#2A2A30", bg: ["#5A1018", "#0B0507"], eyes: "#FF3B3B", mouth: "smirk", brows: "sharp", beard: L.sex === "m" ? "goatee" : L.beard, glow: true, lips: L.sex === "f" ? "#5C0E1A" : L.lips };
    return L;
  }

  function hairBack(L) {
    const c = L.hair;
    if (L.style === "waves") return `<path d="M54 92 C46 140 50 190 66 214 L134 214 C150 190 154 140 146 92 C140 54 60 54 54 92Z" fill="${shade(c, -0.25)}"/>`;
    if (L.style === "bob") return `<path d="M58 92 C52 120 54 150 64 160 L136 160 C146 150 148 120 142 92 C136 56 64 56 58 92Z" fill="${shade(c, -0.25)}"/>`;
    if (L.style === "curls" && L.sex === "f") return `<g fill="${shade(c, -0.2)}">${[[60, 120], [56, 145], [64, 168], [140, 120], [144, 145], [136, 168]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="15"/>`).join("")}</g>`;
    return "";
  }
  function hairFront(L) {
    const c = L.hair, d = shade(c, -0.3), lt = shade(c, 0.25);
    switch (L.style) {
      case "quiff": return `<path d="M64 96 C60 64 78 44 104 44 C124 44 140 56 138 92 C132 78 126 70 116 66 C112 74 96 70 86 66 C78 72 70 82 64 96Z" fill="${c}"/><path d="M90 52 C100 44 118 46 126 56 C116 52 104 52 94 58Z" fill="${lt}" opacity=".7"/>`;
      case "short": return `<path d="M64 96 C62 66 80 50 100 50 C122 50 140 64 136 96 C132 80 124 70 100 68 C80 70 70 80 64 96Z" fill="${c}"/>`;
      case "receding": return `<path d="M64 102 C60 80 66 66 74 62 C72 74 70 86 70 98Z M136 102 C140 80 134 66 126 62 C128 74 130 86 130 98Z" fill="${c}"/><path d="M74 62 C84 56 116 56 126 62" stroke="${d}" stroke-width="2" fill="none" opacity=".35"/>`;
      case "curls": return `<g fill="${c}">${[[72, 74], [86, 62], [100, 58], [114, 62], [128, 74], [66, 90], [134, 90]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="12"/>`).join("")}</g><g fill="${lt}" opacity=".5">${[[84, 58], [104, 54], [122, 62]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4"/>`).join("")}</g>`;
      case "waves": return `<path d="M62 104 C58 66 80 48 102 48 C126 48 144 66 138 104 C134 84 124 70 108 66 C96 76 80 80 70 84 C66 90 64 96 62 104Z" fill="${c}"/><path d="M80 60 C92 52 112 52 124 62" stroke="${lt}" stroke-width="3" fill="none" opacity=".6"/>`;
      case "bun": return `<circle cx="100" cy="40" r="16" fill="${c}"/><path d="M63 100 C60 66 80 52 100 52 C122 52 140 66 137 100 C134 80 122 66 100 64 C80 66 68 78 63 100Z" fill="${c}"/><path d="M78 62 C90 56 110 56 122 62" stroke="${lt}" stroke-width="2" fill="none" opacity=".6"/>`;
      case "bob": return `<path d="M60 112 C56 66 80 50 100 50 C122 50 146 66 140 112 C136 92 130 76 112 70 C104 80 82 82 72 80 C66 88 62 100 60 112Z" fill="${c}"/>`;
      default: return "";
    }
  }
  function face(L) {
    const s = L.skin, sd = shade(s, -0.18), f = L.sex === "f";
    const jaw = f ? "M66 96 C66 54 134 54 134 96 C134 128 118 148 100 150 C82 148 66 128 66 96Z" : "M64 96 C64 52 136 52 136 96 C136 130 120 152 100 154 C80 152 64 130 64 96Z";
    const eye = (x) => `<ellipse cx="${x}" cy="104" rx="6.4" ry="${f ? 4 : 3.4}" fill="#fff"/><circle cx="${x}" cy="104" r="3" fill="${L.eyes}"/><circle cx="${x}" cy="104" r="1.4" fill="#111"/><circle cx="${x + 1}" cy="103" r=".8" fill="#fff"/>` +
      `<path d="M${x - 7} ${f ? 102 : 102.5} Q${x} ${f ? 97 : 98.5} ${x + 7} ${f ? 102 : 102.5}" stroke="${shade(s, -0.5)}" stroke-width="${f ? 1.8 : 1.3}" fill="none"/>` + (L.glow ? `<circle cx="${x}" cy="104" r="6" fill="#FF3B3B" opacity=".25"/>` : "");
    const brow = { bold: (x, k) => `<path d="M${x - 8} ${94 + k} Q${x} ${89} ${x + 8} ${93 - k}" stroke="${shade(L.hair, -0.2)}" stroke-width="3.2" stroke-linecap="round" fill="none"/>`,
      heavy: (x) => `<path d="M${x - 9} 93 L${x + 9} 92" stroke="${shade(L.hair, -0.1)}" stroke-width="4" stroke-linecap="round"/>`,
      soft: (x) => `<path d="M${x - 8} 94 Q${x} 90 ${x + 8} 93" stroke="${shade(L.hair, -0.1)}" stroke-width="2" stroke-linecap="round" fill="none"/>`,
      sharp: (x, k) => `<path d="M${x - 8} ${k > 0 ? 95 : 91} L${x + 8} ${k > 0 ? 91 : 95}" stroke="${shade(L.hair, -0.1)}" stroke-width="2.4" stroke-linecap="round"/>` }[L.brows] ?? (() => "");
    const lip = L.lips ?? shade(s, -0.35);
    const mouth = { grin: `<path d="M88 132 Q100 142 112 132 Q100 137 88 132Z" fill="#fff" stroke="${shade(s, -0.45)}" stroke-width="1.4"/>`,
      smile: `<path d="M89 133 Q100 141 111 133" stroke="${lip}" stroke-width="2.6" stroke-linecap="round" fill="none"/>`,
      smirk: `<path d="M90 135 Q102 137 112 130" stroke="${lip}" stroke-width="2.6" stroke-linecap="round" fill="none"/>`,
      frown: `<path d="M89 137 Q100 132 111 137" stroke="${lip}" stroke-width="2.6" stroke-linecap="round" fill="none"/>`,
      flat: `<path d="M90 134 L110 134" stroke="${lip}" stroke-width="2.4" stroke-linecap="round"/>` }[L.mouth];
    const beard = { stubble: `<path d="${jaw}" fill="${L.hair}" opacity=".18" clip-path="url(#lower)"/>`,
      full: `<path d="M64 104 C66 140 82 164 100 166 C118 164 134 140 136 104 C130 124 120 128 112 126 C106 124 94 124 88 126 C80 128 70 124 64 104Z" fill="${L.hair}"/><path d="M88 130 Q100 126 112 130 Q100 134 88 130Z" fill="${shade(L.hair, -0.25)}"/>`,
      goatee: `<path d="M90 138 Q100 162 110 138 Q100 144 90 138Z" fill="${L.hair === "#A3A8AE" ? "#2A2A2E" : L.hair}"/><path d="M86 128 Q93 125 99 128 M101 128 Q107 125 114 128" stroke="${L.hair === "#A3A8AE" ? "#2A2A2E" : L.hair}" stroke-width="2.6" fill="none" stroke-linecap="round"/>` }[L.beard] ?? "";
    return `<ellipse cx="64" cy="106" rx="6" ry="10" fill="${sd}"/><ellipse cx="136" cy="106" rx="6" ry="10" fill="${sd}"/>
      <path d="${jaw}" fill="url(#skin)"/>
      <path d="M100 150 C${f ? 118 : 120} 148 ${f ? 134 : 136} 128 ${f ? 134 : 136} 96 C${f ? 130 : 132} 124 118 140 100 142Z" fill="${sd}" opacity=".35"/>
      <ellipse cx="80" cy="120" rx="7" ry="4" fill="#E06B5C" opacity="${f ? 0.22 : 0.1}"/><ellipse cx="120" cy="120" rx="7" ry="4" fill="#E06B5C" opacity="${f ? 0.22 : 0.1}"/>
      ${L.freckles ? [[78, 114], [82, 117], [86, 114], [114, 114], [118, 117], [122, 114]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".9" fill="${shade(s, -0.4)}"/>`).join("") : ""}
      ${eye(86)}${eye(114)}${brow(86, 1)}${brow(114, -1)}
      <path d="M100 106 Q98 118 95 122 Q100 125 105 122" stroke="${shade(s, -0.4)}" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      ${beard}${mouth}
      ${L.glasses ? `<g fill="none" stroke="#2A2A2E" stroke-width="2"><circle cx="86" cy="104" r="10"/><circle cx="114" cy="104" r="10"/><path d="M96 103 Q100 100 104 103 M76 102 L66 99 M124 102 L134 99"/></g><g fill="#fff" opacity=".12"><circle cx="86" cy="104" r="9"/><circle cx="114" cy="104" r="9"/></g>` : ""}
      ${L.earrings === "hoop" ? `<circle cx="64" cy="122" r="5" fill="none" stroke="#E3C27A" stroke-width="2"/><circle cx="136" cy="122" r="5" fill="none" stroke="#E3C27A" stroke-width="2"/>` : L.earrings === "stud" ? `<circle cx="64" cy="117" r="2.2" fill="#EAF2FF"/><circle cx="136" cy="117" r="2.2" fill="#EAF2FF"/>` : ""}`;
  }
  function body(L) {
    const suit = L.suit, d = shade(suit, -0.35);
    return `<path d="M86 138 L86 182 Q100 190 114 182 L114 138Z" fill="${shade(L.skin, -0.15)}"/>
      <path d="M14 240 C18 196 52 180 86 174 Q100 186 114 174 C148 180 182 196 186 240Z" fill="url(#suit)"/>
      <path d="M86 174 L100 214 L114 174 Q100 186 86 174Z" fill="${L.shirt}"/>
      <path d="M86 174 L72 186 L92 222 L100 214Z M114 174 L128 186 L108 222 L100 214Z" fill="${d}"/>
      <path d="M72 186 L92 222 M128 186 L108 222" stroke="${L.trim}" stroke-width="2.2" fill="none"/>
      ${L.sex === "m" && !L.glow ? `<path d="M97 186 L103 186 L105 214 L100 222 L95 214Z" fill="${L.trim}"/>` : ""}
      ${L.glow ? `<path d="M97 186 L103 186 L105 214 L100 222 L95 214Z" fill="#B3232F"/>` : ""}`;
  }

  /** The portrait as an SVG string. */
  window.portrait = function (id, recruit = 1, opts = {}) {
    const L = look(id, recruit, !!opts.evil); const uid = `p${hash(`${id}|${recruit}|${!!opts.evil}`).toString(36)}`;
    const svg = `<svg viewBox="16 20 168 202" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${opts.label ?? "portrait"}"><defs>
      <radialGradient id="${uid}bg" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="${L.bg[0]}"/><stop offset="1" stop-color="${L.bg[1]}"/></radialGradient>
      <linearGradient id="${uid}suit" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${shade(L.suit, 0.12)}"/><stop offset="1" stop-color="${shade(L.suit, -0.3)}"/></linearGradient>
      <radialGradient id="${uid}skin" cx="42%" cy="40%" r="70%"><stop offset="0" stop-color="${shade(L.skin, 0.12)}"/><stop offset="1" stop-color="${L.skin}"/></radialGradient>
      <clipPath id="${uid}lower"><rect x="0" y="118" width="200" height="60"/></clipPath></defs>
      <rect width="200" height="240" fill="url(#${uid}bg)"/>
      ${L.glow ? `<circle cx="100" cy="100" r="90" fill="#FF2A2A" opacity=".08"/>` : `<circle cx="100" cy="92" r="78" fill="#fff" opacity=".05"/>`}
      ${hairBack(L)}${body(L)}${face(L)}${hairFront(L)}
      <rect width="200" height="240" fill="none" stroke="#000" stroke-opacity=".25" stroke-width="2"/></svg>`;
    return svg.replace(/url\(#(skin|suit|lower)\)/g, (_, k) => `url(#${uid}${k})`);
  };
})();
