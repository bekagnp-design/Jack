// Card faces drawn with DOM + CSS: corner indices, real pip layouts for 2–10,
// framed court cards, and a ribbon on the jack, which is the "furti" in this game.
import { rankOf, suitOf, isRed } from '../supabase/functions/game/engine.js';

export const SUIT_CHAR = { S: '♠', H: '♥', D: '♦', C: '♣' };

// Pip positions on a 3 x 7 grid (col, row); rows past the middle are drawn upside down.
const PIPS = {
  A: [[1, 3]],
  2: [[1, 0], [1, 6]],
  3: [[1, 0], [1, 3], [1, 6]],
  4: [[0, 0], [2, 0], [0, 6], [2, 6]],
  5: [[0, 0], [2, 0], [1, 3], [0, 6], [2, 6]],
  6: [[0, 0], [2, 0], [0, 3], [2, 3], [0, 6], [2, 6]],
  7: [[0, 0], [2, 0], [1, 1.5], [0, 3], [2, 3], [0, 6], [2, 6]],
  8: [[0, 0], [2, 0], [1, 1.5], [0, 3], [2, 3], [1, 4.5], [0, 6], [2, 6]],
  9: [[0, 0], [2, 0], [0, 2], [2, 2], [1, 3], [0, 4], [2, 4], [0, 6], [2, 6]],
  10: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2], [0, 4], [2, 4], [1, 5], [0, 6], [2, 6]],
};

export function cardLabel(card) {
  return rankOf(card) + SUIT_CHAR[suitOf(card)];
}

export function cardEl(card, { back = false, interactive = false } = {}) {
  const el = document.createElement('div');
  el.className = 'card' + (back ? ' card-back' : isRed(card) ? ' red' : ' black');
  if (card) el.dataset.card = card;
  if (back) return el;

  const r = rankOf(card);
  const s = SUIT_CHAR[suitOf(card)];
  el.setAttribute('aria-label', cardLabel(card));
  if (interactive) { el.tabIndex = 0; el.setAttribute('role', 'button'); }

  const tl = document.createElement('div');
  tl.className = 'idx tl';
  tl.innerHTML = `<span class="r">${r}</span><span class="s">${s}</span>`;
  const br = document.createElement('div');
  br.className = 'idx br';
  br.innerHTML = `<span class="r">${r}</span><span class="s">${s}</span>`;
  el.append(tl, br);

  if (PIPS[r]) {
    const pips = document.createElement('div');
    pips.className = 'pips' + (r === 'A' ? ' ace' : '');
    for (const [c, row] of PIPS[r]) {
      const p = document.createElement('span');
      p.className = 'pip' + (row > 3 ? ' flip' : '');
      p.style.left = `${[30, 50, 70][c]}%`;
      p.style.top = `${12 + (row / 6) * 76}%`;
      p.textContent = s;
      pips.appendChild(p);
    }
    el.appendChild(pips);
  } else {
    const court = document.createElement('div');
    court.className = 'court';
    court.innerHTML = courtSvg(r, s);
    el.appendChild(court);
    if (r === 'J') {
      const ribbon = document.createElement('div');
      ribbon.className = 'ribbon';
      ribbon.dataset.i18n = 'game.furti';
      el.appendChild(ribbon);
    }
  }
  return el;
}

// Court cards: flat figures in a Georgian spirit. The king wears a crown and a full
// beard, the queen a kerchief and diadem, the jack (the furti) a chokha with chest
// gazyrs and a papakha. Drawn in the suit colour via currentColor; the bottom half
// is the top half turned around, as on any playing card.
function courtHalf(r) {
  const body = '<path class="suit" d="M5 58 C5 44 17 38 30 38 C43 38 55 44 55 58 Z"/><rect class="skin" x="26" y="31" width="8" height="9" rx="2"/>';
  if (r === 'K') {
    return `${body}
      <path class="gold" d="M10 58 C10 50 18 45 30 45 C42 45 50 50 50 58" opacity=".0"/>
      <path class="line" d="M13 56 C15 47 22 43 30 43 C38 43 45 47 47 56"/>
      <circle class="gold" cx="19" cy="52" r="2"/><circle class="gold" cx="41" cy="52" r="2"/>
      <circle class="skin" cx="30" cy="24" r="11"/>
      <path class="ink" d="M19 25 C18 41 42 41 41 25 C38 33 22 33 19 25 Z"/>
      <path class="ink" d="M24 28 C27 31 33 31 36 28 C34 30 26 30 24 28 Z" opacity=".0"/>
      <circle class="ink" cx="26" cy="22" r="1.3"/><circle class="ink" cx="34" cy="22" r="1.3"/>
      <path class="gold" d="M18 15 L20 3 L25.5 9 L30 1 L34.5 9 L40 3 L42 15 Z"/>
      <rect class="gold" x="18" y="14" width="24" height="4" rx="1"/>
      <circle class="suit" cx="30" cy="16" r="1.4"/>`;
  }
  if (r === 'Q') {
    return `${body}
      <path class="line" d="M17 49 C22 54 38 54 43 49"/><circle class="gold" cx="30" cy="54" r="2.2"/>
      <path class="suit" d="M13 31 C8 8 52 8 47 31 C46 20 38 13 30 13 C22 13 14 20 13 31 Z"/>
      <path class="suit" d="M13 31 C12 40 15 48 18 52 L21 40 Z" opacity=".9"/><path class="suit" d="M47 31 C48 40 45 48 42 52 L39 40 Z" opacity=".9"/>
      <circle class="skin" cx="30" cy="25" r="10"/>
      <path class="suit" d="M19 21 C22 14 38 14 41 21 C37 17 23 17 19 21 Z"/>
      <path class="gold" d="M19 14 Q30 5 41 14 L39 16 Q30 9 21 16 Z"/><circle class="gold" cx="30" cy="9.5" r="1.8"/>
      <circle class="ink" cx="26" cy="24" r="1.2"/><circle class="ink" cx="34" cy="24" r="1.2"/>
      <path d="M27 30 Q30 32.5 33 30" fill="none" stroke="#b4282e" stroke-width="1.3" stroke-linecap="round"/>
      <circle class="gold" cx="19.5" cy="29" r="1.5"/><circle class="gold" cx="40.5" cy="29" r="1.5"/>`;
  }
  // J: the furti
  const gaz = [0, 1, 2, 3, 4].map((i) => {
    const l = 21 + i * 2.6, rr = 39 - i * 2.6 + 0.0;
    return `<rect class="cream" x="${l}" y="44" width="1.8" height="8" rx=".6"/><rect class="gold" x="${l}" y="43.3" width="1.8" height="1.4" rx=".4"/><rect class="cream" x="${rr}" y="44" width="1.8" height="8" rx=".6"/><rect class="gold" x="${rr}" y="43.3" width="1.8" height="1.4" rx=".4"/>`;
  }).join('');
  return `${body}${gaz}
    <rect class="cream" x="28" y="40" width="4" height="16" rx="1"/>
    <path class="line" d="M6 56 L54 56"/>
    <circle class="skin" cx="30" cy="25" r="10"/>
    <path class="ink" d="M21 28 C24 25 27 28 30 28 C33 28 36 25 39 28 C36 32 33 30 30 30 C27 30 24 32 21 28 Z"/>
    <circle class="ink" cx="26" cy="22.5" r="1.3"/><circle class="ink" cx="34" cy="22.5" r="1.3"/>
    <ellipse class="ink" cx="30" cy="12" rx="14" ry="9"/><rect class="ink" x="16" y="12" width="28" height="5" rx="2.5"/>
    <circle class="suit" cx="30" cy="5.6" r="2.2"/>`;
}

function courtSvg(r, suitChar) {
  const half = courtHalf(r);
  return `<svg viewBox="0 0 60 116" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <g>${half}</g>
    <g transform="translate(60 116) rotate(180)">${half}</g>
    <circle cx="30" cy="58" r="7.5" fill="#f6ecd2" stroke="#d9a93e" stroke-width="1"/>
    <text x="30" y="62.4" text-anchor="middle" font-size="11" class="suit" fill="currentColor">${suitChar}</text>
  </svg>`;
}
