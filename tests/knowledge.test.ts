import { describe, expect, it } from 'vitest';
import { knowledgeOf, previewKnown } from '../src/core/knowledge';
import { applyMove, createGame, type GameState } from '../src/core/rules';
import { moveLines } from '../src/ui/text';

function setup(pos: [number, number], mines0: number[], mines1: number[]): GameState {
  return { ...createGame([1, 2, 4], [43, 44, 45]), pos, mines: [new Set(mines0), new Set(mines1)], arrival: [1, 2], seq: 2 };
}

describe('公開情報だけの知識', () => {
  it('隠れた相手の地雷は、着地の予測に含まれない', () => {
    const s = setup([20, 5], [1, 2, 4], [23, 33, 40]);
    const p = previewKnown(s, 0, 3); // 23に相手の地雷があるが、まだ公開されていない
    expect(p.to).toBe(23);
    expect(p.blasts).toEqual([]);
    expect(p.knownSafe).toBe(false);
  });
  it('ミスで公開された相手の地雷は、連鎖を含めて予測に使う', () => {
    let s = setup([20, 5], [1, 2, 4], [23, 13, 40]);
    s = { ...s, revealed: [new Set(), new Set([23, 13])] };
    const p = previewKnown(s, 0, 3);
    expect(p.blasts).toEqual([23, 13]);
    expect(p.to).toBe(3);
  });
  it('爆発させた段・無事に止まった段は安全と分かる。自分の地雷はミスと分かる', () => {
    const s0 = setup([3, 0], [9, 20, 30], [40, 41, 42]);
    const r = applyMove(s0, 0, 6); // 9: 自分の地雷でミス
    const p = previewKnown({ ...r.state, pos: [3, 0] }, 0, 6);
    expect(p.ownMine).toBe(true);
    expect(p.knownSafe).toBe(true); // 前に無事に止まった
    const k = knowledgeOf(r.state, 0);
    expect([...k.ownExposed]).toEqual([9]);
  });
  it('ゴールに届く手はゴール', () => {
    const p = previewKnown(setup([40, 0], [1, 2, 4], [43, 44, 45]), 0, 6);
    expect(p.goal).toBe(true);
  });
  it('相手のミスで公開された地雷を自分が爆発させたら、残っている公開地雷から消える', () => {
    let s = setup([20, 5], [1, 2, 4], [23, 33, 40]);
    s = { ...s, revealed: [new Set(), new Set([23])] };
    s = applyMove(s, 0, 3).state;
    const k = knowledgeOf(s, 0);
    expect(k.oppRevealed.size).toBe(0);
    expect([...k.oppBlasted]).toEqual([23]);
  });
});

describe('ログの文言', () => {
  it('爆発と自分のミスが分かる文になる', () => {
    const s = setup([39, 0], [12, 6, 5], [22, 32, 42]);
    const lines = moveLines(applyMove(s, 0, 3));
    expect(lines[0]).toContain('39段から3段進んで 42段へ');
    expect(lines.filter((l) => l.includes('爆発'))).toHaveLength(3);
    expect(lines[lines.length - 1]).toContain('自分の地雷を踏んだ');
  });
});
