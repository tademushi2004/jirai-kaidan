/**
 * 3×3 ゼロサム行列ゲームの解（行プレイヤーが最大化）。
 * 支持集合の列挙で解く（reference/hands.py の val3 と同じ考え方）。
 * 「保証できる値 v と、全列に対して v 以上を保証する混ぜ方 x」のうち v が最大のものが、ゲームの値と最適戦略。
 */
export type Mat3 = number[][];
export interface Solution {
  value: number;
  /** 行プレイヤー（最大化側）の最適な混ぜ方。合計1 */
  x: [number, number, number];
}

const EPS = 1e-9;

export function solveZeroSum3(M: Mat3): Solution {
  let best: Solution | null = null;

  const consider = (x: number[], v: number) => {
    for (let j = 0; j < 3; j++) {
      let col = 0;
      for (let i = 0; i < 3; i++) col += x[i] * M[i][j];
      if (col < v - 1e-9) return; // この混ぜ方では v を保証できない
    }
    if (best === null || v > best.value) {
      const c = x.map((e) => Math.max(0, e));
      const s = c[0] + c[1] + c[2];
      best = { value: v, x: [c[0] / s, c[1] / s, c[2] / s] };
    }
  };

  // 純粋戦略
  for (let i = 0; i < 3; i++) {
    const x = [0, 0, 0];
    x[i] = 1;
    consider(x, Math.min(M[i][0], M[i][1], M[i][2]));
  }

  // 2行の混合（2列で無差別になる点）
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      for (let k = 0; k < 3; k++) {
        for (let l = k + 1; l < 3; l++) {
          const den = M[i][k] - M[j][k] - (M[i][l] - M[j][l]);
          if (Math.abs(den) < 1e-12) continue;
          const xi = (M[j][l] - M[j][k]) / den;
          if (xi < -EPS || xi > 1 + EPS) continue;
          const t = Math.min(1, Math.max(0, xi));
          const x = [0, 0, 0];
          x[i] = t;
          x[j] = 1 - t;
          consider(x, t * M[i][k] + (1 - t) * M[j][k]);
        }
      }
    }
  }

  // 3行すべての混合（4元連立方程式: 各列で Σ x_i M[i][j] = v, Σ x_i = 1）
  const A = [
    [M[0][0], M[1][0], M[2][0], -1, 0],
    [M[0][1], M[1][1], M[2][1], -1, 0],
    [M[0][2], M[1][2], M[2][2], -1, 0],
    [1, 1, 1, 0, 1],
  ];
  if (gauss(A)) {
    const x = [A[0][4], A[1][4], A[2][4]];
    if (x.every((e) => e >= -EPS)) consider(x, A[3][4]);
  }

  // 純粋戦略は必ず候補になるので best は非 null
  return best as unknown as Solution;
}

/** 4×(4+1) の拡大係数行列をその場でガウスの消去法。特異なら false */
function gauss(A: number[][]): boolean {
  const n = 4;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return false;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k];
    }
  }
  for (let r = 0; r < n; r++) {
    const d = A[r][r];
    A[r][n] /= d;
    A[r][r] = 1;
  }
  return true;
}
