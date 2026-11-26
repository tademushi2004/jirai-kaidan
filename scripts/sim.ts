/**
 * AI同士を画面なしで大量に対戦させ、強さの順（つよい＞ふつう＞よわい）を数字で確かめる。
 *   npm run sim -- [1組あたりの局数=2000] [--declare]
 * 先手後手を半分ずつ入れ替え、シード固定で再現できる。--declare で宣言（ブラフ）のやり取りも入れる。
 * --check を付けると合否を判定し、満たさなければ終了コード1で終わる（CIで使う）:
 *   ・つよいはよわいに7割以上勝つ
 *   ・つよい＞ふつう、ふつう＞よわい（勝率の95%信頼区間の下限が50%を超える）
 */
import { createAI, LEVELS, type AI, type Level } from '../src/ai/ai';
import { makeRng } from '../src/ai/rng';
import { negotiatePlacement, playTurn } from '../src/core/match';
import type { Player } from '../src/core/rules';

function playGame(levels: [Level, Level], seed: number, declare: boolean): { winner: Player; turns: number } {
  const ais: [AI, AI] = [
    createAI(levels[0], 0, makeRng(seed * 2 + 1)),
    createAI(levels[1], 1, makeRng(seed * 2 + 2)),
  ];
  let { state } = negotiatePlacement(() => ais[0].choosePlacement(), () => ais[1].choosePlacement());
  let turns = 0;
  const players = {
    chooseHand: (s: typeof state, me: Player) => ais[me].chooseHand(s),
    chooseTiebreakSteps: (s: typeof state, me: Player) => ais[me].chooseTiebreakSteps(s),
  };
  while (state.winner === null) {
    if (declare) {
      for (const p of [0, 1] as const) {
        const d = ais[p].maybeDeclare(state);
        if (d) ais[p === 0 ? 1 : 0].hearDeclaration(d);
      }
    }
    state = playTurn(state, players).move.state;
    if (++turns > 5000) throw new Error('game too long');
  }
  return { winner: state.winner, turns };
}

/** 勝率の95%信頼区間（Wilson） */
function wilson(w: number, n: number): [number, number] {
  const z = 1.96;
  const p = w / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}

function versus(a: Level, b: Level, n: number, declare: boolean) {
  let wins = 0;
  let turns = 0;
  for (let i = 0; i < n; i++) {
    const aFirst = i % 2 === 0;
    const r = playGame(aFirst ? [a, b] : [b, a], 1000 + i, declare);
    if ((r.winner === 0) === aFirst) wins++;
    turns += r.turns;
  }
  const [lo, hi] = wilson(wins, n);
  return { wins, n, rate: wins / n, lo, hi, avgTurns: turns / n };
}

const args = process.argv.slice(2);
const declare = args.includes('--declare');
const check = args.includes('--check');
const n = Number(args.find((a) => /^\d+$/.test(a)) ?? 2000);
const names: Record<Level, string> = { weak: 'よわい', medium: 'ふつう', strong: 'つよい' };

console.log(`各組 ${n} 局（先手後手を半分ずつ）${declare ? ' / 宣言あり' : ' / 宣言なし'}`);
const t0 = Date.now();
const pairs: Array<[Level, Level]> = [['strong', 'weak'], ['strong', 'medium'], ['medium', 'weak']];
let failed = false;
for (const [a, b] of pairs) {
  const r = versus(a, b, n, declare);
  const ok = a === 'strong' && b === 'weak' ? r.rate >= 0.7 : r.lo > 0.5;
  if (check && !ok) failed = true;
  console.log(
    `${names[a]} vs ${names[b]}: ${names[a]}の勝率 ${(r.rate * 100).toFixed(1)}% ` +
      `[95%CI ${(r.lo * 100).toFixed(1)}–${(r.hi * 100).toFixed(1)}] (${r.wins}/${r.n}, 平均${r.avgTurns.toFixed(1)}ターン)${check ? (ok ? ' OK' : ' NG') : ''}`,
  );
}
console.log(`(${((Date.now() - t0) / 1000).toFixed(1)}秒)`);
void LEVELS;
if (failed) {
  console.error('強さの順（つよい＞ふつう＞よわい）が確認できませんでした');
  process.exit(1);
}
