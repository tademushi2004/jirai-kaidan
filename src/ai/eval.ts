/**
 * 局面の評価（つよい・ふつうが使う）。
 * 自分が手 h で勝ったとき: 着地先に相手の地雷がある確率 p（信念）から連鎖を含む着地位置の分布を近似し（独立近似）、
 *   その位置での V0 の期待値を取る。
 * 相手が勝ったとき: 自分の地雷は正確に分かるので、連鎖を含めて正確に計算する。
 */
import { GOAL, HANDS, STEP_OF_HAND, beats, nextTieCount, other, tiebreakWinner, type GameState, type Hand, type Player } from '../core/rules';
import { v0 } from './v0';
import type { Mat3 } from './matrix';

export interface Ctx {
  pa: number; // 自分の位置
  pb: number; // 相手の位置
  t: number; // 同じ手のあいこが続いている回数
  tieHand: Hand | null; // 続いているあいこの手
  firstMe: boolean; // 同じ段のとき、自分が先着か
  myMines: ReadonlySet<number>;
  /** 相手の地雷が（残って）ある確率。添字は段 */
  p: ArrayLike<number>;
  tiebreak: 'me' | 'opp' | null;
}

export function makeCtx(state: GameState, me: Player, p: ArrayLike<number>): Ctx {
  const opp = other(me);
  const tb = tiebreakWinner(state);
  return {
    pa: state.pos[me],
    pb: state.pos[opp],
    t: state.tieCount,
    tieHand: state.tieHand,
    firstMe: state.arrival[me] < state.arrival[opp],
    myMines: state.mines[me],
    p,
    tiebreak: tb === null ? null : tb === me ? 'me' : 'opp',
  };
}

export interface ChainOutcome {
  q: number;
  prob: number;
  blasts: number;
}

/** 着地 L から、相手の地雷が確率 p[s] で独立にあるとしたときの連鎖後の最終位置の分布 */
export function chainDist(L: number, p: ArrayLike<number>): ChainOutcome[] {
  const out: ChainOutcome[] = [];
  let prob = 1;
  let q = L;
  let blasts = 0;
  for (;;) {
    if (q < 1) {
      out.push({ q: 0, prob, blasts });
      break;
    }
    const pm = p[q] ?? 0;
    if (pm < 1) out.push({ q, prob: prob * (1 - pm), blasts });
    if (pm <= 0) break;
    prob *= pm;
    blasts++;
    q = Math.max(0, q - 10);
  }
  return out;
}

/** 地雷の集合が分かっているときの連鎖 */
export function chainExact(L: number, mines: ReadonlySet<number>): { q: number; blasts: number } {
  let q = L;
  let blasts = 0;
  while (mines.has(q)) {
    blasts++;
    q = Math.max(0, q - 10);
  }
  return { q, blasts };
}

/** 自分が step 段進んで勝ったときの価値（自分の勝率） */
export function valueIMove(c: Ctx, step: number): number {
  const L = c.pa + step;
  if (L >= GOAL) return 1;
  let v = 0;
  for (const o of chainDist(L, c.p)) v += o.prob * v0(o.q, c.pb, 0, null, false);
  return v;
}

/** 相手が step 段進んで勝ったときの価値（自分の勝率） */
export function valueOppMoves(c: Ctx, step: number): number {
  const L = c.pb + step;
  if (L >= GOAL) return 0;
  const { q } = chainExact(L, c.myMines);
  return v0(c.pa, q, 0, null, true);
}

/**
 * 手 h であいこになったときの価値。原作どおり、同じ手のあいこだけが続けて数えられ、
 * 5回目になったら、ゴールに近い側の勝ちで、勝った側が3段か6段の好きなほうを選んで進む。
 */
export function tieValue(c: Ctx, h: Hand): number {
  if (c.pa === 0 && c.pb === 0) return 0.5;
  const t1 = nextTieCount({ tieCount: c.t, tieHand: c.tieHand }, h);
  if (t1 < 5) return v0(c.pa, c.pb, t1, h, c.firstMe);
  if (c.tiebreak === 'me') return Math.max(valueIMove(c, 3), valueIMove(c, 6));
  if (c.tiebreak === 'opp') return Math.min(valueOppMoves(c, 3), valueOppMoves(c, 6));
  return 0.5;
}

/** 3×3の勝敗表（行 = 自分の手 G/C/P、列 = 相手の手）。値は自分の勝率。対角（あいこ）は手ごとに違う */
export function buildMatrix(c: Ctx): Mat3 {
  const win = HANDS.map((h) => valueIMove(c, STEP_OF_HAND[h]));
  const lose = HANDS.map((h) => valueOppMoves(c, STEP_OF_HAND[h]));
  const tie = HANDS.map((h) => tieValue(c, h));
  return HANDS.map((a, i) =>
    HANDS.map((b, j) => (a === b ? tie[i] : beats(a, b) ? win[i] : lose[j])),
  );
}

/** 地雷を考えない評価用の文脈（ふつうが「地雷もゴールも絡まない」局面で使う） */
export function withoutMines(c: Ctx): Ctx {
  return { ...c, myMines: new Set(), p: new Float64Array(47) };
}
