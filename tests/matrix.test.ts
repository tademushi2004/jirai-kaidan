import { describe, expect, it } from 'vitest';
import { solveZeroSum3 } from '../src/ai/matrix';
import { v0 } from '../src/ai/v0';
import { makeRng } from '../src/ai/rng';

/** 行プレイヤーの混ぜ方 x を固定したとき、列が選べる最悪値 */
const guarantee = (M: number[][], x: number[]) =>
  Math.min(...[0, 1, 2].map((j) => x[0] * M[0][j] + x[1] * M[1][j] + x[2] * M[2][j]));

describe('3×3 ゼロサムソルバー', () => {
  it('じゃんけん（0.5が基準）は 1/3ずつ、値 0.5', () => {
    const M = [[0.5, 1, 0], [0, 0.5, 1], [1, 0, 0.5]];
    const s = solveZeroSum3(M);
    expect(s.value).toBeCloseTo(0.5, 9);
    s.x.forEach((e) => expect(e).toBeCloseTo(1 / 3, 9));
  });
  it('優越戦略があれば純粋戦略', () => {
    const s = solveZeroSum3([[0.9, 0.8, 0.7], [0.1, 0.2, 0.3], [0.4, 0.4, 0.4]]);
    expect(s.value).toBeCloseTo(0.7, 9);
    expect(s.x[0]).toBeCloseTo(1, 9);
  });
  it('ランダム行列で、返した混ぜ方が値を保証し、他の混ぜ方（格子探索）より劣らない', () => {
    const rng = makeRng(7);
    for (let n = 0; n < 200; n++) {
      const M = [0, 1, 2].map(() => [0, 1, 2].map(() => rng()));
      const s = solveZeroSum3(M);
      expect(guarantee(M, s.x)).toBeGreaterThanOrEqual(s.value - 1e-7);
      let bestGrid = -Infinity;
      for (let i = 0; i <= 40; i++) {
        for (let j = 0; i + j <= 40; j++) {
          bestGrid = Math.max(bestGrid, guarantee(M, [i / 40, j / 40, (40 - i - j) / 40]));
        }
      }
      expect(s.value).toBeGreaterThanOrEqual(bestGrid - 1e-9);
      expect(s.value).toBeLessThanOrEqual(bestGrid + 0.02); // 格子の粗さ分
    }
  });
});

describe('V0（地雷なしの勝率表）', () => {
  it('開始局面は 0.5、ゴール圏は端点が 0/1', () => {
    expect(v0(0, 0, 0, null, true)).toBeCloseTo(0.5, 9);
    expect(v0(46, 10, 0, null, true)).toBe(1);
    expect(v0(10, 46, 0, null, true)).toBe(0);
  });
  it('対称性: V(a,b,あいこの状態,先着A) + V(b,a,同じ状態,先着B) = 1', () => {
    for (const [a, b] of [[3, 9], [20, 20], [30, 12], [44, 41], [45, 45], [40, 40]]) {
      expect(v0(a, b, 0, null, true) + v0(b, a, 0, null, false)).toBeCloseTo(1, 5);
      for (let t = 1; t < 5; t++) {
        for (const h of ['G', 'C', 'P'] as const) expect(v0(a, b, t, h, true) + v0(b, a, t, h, false)).toBeCloseTo(1, 5);
      }
    }
  });
  it('リードしているほうが有利。ゴール寸前は大きく有利', () => {
    expect(v0(30, 10, 0, null, true)).toBeGreaterThan(0.5);
    expect(v0(10, 30, 0, null, true)).toBeLessThan(0.5);
    expect(v0(45, 3, 0, null, true)).toBeGreaterThan(0.95);
  });
  it('同じ段のあいこ: 先着が有利（同じ手のあいこ5回目に近いほど効く）', () => {
    expect(v0(20, 20, 4, 'G', true)).toBeGreaterThan(v0(20, 20, 4, 'G', false));
    expect(v0(20, 20, 4, 'G', true)).toBeGreaterThan(0.5);
    expect(v0(20, 20, 4, 'G', true) - 0.5).toBeGreaterThan(v0(20, 20, 1, 'G', true) - 0.5);
  });
  it('同じ手のあいこが続くほど、決着で勝つ側（ゴールに近い側）に有利。手ごとに値が区別されている', () => {
    for (const h of ['G', 'C', 'P'] as const) {
      // 4回続いた状態は、1回の状態より有利（同じ手のあいこがもう1回で勝ちになる）
      expect(v0(40, 20, 4, h, true)).toBeGreaterThanOrEqual(v0(40, 20, 1, h, true) - 1e-6);
      expect(v0(20, 40, 4, h, false)).toBeLessThanOrEqual(v0(20, 40, 1, h, false) + 1e-6);
    }
    // 4回続いている手によって値が違う（手を区別している）
    const vals = (['G', 'C', 'P'] as const).map((h) => v0(40, 20, 4, h, true));
    expect(new Set(vals.map((v) => v.toFixed(4))).size).toBeGreaterThan(1);
  });
});
