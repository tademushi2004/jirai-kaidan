/**
 * AI の3段階。画面からは createAI(level, me, rng) だけを使う。
 * - よわい: 地雷を考えない。プレイヤーの宣言を文字通り信じる。
 * - ふつう: 公開情報から相手の地雷を推理し、「最適な混ぜ方の原則」で手を選ぶ。宣言は信じる・裏を読む・無視を混ぜる。
 * - つよい: 毎回3×3のゼロサムゲームを解いて最適に混ぜる。相手の宣言は無視。
 */
import {
  GOAL, HANDS, STEP_OF_HAND, other,
  type GameState, type Hand, type Player,
} from '../core/rules';
import { Belief } from './belief';
import { buildMatrix, chainDist, chainExact, makeCtx, valueIMove, withoutMines } from './eval';
import { solveZeroSum3 } from './matrix';
import { pickWeighted, randInt, sampleDistinct, type Rng } from './rng';

export type Level = 'weak' | 'medium' | 'strong';
export const LEVELS: readonly Level[] = ['weak', 'medium', 'strong'];

export type Declaration =
  | { kind: 'mine'; stages: number[] } // 「〇段目と〇段目に仕掛けた」
  | { kind: 'hand'; hand: Hand }; // 「次は〇〇を出す」

export interface AI {
  readonly level: Level;
  readonly me: Player;
  /** 地雷の配置（1〜45から3個）。重なったときは、もう一度呼んで置き直す */
  choosePlacement(): number[];
  /** 相手（プレイヤー）の宣言を聞く */
  hearDeclaration(d: Declaration): void;
  chooseHand(state: GameState): Hand;
  /** 同じ手のあいこ5回で勝ったときに進む段数（原作どおり3段か6段を選べる） */
  chooseTiebreakSteps(state: GameState): 3 | 6;
  /** ターンの最初に、ときどき宣言する（ブラフを含む） */
  maybeDeclare(state: GameState): Declaration | null;
}

/** その手に勝つ手 */
const COUNTER: Record<Hand, Hand> = { G: 'P', C: 'G', P: 'C' };
const HAND_INDEX: Record<Hand, number> = { G: 0, C: 1, P: 2 };

// ふつうが使う混ぜ方の表（仕様2章の原則）。順に [グー, チョキ, パー]
const BASE = [0.4, 0.4, 0.2];
const MY_G_CHAIN = [
  BASE, // 連鎖なし
  [0.65, 0.3, 0.05], // 10段だけ
  [0.4, 0.5, 0.1], // 20段
  [0.175, 0.7, 0.125], // 30段
];
const OPP_G_POISONED = [0.2, 0.775, 0.025]; // 相手がグーで勝つと自分の地雷に落ちる

const CHAIN_TRIPLES = [10, 13, 16, 19, 22, 25].map((a) => [a, a + 10, a + 20]); // 先頭が3の倍数の連鎖型

function pickHand(mix: readonly number[], rng: Rng): Hand {
  return HANDS[pickWeighted(mix, rng)];
}

function blend(a: readonly number[], b: readonly number[], lambda: number): number[] {
  return a.map((x, i) => (1 - lambda) * x + lambda * b[i]);
}

function oneHot(h: Hand): number[] {
  const v = [0, 0, 0];
  v[HAND_INDEX[h]] = 1;
  return v;
}

function hasMultipleOf3(ms: readonly number[]): boolean {
  return ms.some((m) => m % 3 === 0);
}

/** 相手が公開情報から矛盾しない範囲で、地雷の確率を更新する */
function updateBelief(belief: Belief, state: GameState, me: Player): void {
  const opp = other(me);
  const ownOriginal = [...state.mines[me], ...state.exploded[opp]];
  const forceIn = [...state.exploded[me], ...state.revealed[opp]];
  const safeNotBlasted = [...state.safe[me]].filter((s) => !state.exploded[me].has(s));
  belief.constrain(forceIn, [...ownOriginal, ...safeNotBlasted]);
}

export function createAI(level: Level, me: Player, rng: Rng): AI {
  const belief = new Belief();
  const weights = new Float64Array(46).fill(1); // ふつうが宣言の読みで使う
  let weightsVersion = 0;
  const declaredMines = new Set<number>(); // よわいが信じた宣言
  let declaredHand: Hand | null = null;
  let handTarget: { hand: Hand; lambda: number } | null = null; // ふつうの宣言の読み

  const activeDeclared = (state: GameState) =>
    [...declaredMines].filter((s) => !state.exploded[me].has(s) && !state.safe[me].has(s));

  function beliefP(state: GameState): Float64Array {
    updateBelief(belief, state, me);
    return belief.marginals(state.exploded[me], level === 'medium' ? weights : undefined, weightsVersion);
  }

  // ---------------------------------------------------------------- 配置
  function placementWeak(): number[] {
    return sampleDistinct(rng, 1, 45, 3);
  }

  function placementMedium(): number[] {
    for (let tries = 0; tries < 50; tries++) {
      const r = rng();
      let m: number[];
      if (r < 0.5) {
        const a = 1 + randInt(rng, 25);
        m = [a, a + 10, a + 20]; // 連鎖型
      } else if (r < 0.75) {
        const k = 1 + randInt(rng, 14);
        const wall = [3 * k, 3 * k + 3]; // 壁型（3の倍数を2つ連続）
        let third = 1 + randInt(rng, 45);
        while (wall.includes(third)) third = 1 + randInt(rng, 45);
        m = [...wall, third];
      } else {
        m = sampleDistinct(rng, 1, 45, 3);
      }
      if (hasMultipleOf3(m)) return m.sort((a, b) => a - b);
    }
    return [12, 22, 32];
  }

  function placementStrong(): number[] {
    return [...CHAIN_TRIPLES[randInt(rng, CHAIN_TRIPLES.length)]];
  }

  // ---------------------------------------------------------------- 手
  function mixMedium(state: GameState): number[] {
    const c = makeCtx(state, me, beliefP(state));
    // ゴールが絡む局面は、地雷なしの勝率表から混ぜ方を解く
    if (Math.max(c.pa, c.pb) >= 34) {
      return [...solveZeroSum3(buildMatrix(withoutMines(c))).x];
    }
    // 相手がグーで勝つと自分の地雷に落ちる？
    const oppG = c.pb + STEP_OF_HAND.G;
    const poisoned = oppG < GOAL && chainExact(oppG, c.myMines).blasts >= 1;
    // 自分がグーで勝つと相手の地雷に落ちる？（連鎖の長さの分布で混ぜる）
    let mixMyG = BASE;
    if (c.pa + STEP_OF_HAND.G < GOAL) {
      mixMyG = [0, 0, 0];
      for (const o of chainDist(c.pa + STEP_OF_HAND.G, c.p)) {
        const tbl = MY_G_CHAIN[Math.min(o.blasts, 3)];
        for (let i = 0; i < 3; i++) mixMyG[i] += o.prob * tbl[i];
      }
    }
    return poisoned ? blend(mixMyG, OPP_G_POISONED, 0.65) : mixMyG;
  }

  function chooseHand(state: GameState): Hand {
    if (level === 'weak') {
      if (declaredHand) {
        const target = COUNTER[declaredHand]; // 宣言を文字通り信じて、その手に勝つ手を出す
        declaredHand = null;
        return target;
      }
      const pos = state.pos[me];
      const avoid = new Set(activeDeclared(state));
      const w = HANDS.map((h, i) => (avoid.has(pos + STEP_OF_HAND[h]) ? 0 : BASE[i]));
      return pickHand(w.some((x) => x > 0) ? w : BASE, rng);
    }
    if (level === 'medium') {
      let mix = mixMedium(state);
      if (handTarget) {
        mix = blend(mix, oneHot(handTarget.hand), handTarget.lambda);
        handTarget = null;
      }
      return pickHand(mix, rng);
    }
    const c = makeCtx(state, me, beliefP(state));
    return pickHand(solveZeroSum3(buildMatrix(c)).x, rng);
  }

  /**
   * 同じ手のあいこ5回で勝ったときの段数。
   * よわい: 宣言された段を避ける（なければ6段）。ふつう: 爆発しそうなほうを避ける。つよい: 勝率が高いほう。
   */
  function chooseTiebreakSteps(state: GameState): 3 | 6 {
    const pos = state.pos[me];
    if (pos + 6 >= GOAL) return 6;
    if (pos + 3 >= GOAL) return 3;
    if (level === 'weak') return activeDeclared(state).includes(pos + 6) ? 3 : 6;
    const p = beliefP(state);
    if (level === 'medium') {
      const blasts = (step: number) => chainDist(pos + step, p).reduce((s, o) => s + o.prob * o.blasts, 0);
      return blasts(3) + 0.05 < blasts(6) ? 3 : 6;
    }
    const c = makeCtx(state, me, p);
    return valueIMove(c, 3) > valueIMove(c, 6) + 1e-9 ? 3 : 6;
  }

  // ---------------------------------------------------------------- 宣言
  function hearDeclaration(d: Declaration): void {
    if (level === 'strong') return; // 理詰めでは無視
    if (level === 'weak') {
      if (d.kind === 'mine') d.stages.forEach((s) => declaredMines.add(s));
      else declaredHand = d.hand;
      return;
    }
    const r = rng(); // ふつう: 信じる 4割 / 裏を読む 2.5割 / 無視 3.5割
    if (d.kind === 'mine') {
      if (r < 0.4) d.stages.forEach((s) => (weights[s] *= 3));
      else if (r < 0.65) d.stages.forEach((s) => (weights[s] *= 0.35));
      weightsVersion++;
    } else if (r < 0.4) {
      handTarget = { hand: COUNTER[d.hand], lambda: 0.5 };
    } else if (r < 0.65) {
      handTarget = { hand: d.hand, lambda: 0.35 }; // 「罠だ」と読んで、宣言された手そのものを出す
    }
  }

  function maybeDeclare(state: GameState): Declaration | null {
    if (state.tieCount > 0) return null;
    const mine = [...state.mines[me]];
    const notMine = (): number => {
      let s = 1 + randInt(rng, 45);
      while (state.mines[me].has(s)) s = 1 + randInt(rng, 45);
      return s;
    };
    if (level === 'weak') {
      // たまに正直なことを言う
      return rng() < 0.08 && mine.length ? { kind: 'mine', stages: [mine[randInt(rng, mine.length)]] } : null;
    }
    if (rng() >= 0.25) return null;
    if (rng() < 0.5) {
      const n = 1 + randInt(rng, 2);
      const stages: number[] = [];
      for (let i = 0; i < n; i++) {
        // ふつうは半分本当、つよいはブラフ（本当の配置は言わない）
        const real = level === 'medium' && mine.length > 0 && rng() < 0.5;
        const s = real ? mine[randInt(rng, mine.length)] : notMine();
        if (!stages.includes(s)) stages.push(s);
      }
      return { kind: 'mine', stages: stages.sort((a, b) => a - b) };
    }
    return { kind: 'hand', hand: HANDS[randInt(rng, 3)] };
  }

  return {
    level,
    me,
    choosePlacement: () => (level === 'weak' ? placementWeak() : level === 'medium' ? placementMedium() : placementStrong()),
    hearDeclaration,
    chooseHand,
    chooseTiebreakSteps,
    maybeDeclare,
  };
}
