/**
 * すごろく盤（6列×8段の蛇行）。0段目（スタート）は左下の2マス分、行ごとに折り返して上へ進み、46段目（ゴール）は左上。
 * スタートを2マス幅にして1マスずらすことで、3の倍数の段が、左右どちらに進む行でも2列目と5列目にそろう。
 * 高さは、各マスの下に描く「段」（平らな色の帯）の高さで表す。0段（スタート）が一番低く、46段（ゴール）が一番高い。
 * 横に並ぶマスでは段が少しずつ高くなって階段の形に見え、上の行ほど段が高いので縦にも高さが分かる。コマは段の上に立つ。
 * 3の倍数の段は、段を朱にして、それと分かるようにする。
 */
import { GOAL } from '../core/rules';
import { h } from './dom';

export const COLS = 6;
export const ROWS = 8;

export interface CellPos {
  /** CSSグリッドの行（1が一番上） */
  row: number;
  /** CSSグリッドの列（1が一番左） */
  col: number;
  span: number;
}

export function cellPos(n: number): CellPos {
  if (n < 0 || n > GOAL || !Number.isInteger(n)) throw new Error(`stage out of range: ${n}`);
  const idx = n === 0 ? 0 : n + 1; // 0段は0〜1番のマスを使う
  const r = Math.floor(idx / COLS);
  const k = idx % COLS;
  const c = r % 2 === 0 ? k : COLS - 1 - k;
  return { row: ROWS - r, col: c + 1, span: n === 0 ? 2 : 1 };
}

/** その段が「3段のまとまり」の何番目か（色を交互に変える） */
export const blockOf = (n: number) => (n === 0 ? 0 : Math.ceil(n / 3));

/** 段の高さ（マスの高さに対する%）。0段が一番低く、46段が一番高い */
export function stepHeight(n: number): number {
  if (n < 0 || n > GOAL) throw new Error(`stage out of range: ${n}`);
  return Math.round((8 + (n / GOAL) * 52) * 10) / 10;
}

export interface Board {
  el: HTMLElement;
  cell(n: number): HTMLElement;
  marks(n: number): HTMLElement;
  pieces(n: number): HTMLElement;
}

export function buildBoard(onCell?: (n: number) => void, clickable?: (n: number) => boolean): Board {
  const el = h('div', { class: 'board', role: 'grid', 'aria-label': '階段（すごろく盤）' });
  const cells = new Map<number, HTMLElement>();
  for (let n = 0; n <= GOAL; n++) {
    const p = cellPos(n);
    const m3 = n > 0 && n % 3 === 0;
    const can = !!onCell && (clickable ? clickable(n) : true);
    const cls = [
      'cell',
      m3 ? 'm3' : '',
      n === GOAL ? 'goal' : '',
      n === 0 ? 'start' : '',
      n % COLS === COLS - 2 && n < GOAL - 3 ? 'turn' : '', // 行の端: 上の行へ折り返す
      can ? 'tap' : '',
    ].filter(Boolean).join(' ');
    const c = h(
      can ? 'button' : 'div',
      {
        class: cls,
        role: 'gridcell',
        dataset: { stage: String(n) },
        style: `grid-row:${p.row};grid-column:${p.col} / span ${p.span};--step:${stepHeight(n)}%`,
        'aria-label': n === GOAL ? 'ゴール（46段目）' : `${n}段目`,
        onclick: can ? () => onCell?.(n) : undefined,
      },
      h('span', { class: 'num' }, n === GOAL ? 'ゴール' : String(n)),
      h('span', { class: 'marks' }),
      h('span', { class: 'pieces' }),
    );
    cells.set(n, c);
    el.append(c);
  }
  const get = (n: number) => cells.get(n) as HTMLElement;
  return {
    el,
    cell: get,
    marks: (n) => get(n).querySelector('.marks') as HTMLElement,
    pieces: (n) => get(n).querySelector('.pieces') as HTMLElement,
  };
}

/** 盤の下の「進み具合」の帯。左が0段、右がゴール。2人の位置を並べて見せる */
export function buildTrack(): { el: HTMLElement; set(me: number, ai: number): void } {
  const ticks: HTMLElement[] = [];
  for (let n = 3; n < GOAL; n += 3) ticks.push(h('i', { class: 'tick', style: `left:${(n / GOAL) * 100}%` }));
  const me = h('span', { class: 'tk me', 'aria-hidden': 'true' });
  const ai = h('span', { class: 'tk ai', 'aria-hidden': 'true' });
  const el = h('div', { class: 'track', 'aria-hidden': 'true' }, ...ticks, me, ai);
  return {
    el,
    set(a: number, b: number) {
      me.style.left = `${(a / GOAL) * 100}%`;
      ai.style.left = `${(b / GOAL) * 100}%`;
    },
  };
}

/** 2人の差の言い方 */
export function gapText(me: number, ai: number): string {
  if (me === ai) return '並んでいる';
  return me > ai ? `あなたが ${me - ai}段 先` : `AIが ${ai - me}段 先`;
}
