// Portraits of the participants (owner, 2026-11-26: "should look more like this, not that cartoony"). Original characters,
// painted in SVG with soft light and shadow: no image files needed, works offline. Each seat has its own face and outfit;
// a recruit gets a new face in the seat's outfit; an evil twin is the same face gone dark. If the owner drops a picture in
// web/portraits/ named after the seat (stocks-bull.jpg, stocks-bull-evil.png, crypto-bear-2.webp, ...) it is used instead.
(() => {
  const SEATS = {
    "stocks-bull": { sex: "m", skin: "#B98262", hair: "#241812", style: "swept", beard: "stubble", eyes: "#4A3423", outfit: "officer", main: "#1C3352", trim: "#C9A55A", sky: ["#2C4A6E", "#0B1522"], rim: "#F1D7A0" },
    "stocks-bear": { sex: "m", skin: "#D7AE90", hair: "#9C9EA2", style: "receding", beard: "full", eyes: "#56656E", outfit: "fur", main: "#3A2A20", trim: "#7A5A3C", sky: ["#5A4636", "#140F0C"], rim: "#E8C9A0", glasses: true, age: 1 },
    "crypto-bull": { sex: "f", skin: "#C98F6C", hair: "#6A2F17", style: "long", eyes: "#3E5E36", outfit: "explorer", main: "#2D5240", trim: "#C9A55A", sky: ["#2E6B58", "#0A1A15"], rim: "#F3DDA8", freckles: true, earring: "gold" },
    "crypto-bear": { sex: "f", skin: "#E6BFA2", hair: "#121216", style: "bun", eyes: "#2E2A36", outfit: "highcollar", main: "#7A1C29", trim: "#D2AE62", sky: ["#6E2834", "#14070A"], rim: "#F6D3C0", lips: "#8E2433", earring: "pearl" },
  };
  const SKINS = ["#EBC6A8", "#DDB08E", "#C98F6C", "#AD7754", "#8A5A3C", "#64402A"];
  const HAIRS = ["#121216", "#241812", "#3E2618", "#6A2F17", "#A87A3A", "#9C9EA2", "#4E3426"];
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
  const shade = (hex, f) => { const n = parseInt(hex.slice(1), 16); const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)))); return "#" + c.map(v => v.toString(16).padStart(2, "0")).join(""); };

  function look(id, recruit, evil) {
    let L = { ...(SEATS[id] ?? SEATS["stocks-bull"]) };
    if (recruit > 1) {
      const h = hash(`${id}#${recruit}`); const sex = h % 2 ? "m" : "f";
      L = { ...L, sex, skin: SKINS[h % SKINS.length], hair: HAIRS[(h >> 3) % HAIRS.length], eyes: ["#4A3423", "#3E5E36", "#56656E", "#2E2A36"][(h >> 5) % 4],
        style: sex === "m" ? ["swept", "short", "receding", "curly"][(h >> 7) % 4] : ["long", "bun", "bob", "curly"][(h >> 7) % 4],
        beard: sex === "m" ? ["none", "stubble", "full", "none"][(h >> 9) % 4] : "none", glasses: (h >> 11) % 5 === 0, freckles: (h >> 13) % 4 === 0,
        earring: sex === "f" ? ["gold", "pearl", "none"][(h >> 14) % 3] : "none", lips: sex === "f" && (h >> 16) % 2 ? "#8E2433" : undefined, age: (h >> 18) % 3 === 0 ? 1 : 0 };
    }
    if (evil) L = { ...L, main: "#121216", trim: "#A3222F", sky: ["#4A0E16", "#070304"], rim: "#FF4A4A", eyes: "#FF2B2B", evil: true,
      beard: L.sex === "m" ? (L.beard === "full" ? "full" : "goatee") : "none", lips: L.sex === "f" ? "#4A0A14" : L.lips };
    return L;
  }

  // ---- pieces (head centred at x 150; eyes at y 158; chin at y 250) ----
  const FACE_M = "M86 150 C84 104 108 72 150 72 C192 72 216 104 214 150 C214 186 204 214 186 234 C176 245 164 252 150 252 C136 252 124 245 114 234 C96 214 86 186 86 150Z";
  const FACE_F = "M90 150 C88 104 110 74 150 74 C190 74 212 104 210 150 C210 184 200 210 184 230 C174 242 162 250 150 250 C138 250 126 242 116 230 C100 210 90 184 90 150Z";

  function background(L, u) {
    return `<rect width="300" height="400" fill="url(#${u}sky)"/>
      <g filter="url(#${u}soft)" opacity=".55">${[[20, 290, 30, 110], [60, 300, 22, 80], [96, 270, 26, 130], [190, 280, 24, 120], [226, 300, 30, 90], [262, 260, 26, 140]].map(([x, y, w, h], i) => `<rect x="${x}" y="${y - h}" width="${w}" height="${h + 120}" fill="${i % 2 ? shade(L.sky[1], 0.15) : shade(L.sky[0], -0.35)}"/>`).join("")}</g>
      <circle cx="${L.evil ? 150 : 210}" cy="120" r="120" fill="${L.rim}" opacity="${L.evil ? 0.16 : 0.12}" filter="url(#${u}blur)"/>`;
  }
  function hairBack(L) {
    const c = shade(L.hair, -0.2);
    if (L.style === "long") return `<path d="M84 140 C70 210 74 300 96 352 L204 352 C226 300 230 210 216 140 C210 92 90 92 84 140Z" fill="${c}"/>`;
    if (L.style === "bob") return `<path d="M86 140 C80 190 84 228 98 244 L202 244 C216 228 220 190 214 140 C208 94 92 94 86 140Z" fill="${c}"/>`;
    if (L.style === "curly" && L.sex === "f") return `<g fill="${c}">${[[84, 170], [80, 205], [90, 238], [216, 170], [220, 205], [210, 238]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="24"/>`).join("")}</g>`;
    return "";
  }
  function outfit(L, u) {
    const m = L.main, d = shade(m, -0.45), lt = shade(m, 0.22), t = L.trim;
    const body = `<path d="M20 400 C24 330 70 300 116 290 L150 300 L184 290 C230 300 276 330 280 400Z" fill="url(#${u}cloth)"/>`;
    const fold = `<g filter="url(#${u}blur)" opacity=".5"><path d="M70 340 C90 330 100 360 96 400" stroke="${d}" stroke-width="10" fill="none"/><path d="M230 340 C210 330 200 360 204 400" stroke="${d}" stroke-width="10" fill="none"/></g>`;
    switch (L.outfit) {
      case "officer": return `${body}${fold}
        <path d="M118 288 L150 330 L182 288 L176 280 L150 302 L124 280Z" fill="#E9E4DA"/><path d="M138 300 L150 330 L162 300 Q150 312 138 300Z" fill="#D8D0C2"/>
        <path d="M116 290 L150 340 L150 400 L104 400 L96 312Z M184 290 L150 340 L150 400 L196 400 L204 312Z" fill="${lt}" opacity=".35"/>
        <path d="M150 340 L150 400" stroke="${d}" stroke-width="2"/>${[350, 372, 394].map(y => `<circle cx="140" cy="${y}" r="3.2" fill="${t}"/><circle cx="160" cy="${y}" r="3.2" fill="${t}"/>`).join("")}
        <path d="M40 330 C60 308 92 300 112 302 L106 322 C84 322 62 330 46 344Z" fill="${t}"/><path d="M260 330 C240 308 208 300 188 302 L194 322 C216 322 238 330 254 344Z" fill="${t}"/>
        <g stroke="${shade(t, -0.25)}" stroke-width="2">${Array.from({ length: 9 }, (_, i) => `<path d="M${48 + i * 7} ${340 - i * 1.6} l-2 12"/><path d="M${252 - i * 7} ${340 - i * 1.6} l2 12"/>`).join("")}</g>
        <path d="M116 290 L96 312 M184 290 L204 312" stroke="${t}" stroke-width="2.5"/>`;
      case "fur": return `${body}${fold}
        <path d="M128 286 L150 318 L172 286 L164 282 L150 296 L136 282Z" fill="#D9D2C4"/><path d="M146 300 L154 300 L156 330 L150 338 L144 330Z" fill="#6E2430"/>
        <path d="M128 300 L150 330 L150 400 L118 400 Z M172 300 L150 330 L150 400 L182 400Z" fill="#2A221C"/>
        <path d="M44 344 C70 306 108 290 132 286 L150 318 L168 286 C192 290 230 306 256 344" stroke="${shade(t, -0.15)}" stroke-width="40" fill="none" stroke-linecap="round" opacity=".95"/>
        <path d="M44 344 C70 306 108 290 132 286 L150 318 L168 286 C192 290 230 306 256 344" stroke="${shade(t, 0.25)}" stroke-width="40" fill="none" stroke-linecap="round" filter="url(#${u}grain)"/>
        <path d="M50 336 C76 304 110 292 132 290 M250 336 C224 304 190 292 168 290" stroke="${shade(t, 0.45)}" stroke-width="6" fill="none" opacity=".35" filter="url(#${u}soft)"/>`;
      case "explorer": return `${body}${fold}
        <path d="M120 286 C130 310 170 310 180 286 L188 300 C176 334 124 334 112 300Z" fill="#E8DCC4"/><path d="M134 318 C140 340 132 360 124 372 L140 366 C146 352 150 336 148 320Z" fill="#D9CBB0"/>
        <path d="M112 300 L84 316 L100 400 L130 400 L124 340Z M188 300 L216 316 L200 400 L170 400 L176 340Z" fill="${lt}" opacity=".4"/>
        <rect x="88" y="356" width="34" height="9" rx="2" fill="${shade(m, -0.3)}"/><rect x="100" y="354" width="10" height="13" rx="2" fill="none" stroke="${t}" stroke-width="2"/>
        <path d="M206 316 L222 312 L230 348 L214 352Z" fill="${shade(m, -0.2)}" stroke="${t}" stroke-width="1.5"/>`;
      case "highcollar": return `${body}${fold}
        <path d="M112 248 C118 274 120 292 116 304 L150 330 L184 304 C180 292 182 274 188 248 L178 252 C176 274 170 288 150 296 C130 288 124 274 122 252Z" fill="${shade(m, -0.15)}"/>
        <path d="M112 248 C118 274 120 292 116 304 M188 248 C182 274 180 292 184 304" stroke="${t}" stroke-width="2.5" fill="none"/>
        <path d="M116 304 L150 330 L184 304 L190 400 L110 400Z" fill="#141418"/><path d="M116 304 L150 330 L184 304" stroke="${t}" stroke-width="2.5" fill="none"/>
        <path d="M150 330 L150 400" stroke="${t}" stroke-width="1.5" opacity=".7"/>
        <circle cx="150" cy="290" r="6" fill="${t}"/><circle cx="150" cy="290" r="3" fill="${L.evil ? "#FF2B2B" : "#7A1C29"}"/>`;
      default: return body;
    }
  }
  function neck(L, u) {
    const s = L.skin;
    return `<path d="M120 220 L120 292 Q150 312 180 292 L180 220Z" fill="${shade(s, -0.12)}"/>
      <path d="M118 236 Q150 270 182 236 L182 262 Q150 286 118 262Z" fill="${shade(s, -0.45)}" opacity=".55" filter="url(#${u}blur)"/>`;
  }
  function head(L, u) {
    const s = L.skin, f = L.sex === "f", face = f ? FACE_F : FACE_M, dk = shade(s, -0.42), lt = shade(s, 0.28);
    const shading = `<g clip-path="url(#${u}face)">
      <g filter="url(#${u}blur)">
        <ellipse cx="${f ? 90 : 86}" cy="170" rx="30" ry="80" fill="${dk}" opacity=".55"/><ellipse cx="${f ? 210 : 214}" cy="170" rx="26" ry="80" fill="${dk}" opacity=".35"/>
        <ellipse cx="122" cy="150" rx="22" ry="12" fill="${dk}" opacity=".45"/><ellipse cx="178" cy="150" rx="22" ry="12" fill="${dk}" opacity=".4"/>
        <ellipse cx="160" cy="186" rx="9" ry="20" fill="${dk}" opacity=".45"/><ellipse cx="150" cy="204" rx="16" ry="6" fill="${dk}" opacity=".5"/>
        <ellipse cx="150" cy="${f ? 234 : 236}" rx="22" ry="7" fill="${dk}" opacity=".35"/><ellipse cx="112" cy="${f ? 196 : 200}" rx="12" ry="22" fill="${dk}" opacity=".3"/>
        <ellipse cx="150" cy="104" rx="38" ry="18" fill="${lt}" opacity=".55"/><ellipse cx="146" cy="176" rx="5" ry="22" fill="${lt}" opacity=".6"/>
        <ellipse cx="126" cy="182" rx="14" ry="8" fill="${lt}" opacity=".4"/><ellipse cx="178" cy="180" rx="12" ry="7" fill="${lt}" opacity=".3"/>
        <ellipse cx="150" cy="${f ? 242 : 244}" rx="10" ry="5" fill="${lt}" opacity=".35"/>
        ${f ? `<ellipse cx="118" cy="192" rx="13" ry="7" fill="#D86A5A" opacity=".28"/><ellipse cx="182" cy="192" rx="13" ry="7" fill="#D86A5A" opacity=".22"/>` : ""}
        ${L.age ? `<path d="M108 120 Q150 112 192 120" stroke="${dk}" stroke-width="3" fill="none" opacity=".4"/><path d="M120 214 Q114 200 122 186 M180 214 Q186 200 178 186" stroke="${dk}" stroke-width="3" fill="none" opacity=".45"/>` : ""}
        ${L.evil ? `<ellipse cx="122" cy="166" rx="20" ry="9" fill="#2A0508" opacity=".55"/><ellipse cx="178" cy="166" rx="20" ry="9" fill="#2A0508" opacity=".5"/>` : ""}
      </g>
      <path d="M${f ? 210 : 214} 120 C${f ? 214 : 218} 160 ${f ? 206 : 210} 200 ${f ? 186 : 188} 232" stroke="${L.rim}" stroke-width="5" fill="none" opacity=".35" filter="url(#${u}blur)"/>
      ${L.freckles ? [[116, 180], [122, 186], [129, 181], [171, 181], [178, 186], [184, 180], [140, 186], [160, 186]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.1" fill="${dk}" opacity=".6"/>`).join("") : ""}
      ${L.beard === "stubble" ? `<path d="M96 190 C104 232 128 252 150 252 C172 252 196 232 204 190 C194 214 178 222 164 214 Q150 208 136 214 C122 222 106 214 96 190Z" fill="${L.hair}" opacity=".28" filter="url(#${u}grain)"/><path d="M128 210 Q150 202 172 210 Q150 214 128 210Z" fill="${L.hair}" opacity=".3"/>` : ""}
    </g>`;
    const eye = (x, flip) => { const w = f ? 15 : 14, h = f ? 6.2 : 5.4, y = 160;
      return `<path d="M${x - w} ${y} Q${x} ${y - h * 1.5} ${x + w} ${y - 1} Q${x} ${y + h} ${x - w} ${y}Z" fill="#EAE2DA"/>
        <clipPath id="${u}e${x}"><path d="M${x - w} ${y} Q${x} ${y - h * 1.5} ${x + w} ${y - 1} Q${x} ${y + h} ${x - w} ${y}Z"/></clipPath>
        <g clip-path="url(#${u}e${x})"><circle cx="${x + flip}" cy="${y - 0.5}" r="6.6" fill="url(#${u}iris)"/><circle cx="${x + flip}" cy="${y - 0.5}" r="2.8" fill="#0A0A0C"/>
          <ellipse cx="${x}" cy="${y - h - 1}" rx="${w + 2}" ry="${h * 0.9}" fill="${shade(s, -0.55)}" opacity=".45"/>${L.evil ? `<circle cx="${x + flip}" cy="${y - 0.5}" r="7" fill="#FF2B2B" opacity=".35"/>` : ""}</g>
        <circle cx="${x + flip + 2}" cy="${y - 2.5}" r="1.4" fill="#fff" opacity=".9"/>
        <path d="M${x - w - 1} ${y + 0.5} Q${x} ${y - h * 1.6} ${x + w + 1} ${y - 1.5}" stroke="#1A1210" stroke-width="${f ? 2.6 : 2}" fill="none" stroke-linecap="round"/>
        <path d="M${x - w + 2} ${y - h - 3} Q${x} ${y - h * 2.4} ${x + w} ${y - h - 2}" stroke="${shade(s, -0.4)}" stroke-width="1.2" fill="none" opacity=".6"/>
        <path d="M${x - w + 3} ${y + 2} Q${x} ${y + h + 1.5} ${x + w - 2} ${y + 1}" stroke="${shade(s, -0.35)}" stroke-width="1" fill="none" opacity=".5"/>`; };
    const brow = (x, dir) => { const thick = f ? 3.2 : 5, y = L.evil ? 140 : 142, tilt = L.evil ? 5 : 0;
      return `<path d="M${x - 18 * dir} ${y + 3 - tilt * (dir > 0 ? 0 : 1)} Q${x - 4 * dir} ${y - thick - 3} ${x + 16 * dir} ${y + 1 + tilt * (dir > 0 ? 1 : 0)} Q${x - 2 * dir} ${y - 1} ${x - 18 * dir} ${y + 3 - tilt * (dir > 0 ? 0 : 1)}Z" fill="${shade(L.hair === "#9C9EA2" ? "#6E7074" : L.hair, 0.05)}" opacity=".92"/>`; };
    const nose = `<path d="M144 166 Q142 186 136 196 Q142 204 150 202 Q158 204 164 196 Q158 186 156 166" fill="none" stroke="${shade(s, -0.35)}" stroke-width="1.4" opacity=".55"/>
      <ellipse cx="142" cy="199" rx="3.6" ry="2.2" fill="${shade(s, -0.6)}" opacity=".7"/><ellipse cx="158" cy="199" rx="3.6" ry="2.2" fill="${shade(s, -0.6)}" opacity=".7"/>
      <ellipse cx="150" cy="194" rx="6" ry="4" fill="${lt}" opacity=".35"/>`;
    const lipC = L.lips ?? shade(s, f ? -0.28 : -0.22); const smirk = L.evil ? 3 : 0;
    const mouth = `<path d="M${f ? 132 : 134} 220 Q141 ${f ? 212 : 215} 150 216 Q159 ${f ? 212 : 215} ${f ? 168 : 166} ${220 - smirk} Q150 223 ${f ? 132 : 134} 220Z" fill="${shade(lipC, -0.12)}"/>
      <path d="M${f ? 132 : 134} 220 Q150 ${f ? 234 : 230} ${f ? 168 : 166} ${220 - smirk} Q150 224 ${f ? 132 : 134} 220Z" fill="${lipC}"/>
      <path d="M${f ? 132 : 134} 220 Q150 224 ${f ? 168 : 166} ${220 - smirk}" stroke="${shade(s, -0.65)}" stroke-width="1.4" fill="none"/>
      <ellipse cx="150" cy="${f ? 226 : 225}" rx="8" ry="2" fill="#fff" opacity="${f ? 0.25 : 0.12}"/>`;
    const beard = L.beard === "full" ? `<path d="M90 176 C92 236 122 270 150 272 C178 270 208 236 210 176 C202 206 188 214 172 208 Q150 200 128 208 C112 214 98 206 90 176Z" fill="${shade(L.hair, -0.15)}" opacity=".92"/><path d="M90 176 C92 236 122 270 150 272 C178 270 208 236 210 176 C202 206 188 214 172 208 Q150 200 128 208 C112 214 98 206 90 176Z" fill="${shade(L.hair, 0.22)}" opacity=".55" filter="url(#${u}grain)"/>
        <path d="M128 212 Q140 206 150 210 Q160 206 172 212 Q160 218 150 214 Q140 218 128 212Z" fill="${shade(L.hair, -0.3)}"/>`
      : L.beard === "goatee" ? `<path d="M134 230 Q150 266 166 230 Q150 238 134 230Z" fill="${L.hair === "#9C9EA2" ? "#2A2A2E" : L.hair}" filter="url(#${u}grain)"/><path d="M128 212 Q140 205 150 209 Q160 205 172 212 Q160 215 150 212 Q140 215 128 212Z" fill="${L.hair === "#9C9EA2" ? "#2A2A2E" : L.hair}"/>` : "";
    const ears = `<path d="M88 150 C76 146 74 168 82 182 C86 190 92 190 94 184Z" fill="${shade(s, -0.12)}"/><path d="M212 150 C224 146 226 168 218 182 C214 190 208 190 206 184Z" fill="${shade(s, -0.2)}"/>`;
    const ear = L.earring === "gold" ? `<circle cx="84" cy="194" r="6" fill="none" stroke="#D9B45A" stroke-width="2.4"/><circle cx="216" cy="194" r="6" fill="none" stroke="#D9B45A" stroke-width="2.4"/>`
      : L.earring === "pearl" ? `<circle cx="85" cy="190" r="3.6" fill="#F4F0EA"/><circle cx="215" cy="190" r="3.6" fill="#F4F0EA"/>` : "";
    const glasses = L.glasses ? `<g fill="none" stroke="#2A2620" stroke-width="2.4"><rect x="102" y="146" width="40" height="28" rx="12"/><rect x="158" y="146" width="40" height="28" rx="12"/><path d="M142 156 Q150 152 158 156 M102 154 L90 150 M198 154 L210 150"/></g><g fill="#fff" opacity=".08"><rect x="103" y="147" width="38" height="26" rx="11"/><rect x="159" y="147" width="38" height="26" rx="11"/></g>` : "";
    return `${ears}<path d="${face}" fill="url(#${u}skin)"/>${shading}${eye(122, 1)}${eye(178, -1)}${brow(122, 1)}${brow(178, -1)}${nose}${beard}${mouth}${glasses}${ear}`;
  }
  function hairFront(L, u) {
    const c = L.hair, d = shade(c, -0.35), lt = shade(c, 0.35);
    const strands = (paths) => `<g fill="none" stroke="${lt}" stroke-width="1.4" opacity=".35">${paths.map(p => `<path d="${p}"/>`).join("")}</g>`;
    const shadow = `<path d="M96 132 Q150 96 204 132" stroke="${shade(L.skin, -0.5)}" stroke-width="10" fill="none" opacity=".35" filter="url(#${u}blur)"/>`;
    switch (L.style) {
      case "swept": return `${shadow}<path d="M84 150 C78 96 104 60 152 58 C196 56 222 88 216 146 C210 120 200 104 184 96 C168 104 140 100 120 92 C104 104 92 124 84 150Z" fill="${c}"/>${strands(["M112 82 C130 66 168 64 190 80", "M104 98 C126 80 160 78 186 90", "M150 62 C170 64 192 74 204 94"])}`;
      case "short": return `${shadow}<path d="M86 146 C82 98 108 66 150 64 C192 66 218 98 214 146 C208 116 196 98 150 94 C108 98 94 116 86 146Z" fill="${c}"/>${strands(["M110 82 C130 70 170 70 190 82"])}`;
      case "receding": return `<path d="M84 160 C80 128 86 104 98 96 C96 116 94 136 94 156Z M216 160 C220 128 214 104 202 96 C204 116 206 136 206 156Z" fill="${c}"/><path d="M98 96 C114 84 186 84 202 96" stroke="${c}" stroke-width="5" fill="none" opacity=".45"/>${strands(["M88 140 C88 120 92 106 98 98", "M212 140 C212 120 208 106 202 98"])}`;
      case "curly": return `${shadow}<g fill="${c}">${[[100, 112], [118, 88], [140, 76], [162, 76], [184, 88], [202, 112], [92, 136], [208, 136]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="20"/>`).join("")}</g><g fill="${lt}" opacity=".3">${[[116, 82], [146, 70], [178, 80]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7"/>`).join("")}</g>`;
      case "long": return `${shadow}<path d="M84 168 C78 100 108 64 152 62 C198 62 224 100 216 168 C210 128 196 104 170 96 C150 110 116 116 96 124 C90 136 86 150 84 168Z" fill="${c}"/>${strands(["M100 120 C118 96 150 84 178 90", "M170 96 C192 104 206 126 212 158", "M96 126 C88 160 88 200 94 240"])}`;
      case "bun": return `<circle cx="150" cy="54" r="24" fill="${c}"/><path d="M138 40 Q150 32 164 40" stroke="${lt}" stroke-width="2" fill="none" opacity=".4"/>${shadow}<path d="M86 156 C82 100 110 70 150 68 C190 70 218 100 214 156 C208 118 190 96 150 92 C110 96 92 118 86 156Z" fill="${c}"/>${strands(["M108 96 C126 80 174 80 192 96", "M100 116 C110 100 128 90 150 88"])}`;
      case "bob": return `${shadow}<path d="M84 196 C76 104 108 66 150 64 C194 66 226 104 216 196 C212 150 204 118 176 104 C156 116 120 120 100 118 C90 140 86 166 84 196Z" fill="${c}"/>${strands(["M104 112 C124 92 160 86 182 98"])}`;
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
    return `<svg viewBox="22 16 256 341" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${opts.label ?? "portrait"}" preserveAspectRatio="xMidYMid slice"><defs>
      <linearGradient id="${u}sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${L.sky[0]}"/><stop offset="1" stop-color="${L.sky[1]}"/></linearGradient>
      <linearGradient id="${u}cloth" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${shade(L.main, 0.18)}"/><stop offset=".6" stop-color="${L.main}"/><stop offset="1" stop-color="${shade(L.main, -0.5)}"/></linearGradient>
      <radialGradient id="${u}skin" cx="44%" cy="38%" r="70%"><stop offset="0" stop-color="${shade(L.skin, 0.1)}"/><stop offset=".7" stop-color="${L.skin}"/><stop offset="1" stop-color="${shade(L.skin, -0.25)}"/></radialGradient>
      <radialGradient id="${u}iris" cx="40%" cy="40%" r="70%"><stop offset="0" stop-color="${shade(L.eyes, 0.35)}"/><stop offset="1" stop-color="${shade(L.eyes, -0.35)}"/></radialGradient>
      <clipPath id="${u}face"><path d="${L.sex === "f" ? FACE_F : FACE_M}"/></clipPath>
      <filter id="${u}blur" x="-60%" y="-60%" width="220%" height="220%" filterUnits="objectBoundingBox"><feGaussianBlur stdDeviation="7"/></filter>
      <filter id="${u}soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3"/></filter>
      <filter id="${u}grain" x="0" y="0" width="300" height="400" filterUnits="userSpaceOnUse"><feTurbulence type="fractalNoise" baseFrequency=".75" numOctaves="2" seed="3" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.2 1.3" result="m"/><feComposite in="SourceGraphic" in2="m" operator="in"/></filter>
      <filter id="${u}canvas" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="3" seed="7"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="table" tableValues="0 .09"/></feComponentTransfer></filter>
      <radialGradient id="${u}vig" cx="50%" cy="42%" r="72%"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".6"/></radialGradient></defs>
      ${background(L, u)}${hairBack(L)}${neck(L, u)}${outfit(L, u)}${head(L, u)}${hairFront(L, u)}
      <path d="M20 400 C24 330 70 300 116 290" stroke="${L.rim}" stroke-width="4" fill="none" opacity=".25" filter="url(#${u}soft)"/>
      <rect width="300" height="400" filter="url(#${u}canvas)"/><rect width="300" height="400" fill="url(#${u}vig)"/></svg>`;
  };
})();
