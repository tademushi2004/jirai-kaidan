/**
 * プレイヤーが「公開情報だけで」知っていること（隠れた相手の地雷は使わない）。
 * 画面の表示（マーク・着地の警告）はすべてここから作る。
 */
import { GOAL, BLAST_DROP, other, type GameState, type Player } from './rules';

export interface Knowledge {
  /** 自分の（残っている）地雷 */
  ownMines: ReadonlySet<number>;
  /** 自分の地雷のうち、ミスで相手に位置が知られた段 */
  ownExposed: ReadonlySet<number>;
  /** 自分が爆発させた相手の地雷の段（もう消えている。相手の配置に含まれていたことが確定） */
  oppBlasted: ReadonlySet<number>;
  /** 相手のミスで位置が公開された、まだ残っている相手の地雷 */
  oppRevealed: ReadonlySet<number>;
  /** 自分が無事に止まった段（その時点で相手の地雷はないと分かった段） */
  safeLanded: ReadonlySet<number>;
}

export function knowledgeOf(state: GameState, me: Player): Knowledge {
  const opp = other(me);
  return {
    ownMines: state.mines[me],
    ownExposed: new Set([...state.revealed[me]].filter((s) => state.mines[me].has(s))),
    oppBlasted: state.exploded[me],
    oppRevealed: new Set([...state.revealed[opp]].filter((s) => !state.exploded[me].has(s))),
    safeLanded: state.safe[me],
  };
}

export interface KnownPreview {
  /** 手で止まる段（ゴールに届くなら 46 以上） */
  landed: number;
  goal: boolean;
  /** 公開済みの相手の地雷による連鎖の爆発（段の順）。隠れた地雷は含まない */
  blasts: number[];
  /** 公開情報だけで分かる範囲の最終位置 */
  to: number;
  /** 最終位置が自分の地雷（ミスになる） */
  ownMine: boolean;
  /** 最終位置に相手の地雷がないと分かっている */
  knownSafe: boolean;
}

/** steps 段進んで勝ったときに、公開情報だけで分かる着地の予測 */
export function previewKnown(state: GameState, me: Player, steps: number): KnownPreview {
  const k = knowledgeOf(state, me);
  const landed = state.pos[me] + steps;
  if (landed >= GOAL) return { landed, goal: true, blasts: [], to: GOAL, ownMine: false, knownSafe: true };
  const blasts: number[] = [];
  let q = landed;
  while (k.oppRevealed.has(q)) {
    blasts.push(q);
    q = Math.max(0, q - BLAST_DROP);
  }
  return {
    landed,
    goal: false,
    blasts,
    to: q,
    ownMine: k.ownMines.has(q),
    knownSafe: q === 0 || k.safeLanded.has(q) || k.oppBlasted.has(q),
  };
}
