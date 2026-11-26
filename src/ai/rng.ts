/** シード付き乱数（mulberry32）。テストと対戦結果を再現できるようにする */
export type Rng = () => number;

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randInt = (rng: Rng, n: number): number => Math.floor(rng() * n);

/** 重みに比例して添字を選ぶ */
export function pickWeighted(weights: readonly number[], rng: Rng): number {
  let total = 0;
  for (const w of weights) total += w;
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

/** lo〜hi（両端含む）から k 個を重複なしで選ぶ（昇順で返す） */
export function sampleDistinct(rng: Rng, lo: number, hi: number, k: number): number[] {
  const pool: number[] = [];
  for (let i = lo; i <= hi; i++) pool.push(i);
  const out: number[] = [];
  for (let i = 0; i < k; i++) out.push(pool.splice(randInt(rng, pool.length), 1)[0]);
  return out.sort((a, b) => a - b);
}
