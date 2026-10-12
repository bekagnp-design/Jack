// Ten original comic stickers, drawn as animated SVG. One of them pops up when a
// player takes the table with a jack (the furti). Each player picks their own.

const INK = '#1b1a17';
const stroke = `stroke="${INK}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"`;
const cap = (text, y = 190, size = 30, fill = '#fff3cf') =>
  `<text x="100" y="${y}" text-anchor="middle" font-weight="800" font-size="${size}" fill="${fill}" stroke="${INK}" stroke-width="5" paint-order="stroke" stroke-linejoin="round">${text}</text>`;

export const STICKERS = [
  { id: 'bam', art: (c) => `
    <g class="st-shake"><polygon points="100,6 121,58 178,38 149,92 196,119 138,130 151,184 100,150 49,184 62,130 4,119 51,92 22,38 79,58" fill="#ffd23f" ${stroke}/>
    <text x="100" y="116" text-anchor="middle" font-weight="900" font-size="44" fill="#e03131" stroke="${INK}" stroke-width="4" paint-order="stroke">${c}</text></g>` },

  { id: 'khinkali', art: (c) => `
    <g class="st-bounce"><path d="M38 150 C14 108 58 66 100 58 C142 66 186 108 162 150 C140 178 60 178 38 150 Z" fill="#f6e7c8" ${stroke}/>
    <g stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"><path d="M100 60 C86 78 72 96 62 118"/><path d="M100 60 C100 82 100 100 100 122"/><path d="M100 60 C114 78 128 96 138 118"/><path d="M100 60 C74 70 52 90 44 112"/><path d="M100 60 C126 70 148 90 156 112"/></g>
    <circle cx="100" cy="46" r="11" fill="#f6e7c8" ${stroke}/>
    <circle cx="80" cy="126" r="9" fill="#fff" ${stroke}/><circle cx="120" cy="126" r="9" fill="#fff" ${stroke}/><circle cx="82" cy="128" r="4" fill="${INK}"/><circle cx="122" cy="128" r="4" fill="${INK}"/>
    <path d="M86 146 Q100 160 114 146" fill="none" ${stroke}/><circle cx="62" cy="142" r="7" fill="#f4a3a3" opacity=".8"/><circle cx="138" cy="142" r="7" fill="#f4a3a3" opacity=".8"/></g>${cap(c)}` },

  { id: 'mustache', art: (c) => `
    <g class="st-bounce"><ellipse cx="72" cy="62" rx="20" ry="24" fill="#fff" ${stroke}/><ellipse cx="128" cy="62" rx="20" ry="24" fill="#fff" ${stroke}/>
    <circle class="st-eyes" cx="76" cy="68" r="8" fill="${INK}"/><circle class="st-eyes" cx="124" cy="68" r="8" fill="${INK}"/>
    <path d="M16 118 C14 78 82 70 100 100 C118 70 186 78 184 118 C152 100 122 112 100 128 C78 112 48 100 16 118 Z" fill="${INK}" ${stroke}/>
    <path d="M60 104 C74 98 88 100 98 108" fill="none" stroke="#6b5b4a" stroke-width="3" stroke-linecap="round"/></g>${cap(c)}` },

  { id: 'horn', art: (c) => `
    <g class="st-tilt"><path d="M26 62 C58 36 152 36 178 82 C150 92 96 98 62 134 C38 124 26 94 26 62 Z" fill="#d9b574" ${stroke}/>
    <path d="M26 62 C58 36 152 36 178 82" fill="none" stroke="#f0cf8d" stroke-width="8" stroke-linecap="round"/>
    <ellipse cx="102" cy="58" rx="62" ry="12" fill="#a4263a" ${stroke} transform="rotate(10 102 58)"/>
    <path d="M60 134 C48 150 40 160 30 170" fill="none" ${stroke}/>
    <g fill="#ffd23f" class="st-twinkle"><text x="150" y="30" font-size="30">✦</text><text x="170" y="60" font-size="20">✦</text><text x="30" y="40" font-size="22">✦</text></g></g>${cap(c)}` },

  { id: 'lightning', art: (c) => `
    <g class="st-shake"><path d="M40 70 C20 70 16 40 44 38 C48 16 84 12 96 30 C112 14 148 22 150 46 C176 44 184 74 160 78 Z" fill="#9aa5b1" ${stroke}/>
    <polygon class="st-flash" points="110,66 64,124 98,124 82,182 140,106 104,106 124,66" fill="#ffd23f" ${stroke}/></g>${cap(c, 196, 30)}` },

  { id: 'cat', art: (c) => `
    <g class="st-shake"><polygon points="42,70 38,22 80,46" fill="#f0a24b" ${stroke}/><polygon points="158,70 162,22 120,46" fill="#f0a24b" ${stroke}/>
    <circle cx="100" cy="104" r="62" fill="#f0a24b" ${stroke}/>
    <circle cx="76" cy="92" r="19" fill="#fff" ${stroke}/><circle cx="124" cy="92" r="19" fill="#fff" ${stroke}/>
    <circle class="st-eyes" cx="76" cy="94" r="6" fill="${INK}"/><circle class="st-eyes" cx="124" cy="94" r="6" fill="${INK}"/>
    <ellipse cx="100" cy="134" rx="14" ry="18" fill="#7a2230" ${stroke}/><polygon points="94,114 106,114 100,122" fill="#e98a9a"/>
    <g stroke="${INK}" stroke-width="3" stroke-linecap="round"><path d="M30 112 L58 118"/><path d="M28 130 L58 128"/><path d="M170 112 L142 118"/><path d="M172 130 L142 128"/></g>
    <circle cx="44" cy="148" r="14" fill="#f0a24b" ${stroke}/><circle cx="156" cy="148" r="14" fill="#f0a24b" ${stroke}/></g>${cap(c)}` },

  { id: 'glove', art: (c) => `
    <g class="st-punch"><path d="M20 76 C20 40 70 30 108 36 C150 42 176 70 168 104 C162 130 140 138 116 138 L60 138 C36 138 20 112 20 76 Z" fill="#e03131" ${stroke}/>
    <path d="M66 138 L66 172 L128 172 L124 138" fill="#f6e7c8" ${stroke}/>
    <path d="M44 68 C70 54 110 54 138 72" fill="none" stroke="#ff8a8a" stroke-width="8" stroke-linecap="round"/></g>
    <g class="st-twinkle" stroke="${INK}" stroke-width="5" stroke-linecap="round"><path d="M178 40 L196 28"/><path d="M184 66 L200 64"/><path d="M176 14 L184 2"/></g>${cap(c, 196, 30)}` },

  { id: 'broom', art: (c) => `
    <g class="st-sweep"><line x1="150" y1="14" x2="86" y2="112" ${stroke}/>
    <path d="M70 100 L108 120 L84 168 C70 172 40 160 30 146 Z" fill="#e2b04a" ${stroke}/>
    <g stroke="${INK}" stroke-width="3" stroke-linecap="round"><path d="M52 118 L44 150"/><path d="M68 124 L62 158"/><path d="M84 130 L80 164"/></g></g>
    <g class="st-fly"><rect x="130" y="124" width="26" height="36" rx="4" fill="#fff" ${stroke} transform="rotate(18 143 142)"/><rect x="160" y="96" width="22" height="30" rx="4" fill="#fff" ${stroke} transform="rotate(-24 171 111)"/><rect x="118" y="80" width="20" height="28" rx="4" fill="#fff" ${stroke} transform="rotate(40 128 94)"/></g>${cap(c, 198, 28)}` },

  { id: 'crown', art: (c) => `
    <g class="st-bounce"><path d="M24 150 L14 62 L62 100 L100 38 L138 100 L186 62 L176 150 Z" fill="#ffd23f" ${stroke}/>
    <rect x="24" y="150" width="152" height="22" rx="6" fill="#e2a41c" ${stroke}/>
    <circle cx="100" cy="118" r="11" fill="#e03131" ${stroke}/><circle cx="58" cy="132" r="8" fill="#3b82f6" ${stroke}/><circle cx="142" cy="132" r="8" fill="#2f9e44" ${stroke}/>
    <circle cx="14" cy="60" r="8" fill="#ffd23f" ${stroke}/><circle cx="100" cy="36" r="8" fill="#ffd23f" ${stroke}/><circle cx="186" cy="60" r="8" fill="#ffd23f" ${stroke}/></g>
    <g class="st-twinkle" fill="#fff3cf"><text x="26" y="34" font-size="26">✦</text><text x="156" y="30" font-size="30">✦</text></g>${cap(c, 198, 28)}` },

  { id: 'tornado', art: (c) => `
    <g class="st-spin"><ellipse cx="100" cy="40" rx="84" ry="18" fill="#9aa5b1" ${stroke}/><ellipse cx="100" cy="76" rx="66" ry="15" fill="#a9b4c0" ${stroke}/><ellipse cx="100" cy="108" rx="48" ry="13" fill="#b8c2cc" ${stroke}/><ellipse cx="100" cy="138" rx="30" ry="10" fill="#c7d0d9" ${stroke}/><ellipse cx="100" cy="162" rx="14" ry="7" fill="#d6dde4" ${stroke}/></g>
    <g class="st-orbit"><rect x="150" y="56" width="22" height="30" rx="4" fill="#fff" ${stroke}/><rect x="26" y="96" width="20" height="28" rx="4" fill="#fff" ${stroke} /></g>${cap(c, 198, 26)}` },
];

export function stickerHtml(id, caption, size = 150) {
  const s = STICKERS.find((x) => x.id === id) || STICKERS[0];
  return `<svg class="sticker-svg" viewBox="0 0 200 210" width="${size}" height="${size * 1.05}" aria-hidden="true">${s.art(caption)}</svg>`;
}

const KEY = 'eleven.sticker';
const OFF_KEY = 'eleven.stickerOff';
export function mySticker() { try { const v = localStorage.getItem(KEY); return STICKERS.some((s) => s.id === v) ? v : 'bam'; } catch { return 'bam'; } }
export function setMySticker(id) { try { localStorage.setItem(KEY, id); } catch { /* ignore */ } }
export function stickersOff() { try { return localStorage.getItem(OFF_KEY) === '1'; } catch { return false; } }
export function setStickersOff(off) { try { localStorage.setItem(OFF_KEY, off ? '1' : '0'); } catch { /* ignore */ } }
// Computer players get a stable, varied sticker from their seat number.
export function botSticker(seat) { return STICKERS[(seat * 3 + 1) % STICKERS.length].id; }
