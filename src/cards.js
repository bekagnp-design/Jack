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
    court.innerHTML = `<span class="court-s">${s}</span><span class="court-r">${r}</span><span class="court-s flip">${s}</span>`;
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
