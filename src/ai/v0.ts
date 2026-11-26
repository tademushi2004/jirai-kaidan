/**
 * 地雷なしのグリコの勝率表 V0。
 * v0(a, b, t, h, firstA): 自分(A)が a 段、相手(B)が b 段、手 h のあいこが t 回続いた状態での、Aの勝率。
 * 同じ段のときだけ firstA（Aが先着か）が意味を持つ。ゴールから逆算し、各状態で3×3ゼロサムゲームを解く。
 *
 * あいこは原作どおり「同じ手」の連続だけを数える。手 x であいこになると、続いていた手が x なら回数+1、違えば1に戻る。
 * 同じ手で5回目になったら、ゴールに近い側（同じ段なら先着）の勝ちで、勝った側が3段か6段の好きなほうを選んで進む。
 * 違う手のあいこで1回目に戻る経路があるので、同じ (a, b) の中であいこの状態どうしが循環する。
 * そのため、各 (a, b) で値が収束するまで繰り返し計算する（あいこの確率は1未満なので必ず収束する）。
 */
import { GOAL, HANDS, STEP_OF_HAND, type Hand } from '../core/rules';
import { solveZeroSum3 } from './matrix';

const N = GOAL; // 位置 0..45
/** あいこの状態の数: 0 = 続いていない、1〜12 = (回数1〜4) × (手3種) */
const K = 1 + 4 * 3;
const HAND_IDX: Record<Hand, number> = { G: 0, C: 1, P: 2 };
const kOf = (t: number, x: number) => (t === 0 ? 0 : 1 + (t - 1) * 3 + x);
const idx = (a: number, b: number, k: number, f: number) => ((a * N + b) * K + k) * 2 + f;

let table: Float32Array | null = null;

/** 表を作る（約1秒かかる。画面では Web Worker で先に作っておく） */
export function buildV0Table(): Float32Array {
  const V = new Float32Array(N * N * K * 2);
  const steps = HANDS.map((h) => STEP_OF_HAND[h]);
  const states: Array<[number, number]> = [[0, 0]];
  for (let t = 4; t >= 1; t--) for (let x = 0; x < 3; x++) states.push([t, x]); // 終わりに近い状態から更新すると速く収束する
  const M: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const cur = new Float64Array(K);

  // f: 0 = Aが先着, 1 = Bが先着
  const get = (a: number, b: number, f: number): number => {
    if (a >= GOAL) return 1;
    if (b >= GOAL) return 0;
    return V[idx(a, b, 0, f)];
  };

  for (let a = N - 1; a >= 0; a--) {
    for (let b = N - 1; b >= 0; b--) {
      if (a === 0 && b === 0) {
        // 開始直後（先着なし）はあいこが何回でも続く。対称なので 0.5
        for (let k = 0; k < K; k++) for (let f = 0; f < 2; f++) V[idx(0, 0, k, f)] = 0.5;
        continue;
      }
      const valA = (s: number) => get(a + s, b, a + s === b ? 1 : 0);
      const valB = (s: number) => get(a, b + s, 0);
      const winA = [valA(steps[0]), valA(steps[1]), valA(steps[2])];
      const winB = [valB(steps[0]), valB(steps[1]), valB(steps[2])];
      // 同じ手のあいこ5回の決着: 勝った側は3段と6段のよいほうを選ぶ
      const takeA = Math.max(valA(3), valA(6));
      const takeB = Math.min(valB(3), valB(6));
      for (let f = 0; f < 2; f++) {
        const aTakes = a > b || (a === b && f === 0); // 同じ手のあいこ5回で勝つのはA？
        cur.fill(0.5);
        for (let it = 0; it < 200; it++) {
          let delta = 0;
          for (const [t, h] of states) {
            for (let x = 0; x < 3; x++) {
              const t2 = t > 0 && h === x ? t + 1 : 1;
              const diag = t2 < 5 ? cur[kOf(t2, x)] : aTakes ? takeA : takeB;
              for (let y = 0; y < 3; y++) {
                if (x === y) M[x][y] = diag;
                else if (y === (x + 1) % 3) M[x][y] = winA[x]; // Aの手xがBの手yに勝つ
                else M[x][y] = winB[y];
              }
            }
            // 対角だけが手 x ごとに違う。行xの対角は M[x][x]
            const v = solveZeroSum3(M).value;
            const k = kOf(t, h);
            delta = Math.max(delta, Math.abs(v - cur[k]));
            cur[k] = v;
          }
          if (delta < 1e-7) break; // 表は Float32 で持つので、これより細かくしても意味がない
        }
        for (let k = 0; k < K; k++) V[idx(a, b, k, f)] = cur[k];
      }
    }
  }
  return V;
}

/**
 * @param t あいこが続いている回数（0〜4）
 * @param h 続いているあいこの手（t が0なら null）
 */
export function v0(a: number, b: number, t: number, h: Hand | null, firstA: boolean): number {
  if (a >= GOAL) return 1;
  if (b >= GOAL) return 0;
  if (table === null) table = buildV0Table();
  const k = t <= 0 || h === null ? 0 : kOf(Math.min(t, 4), HAND_IDX[h]);
  return table[idx(a, b, k, firstA ? 0 : 1)];
}

/** 起動直後に表を作っておく（最初の手で待たせないため） */
export function warmV0(): void {
  if (table === null) table = buildV0Table();
}

/** 別スレッドで作った表を受け取る */
export function setV0Table(t: Float32Array): void {
  if (table === null && t.length === N * N * K * 2) table = t;
}
