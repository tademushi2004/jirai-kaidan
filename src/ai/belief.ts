/**
 * 相手の地雷の信念。
 * 相手の配置候補（1〜45から3つ、14190通り）のうち、公開情報と矛盾しないものだけを残し、
 * 各段に「相手の地雷が（残って）ある確率」を数える。
 */
import { MAX_MINE_STAGE } from '../core/rules';

const COMBO_A: number[] = [];
const COMBO_B: number[] = [];
const COMBO_C: number[] = [];
const COMBO_LO: number[] = [];
const COMBO_HI: number[] = [];

const bitLo = (s: number) => (s <= 30 ? 1 << (s - 1) : 0);
const bitHi = (s: number) => (s > 30 ? 1 << (s - 31) : 0);

for (let a = 1; a <= MAX_MINE_STAGE; a++) {
  for (let b = a + 1; b <= MAX_MINE_STAGE; b++) {
    for (let c = b + 1; c <= MAX_MINE_STAGE; c++) {
      COMBO_A.push(a);
      COMBO_B.push(b);
      COMBO_C.push(c);
      COMBO_LO.push(bitLo(a) | bitLo(b) | bitLo(c));
      COMBO_HI.push(bitHi(a) | bitHi(b) | bitHi(c));
    }
  }
}
export const COMBO_COUNT = COMBO_A.length; // 14190

function mask(stages: Iterable<number>): [number, number] {
  let lo = 0;
  let hi = 0;
  for (const s of stages) {
    lo |= bitLo(s);
    hi |= bitHi(s);
  }
  return [lo, hi];
}

export class Belief {
  private cand: Int32Array;
  private count: number;
  private key = '';
  private cache: Float64Array | null = null;
  private cacheExploded = '';
  private cacheWeightsVersion = -1;

  constructor() {
    this.cand = new Int32Array(COMBO_COUNT);
    for (let i = 0; i < COMBO_COUNT; i++) this.cand[i] = i;
    this.count = COMBO_COUNT;
  }

  /**
   * 公開情報で候補を絞る（情報は増える一方なので、今ある候補をさらに絞ればよい）。
   * @param forceIn 配置に必ず含まれる段（爆発させた段、相手のミスで公開された段）
   * @param forbid  配置に含まれない段（自分の配置、無事に止まった段）
   */
  constrain(forceIn: Iterable<number>, forbid: Iterable<number>): void {
    const [fl, fh] = mask(forceIn);
    const [bl, bh] = mask(forbid);
    const key = `${fl},${fh},${bl},${bh}`;
    if (key === this.key) return;
    this.key = key;
    let n = 0;
    for (let k = 0; k < this.count; k++) {
      const i = this.cand[k];
      if ((COMBO_LO[i] & fl) === fl && (COMBO_HI[i] & fh) === fh && (COMBO_LO[i] & bl) === 0 && (COMBO_HI[i] & bh) === 0) {
        this.cand[n++] = i;
      }
    }
    this.count = n;
    this.cache = null;
  }

  get candidates(): number {
    return this.count;
  }

  /**
   * 各段に相手の地雷が「残って」ある確率（爆発済みの段は0）。
   * weights を渡すと、配置の重み = 3つの段の重みの積（宣言の読みなどに使う）。
   */
  marginals(exploded: ReadonlySet<number>, weights?: Float64Array, weightsVersion = 0): Float64Array {
    const exKey = [...exploded].sort((a, b) => a - b).join(',');
    if (this.cache && this.cacheExploded === exKey && this.cacheWeightsVersion === weightsVersion) return this.cache;

    const acc = new Float64Array(MAX_MINE_STAGE + 1);
    let total = 0;
    const gone = new Uint8Array(MAX_MINE_STAGE + 1);
    for (const s of exploded) gone[s] = 1;
    for (let k = 0; k < this.count; k++) {
      const i = this.cand[k];
      const a = COMBO_A[i];
      const b = COMBO_B[i];
      const c = COMBO_C[i];
      const w = weights ? weights[a] * weights[b] * weights[c] : 1;
      total += w;
      if (!gone[a]) acc[a] += w;
      if (!gone[b]) acc[b] += w;
      if (!gone[c]) acc[c] += w;
    }
    if (total > 0) {
      for (let s = 0; s <= MAX_MINE_STAGE; s++) acc[s] /= total;
    } else {
      // 矛盾した情報（起こらないはず）: 一様にしておく
      for (let s = 1; s <= MAX_MINE_STAGE; s++) acc[s] = gone[s] ? 0 : 3 / MAX_MINE_STAGE;
    }
    this.cache = acc;
    this.cacheExploded = exKey;
    this.cacheWeightsVersion = weightsVersion;
    return acc;
  }
}
