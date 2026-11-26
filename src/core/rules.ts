/**
 * 地雷かいだん ルール本体（画面から完全に独立した純粋関数）。
 * 仕様資料「1 ルール仕様」に対応。状態は不変（各関数は新しい状態を返す）。
 */

export const GOAL = 46;
export const MINE_COUNT = 3;
export const MIN_MINE_STAGE = 1;
export const MAX_MINE_STAGE = 45;
export const BLAST_DROP = 10;
export const TIE_LIMIT = 5;

export type Player = 0 | 1;
export type Hand = 'G' | 'C' | 'P'; // グー・チョキ・パー
export const HANDS: readonly Hand[] = ['G', 'C', 'P'];
export const STEP_OF_HAND: Record<Hand, 3 | 6> = { G: 3, C: 6, P: 6 };

export const other = (p: Player): Player => (p === 0 ? 1 : 0);

/** a が b に勝つか（グー>チョキ>パー>グー） */
export function beats(a: Hand, b: Hand): boolean {
  return (a === 'G' && b === 'C') || (a === 'C' && b === 'P') || (a === 'P' && b === 'G');
}

// ---------------------------------------------------------------- 地雷の設置

export type PlacementError = 'count' | 'range' | 'duplicate';

/** 1人分の配置の妥当性（1〜45に3個、同じ段に2個は不可） */
export function validatePlacement(mines: readonly number[]): PlacementError | null {
  if (mines.length !== MINE_COUNT) return 'count';
  if (mines.some((m) => !Number.isInteger(m) || m < MIN_MINE_STAGE || m > MAX_MINE_STAGE)) return 'range';
  if (new Set(mines).size !== mines.length) return 'duplicate';
  return null;
}

/** 両者の配置の重なり。重なった段の番号だけを昇順で返す（空なら確定） */
export function placementOverlap(a: readonly number[], b: readonly number[]): number[] {
  const sb = new Set(b);
  return [...new Set(a.filter((m) => sb.has(m)))].sort((x, y) => x - y);
}

// ---------------------------------------------------------------- 状態

export interface GameState {
  /** 現在位置 */
  pos: [number, number];
  /** 各自の「残っている」地雷（mines[p] は p が置いた地雷。相手が踏むと消える） */
  mines: [ReadonlySet<number>, ReadonlySet<number>];
  /** exploded[p]: p が踏んで爆発させた（=消えた）相手の地雷の段。両者に公開 */
  exploded: [ReadonlySet<number>, ReadonlySet<number>];
  /** revealed[p]: p が自分の地雷を踏んで（ミス）相手に位置が公開された、p の地雷の段 */
  revealed: [ReadonlySet<number>, ReadonlySet<number>];
  /** safe[p]: p が無事に止まった段（その時点で相手の地雷はないと分かった段）。両者に公開 */
  safe: [ReadonlySet<number>, ReadonlySet<number>];
  /** その段に着いた順序（大きいほど後）。まだ一度も動いていない側は 0 */
  arrival: [number, number];
  /** 着地の通し番号 */
  seq: number;
  /** 今のターンで「同じ手」によるあいこが続いている回数（0〜4。5で決着）。違う手のあいこなら1から数え直す */
  tieCount: number;
  /** 続いているあいこの手（tieCount が0なら null） */
  tieHand: Hand | null;
  winner: Player | null;
}

export function createGame(minesA: readonly number[], minesB: readonly number[]): GameState {
  for (const m of [minesA, minesB]) {
    const e = validatePlacement(m);
    if (e) throw new Error(`invalid placement: ${e}`);
  }
  if (placementOverlap(minesA, minesB).length > 0) throw new Error('placements overlap');
  return {
    pos: [0, 0],
    mines: [new Set(minesA), new Set(minesB)],
    exploded: [new Set(), new Set()],
    revealed: [new Set(), new Set()],
    safe: [new Set(), new Set()],
    arrival: [0, 0],
    seq: 0,
    tieCount: 0,
    tieHand: null,
    winner: null,
  };
}

// ---------------------------------------------------------------- 移動と地雷

export type MoveOutcome = 'goal' | 'safe' | 'miss';

export interface Blast {
  /** 爆発した段（相手の地雷があった段） */
  stage: number;
  /** 爆発で落ちた先 */
  fellTo: number;
}

export interface MoveResult {
  state: GameState;
  mover: Player;
  from: number;
  /** サイコロ（手）で止まった段。ゴール到達時は 46 を超えうる */
  landed: number;
  /** 連鎖の爆発（順番どおり） */
  blasts: Blast[];
  /** 最終位置 */
  to: number;
  outcome: MoveOutcome;
}

/**
 * mover が steps 段進む。着地→相手の地雷なら爆発して10段下がる（連鎖）→最終位置で自分の地雷ならミス公開。
 * 46段目に到達・通過したら地雷判定なしで即勝利。
 */
export function applyMove(state: GameState, mover: Player, steps: number): MoveResult {
  if (state.winner !== null) throw new Error('game already finished');
  const foe = other(mover);
  const from = state.pos[mover];
  const landed = from + steps;

  if (landed >= GOAL) {
    const pos: [number, number] = [state.pos[0], state.pos[1]];
    pos[mover] = GOAL;
    return {
      state: { ...state, pos, tieCount: 0, tieHand: null, winner: mover, seq: state.seq + 1 },
      mover, from, landed, blasts: [], to: GOAL, outcome: 'goal',
    };
  }

  const foeMines = new Set(state.mines[foe]);
  const exploded = new Set(state.exploded[mover]);
  const blasts: Blast[] = [];
  let q = landed;
  while (foeMines.has(q)) {
    foeMines.delete(q); // 爆発した地雷は消える
    exploded.add(q);
    const fellTo = Math.max(0, q - BLAST_DROP);
    blasts.push({ stage: q, fellTo });
    q = fellTo;
  }

  const ownMine = state.mines[mover].has(q);
  const safe = new Set(state.safe[mover]);
  if (q >= 1) safe.add(q); // 相手の地雷がない段に止まれた
  const revealed = new Set(state.revealed[mover]);
  if (ownMine) revealed.add(q); // ミス: 罰なし、地雷は残り、位置が公開される

  const pos: [number, number] = [state.pos[0], state.pos[1]];
  pos[mover] = q;
  const arrival: [number, number] = [state.arrival[0], state.arrival[1]];
  const seq = state.seq + 1;
  arrival[mover] = seq;

  const set = <T,>(pair: [T, T], v: T): [T, T] => (mover === 0 ? [v, pair[1]] : [pair[0], v]);
  const next: GameState = {
    ...state,
    pos,
    arrival,
    seq,
    tieCount: 0,
    tieHand: null,
    mines: foe === 0 ? [foeMines, state.mines[1]] : [state.mines[0], foeMines],
    exploded: set(state.exploded, exploded),
    safe: set(state.safe, safe),
    revealed: set(state.revealed, revealed),
  };
  return { state: next, mover, from, landed, blasts, to: q, outcome: ownMine ? 'miss' : 'safe' };
}

// ---------------------------------------------------------------- じゃんけんとあいこ

/**
 * 原作の〈あいこルール〉: 1ターン内で「同じ手」によるあいこが5回連続したら、
 * そのターンのじゃんけんは〝立っている位置がゴールに近いプレイヤー〟の勝ち。勝ったプレイヤーは三段か六段、好きなほうを選んで上れる。
 * 両者が同じ段なら、先に来ていたほうを〝ゴールに近い〟と見なす。
 * 両者0段（開始直後、または爆発で両者が0段に戻った場合）は先着がないので null（あいこを続ける）。
 */
export function tiebreakWinner(state: GameState): Player | null {
  const [a, b] = state.pos;
  if (a !== b) return a > b ? 0 : 1;
  if (a === 0) return null;
  return state.arrival[0] < state.arrival[1] ? 0 : 1;
}

/** 今のあいこの続き具合で、次に手 h であいこになったら何回目になるか */
export function nextTieCount(state: Pick<GameState, 'tieCount' | 'tieHand'>, h: Hand): number {
  return state.tieHand === h ? state.tieCount + 1 : 1;
}

export type JankenResult =
  | { kind: 'tie'; state: GameState }
  | { kind: 'win'; state: GameState; winner: Player; hand: Hand; steps: 3 | 6 }
  /** 同じ手のあいこ5回で決着。winner が3段か6段を選び、applyMove(state, winner, 選んだ段数) を呼ぶ。hand はあいこが続いた手（表示用） */
  | { kind: 'tiebreak'; state: GameState; winner: Player; hand: Hand };

/** 1回のじゃんけんを解決する。勝ちの場合の移動は applyMove で別途行う */
export function resolveJanken(state: GameState, h0: Hand, h1: Hand): JankenResult {
  if (state.winner !== null) throw new Error('game already finished');
  if (h0 === h1) {
    const tieCount = nextTieCount(state, h0);
    const next: GameState = { ...state, tieCount, tieHand: h0 };
    if (tieCount >= TIE_LIMIT) {
      const w = tiebreakWinner(state);
      if (w !== null) {
        return { kind: 'tiebreak', state: { ...next, tieCount: 0, tieHand: null }, winner: w, hand: h0 };
      }
    }
    return { kind: 'tie', state: next };
  }
  const winner: Player = beats(h0, h1) ? 0 : 1;
  const hand = winner === 0 ? h0 : h1;
  return { kind: 'win', state: { ...state, tieCount: 0, tieHand: null }, winner, hand, steps: STEP_OF_HAND[hand] };
}

// ---------------------------------------------------------------- 画面・AI 向けの補助

/** 手ごとの着地の予測（地雷判定込み）。状態は変えない */
export function previewMove(state: GameState, mover: Player, steps: number): MoveResult {
  return applyMove(state, mover, steps);
}

/** あいこで得をする側（ゴールに近い側。同じ段なら先着。両者0段なら null） */
export function tieFavored(state: GameState): Player | null {
  return tiebreakWinner(state);
}
