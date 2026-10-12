// თერთმეტი / Eleven — game engine.
// Shared by the browser client and the Supabase Edge Function (Deno), so it is
// plain ESM with no imports. The server is the only one that calls mutating
// functions on real games; the client uses the read-only helpers for hints.
//
// Rules (as agreed with the user):
//  - 52 cards, 2–4 players, each for themselves. Dealer rotates; the player to
//    the dealer's left plays first.
//  - 4 cards face up on the table (never a jack: it goes back into the deck),
//    4 cards to each player. When every hand is empty, 4 more each from the
//    deck (the table is not replenished).
//  - A number card (A=1 … 10) may take a group of number cards from the table
//    whose sum together with it is exactly 11. One group per play.
//  - Q takes one Q, K takes one K.
//  - J ("furti") takes everything on the table except Qs and Ks (other Js
//    included). With nothing to take it stays on the table.
//  - Taking is optional: any card may simply be laid on the table.
//  - When deck and hands are empty, whatever is left on the table goes to the
//    last player who took something.
//  - Deal score: most cards 2 pts, most clubs 1 pt (ties: nobody), 10♦ 1 pt,
//    2♣ 1 pt. Totals accumulate; the game ends when someone reaches the target
//    and is the sole leader.

export const SUITS = ['S', 'H', 'D', 'C'];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const TARGET_SUM = 11;
export const HAND_SIZE = 4;
export const TABLE_SIZE = 4;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const TURN_SECONDS = 60; // after this a human's move is made for them

// ---------- cards ----------

export function rankOf(card) { return card.slice(0, -1); }
export function suitOf(card) { return card.slice(-1); }
export function isNumber(card) { const r = rankOf(card); return r !== 'J' && r !== 'Q' && r !== 'K'; }
export function valueOf(card) {
  const r = rankOf(card);
  if (r === 'A') return 1;
  if (r === 'J' || r === 'Q' || r === 'K') return 0;
  return parseInt(r, 10);
}
export function isRed(card) { const s = suitOf(card); return s === 'H' || s === 'D'; }

export function fullDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(r + s);
  return deck;
}

// Random source: crypto when available (browser, Deno, Node 19+), else Math.random.
function cryptoRandom() {
  const g = globalThis;
  if (g.crypto && g.crypto.getRandomValues) {
    const buf = new Uint32Array(1);
    g.crypto.getRandomValues(buf);
    return buf[0] / 4294967296;
  }
  return Math.random();
}

// Deterministic generator for tests and replays.
export function seededRandom(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(cards, rand = cryptoRandom) {
  const a = cards.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- captures ----------

function sumCombos(need, cards) {
  // All subsets of number cards summing to `need`.
  const nums = cards.filter(isNumber);
  const out = [];
  (function rec(start, sum, chosen) {
    if (sum === need && chosen.length) { out.push(chosen.slice()); return; }
    if (sum >= need) return;
    for (let i = start; i < nums.length; i++) {
      chosen.push(nums[i]);
      rec(i + 1, sum + valueOf(nums[i]), chosen);
      chosen.pop();
    }
  })(0, 0, []);
  return out;
}

// Every legal group `card` could take from `table`. Each group is a list of card ids.
export function legalCaptures(card, table) {
  const r = rankOf(card);
  if (r === 'J') {
    const all = table.filter((c) => rankOf(c) !== 'Q' && rankOf(c) !== 'K');
    return all.length ? [all] : [];
  }
  if (r === 'Q' || r === 'K') {
    return table.filter((c) => rankOf(c) === r).map((c) => [c]);
  }
  return sumCombos(TARGET_SUM - valueOf(card), table);
}

export function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

export function isLegalCapture(card, table, take) {
  if (!take || !take.length) return true; // laying the card down is always allowed
  return legalCaptures(card, table).some((g) => sameSet(g, take));
}

// Table cards that take part in at least one legal group for `card` (for UI hints).
export function captureHints(card, table) {
  const set = new Set();
  for (const g of legalCaptures(card, table)) for (const c of g) set.add(c);
  return [...set];
}

// ---------- game state ----------

export function newGame({ players, targetScore = 11, dealer = 0, rand } = {}) {
  if (!players || players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    throw new Error('players must be 2 to 4');
  }
  const state = {
    players: players.map((p, i) => ({ seat: i, id: p.id || null, name: p.name || `Player ${i + 1}`, bot: !!p.bot, away: false })),
    n: players.length,
    targetScore,
    dealer: dealer % players.length,
    totals: players.map(() => 0),
    dealNo: 0,
    dealResults: [],
    phase: 'lobby', // 'deal' | 'deal_over' | 'game_over'
    winner: null,
    deal: null,
    version: 0,
  };
  startDeal(state, rand);
  return state;
}

export function startDeal(state, rand) {
  if (state.phase === 'game_over') throw new Error('game is over');
  if (state.dealNo > 0) state.dealer = (state.dealer + 1) % state.n;
  state.dealNo += 1;
  const deck = shuffle(fullDeck(), rand);
  // The four cards turned up on the table are never jacks: a jack that turns up
  // goes back into the deck at a random place and another card is turned instead.
  const r = rand || cryptoRandom;
  const table = [];
  while (table.length < TABLE_SIZE) {
    const c = deck.shift();
    if (rankOf(c) === 'J') deck.splice(Math.max(1, Math.floor(r() * (deck.length + 1))), 0, c);
    else table.push(c);
  }
  const deal = {
    deck,
    table,
    hands: state.players.map(() => []),
    captured: state.players.map(() => []),
    current: (state.dealer + 1) % state.n,
    turnStartedAt: Date.now(),
    lastCapturer: null,
    handRound: 0,
    log: [],
  };
  state.deal = deal;
  state.phase = 'deal';
  dealHands(state);
  state.version += 1;
  return state;
}

// The computer moves for bots and for humans who stepped away.
export function isComputerTurn(state) {
  if (state.phase !== 'deal') return false;
  const p = state.players[state.deal.current];
  return !!(p && (p.bot || p.away));
}

export function setAway(state, seat, away) {
  const p = state.players[seat];
  if (!p || p.bot) return;
  p.away = !!away;
  state.version += 1;
}

// A human takes over a bot's seat (late join) or returns to their own.
export function seatHuman(state, seat, { id, name }) {
  const p = state.players[seat];
  if (!p) throw new GameError('bad_seat', 'No such seat');
  p.id = id;
  p.name = name;
  p.bot = false;
  p.away = false;
  state.version += 1;
}

function dealHands(state) {
  const d = state.deal;
  d.handRound += 1;
  // Deal one card at a time starting left of the dealer, like at a real table.
  for (let k = 0; k < HAND_SIZE; k++) {
    for (let i = 0; i < state.n; i++) {
      const seat = (state.dealer + 1 + i) % state.n;
      if (d.deck.length) d.hands[seat].push(d.deck.shift());
    }
  }
  d.log.push({ type: 'deal', round: d.handRound, ts: Date.now() });
}

// Apply a move. `take` is the list of table card ids to capture (empty = lay down).
export function play(state, seat, card, take = []) {
  if (state.phase !== 'deal') throw new GameError('not_playing', 'No deal in progress');
  const d = state.deal;
  if (seat !== d.current) throw new GameError('not_your_turn', 'Not your turn');
  const hand = d.hands[seat];
  const hi = hand.indexOf(card);
  if (hi < 0) throw new GameError('card_not_in_hand', 'Card is not in your hand');
  take = (take || []).slice();
  for (const t of take) if (!d.table.includes(t)) throw new GameError('card_not_on_table', 'Card is not on the table');
  if (!isLegalCapture(card, d.table, take)) throw new GameError('illegal_capture', 'Those cards do not make eleven');

  hand.splice(hi, 1);
  const event = { type: 'play', seat, card, take, ts: Date.now() };
  if (take.length) {
    d.table = d.table.filter((c) => !take.includes(c));
    d.captured[seat].push(card, ...take);
    d.lastCapturer = seat;
    if (d.table.length === 0) event.sweep = true;
  } else {
    d.table.push(card);
  }
  d.log.push(event);
  if (d.log.length > 40) d.log.splice(0, d.log.length - 40);

  // Advance.
  const allEmpty = d.hands.every((h) => h.length === 0);
  if (allEmpty) {
    if (d.deck.length) {
      dealHands(state);
      d.current = (d.current + 1) % state.n;
    } else {
      finishDeal(state);
      state.version += 1;
      return event;
    }
  } else {
    d.current = (d.current + 1) % state.n;
    // Safety: skip anyone with no cards (cannot happen with equal hands, but keep it robust).
    let guard = 0;
    while (d.hands[d.current].length === 0 && guard++ < state.n) d.current = (d.current + 1) % state.n;
  }
  d.turnStartedAt = Date.now();
  state.version += 1;
  return event;
}

// True once the player on turn has used up their time.
export function turnExpired(state, now = Date.now()) {
  const d = state.deal;
  if (state.phase !== 'deal' || !d || d.turnStartedAt == null) return false;
  return now - d.turnStartedAt >= TURN_SECONDS * 1000;
}

function finishDeal(state) {
  const d = state.deal;
  let leftover = [];
  if (d.table.length) {
    leftover = d.table.splice(0);
    if (d.lastCapturer != null) d.captured[d.lastCapturer].push(...leftover);
  }
  const result = scoreDeal(d.captured);
  result.dealNo = state.dealNo;
  result.dealer = state.dealer;
  result.leftoverTo = d.lastCapturer;
  result.leftover = leftover;
  result.totalsBefore = state.totals.slice();
  state.totals = state.totals.map((t, i) => t + result.points[i]);
  result.totals = state.totals.slice();
  state.dealResults.push(result);
  d.log.push({ type: 'deal_over', ts: Date.now() });
  d.current = null;

  const max = Math.max(...state.totals);
  const leaders = state.totals.map((t, i) => (t === max ? i : -1)).filter((i) => i >= 0);
  if (max >= state.targetScore && leaders.length === 1) {
    state.phase = 'game_over';
    state.winner = leaders[0];
  } else {
    state.phase = 'deal_over';
  }
}

// Score one deal from each player's captured pile.
export function scoreDeal(captured) {
  const n = captured.length;
  const cards = captured.map((p) => p.length);
  const clubs = captured.map((p) => p.filter((c) => suitOf(c) === 'C').length);
  const tenD = captured.findIndex((p) => p.includes('10D'));
  const twoC = captured.findIndex((p) => p.includes('2C'));
  const points = new Array(n).fill(0);
  const reasons = captured.map(() => []);

  const soleMax = (arr) => {
    const m = Math.max(...arr);
    const who = arr.map((v, i) => (v === m ? i : -1)).filter((i) => i >= 0);
    return who.length === 1 && m > 0 ? who[0] : -1;
  };
  const mc = soleMax(cards);
  if (mc >= 0) { points[mc] += 2; reasons[mc].push('cards'); }
  const mk = soleMax(clubs);
  if (mk >= 0) { points[mk] += 1; reasons[mk].push('clubs'); }
  if (tenD >= 0) { points[tenD] += 1; reasons[tenD].push('tenD'); }
  if (twoC >= 0) { points[twoC] += 1; reasons[twoC].push('twoC'); }

  return { cards, clubs, tenD: tenD >= 0 ? tenD : null, twoC: twoC >= 0 ? twoC : null, mostCards: mc >= 0 ? mc : null, mostClubs: mk >= 0 ? mk : null, points, reasons };
}

// From the deal-over screen to the next deal.
export function nextDeal(state, rand) {
  if (state.phase !== 'deal_over') throw new GameError('not_deal_over', 'The deal is not over');
  return startDeal(state, rand);
}

// ---------- views ----------

// Everything a client may see: no deck order, no other hands, no pile contents.
export function publicView(state) {
  const d = state.deal;
  return {
    players: state.players,
    n: state.n,
    targetScore: state.targetScore,
    dealer: state.dealer,
    totals: state.totals,
    dealNo: state.dealNo,
    dealResults: state.dealResults,
    phase: state.phase,
    winner: state.winner,
    version: state.version,
    deal: d ? {
      table: d.table,
      handCounts: d.hands.map((h) => h.length),
      capturedCounts: d.captured.map((c) => c.length),
      current: d.current,
      turnStartedAt: d.turnStartedAt,
      lastCapturer: d.lastCapturer,
      deckCount: d.deck.length,
      handRound: d.handRound,
      log: d.log.slice(-12),
    } : null,
  };
}

export function handOf(state, seat) {
  return state.deal ? state.deal.hands[seat].slice() : [];
}

// ---------- bots ----------
//
// Three levels. All of them only look at what a person at the table could see:
// their own hand, the table, the piles already taken, and how many cards are
// left in the deck. Nobody peeks at the deck or at other hands.
//
//  easy    takes something about half the time, otherwise plays a random card
//  normal  always takes the most valuable group, lays down the safest card
//  hard    normal, plus memory of which cards are gone, the end of the deal,
//          and the standing in cards and clubs

export const BOT_LEVELS = ['easy', 'normal', 'hard'];

function groupWorth(card, group) {
  // What a capture is worth, in rough deal-points.
  const all = [card, ...group];
  let w = all.length * 0.35;                       // every card counts toward "most cards"
  w += all.filter((c) => suitOf(c) === 'C').length * 0.4;
  if (all.includes('10D')) w += 1.2;
  if (all.includes('2C')) w += 1.2;
  return w;
}

// Values v (1..10) for which some group on `table` plus `card` would sum to 11,
// i.e. what a single number card could take if `card` were laid down.
function exposedValues(card, table) {
  const nums = table.filter(isNumber).concat([card]);
  const out = [];
  for (let v = 1; v <= 10; v++) {
    if (sumCombos(TARGET_SUM - v, nums).some((g) => g.includes(card))) out.push(v);
  }
  return out;
}

function layDownCost(card, table) {
  // Lower is better. Avoid giving away points and avoid feeding easy elevens.
  const r = rankOf(card);
  let cost = 0;
  if (card === '10D' || card === '2C') cost += 5;
  if (suitOf(card) === 'C') cost += 1;
  if (r === 'J') cost += 6;                        // a furti should not be wasted
  if (r === 'Q' || r === 'K') cost += 0.2;         // only a matching picture can take it
  if (isNumber(card)) {
    cost += 0.6 + exposedValues(card, table).length * 0.15;
    cost += valueOf(card) * 0.02;                  // slight preference for small cards
  }
  return cost;
}

function pick(list, rand) { return list[Math.floor(rand() * list.length)]; }

function easyMove(state, seat, rand) {
  const d = state.deal;
  const hand = d.hands[seat];
  const captures = [];
  for (const card of hand) for (const group of legalCaptures(card, d.table)) captures.push({ card, take: group });
  if (captures.length && rand() < 0.55) return pick(captures, rand);
  return { card: pick(hand, rand), take: [] };
}

function normalMove(state, seat) {
  const d = state.deal;
  const hand = d.hands[seat];
  let best = null;
  for (const card of hand) {
    for (const group of legalCaptures(card, d.table)) {
      let w = groupWorth(card, group);
      if (rankOf(card) === 'J' && group.length < 3) w -= 1.5; // keep the furti for a fuller table
      if (!best || w > best.w) best = { card, take: group, w };
    }
  }
  if (best && best.w > 0.5) return { card: best.card, take: best.take };

  let lay = null;
  for (const card of hand) {
    const cost = layDownCost(card, d.table);
    if (!lay || cost < lay.cost) lay = { card, cost };
  }
  return { card: lay.card, take: [] };
}

function hardMove(state, seat) {
  const d = state.deal;
  const hand = d.hands[seat];
  const n = state.n;

  // Memory: what has already left circulation.
  const seen = new Set([...d.table, ...hand, ...d.captured.flat()]);
  const unseen = (r) => 4 - [...seen].filter((c) => rankOf(c) === r).length;
  const unseenValue = (v) => unseen(v === 1 ? 'A' : String(v));
  const jacksOut = unseen('J');

  // Standing in the two majority counts.
  const myCards = d.captured[seat].length;
  const bestOtherCards = Math.max(0, ...d.captured.map((p, i) => (i === seat ? -1 : p.length)));
  const myClubs = d.captured[seat].filter((c) => suitOf(c) === 'C').length;
  const bestOtherClubs = Math.max(0, ...d.captured.map((p, i) => (i === seat ? -1 : p.filter((c) => suitOf(c) === 'C').length)));
  const clubsLeft = 13 - d.captured.flat().filter((c) => suitOf(c) === 'C').length;
  const clubsDecided = myClubs > bestOtherClubs + clubsLeft || bestOtherClubs > myClubs + clubsLeft;

  const cardsLeftToPlay = d.hands.reduce((a, h) => a + h.length, 0) + d.deck.length;
  const lastRound = d.deck.length === 0;
  const myPlaysLeft = hand.length + Math.floor(d.deck.length / n);
  const endgame = lastRound && hand.length <= 2;

  let best = null;
  for (const card of hand) {
    for (const group of legalCaptures(card, d.table)) {
      const all = [card, ...group];
      let w = all.length * 0.4;
      if (!clubsDecided) w += all.filter((c) => suitOf(c) === 'C').length * 0.5;
      if (all.includes('10D')) w += 1.3;
      if (all.includes('2C')) w += 1.3;
      if (myCards <= bestOtherCards) w += all.length * 0.1;        // behind in cards: every card matters more
      if (endgame) w += 0.8 + d.table.length * 0.15;               // last taker also gets the leftovers
      if (rankOf(card) === 'J') {
        // The furti is worth holding for a fuller table, unless the deal is ending.
        if (group.length < 3 && !lastRound) w -= 1.6;
        if (jacksOut === 1) w += 0.3;                                 // nobody else can clear the table after this
      }
      if (!best || w > best.w) best = { card, take: group, w };
    }
  }
  if (best && best.w > (endgame ? 0.2 : 0.5)) return { card: best.card, take: best.take };

  let lay = null;
  for (const card of hand) {
    const r = rankOf(card);
    let cost = 0;
    if (card === '10D' || card === '2C') cost += 5;
    if (suitOf(card) === 'C' && !clubsDecided) cost += 1.2;
    if (r === 'J') cost += myPlaysLeft <= 1 ? 0 : 6;
    if (r === 'Q' || r === 'K') cost += 0.25 * unseen(r);           // safe once the other three are gone
    if (isNumber(card)) {
      // Danger = how many unseen single cards could take it, weighted by what they would get.
      let danger = 0;
      for (const v of exposedValues(card, d.table)) danger += unseenValue(v);
      cost += 0.3 + danger * 0.12 + valueOf(card) * 0.02;
      if (jacksOut > 0) cost += 0.1;                                 // anything on the table can be swept
    }
    if (cardsLeftToPlay <= n) cost *= 0.5;                           // the deal is ending, little to lose
    if (!lay || cost < lay.cost) lay = { card, cost };
  }
  return { card: lay.card, take: [] };
}

export function botMove(state, seat, level = 'normal', rand = Math.random) {
  if (level === 'easy') return easyMove(state, seat, rand);
  if (level === 'hard') return hardMove(state, seat);
  return normalMove(state, seat);
}

// ---------- errors ----------

export class GameError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
