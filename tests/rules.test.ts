import { describe, expect, it } from 'vitest';
import {
  applyMove, createGame, placementOverlap, resolveJanken, tiebreakWinner, validatePlacement,
  type GameState, type Hand,
} from '../src/core/rules';

/** 位置などを指定した局面を作る（テスト用） */
function setup(opts: {
  pos: [number, number];
  mines0?: number[]; // プレイヤー0が置いた地雷
  mines1?: number[]; // プレイヤー1が置いた地雷
  arrival?: [number, number];
}): GameState {
  const base = createGame(opts.mines0 ?? [1, 2, 4], opts.mines1 ?? [43, 44, 45]);
  return {
    ...base,
    mines: [new Set(opts.mines0 ?? [1, 2, 4]), new Set(opts.mines1 ?? [43, 44, 45])],
    pos: opts.pos,
    arrival: opts.arrival ?? [1, 2],
    seq: 2,
  };
}

describe('1-7 例1: 連鎖', () => {
  it('39段 相手の地雷{22,32,42} → グーで勝つと12段、相手の地雷は全部消える', () => {
    const s = setup({ pos: [39, 0], mines1: [22, 32, 42], mines0: [5, 6, 7] });
    const r = applyMove(s, 0, 3);
    expect(r.to).toBe(12);
    expect(r.blasts.map((b) => b.stage)).toEqual([42, 32, 22]);
    expect(r.state.pos[0]).toBe(12);
    expect(r.state.mines[1].size).toBe(0);
    expect([...r.state.exploded[0]].sort((a, b) => a - b)).toEqual([22, 32, 42]);
    expect(r.outcome).toBe('safe');
  });
});

describe('1-7 例2: 0段未満にならない', () => {
  it('8段 相手の地雷{11} → グーで11で爆発して1段', () => {
    const r = applyMove(setup({ pos: [8, 0], mines1: [11, 20, 30], mines0: [5, 6, 7] }), 0, 3);
    expect(r.to).toBe(1);
  });
  it('5段 相手の地雷{8} → グーで8で爆発して0段', () => {
    const r = applyMove(setup({ pos: [5, 0], mines1: [8, 20, 30], mines0: [15, 16, 17] }), 0, 3);
    expect(r.to).toBe(0);
    expect(r.blasts).toEqual([{ stage: 8, fellTo: 0 }]);
  });
});

describe('1-7 例3: 爆発した地雷は消える', () => {
  it('同じ段に2回目に止まっても爆発しない', () => {
    let s = setup({ pos: [5, 0], mines1: [8, 20, 30], mines0: [15, 16, 17] });
    s = applyMove(s, 0, 3).state; // 8で爆発 → 0
    expect(s.pos[0]).toBe(0);
    s = { ...s, pos: [2, 0] };
    const r = applyMove(s, 0, 6); // もう一度8に止まる
    expect(r.blasts).toEqual([]);
    expect(r.to).toBe(8);
    expect(r.outcome).toBe('safe');
  });
});

describe('1-7 例4: ミス（自分の地雷）', () => {
  it('罰なし、地雷は残り、相手に位置が公開される', () => {
    const s = setup({ pos: [3, 0], mines0: [9, 20, 30], mines1: [40, 41, 42] });
    const r = applyMove(s, 0, 6);
    expect(r.to).toBe(9);
    expect(r.outcome).toBe('miss');
    expect(r.state.mines[0].has(9)).toBe(true);
    expect(r.state.revealed[0].has(9)).toBe(true);
    expect(r.state.pos[0]).toBe(9);
  });
  it('通過しただけの段では何も起きない', () => {
    const s = setup({ pos: [3, 0], mines0: [6, 20, 30], mines1: [40, 41, 42] });
    const r = applyMove(s, 0, 6); // 9に着地（6は通過）
    expect(r.outcome).toBe('safe');
    expect(r.state.revealed[0].size).toBe(0);
  });
});

describe('1-7 例5: 連鎖の最終位置が自分の地雷', () => {
  it('1回の爆発で落ちた先が自分の地雷 → ミスとして公開', () => {
    // 39→42(相手の地雷で爆発)→32(自分の地雷) で止まる
    const s = setup({ pos: [39, 0], mines0: [32, 5, 6], mines1: [42, 20, 30] });
    const r = applyMove(s, 0, 3);
    expect(r.blasts.map((b) => b.stage)).toEqual([42]);
    expect(r.to).toBe(32);
    expect(r.outcome).toBe('miss');
    expect(r.state.revealed[0].has(32)).toBe(true);
    expect(r.state.mines[0].has(32)).toBe(true);
  });
  it('3回連鎖して最終位置が自分の地雷 → ミス公開', () => {
    const s = setup({ pos: [39, 0], mines0: [12, 6, 5], mines1: [22, 32, 42] });
    const r = applyMove(s, 0, 3);
    expect(r.blasts.map((b) => b.stage)).toEqual([42, 32, 22]);
    expect(r.to).toBe(12);
    expect(r.outcome).toBe('miss');
    expect(r.state.revealed[0].has(12)).toBe(true);
    expect(r.state.mines[0].has(12)).toBe(true);
  });
  it('爆発した段は公開されるが、自分の地雷として公開されるのは最終位置だけ', () => {
    const s = setup({ pos: [39, 0], mines0: [12, 6, 5], mines1: [22, 32, 42] });
    const r = applyMove(s, 0, 3);
    expect([...r.state.revealed[0]]).toEqual([12]);
    expect([...r.state.exploded[0]].sort((a, b) => a - b)).toEqual([22, 32, 42]);
  });
});

describe('1-7 例6: ゴール', () => {
  it('40段からチョキで勝つと46で勝利、地雷判定なし', () => {
    const s = setup({ pos: [40, 0], mines1: [41, 44, 45], mines0: [1, 2, 3] });
    const r = applyMove(s, 0, 6);
    expect(r.outcome).toBe('goal');
    expect(r.state.winner).toBe(0);
    expect(r.state.pos[0]).toBe(46);
    expect(r.blasts).toEqual([]);
  });
  it('通過（46を超える）でも勝利', () => {
    const r = applyMove(setup({ pos: [44, 0] }), 0, 6);
    expect(r.state.winner).toBe(0);
  });
  it('決着後は動けない', () => {
    const r = applyMove(setup({ pos: [44, 0] }), 0, 6);
    expect(() => applyMove(r.state, 1, 3)).toThrow();
    expect(() => resolveJanken(r.state, 'G', 'C')).toThrow();
  });
});

describe('1-7 例7: 同じ手によるあいこ5連続（原作の〈あいこルール〉）', () => {
  /** 手 h で n 回あいこにする */
  function tieN(s: GameState, n: number, h: Hand = 'G') {
    let cur = s;
    let last = resolveJanken(cur, h, h);
    cur = last.state;
    for (let i = 1; i < n; i++) {
      last = resolveJanken(cur, h, h);
      cur = last.state;
    }
    return last;
  }
  it('同じ手で4回まではただのあいこ', () => {
    const r = tieN(setup({ pos: [10, 20] }), 4);
    expect(r.kind).toBe('tie');
    expect(r.state.tieCount).toBe(4);
    expect(r.state.tieHand).toBe('G');
  });
  it('同じ手で5回目: ゴールに近いほうの勝ち（段数は勝った側が選ぶので、結果には含まない）', () => {
    const r = tieN(setup({ pos: [10, 20] }), 5, 'G');
    expect(r).toMatchObject({ kind: 'tiebreak', winner: 1, hand: 'G' });
    expect('steps' in r).toBe(false);
    const r2 = tieN(setup({ pos: [30, 20] }), 5, 'P');
    expect(r2).toMatchObject({ kind: 'tiebreak', winner: 0, hand: 'P' });
    expect(r2.state.tieCount).toBe(0);
    expect(r2.state.tieHand).toBeNull();
  });
  it('違う手のあいこを挟むと、回数は1から数え直し', () => {
    let s = setup({ pos: [10, 20] });
    for (let i = 0; i < 4; i++) s = resolveJanken(s, 'G', 'G').state; // グーで4回
    const r = resolveJanken(s, 'C', 'C'); // チョキのあいこ → 1回目
    expect(r).toMatchObject({ kind: 'tie' });
    expect(r.state.tieCount).toBe(1);
    expect(r.state.tieHand).toBe('C');
    // グーで合計8回あいこでも、連続していなければ決着しない
    let cur = r.state;
    for (let i = 0; i < 4; i++) {
      const x = resolveJanken(cur, 'G', 'G');
      expect(x.kind).toBe('tie');
      cur = x.state;
    }
    expect(cur.tieCount).toBe(4);
    expect(resolveJanken(cur, 'G', 'G')).toMatchObject({ kind: 'tiebreak', winner: 1, hand: 'G' });
  });
  it('同じ段なら先に着いていたほうの勝ち', () => {
    expect(tiebreakWinner(setup({ pos: [15, 15], arrival: [3, 7] }))).toBe(0);
    expect(tiebreakWinner(setup({ pos: [15, 15], arrival: [9, 7] }))).toBe(1);
    const r = tieN(setup({ pos: [15, 15], arrival: [9, 7] }), 5, 'C');
    expect(r).toMatchObject({ kind: 'tiebreak', winner: 1, hand: 'C' });
  });
  it('勝った側は3段か6段を選べる。グーのあいこでも6段を選べる', () => {
    const r = tieN(setup({ pos: [30, 20] }), 5, 'G');
    if (r.kind !== 'tiebreak') throw new Error();
    expect(applyMove(r.state, r.winner, 3).to).toBe(33);
    expect(applyMove(r.state, r.winner, 6).to).toBe(36);
  });
  it('決着後の移動は通常の勝ちと同じ扱い（地雷・連鎖・ミス）', () => {
    const s = setup({ pos: [30, 20], mines1: [36, 26, 16], mines0: [1, 2, 4] });
    const r = tieN(s, 5, 'C');
    if (r.kind !== 'tiebreak') throw new Error();
    const mv = applyMove(r.state, r.winner, 6); // 6段を選ぶ: 30→36 爆発 → 26 爆発 → 16 爆発 → 6
    expect(mv.blasts.map((b) => b.stage)).toEqual([36, 26, 16]);
    expect(mv.to).toBe(6);
    expect(mv.state.tieCount).toBe(0);
    expect(mv.state.tieHand).toBeNull();
  });
  it('じゃんけんで勝敗がついたらあいこ回数はリセットされる', () => {
    let s = setup({ pos: [10, 20] });
    s = resolveJanken(s, 'G', 'G').state;
    s = resolveJanken(s, 'G', 'G').state;
    const r = resolveJanken(s, 'G', 'C');
    expect(r).toMatchObject({ kind: 'win', winner: 0, steps: 3 });
    expect(r.state.tieCount).toBe(0);
    expect(r.state.tieHand).toBeNull();
  });
});

describe('1-7 例8: 開始直後のあいこ', () => {
  it('両者0段では、同じ手で5回を超えても続く', () => {
    let s = createGame([5, 6, 7], [10, 11, 12]);
    for (let i = 0; i < 20; i++) {
      const r = resolveJanken(s, 'P', 'P');
      expect(r.kind).toBe('tie');
      s = r.state;
    }
    expect(s.tieCount).toBe(20);
  });
  it('開始直後のあいこの後でも、勝敗がつけば普通に進む', () => {
    let s = createGame([5, 6, 7], [10, 11, 12]);
    for (let i = 0; i < 7; i++) s = resolveJanken(s, 'G', 'G').state;
    const r = resolveJanken(s, 'C', 'P');
    expect(r).toMatchObject({ kind: 'win', winner: 0, steps: 6 });
  });
  it('（案2）爆発で両者が0段になった場合も先着なしとして続く', () => {
    const s = setup({ pos: [0, 0], arrival: [5, 6] });
    expect(tiebreakWinner(s)).toBeNull();
    let cur = s;
    for (let i = 0; i < 9; i++) {
      const r = resolveJanken(cur, 'G', 'G');
      expect(r.kind).toBe('tie');
      cur = r.state;
    }
  });
  it('片方だけ0段なら、あいこ5回でもう片方が手番を取る', () => {
    const s = setup({ pos: [0, 3], arrival: [0, 1] });
    expect(tiebreakWinner(s)).toBe(1);
  });
});

describe('1-7 例9: 設置の重なり', () => {
  it('重なった段の番号だけが返る（昇順）', () => {
    expect(placementOverlap([30, 12, 5], [5, 40, 30])).toEqual([5, 30]);
    expect(placementOverlap([1, 2, 3], [4, 5, 6])).toEqual([]);
  });
  it('重なったまま対局は始められない', () => {
    expect(() => createGame([1, 2, 3], [3, 4, 5])).toThrow();
  });
  it('配置の妥当性', () => {
    expect(validatePlacement([1, 22, 45])).toBeNull();
    expect(validatePlacement([0, 22, 45])).toBe('range');
    expect(validatePlacement([1, 22, 46])).toBe('range');
    expect(validatePlacement([7, 7, 45])).toBe('duplicate');
    expect(validatePlacement([7, 8])).toBe('count');
    expect(validatePlacement([7, 8, 9, 10])).toBe('count');
  });
});

describe('公開情報（無事に止まった段）', () => {
  it('無事に止まった段が記録される。ミスの段は無事でもある', () => {
    const s = setup({ pos: [3, 0], mines0: [9, 20, 30], mines1: [40, 41, 42] });
    const r = applyMove(s, 0, 6);
    expect(r.state.safe[0].has(9)).toBe(true);
  });
  it('状態は不変（元の状態は変わらない）', () => {
    const s = setup({ pos: [39, 0], mines1: [22, 32, 42], mines0: [5, 6, 7] });
    applyMove(s, 0, 3);
    expect(s.mines[1].size).toBe(3);
    expect(s.pos[0]).toBe(39);
  });
});
