/** 画面の振動・点滅・端末の振動。reduce が true のときは何もしない */

/** 要素を揺らす。strength は 1〜6（連鎖が進むほど強くする） */
export function shake(el: HTMLElement, strength: number, reduce: boolean): void {
  if (reduce || typeof el.animate !== 'function') return;
  const s = Math.max(1, Math.min(6, strength));
  const amp = 3 + s * 3; // px
  const n = 9;
  const frames: Keyframe[] = [];
  for (let i = 0; i <= n; i++) {
    const decay = 1 - i / n;
    const x = i === n ? 0 : (Math.random() * 2 - 1) * amp * decay;
    const y = i === n ? 0 : (Math.random() * 2 - 1) * amp * decay;
    frames.push({ transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)` });
  }
  el.animate(frames, { duration: 240 + s * 60, easing: 'ease-out' });
}

/** 画面全体を一瞬光らせる */
export function flash(host: HTMLElement, strength: number, reduce: boolean, color = '#ffb347'): void {
  if (reduce || typeof host.animate !== 'function') return;
  const v = document.createElement('div');
  v.className = 'flash';
  v.style.background = color;
  host.append(v);
  const a = v.animate([{ opacity: Math.min(0.55, 0.2 + strength * 0.07) }, { opacity: 0 }], { duration: 280 });
  a.onfinish = () => v.remove();
}

/** 端末の振動（対応している端末だけ） */
export function vibrate(strength: number, reduce: boolean): void {
  if (reduce) return;
  try {
    navigator.vibrate?.(25 + strength * 25);
  } catch {
    /* 非対応 */
  }
}

/** 要素を一瞬光らせる（爆発した段など） */
export function pulse(el: HTMLElement, color: string, reduce: boolean): void {
  if (reduce || typeof el.animate !== 'function') return;
  el.animate([{ boxShadow: `inset 0 0 0 100vmax ${color}` }, { boxShadow: 'inset 0 0 0 100vmax transparent' }], { duration: 480, easing: 'ease-out' });
}
