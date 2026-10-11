// სწრაფი შემოწმება: node test.js
const G = require('./game.js');
const assert = require('assert');

// აღების წესები
const t = [{ rank: '10', suit: '♠' }, { rank: '2', suit: '♥' }, { rank: '2', suit: '♦' }, { rank: '7', suit: '♣' }, { rank: 'Q', suit: '♠' }];
assert.deepStrictEqual(G.legalCaptures({ rank: 'A', suit: '♣' }, t), [[0]]);            // A+10
assert.deepStrictEqual(G.legalCaptures({ rank: '2', suit: '♣' }, t), [[1, 3], [2, 3]]); // 2+(2+7), ორი ვარიანტი
assert.deepStrictEqual(G.legalCaptures({ rank: 'J', suit: '♣' }, t), [[0, 1, 2, 3]]);   // ფურთი, Q რჩება
assert.deepStrictEqual(G.legalCaptures({ rank: 'Q', suit: '♣' }, t), [[4]]);
assert.deepStrictEqual(G.legalCaptures({ rank: 'K', suit: '♣' }, t), []);
assert.deepStrictEqual(G.legalCaptures({ rank: '3', suit: '♣' }, t), []);

// სრული თამაში AI vs AI, 200 seed-ით: ყოველთვის სრულდება და 52 კარტი ნაწილდება.
for (let seed = 1; seed <= 200; seed++) {
  const s = G.newGame(seed);
  let guard = 0;
  while (!s.over && guard++ < 200) {
    const m = G.aiMove(s);
    G.play(s, m.handIdx, m.tableIdxs);
  }
  assert(s.over, 'seed ' + seed + ' არ დასრულდა');
  const [a, b] = G.scores(s);
  assert.strictEqual(a + b + s.table.length, 52, 'seed ' + seed + ' კარტები დაიკარგა');
  assert.strictEqual(s.table.length, 0);
}
console.log('ყველა ტესტი გავიდა');
