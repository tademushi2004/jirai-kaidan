/**
 * 画面の上に重ねる演出（爆発・紙吹雪・大きな文字）。DOM と Web Animations API だけで作る。
 * reduce=true（振動・点滅を減らす）のときは、動きを出さず、文字の知らせだけを短く出す。
 */

export type BlastKind = 'hurt' | 'hit'; // hurt: 自分が相手の地雷を踏んだ / hit: 相手に自分の地雷を踏ませた
export type BannerKind = BlastKind | 'win' | 'lose' | 'miss';

const CONFETTI = ['#b8322a', '#e69f00', '#0072b2', '#2a2622', '#f4c542', '#fffaf0', '#56b4e9'];
const DEBRIS: Record<BlastKind, string[]> = {
  hurt: ['#2a2622', '#5f564d', '#b8322a', '#e0461f', '#2a2622'],
  hit: ['#e69f00', '#f4c542', '#b8322a', '#fffaf0', '#e69f00'],
};

/** 演出を重ねる層（host の中に1つだけ作る） */
export function fxLayer(host: HTMLElement): HTMLElement {
  let layer = host.querySelector<HTMLElement>(':scope > .fx-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'fx-layer';
    host.append(layer);
  }
  return layer;
}

function spawn(layer: HTMLElement, cls: string, css: Partial<CSSStyleDeclaration>): HTMLElement {
  const el = document.createElement('div');
  el.className = cls;
  Object.assign(el.style, css);
  layer.append(el);
  return el;
}

function run(el: HTMLElement, frames: Keyframe[], opts: KeyframeAnimationOptions): void {
  if (typeof el.animate !== 'function') {
    el.remove();
    return;
  }
  const a = el.animate(frames, { fill: 'both', ...opts });
  a.onfinish = () => el.remove();
  a.oncancel = () => el.remove();
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** 要素の中心の、host から見た位置 */
export function centerIn(host: HTMLElement, el: HTMLElement): { x: number; y: number } {
  const h = host.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: r.left - h.left + r.width / 2, y: r.top - h.top + r.height / 2 };
}

/** 爆発。strength は連鎖の回数（1〜）。被弾は黒煙と赤黒い破片、命中は金と朱の破片 */
export function explosion(host: HTMLElement, x: number, y: number, strength: number, kind: BlastKind, reduce: boolean): void {
  if (reduce) return;
  const layer = fxLayer(host);
  const s = Math.min(strength, 5);
  const scale = 1 + 0.25 * (s - 1);
  // 中心の閃光
  const core = spawn(layer, `boom-core ${kind}`, { left: `${x}px`, top: `${y}px` });
  run(core, [
    { transform: 'translate(-50%, -50%) scale(.2)', opacity: 1 },
    { transform: `translate(-50%, -50%) scale(${2.6 * scale})`, opacity: 0.95, offset: 0.25 },
    { transform: `translate(-50%, -50%) scale(${3.6 * scale})`, opacity: 0 },
  ], { duration: 650, easing: 'ease-out' });
  // 衝撃の輪（2重）
  for (let i = 0; i < 2; i++) {
    const ring = spawn(layer, `boom-ring ${kind}`, { left: `${x}px`, top: `${y}px` });
    run(ring, [
      { transform: 'translate(-50%, -50%) scale(.3)', opacity: 1 },
      { transform: `translate(-50%, -50%) scale(${(5 + 2 * i) * scale})`, opacity: 0 },
    ], { duration: 520 + 160 * i, delay: 60 * i, easing: 'cubic-bezier(.1,.7,.3,1)' });
  }
  // 破片
  const n = 16 + 6 * s;
  for (let i = 0; i < n; i++) {
    const ang = rand(0, Math.PI * 2);
    const dist = rand(60, 150) * scale;
    const size = rand(4, 10);
    const color = DEBRIS[kind][i % DEBRIS[kind].length];
    const d = spawn(layer, 'debris', { left: `${x}px`, top: `${y}px`, width: `${size}px`, height: `${size * rand(0.6, 1.4)}px`, background: color });
    const dx = Math.cos(ang) * dist;
    const dy = Math.sin(ang) * dist;
    run(d, [
      { transform: 'translate(-50%, -50%) rotate(0deg)', opacity: 1 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${rand(-360, 360)}deg)`, opacity: 1, offset: 0.6 },
      { transform: `translate(calc(-50% + ${dx * 1.1}px), calc(-50% + ${dy + 70}px)) rotate(${rand(-540, 540)}deg)`, opacity: 0 },
    ], { duration: rand(700, 1100), easing: 'cubic-bezier(.15,.8,.4,1)' });
  }
  // 被弾は黒煙が立ちのぼる
  if (kind === 'hurt') {
    for (let i = 0; i < 4 + s; i++) {
      const p = spawn(layer, 'smoke', { left: `${x + rand(-18, 18)}px`, top: `${y + rand(-8, 8)}px` });
      run(p, [
        { transform: 'translate(-50%, -50%) scale(.4)', opacity: 0 },
        { transform: 'translate(-50%, -60%) scale(1.2)', opacity: 0.75, offset: 0.2 },
        { transform: `translate(calc(-50% + ${rand(-30, 30)}px), calc(-50% - ${rand(60, 110)}px)) scale(${rand(2.2, 3.2)})`, opacity: 0 },
      ], { duration: rand(1100, 1600), delay: i * 60, easing: 'ease-out' });
    }
  }
}

/** 紙吹雪。rain: 上から降る / burst: (x, y) から弾ける */
export function confetti(host: HTMLElement, reduce: boolean, opts: { mode: 'rain' | 'burst'; count?: number; x?: number; y?: number }): void {
  if (reduce) return;
  const layer = fxLayer(host);
  const W = host.clientWidth;
  const H = host.clientHeight;
  const count = opts.count ?? (opts.mode === 'rain' ? 140 : 40);
  for (let i = 0; i < count; i++) {
    const w = rand(6, 10);
    const color = CONFETTI[i % CONFETTI.length];
    const round = Math.random() < 0.25;
    if (opts.mode === 'rain') {
      const x0 = rand(0, W);
      const el = spawn(layer, 'confetti', { left: `${x0}px`, top: '-20px', width: `${w}px`, height: `${round ? w : w * 1.6}px`, background: color, borderRadius: round ? '50%' : '1px' });
      const sway = rand(-60, 60);
      run(el, [
        { transform: 'translate(0, 0) rotate(0deg) rotateY(0deg)' },
        { transform: `translate(${sway}px, ${H * 0.5}px) rotate(${rand(180, 540)}deg) rotateY(360deg)`, offset: 0.5 },
        { transform: `translate(${-sway * 0.5}px, ${H + 40}px) rotate(${rand(540, 900)}deg) rotateY(720deg)` },
      ], { duration: rand(2200, 3800), delay: rand(0, 1400), easing: 'linear' });
    } else {
      const x = opts.x ?? W / 2;
      const y = opts.y ?? H / 2;
      const el = spawn(layer, 'confetti', { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${round ? w : w * 1.6}px`, background: color, borderRadius: round ? '50%' : '1px' });
      const ang = rand(-Math.PI * 0.95, -Math.PI * 0.05); // 上向きに弾ける
      const v = rand(90, 190);
      const dx = Math.cos(ang) * v;
      const dy = Math.sin(ang) * v;
      run(el, [
        { transform: 'translate(-50%, -50%) rotate(0deg)', opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${rand(180, 360)}deg)`, opacity: 1, offset: 0.4 },
        { transform: `translate(calc(-50% + ${dx * 1.4}px), calc(-50% + ${dy + 160}px)) rotate(${rand(360, 720)}deg)`, opacity: 0 },
      ], { duration: rand(1100, 1600), easing: 'cubic-bezier(.2,.7,.4,1)' });
    }
  }
}

/** 画面の真ん中に大きく出す文字（被弾！／命中！／勝利 など）。文字の知らせは reduce でも出す */
export function banner(host: HTMLElement, text: string, kind: BannerKind, reduce: boolean, sub = '', duration = 1100, extra = ''): void {
  const layer = fxLayer(host);
  layer.querySelectorAll('.banner').forEach((b) => b.remove());
  const el = spawn(layer, `banner ${kind} ${extra}`.trim(), {});
  const main = document.createElement('b');
  main.textContent = text;
  el.append(main);
  if (sub) {
    const s = document.createElement('span');
    s.textContent = sub;
    el.append(s);
  }
  if (reduce) {
    setTimeout(() => el.remove(), Math.min(duration, 900));
    return;
  }
  const tilt = kind === 'hurt' || kind === 'lose' ? 4 : -6;
  run(el, [
    { transform: `translate(-50%, -50%) scale(2.6) rotate(${tilt * 2}deg)`, opacity: 0 },
    { transform: `translate(-50%, -50%) scale(.92) rotate(${tilt}deg)`, opacity: 1, offset: 0.14 },
    { transform: `translate(-50%, -50%) scale(1) rotate(${tilt}deg)`, opacity: 1, offset: 0.22 },
    { transform: `translate(-50%, -50%) scale(1.02) rotate(${tilt}deg)`, opacity: 1, offset: 0.82 },
    { transform: `translate(-50%, -50%) scale(1.15) rotate(${tilt}deg)`, opacity: 0 },
  ], { duration, easing: 'cubic-bezier(.2,1.2,.4,1)' });
}

/** 画面全体を一瞬染める */
export function tint(host: HTMLElement, color: string, strength: number, reduce: boolean, duration = 420): void {
  if (reduce) return;
  const el = spawn(fxLayer(host), 'tint', { background: color });
  run(el, [{ opacity: Math.min(0.85, strength) }, { opacity: 0 }], { duration, easing: 'ease-out' });
}

/**
 * 連鎖ボーナス（2発目以降）。n が大きいほど派手になる:
 * 画面いっぱいの衝撃波、回る集中線、色の点滅、命中なら大量の紙吹雪、被弾なら黒い稲妻のような亀裂。
 */
export function chainBurst(host: HTMLElement, x: number, y: number, n: number, kind: BlastKind, reduce: boolean): void {
  if (reduce) return;
  const layer = fxLayer(host);
  const lv = Math.min(n, 5);
  const big = Math.max(host.clientWidth, host.clientHeight) * 2.4;
  // 画面いっぱいに広がる衝撃波（回数ぶん重ねる）
  for (let i = 0; i < lv; i++) {
    const w = spawn(layer, `shock ${kind}`, { left: `${x}px`, top: `${y}px` });
    run(w, [
      { width: '20px', height: '20px', opacity: 1, borderWidth: `${6 + 2 * lv}px` },
      { width: `${big}px`, height: `${big}px`, opacity: 0, borderWidth: '2px' },
    ], { duration: 700 + 80 * lv, delay: i * 110, easing: 'cubic-bezier(.1,.6,.3,1)' });
  }
  // 集中線（回転しながら広がる）
  const lines = spawn(layer, `speedlines ${kind}`, { left: `${x}px`, top: `${y}px`, width: `${big}px`, height: `${big}px` });
  run(lines, [
    { transform: 'translate(-50%, -50%) rotate(0deg) scale(.2)', opacity: 0 },
    { transform: 'translate(-50%, -50%) rotate(20deg) scale(1)', opacity: 0.55 + 0.08 * lv, offset: 0.25 },
    { transform: `translate(-50%, -50%) rotate(${40 + 15 * lv}deg) scale(1.1)`, opacity: 0 },
  ], { duration: 900 + 150 * lv, easing: 'ease-out' });
  // 色の点滅（回数ぶん）
  const colors = kind === 'hit' ? ['#fff3b0', '#f4c542', '#ffffff', '#e69f00'] : ['#5a0000', '#000000', '#b8322a', '#000000'];
  const blink = spawn(layer, 'tint', { background: colors[0] });
  const frames: Keyframe[] = [];
  for (let i = 0; i < 2 + lv; i++) {
    frames.push({ background: colors[i % colors.length], opacity: 0.55 });
    frames.push({ opacity: 0.05 });
  }
  frames.push({ opacity: 0 });
  run(blink, frames, { duration: 220 * (2 + lv), easing: 'linear' });
  if (kind === 'hit') {
    confetti(host, false, { mode: 'burst', count: 40 * lv, x, y });
    if (lv >= 3) confetti(host, false, { mode: 'rain', count: 50 * (lv - 2) });
  } else {
    // 被弾: 画面にひびが走る
    for (let i = 0; i < 2 + lv; i++) {
      const ang = rand(0, 360);
      const len = rand(120, 260) + 30 * lv;
      const crack = spawn(layer, 'crack', { left: `${x}px`, top: `${y}px`, width: `${len}px` });
      run(crack, [
        { transform: `rotate(${ang}deg) scaleX(0)`, opacity: 1 },
        { transform: `rotate(${ang}deg) scaleX(1)`, opacity: 1, offset: 0.15 },
        { transform: `rotate(${ang}deg) scaleX(1)`, opacity: 0 },
      ], { duration: 1100 + 120 * lv, easing: 'ease-out' });
    }
  }
}
