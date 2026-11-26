/**
 * 1局を進める共通の流れ（AI対戦スクリプトと画面で同じ手順を使う）。
 * 配置 → 重なりがなくなるまで置き直し → じゃんけんを繰り返す。
 */
import {
  applyMove, createGame, other, placementOverlap, resolveJanken, validatePlacement,
  type GameState, type Hand, type MoveResult, type Player,
} from './rules';

/** 重なりがなくなるまで、置き直しを繰り返して対局の初期状態を作る */
export function negotiatePlacement(
  place0: () => number[],
  place1: () => number[],
  maxRounds = 10000,
): { state: GameState; retries: number; overlaps: number[][] } {
  const overlaps: number[][] = [];
  for (let i = 0; i < maxRounds; i++) {
    const a = place0();
    const b = place1();
    for (const m of [a, b]) {
      const e = validatePlacement(m);
      if (e) throw new Error(`invalid placement: ${e}`);
    }
    const overlap = placementOverlap(a, b);
    if (overlap.length === 0) return { state: createGame(a, b), retries: i, overlaps };
    overlaps.push(overlap);
  }
  throw new Error('placement never settled');
}

export interface Players {
  chooseHand(state: GameState, me: Player): Hand;
  /** 同じ手のあいこ5回で勝ったときに進む段数（3か6を選ぶ） */
  chooseTiebreakSteps(state: GameState, me: Player): 3 | 6;
}

/** 1ターン（勝敗がつくまで）を進める。あいこは内部で繰り返す */
export function playTurn(
  state: GameState,
  players: Players,
  maxTies = 10000,
): { move: MoveResult; hands: Array<[Hand, Hand]> } {
  const hands: Array<[Hand, Hand]> = [];
  let s = state;
  for (let i = 0; i < maxTies; i++) {
    const h0 = players.chooseHand(s, 0);
    const h1 = players.chooseHand(s, 1);
    hands.push([h0, h1]);
    const r = resolveJanken(s, h0, h1);
    if (r.kind === 'tie') {
      s = r.state;
      continue;
    }
    if (r.kind === 'win') return { move: applyMove(r.state, r.winner, r.steps), hands };
    // 同じ手のあいこ5回: 勝った側が3段か6段を選ぶ
    const steps = players.chooseTiebreakSteps(r.state, r.winner);
    return { move: applyMove(r.state, r.winner, steps), hands };
  }
  throw new Error('too many ties');
}

export { other };
