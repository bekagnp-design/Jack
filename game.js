// თერთმეტობანა (ფურთი) — თამაშის ძრავი.
// მუშაობს როგორც ბრაუზერში (window.Tertmetobana), ისე Node-ში (module.exports).
//
// წესები, რომლითაც ძრავი მუშაობს:
//  - 52 კარტი, 2 მოთამაშე, თითოეულს 4 კარტი, მაგიდაზე 4 კარტი.
//  - რიცხვითი კარტი (A=1, 2..10) იღებს მაგიდიდან რიცხვით კარტებს,
//    თუ მათი ჯამი + ჩამოსული კარტი = 11.
//  - დამა იღებს დამას, კაროლი — კაროლს.
//  - ვალეტი („ფურთი") იღებს მაგიდიდან ყველაფერს, გარდა დამებისა და კაროლებისა.
//  - თუ აღება შეუძლებელია (ან არ გინდა), კარტი მაგიდაზე რჩება.
//  - ხელების დაცლისას ორივეს ურიგდება 4-4 დასტიდან. დასტის და ხელების
//    დაცლის შემდეგ მაგიდაზე დარჩენილს ბოლო ამღები იღებს.
//  - ქულა: რამდენი კარტი აიღე. (დაშვება — სხვა ქულათვლა წესებში არ იყო.)

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Tertmetobana = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const TARGET = 11;
  const HAND_SIZE = 4;
  const TABLE_SIZE = 4;

  function makeDeck() {
    const deck = [];
    for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
    return deck;
  }

  // დეტერმინისტული შემთხვევითობა, რომ თამაში seed-ით განმეორებადი იყოს.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(deck, rand) {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  function isNumeric(card) { return card.rank !== 'J' && card.rank !== 'Q' && card.rank !== 'K'; }
  function value(card) { return card.rank === 'A' ? 1 : parseInt(card.rank, 10); }
  function cardId(card) { return card.rank + card.suit; }

  function newGame(seed) {
    const rand = mulberry32(seed == null ? (Date.now() & 0xffffffff) : seed);
    const deck = shuffle(makeDeck(), rand);
    const state = {
      seed,
      deck,
      table: [],
      hands: [[], []],
      captured: [[], []],
      current: 0,
      lastCapturer: null,
      round: 0,
      over: false,
      log: [],
    };
    for (let i = 0; i < TABLE_SIZE; i++) state.table.push(deck.pop());
    dealHands(state);
    return state;
  }

  function dealHands(state) {
    state.round += 1;
    for (let i = 0; i < HAND_SIZE; i++) {
      for (const hand of state.hands) if (state.deck.length) hand.push(state.deck.pop());
    }
  }

  // ყველა ქვესიმრავლე, რომელიც ჩამოსულ კარტთან ერთად 11-ს აძლევს.
  function numericCombos(card, table) {
    const need = TARGET - value(card);
    const idx = [];
    table.forEach((c, i) => { if (isNumeric(c)) idx.push(i); });
    const out = [];
    (function rec(start, sum, chosen) {
      if (sum === need && chosen.length) { out.push(chosen.slice()); return; }
      if (sum >= need) return;
      for (let k = start; k < idx.length; k++) {
        chosen.push(idx[k]);
        rec(k + 1, sum + value(table[idx[k]]), chosen);
        chosen.pop();
      }
    })(0, 0, []);
    return out;
  }

  // აბრუნებს ყველა ლეგალურ აღებას: ინდექსების მასივების სიას.
  function legalCaptures(card, table) {
    if (card.rank === 'J') {
      const all = [];
      table.forEach((c, i) => { if (c.rank !== 'Q' && c.rank !== 'K') all.push(i); });
      return all.length ? [all] : [];
    }
    if (card.rank === 'Q' || card.rank === 'K') {
      const same = [];
      table.forEach((c, i) => { if (c.rank === card.rank) same.push(i); });
      return same.length ? [same] : [];
    }
    return numericCombos(card, table);
  }

  function sameSet(a, b) {
    if (a.length !== b.length) return false;
    const s = new Set(a);
    return b.every((x) => s.has(x));
  }

  function isLegalCapture(card, table, tableIdxs) {
    return legalCaptures(card, table).some((c) => sameSet(c, tableIdxs));
  }

  // სვლა: handIdx — კარტი ხელიდან, tableIdxs — რას იღებს (ცარიელი = მაგიდაზე დადება).
  function play(state, handIdx, tableIdxs) {
    if (state.over) throw new Error('თამაში დასრულებულია');
    const hand = state.hands[state.current];
    const card = hand[handIdx];
    if (!card) throw new Error('ასეთი კარტი ხელში არ არის');
    tableIdxs = (tableIdxs || []).slice();

    const entry = { player: state.current, card, captured: [] };
    if (tableIdxs.length) {
      if (!isLegalCapture(card, state.table, tableIdxs)) throw new Error('არასწორი აღება');
      const taken = tableIdxs.sort((a, b) => b - a).map((i) => state.table.splice(i, 1)[0]);
      state.captured[state.current].push(card, ...taken);
      state.lastCapturer = state.current;
      entry.captured = taken;
    } else {
      state.table.push(card);
    }
    hand.splice(handIdx, 1);
    state.log.push(entry);

    advance(state);
    return entry;
  }

  function advance(state) {
    const empty = state.hands.every((h) => h.length === 0);
    if (empty) {
      if (state.deck.length) {
        dealHands(state);
      } else {
        // დასასრული: დარჩენილი მაგიდა ბოლო ამღებს.
        const who = state.lastCapturer == null ? state.current : state.lastCapturer;
        state.captured[who].push(...state.table.splice(0));
        state.over = true;
        return;
      }
    }
    state.current = 1 - state.current;
    // თუ მომდევნოს ხელი ცარიელია, მაგრამ მეორეს არა (არ უნდა მოხდეს 4-4-ით, მაინც დაცული).
    if (!state.hands[state.current].length) state.current = 1 - state.current;
  }

  function scores(state) {
    return state.captured.map((c) => c.length);
  }

  // მარტივი კომპიუტერი: აიღე რაც შეიძლება მეტი კარტი; თუ არა, დადე ყველაზე პატარა რიცხვითი.
  function aiMove(state) {
    const hand = state.hands[state.current];
    let best = null;
    hand.forEach((card, hi) => {
      for (const combo of legalCaptures(card, state.table)) {
        const score = combo.length + (card.rank === 'J' ? 0.5 : 0);
        if (!best || score > best.score) best = { handIdx: hi, tableIdxs: combo, score };
      }
    });
    if (best) return { handIdx: best.handIdx, tableIdxs: best.tableIdxs };

    // დადება: ვერიდებით ვალეტს (ფურთი ძვირფასია), სხვებს შორის ყველაზე პატარა.
    let pick = 0;
    let pickScore = Infinity;
    hand.forEach((card, hi) => {
      const s = card.rank === 'J' ? 100 : isNumeric(card) ? value(card) : 50;
      if (s < pickScore) { pickScore = s; pick = hi; }
    });
    return { handIdx: pick, tableIdxs: [] };
  }

  return {
    SUITS, RANKS, TARGET, HAND_SIZE, TABLE_SIZE,
    newGame, play, legalCaptures, isLegalCapture, aiMove, scores,
    value, isNumeric, cardId,
  };
});
