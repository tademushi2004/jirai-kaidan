import { describe, expect, it } from 'vitest';
import { createAI, LEVELS } from '../src/ai/ai';
import { Belief, COMBO_COUNT } from '../src/ai/belief';
import { buildMatrix, chainDist, chainExact, makeCtx, valueIMove } from '../src/ai/eval';
import { solveZeroSum3 } from '../src/ai/matrix';
import { makeRng } from '../src/ai/rng';
import { negotiatePlacement, playTurn } from '../src/core/match';
import { createGame, validatePlacement, type GameState, type Player } from '../src/core/rules';

const sum = (a: ArrayLike<number>) => Array.from(a).reduce((s, x) => s + x, 0);

function setup(pos: [number, number], mines0: number[], mines1: number[]): GameState {
  return { ...createGame([1, 2, 4], [43, 44, 45]), pos, mines: [new Set(mines0), new Set(mines1)], arrival: [1, 2], seq: 2 };
}

describe('信念（相手の地雷の確率）', () => {
  it('候補は14190通り。自分の配置を除くと C(42,3)=11480 通り', () => {
    expect(COMBO_COUNT).toBe(14190);
    const b = new Belief();
    b.constrain([], [10, 20, 30]);
    expect(b.candidates).toBe(11480);
  });
  it('確率の合計は「残っている地雷の数」', () => {
    const b = new Belief();
    b.constrain([], [10, 20, 30]);
    expect(sum(b.marginals(new Set()))).toBeCloseTo(3, 9);
    b.constrain([42], [10, 20, 30]);
    const p = b.marginals(new Set([42]));
    expect(p[42]).toBe(0);
    expect(sum(p)).toBeCloseTo(2, 9);
  });
  it('無事に止まった段は確率0、公開された地雷は確率1', () => {
    const b = new Belief();
    b.constrain([33], [10, 20, 30, 12]);
    const p = b.marginals(new Set());
    expect(p[12]).toBe(0);
    expect(p[33]).toBeCloseTo(1, 9);
    expect(sum(p)).toBeCloseTo(3, 9);
  });
});

describe('評価', () => {
  it('連鎖の分布: 地雷がなければ着地、確率1の連鎖は最後まで落ちる', () => {
    expect(chainDist(30, new Float64Array(47))).toEqual([{ q: 30, prob: 1, blasts: 0 }]);
    const p = new Float64Array(47);
    p[42] = p[32] = p[22] = 1;
    expect(chainDist(42, p)).toEqual([{ q: 12, prob: 1, blasts: 3 }]);
    expect(chainExact(42, new Set([42, 32, 22]))).toEqual({ q: 12, blasts: 3 });
  });
  it('両者とも次に勝てばゴールなら、最適な混ぜ方は均等', () => {
    const s = setup([44, 44], [1, 2, 4], [43, 45, 40]);
    const c = makeCtx(s, 0, new Float64Array(47));
    const sol = solveZeroSum3(buildMatrix(c));
    sol.x.forEach((e) => expect(e).toBeCloseTo(1 / 3, 6));
    expect(sol.value).toBeGreaterThan(0.5); // 同じ段で先着の自分は、あいこ5回で手番を取れるぶん有利
    expect(sol.value).toBeLessThan(0.75);
  });
  it('相手がグーで勝つと自分の地雷に落ちるなら、つよいはグーを減らしチョキ中心にする', () => {
    // 相手 30段: グーで勝つと33 → 自分の地雷。自分 20段、地雷なしの局面
    const s = setup([20, 30], [33, 23, 13], [40, 41, 42]);
    const c = makeCtx(s, 0, new Float64Array(47));
    const x = solveZeroSum3(buildMatrix(c)).x;
    expect(x[1]).toBeGreaterThan(x[0]); // チョキ > グー
    expect(x[1]).toBeGreaterThan(0.4);
  });
});

describe('AIの振る舞い', () => {
  it('配置はどの強さでも妥当。ふつうは3の倍数を含み、つよいは10段おきの連鎖型', () => {
    for (const level of LEVELS) {
      const ai = createAI(level, 0, makeRng(3));
      for (let i = 0; i < 200; i++) {
        const m = ai.choosePlacement();
        expect(validatePlacement(m)).toBeNull();
        if (level === 'medium') expect(m.some((x) => x % 3 === 0)).toBe(true);
        if (level === 'strong') {
          expect(m[1] - m[0]).toBe(10);
          expect(m[2] - m[1]).toBe(10);
          expect(m[2] % 3).toBe(0);
        }
      }
    }
  });
  it('重なったら、重なった段だけが記録されて置き直しになる', () => {
    const first = [[1, 2, 3], [4, 5, 6]];
    const second = [[3, 9, 10], [20, 21, 22]];
    let i = 0;
    let j = 0;
    const r = negotiatePlacement(() => first[i++], () => second[j++]);
    expect(r.overlaps).toEqual([[3]]);
    expect(r.retries).toBe(1);
    expect([...r.state.mines[0]]).toEqual([4, 5, 6]);
    expect([...r.state.mines[1]]).toEqual([20, 21, 22]);
  });
  it('同じ強さ同士でも、配置が重なる限り置き直して最終的に決着する', () => {
    const a = createAI('strong', 0, makeRng(1));
    const b = createAI('strong', 1, makeRng(2));
    const r = negotiatePlacement(() => a.choosePlacement(), () => b.choosePlacement());
    expect(r.state.winner).toBeNull();
  });
  it('どの組み合わせでも1局が最後まで進み、同じシードなら同じ結果', () => {
    const run = (la: 'weak' | 'medium' | 'strong', lb: 'weak' | 'medium' | 'strong') => {
      const ais = [createAI(la, 0, makeRng(11)), createAI(lb, 1, makeRng(12))];
      let { state } = negotiatePlacement(() => ais[0].choosePlacement(), () => ais[1].choosePlacement());
      const pl = {
        chooseHand: (s: GameState, me: Player) => ais[me].chooseHand(s),
        chooseTiebreakSteps: (s: GameState, me: Player) => ais[me].chooseTiebreakSteps(s),
      };
      let n = 0;
      while (state.winner === null && n++ < 3000) state = playTurn(state, pl).move.state;
      return [state.winner, state.pos, n];
    };
    for (const a of LEVELS) for (const b of LEVELS) {
      const r1 = run(a, b);
      expect(r1[0]).not.toBeNull();
      expect(run(a, b)).toEqual(r1);
    }
  });
  it('よわい: 宣言された手を文字通り信じて、それに勝つ手を出す', () => {
    const ai = createAI('weak', 0, makeRng(5));
    const s = setup([10, 10], [1, 2, 4], [43, 44, 45]);
    ai.hearDeclaration({ kind: 'hand', hand: 'G' });
    expect(ai.chooseHand(s)).toBe('P');
    ai.hearDeclaration({ kind: 'hand', hand: 'C' });
    expect(ai.chooseHand(s)).toBe('G');
  });
  it('よわい: 宣言された段に着く手は避ける', () => {
    const ai = createAI('weak', 0, makeRng(5));
    const s = setup([10, 10], [1, 2, 4], [43, 44, 45]);
    ai.hearDeclaration({ kind: 'mine', stages: [13] }); // グー(+3)で13
    for (let i = 0; i < 200; i++) expect(ai.chooseHand(s)).not.toBe('G');
  });
  it('つよい: 宣言は無視する（宣言があってもなくても同じ手）', () => {
    const s = setup([20, 25], [1, 2, 4], [43, 44, 45]);
    const a = createAI('strong', 0, makeRng(9));
    const b = createAI('strong', 0, makeRng(9));
    b.hearDeclaration({ kind: 'hand', hand: 'G' });
    b.hearDeclaration({ kind: 'mine', stages: [23, 26] });
    for (let i = 0; i < 50; i++) expect(b.chooseHand(s)).toBe(a.chooseHand(s));
  });
  it('ふつう: 相手のグーが自分の地雷に落ちるなら、チョキを中心に出す', () => {
    const ai = createAI('medium', 0, makeRng(21));
    const s = setup([15, 30], [33, 12, 6], [40, 41, 42]);
    const count = { G: 0, C: 0, P: 0 };
    for (let i = 0; i < 1000; i++) count[ai.chooseHand(s)]++;
    expect(count.C).toBeGreaterThan(650);
    expect(count.P).toBeLessThan(100);
  });
  it('ふつう: 序盤の地雷なし局面は、グー4:チョキ4:パー2に近い', () => {
    const ai = createAI('medium', 0, makeRng(22));
    const s = setup([0, 3], [1, 2, 4], [43, 44, 45]);
    const count = { G: 0, C: 0, P: 0 };
    for (let i = 0; i < 4000; i++) count[ai.chooseHand(s)]++;
    // 公開情報から相手の地雷がほぼ一様なので、基準の混ぜ方に近い（地雷の期待値ぶんだけずれる）
    expect(count.G / 4000).toBeGreaterThan(0.3);
    expect(count.P / 4000).toBeLessThan(0.3);
  });
  it('あいこの価値は手ごとに違う: 同じ手で5回目になる手は、勝って3段か6段のよいほうを選べる価値になる', () => {
    // 自分 38段・相手 20段で、グーのあいこが4回続いている。グーでもう一度あいこなら、ゴールに近い自分の勝ちで3段か6段を選べる
    // チョキやパーのあいこなら1回目から数え直し
    const s: GameState = { ...setup([38, 20], [1, 2, 4], [43, 44, 45]), tieCount: 4, tieHand: 'G' };
    const c = makeCtx(s, 0, new Float64Array(47));
    const M = buildMatrix(c);
    expect(M[0][0]).toBeCloseTo(Math.max(valueIMove(c, 3), valueIMove(c, 6)), 9);
    expect(M[1][1]).not.toBeCloseTo(M[0][0], 3);
    // 44段（+6）に相手の地雷があると分かっていても、3段を選べるので価値は下がりにくい
    const p = new Float64Array(47);
    p[44] = 1;
    const c2 = makeCtx(s, 0, p);
    expect(buildMatrix(c2)[0][0]).toBeCloseTo(Math.max(valueIMove(c2, 3), valueIMove(c2, 6)), 9);
    expect(valueIMove(c2, 6)).toBeLessThan(valueIMove(c2, 3));
  });
  it('あいこ5回の段数: 6段先に位置の分かった相手の地雷があるなら、つよいは3段を選ぶ', () => {
    const ai = createAI('strong', 0, makeRng(1));
    const s = setup([20, 10], [1, 2, 4], [26, 40, 41]);
    const s2: GameState = { ...s, revealed: [new Set(), new Set([26])] };
    expect(ai.chooseTiebreakSteps(s2)).toBe(3);
    expect(ai.chooseTiebreakSteps({ ...s2, pos: [41, 10] })).toBe(6); // 6段でゴールなら6段
  });
  it('公開された相手の地雷（ミスで公開）は確率1として扱われる', () => {
    const b = new Belief();
    b.constrain([26], [1, 2, 4]);
    const p = b.marginals(new Set());
    expect(p[26]).toBeCloseTo(1, 9);
    const s = setup([20, 10], [1, 2, 4], [26, 40, 41]);
    const c = makeCtx(s, 0, p);
    expect(valueIMove(c, 6)).toBeLessThan(valueIMove(c, 3)); // 6段は26で爆発して16へ
  });
});
