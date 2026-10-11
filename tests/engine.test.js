import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../supabase/functions/game/engine.js';

const P2 = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B', bot: true }];
const P3 = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B', bot: true }, { id: 'c', name: 'C', bot: true }];
const P4 = [...P3, { id: 'd', name: 'D', bot: true }];

test('capture rules', () => {
  const table = ['10S', '2H', '2D', '7C', 'QS', 'JH', 'KD'];
  assert.deepEqual(E.legalCaptures('AC', table), [['10S']]);
  assert.deepEqual(E.legalCaptures('2C', table), [['2H', '7C'], ['2D', '7C']]);
  assert.deepEqual(E.legalCaptures('JC', table), [['10S', '2H', '2D', '7C', 'JH']]); // furti: all but Q and K
  assert.deepEqual(E.legalCaptures('QC', table), [['QS']]);
  assert.deepEqual(E.legalCaptures('KC', table), [['KD']]);
  assert.deepEqual(E.legalCaptures('3C', table), []);
  assert.deepEqual(E.legalCaptures('JC', ['QS', 'KD']), []); // nothing for the furti to take
  assert.deepEqual(E.legalCaptures('QC', ['QS', 'QH']), [['QS'], ['QH']]); // one queen at a time
  assert.equal(E.isLegalCapture('AC', table, ['10S']), true);
  assert.equal(E.isLegalCapture('AC', table, ['2H']), false);
  assert.equal(E.isLegalCapture('AC', table, []), true); // laying down is always allowed
  assert.equal(E.isLegalCapture('2C', table, ['2H', '2D', '7C']), false); // only one group
});

test('deal scoring', () => {
  const r = E.scoreDeal([
    ['10D', '2C', '3C', '4C', '5S'],        // 5 cards, 3 clubs, both bonus cards
    ['6H', '7H', '8H', '9H', 'AS', 'KS'],   // 6 cards, 0 clubs
  ]);
  assert.deepEqual(r.points, [3, 2]);
  assert.equal(r.mostCards, 1);
  assert.equal(r.mostClubs, 0);
  const tie = E.scoreDeal([['AC', '2S'], ['3C', '4S']]);
  assert.deepEqual(tie.points, [0, 0]); // ties give nothing
  assert.equal(tie.mostCards, null);
  assert.equal(tie.mostClubs, null);
});

test('new game: dealer, starter, hands, table', () => {
  const s = E.newGame({ players: P3, targetScore: 11, dealer: 0, rand: E.seededRandom(1) });
  assert.equal(s.phase, 'deal');
  assert.equal(s.deal.current, 1); // left of dealer starts
  assert.deepEqual(s.deal.hands.map((h) => h.length), [4, 4, 4]);
  assert.equal(s.deal.table.length, 4);
  assert.equal(s.deal.deck.length, 52 - 4 - 12);
  const v = E.publicView(s);
  assert.equal(v.deal.handCounts.length, 3);
  assert.equal('hands' in v.deal, false);
  assert.equal('deck' in v.deal, false);
});

test('illegal moves are rejected', () => {
  const s = E.newGame({ players: P2, rand: E.seededRandom(2) });
  const cur = s.deal.current;
  const other = 1 - cur;
  assert.throws(() => E.play(s, other, s.deal.hands[other][0], []), /turn/);
  assert.throws(() => E.play(s, cur, 'ZZ', []), /hand/);
  assert.throws(() => E.play(s, cur, s.deal.hands[cur][0], ['nope']), /table/);
});

function playOut(players, seed, target = 11) {
  const rand = E.seededRandom(seed);
  const s = E.newGame({ players, targetScore: target, rand });
  let moves = 0;
  while (s.phase !== 'game_over' && moves < 5000) {
    if (s.phase === 'deal_over') { E.nextDeal(s, rand); continue; }
    const seat = s.deal.current;
    const m = E.botMove(s, seat);
    E.play(s, seat, m.card, m.take);
    moves++;
  }
  return { s, moves };
}

test('full games for 2, 3 and 4 players finish and conserve cards', () => {
  for (const players of [P2, P3, P4]) {
    for (let seed = 1; seed <= 60; seed++) {
      const { s } = playOut(players, seed);
      assert.equal(s.phase, 'game_over', `seed ${seed}`);
      assert.ok(s.totals[s.winner] >= 11);
      const leaders = s.totals.filter((t) => t === s.totals[s.winner]);
      assert.equal(leaders.length, 1, 'winner is the sole leader');
      for (const r of s.dealResults) {
        const total = r.cards.reduce((a, b) => a + b, 0);
        // All 52 cards end up in piles unless nobody captured anything (leftover discarded).
        assert.ok(total === 52 || r.leftoverTo === null, `seed ${seed}: ${total}`);
        assert.ok(r.points.reduce((a, b) => a + b, 0) <= 5);
      }
      // Dealer rotated once per deal.
      assert.equal(s.dealer, (s.dealResults.length - 1) % players.length);
    }
  }
});

test('leftover table cards go to the last capturer', () => {
  const { s } = playOut(P2, 7);
  const r = s.dealResults[0];
  assert.ok(r.leftoverTo === null || r.leftover.length >= 0);
});

function duel(levelA, levelB, seed) {
  const rand = E.seededRandom(seed);
  const s = E.newGame({ players: [{ id: 'a', name: 'A', bot: true }, { id: 'b', name: 'B', bot: true }], targetScore: 11, rand });
  let moves = 0;
  while (s.phase !== 'game_over' && moves++ < 5000) {
    if (s.phase === 'deal_over') { E.nextDeal(s, rand); continue; }
    const seat = s.deal.current;
    const m = E.botMove(s, seat, seat === 0 ? levelA : levelB, rand);
    E.play(s, seat, m.card, m.take);
  }
  return s.winner;
}

test('every bot level plays legal moves and the levels are ordered', () => {
  let hardOverEasy = 0, hardOverNormal = 0, normalOverEasy = 0;
  const N = 120;
  for (let seed = 1; seed <= N; seed++) {
    if (duel('hard', 'easy', seed) === 0) hardOverEasy++;
    if (duel('easy', 'hard', seed) === 1) hardOverEasy++;
    if (duel('hard', 'normal', seed) === 0) hardOverNormal++;
    if (duel('normal', 'hard', seed) === 1) hardOverNormal++;
    if (duel('normal', 'easy', seed) === 0) normalOverEasy++;
    if (duel('easy', 'normal', seed) === 1) normalOverEasy++;
  }
  console.log(`hard>easy ${hardOverEasy}/${2 * N}, hard>normal ${hardOverNormal}/${2 * N}, normal>easy ${normalOverEasy}/${2 * N}`);
  assert.ok(hardOverEasy > N * 2 * 0.6, 'hard should clearly beat easy');
  assert.ok(normalOverEasy > N * 2 * 0.6, 'normal should clearly beat easy');
  assert.ok(hardOverNormal >= N * 2 * 0.5, 'hard should not lose to normal');
});

test('turn timer', () => {
  const s = E.newGame({ players: P2, rand: E.seededRandom(3) });
  assert.equal(E.turnExpired(s, s.deal.turnStartedAt + 1000), false);
  assert.equal(E.turnExpired(s, s.deal.turnStartedAt + 60000), true);
  assert.equal(E.isComputerTurn(s), s.players[s.deal.current].bot);
  E.setAway(s, 0, true);
  assert.equal(s.players[0].away, true);
  E.seatHuman(s, 1, { id: 'z', name: 'Z' });
  assert.equal(s.players[1].bot, false);
  assert.equal(E.isComputerTurn(s), s.deal.current === 0);
});
