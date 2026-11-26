import { describe, expect, it } from 'vitest';
import { cellPos, gapText, stepHeight } from '../src/ui/board';
import { DESPAIR, PRAISE, pickLine } from '../src/ui/text';

describe('すごろく盤の配置', () => {
  it('0〜46段が重ならずに6列×8段に収まる（スタートは2マス分）', () => {
    const used = new Set<string>();
    for (let n = 0; n <= 46; n++) {
      const p = cellPos(n);
      for (let c = p.col; c < p.col + p.span; c++) {
        const key = `${p.row},${c}`;
        expect(used.has(key)).toBe(false);
        used.add(key);
        expect(c).toBeGreaterThanOrEqual(1);
        expect(c).toBeLessThanOrEqual(6);
      }
      expect(p.row).toBeGreaterThanOrEqual(1);
      expect(p.row).toBeLessThanOrEqual(8);
    }
    expect(used.size).toBe(48);
  });
  it('0段は左下（2マス分）、ゴールは左上', () => {
    expect(cellPos(0)).toEqual({ row: 8, col: 1, span: 2 });
    expect(cellPos(46)).toEqual({ row: 1, col: 1, span: 1 });
  });
  it('蛇行: 隣り合う段は必ず隣のマス（横か、行の端で真上）', () => {
    for (let n = 0; n < 45; n++) {
      const a = cellPos(n);
      const b = cellPos(n + 1);
      // 2マス分のマスは、近いほうの端で測る
      const ac = b.col > a.col ? a.col + a.span - 1 : a.col;
      const d = Math.abs(a.row - b.row) + Math.abs(ac - b.col);
      expect(d).toBe(1);
    }
  });
  it('3の倍数の段は、行の向きによらず2列目と5列目にそろう', () => {
    const cols = new Set<number>();
    for (let n = 3; n <= 45; n += 3) cols.add(cellPos(n).col);
    expect([...cols].sort()).toEqual([2, 5]);
  });
  it('段の高さは上に行くほど増え、スタートが一番低く、ゴールが一番高い', () => {
    for (let n = 0; n < 46; n++) expect(stepHeight(n + 1)).toBeGreaterThanOrEqual(stepHeight(n));
    const all = Array.from({ length: 47 }, (_, n) => stepHeight(n));
    expect(stepHeight(0)).toBe(Math.min(...all));
    expect(stepHeight(46)).toBe(Math.max(...all));
    expect(stepHeight(46) - stepHeight(0)).toBeGreaterThanOrEqual(45);
    expect(stepHeight(46)).toBeLessThanOrEqual(62); // 上に番号と印を書く余白を残す
    for (let n = 0; n < 46; n++) expect(stepHeight(n + 1)).toBeGreaterThan(stepHeight(n)); // 隣どうしでも必ず差がある
    // 同じ行の左右端でも、行が上がれば必ず厚くなる（蛇行しても高さが読み取れる）
    expect(stepHeight(12)).toBeGreaterThan(stepHeight(5));
  });
  it('範囲外はエラー', () => {
    expect(() => cellPos(47)).toThrow();
    expect(() => cellPos(-1)).toThrow();
  });
});

describe('表示の文言', () => {
  it('2人の差', () => {
    expect(gapText(10, 10)).toBe('並んでいる');
    expect(gapText(15, 9)).toBe('あなたが 6段 先');
    expect(gapText(9, 21)).toBe('AIが 12段 先');
  });
  it('褒め言葉・焦りは乱数の端でも返る', () => {
    for (const r of [0, 0.5, 0.9999999]) {
      expect(PRAISE).toContain(pickLine(PRAISE, r));
      expect(DESPAIR).toContain(pickLine(DESPAIR, r));
    }
  });
});
