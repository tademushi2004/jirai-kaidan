/**
 * 効果音。すべて Web Audio API で合成する（音声ファイルは使わない＝ライセンスの問題がない）。
 * ブラウザの制約で、最初の操作（クリックなど）のあとに音が出る。
 */
import type { Settings } from './settings';

type Wave = OscillatorType;
interface ToneOpts {
  type?: Wave;
  gain?: number;
  /** 周波数をこの値へ滑らせる */
  slideTo?: number;
  /** 何秒後に鳴らすか */
  delay?: number;
}

/** 階段を上る音階（ペンタトニック）。k段目ほど高い */
const LADDER = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
const hz = (semitones: number, base = 261.63) => base * Math.pow(2, semitones / 12);

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  constructor(
    private settings: () => Settings,
    /** true なら一切鳴らさない（?fast や自動テスト用） */
    private silent = false,
  ) {}

  /** 最初の操作で呼ぶ。AudioContext は操作のあとでないと動かせない */
  unlock(): void {
    this.ensure();
  }

  private ensure(): AudioContext | null {
    if (this.silent) return null;
    const s = this.settings();
    if (s.muted || s.volume <= 0) return null;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate; // 1秒ぶんのノイズ
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      if (this.master) this.master.gain.value = s.volume;
      return this.ctx;
    } catch {
      return null;
    }
  }

  private tone(freq: number, dur: number, o: ToneOpts = {}): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type ?? 'square';
    osc.frequency.setValueAtTime(freq, t0);
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.slideTo), t0 + dur);
    const peak = o.gain ?? 0.15;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, cutoff: number, gain: number, delay = 0): void {
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.noiseBuf) return;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, cutoff * 0.15), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  /** 帯域を絞ったノイズ（歓声のざわめき・地鳴りに使う） */
  private bandNoise(dur: number, freq: number, q: number, gain: number, delay = 0, attack = 0.05, wobble = 0): void {
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.noiseBuf) return;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(freq, t0);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.setValueAtTime(gain, t0 + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    if (wobble > 0) {
      // 群衆のうねり: 音量を不規則に揺らす
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = 5 + Math.random() * 4;
      lg.gain.value = gain * wobble;
      lfo.connect(lg).connect(g.gain);
      lfo.start(t0);
      lfo.stop(t0 + dur + 0.05);
    }
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  /** 1人ぶんの「わーっ」（母音に近い帯域で鳴らすのこぎり波） */
  private voice(delay: number, len: number): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + delay;
    const base = 220 + Math.random() * 260;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(base, t0);
    osc.frequency.linearRampToValueAtTime(base * (1.25 + Math.random() * 0.2), t0 + len * 0.35);
    osc.frequency.linearRampToValueAtTime(base * 1.05, t0 + len);
    const vib = ctx.createOscillator();
    const vg = ctx.createGain();
    vib.frequency.value = 5 + Math.random() * 3;
    vg.gain.value = base * 0.03;
    vib.connect(vg).connect(osc.frequency);
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 700 + Math.random() * 300;
    f1.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.06, t0 + 0.08);
    g.gain.setValueAtTime(0.06, t0 + len * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
    osc.connect(f1).connect(g).connect(this.master);
    osc.start(t0);
    vib.start(t0);
    osc.stop(t0 + len + 0.05);
    vib.stop(t0 + len + 0.05);
  }

  // ---------------------------------------------------------------- 効果音
  click(): void {
    this.tone(880, 0.05, { type: 'sine', gain: 0.08 });
  }

  /** 「じゃん」「けん」の拍（i = 0, 1） */
  jan(i: number): void {
    this.tone(i === 0 ? 520 : 620, 0.08, { type: 'triangle', gain: 0.2 });
  }

  /** 「ぽん」: 手が同時に公開される */
  pon(): void {
    this.tone(330, 0.14, { type: 'square', gain: 0.16, slideTo: 260 });
    this.noise(0.08, 3000, 0.1);
  }

  /** カードを持ち上げる */
  lift(): void {
    this.tone(1046.5, 0.05, { type: 'sine', gain: 0.07 });
  }

  /** カードをめくる */
  flip(): void {
    this.noise(0.05, 5000, 0.12);
    this.tone(523.25, 0.06, { type: 'triangle', gain: 0.08 });
  }

  /** じゃんけんに勝った（明るく上がる） */
  good(): void {
    [783.99, 987.77, 1318.5].forEach((f, i) => this.tone(f, i === 2 ? 0.3 : 0.1, { type: 'triangle', gain: 0.2, delay: i * 0.07 }));
  }

  /** じゃんけんに負けた（低く沈む、どすんと響く） */
  bad(): void {
    this.tone(220, 0.5, { type: 'sawtooth', gain: 0.14, slideTo: 92 });
    this.tone(233, 0.5, { type: 'sawtooth', gain: 0.08, slideTo: 98 });
    this.noise(0.25, 400, 0.25);
  }

  tie(): void {
    this.tone(440, 0.07, { type: 'triangle', gain: 0.12 });
    this.tone(440, 0.07, { type: 'triangle', gain: 0.12, delay: 0.09 });
  }

  /** 1段上る音（グ・リ・コ／チ・ヨ・コ・レ・イ・ト／パ・イ・ナ・ツ・プ・ル のリズム）。k は何歩目か（0始まり） */
  step(k: number): void {
    const i = k % LADDER.length;
    this.tone(hz(LADDER[i] + 12 * Math.floor(k / LADDER.length)), 0.1, { type: 'square', gain: 0.11 });
  }

  /** 爆発。n は連鎖の何回目か（1始まり）。回数が増えるほど大きく、高くなる */
  blast(n: number): void {
    const up = Math.min(n, 6) - 1;
    this.tone(150 * (1 + 0.22 * up), 0.34 + 0.04 * up, { type: 'sine', gain: Math.min(0.5, 0.3 + 0.05 * up), slideTo: 38 });
    this.noise(0.38 + 0.05 * up, 900 + 500 * up, Math.min(0.55, 0.3 + 0.07 * up));
    if (up >= 1) this.tone(hz(7 + 3 * up, 220), 0.12, { type: 'sawtooth', gain: 0.1, delay: 0.02 }); // 連鎖の高まり
  }

  /** 自分が相手の地雷を踏んだ（被弾）: 爆発＋地鳴り＋落ちていく悲鳴のような音 */
  boomHurt(n: number): void {
    this.blast(n + 1);
    this.tone(60, 0.9, { type: 'sine', gain: 0.45, slideTo: 30 });
    this.bandNoise(0.9, 120, 0.8, 0.35, 0, 0.01);
    this.tone(520, 0.5, { type: 'sawtooth', gain: 0.07, slideTo: 130, delay: 0.12 });
  }

  /** 相手に自分の地雷を踏ませた（命中）: 爆発＋かかった！の明るい合図 */
  boomHit(n: number): void {
    this.blast(n);
    [659.25, 830.61, 987.77, 1318.5].forEach((f, i) => this.tone(f, 0.12, { type: 'square', gain: 0.1, delay: 0.18 + i * 0.06 }));
    this.voice(0.2, 0.6);
    this.voice(0.25, 0.55);
  }

  /** 連鎖ボーナスの音。n 回目ほど高く、長く、厚くなる。命中は上がっていく明るい音型、被弾は不協和に落ちていく音型 */
  chain(n: number, kind: 'hurt' | 'hit'): void {
    const lv = Math.min(n, 5);
    const notes = lv + 2;
    if (kind === 'hit') {
      const base = 523.25 * Math.pow(2, (lv - 2) * 3 / 12);
      const steps = [0, 4, 7, 12, 16, 19, 24];
      for (let i = 0; i < notes; i++) {
        this.tone(base * Math.pow(2, steps[i] / 12), 0.14, { type: 'square', gain: 0.11, delay: 0.25 + i * 0.07 });
        this.tone(base * Math.pow(2, (steps[i] + 7) / 12), 0.14, { type: 'triangle', gain: 0.06, delay: 0.25 + i * 0.07 });
      }
      if (lv >= 3) this.cheer(1.2 + 0.3 * lv);
      else for (let i = 0; i < 4; i++) this.voice(0.3 + Math.random() * 0.2, 0.6);
    } else {
      const base = 440 * Math.pow(2, -(lv - 2) * 2 / 12);
      for (let i = 0; i < notes; i++) {
        const f = base * Math.pow(2, -i * 2.5 / 12);
        this.tone(f, 0.18, { type: 'sawtooth', gain: 0.09, delay: 0.25 + i * 0.09 });
        this.tone(f * 1.06, 0.18, { type: 'sawtooth', gain: 0.07, delay: 0.25 + i * 0.09 }); // ぶつかる音でまずさを出す
      }
      this.tone(45, 1.2 + 0.2 * lv, { type: 'sine', gain: 0.4, slideTo: 25 });
      this.bandNoise(1 + 0.2 * lv, 80, 0.6, 0.3, 0.05, 0.01);
    }
  }

  /** 歓声（ざわめき＋何人かの「わーっ」＋指笛） */
  cheer(dur = 2.4): void {
    this.bandNoise(dur, 1400, 0.7, 0.16, 0, 0.25, 0.5);
    this.bandNoise(dur * 0.9, 2600, 1.2, 0.07, 0.1, 0.3, 0.6);
    for (let i = 0; i < 9; i++) this.voice(Math.random() * 0.7, 0.6 + Math.random() * 0.8);
    this.tone(1900, 0.35, { type: 'sine', gain: 0.07, slideTo: 2600, delay: 0.4 });
    this.tone(2100, 0.5, { type: 'sine', gain: 0.06, slideTo: 1700, delay: 0.85 });
  }

  /** 対局に勝った: ファンファーレ＋歓声 */
  victory(): void {
    this.win();
    this.cheer();
  }

  /** 対局に負けた: 下がる音＋重い鐘 */
  defeat(): void {
    this.lose();
    this.tone(98, 2.2, { type: 'sine', gain: 0.35, delay: 0.1 });
    this.tone(196.5, 1.6, { type: 'sine', gain: 0.12, delay: 0.1 });
    this.tone(293, 1.2, { type: 'sine', gain: 0.06, delay: 0.1 });
    this.bandNoise(1.2, 90, 0.7, 0.2, 0.1, 0.02);
  }

  /** 爆発で落ちる */
  fall(): void {
    this.tone(700, 0.3, { type: 'sine', gain: 0.1, slideTo: 140 });
  }

  /** 自分の地雷を踏んだ（ミス） */
  miss(): void {
    this.tone(190, 0.13, { type: 'sawtooth', gain: 0.13 });
    this.tone(150, 0.2, { type: 'sawtooth', gain: 0.13, delay: 0.15 });
  }

  /** 相手の地雷のない段に無事に止まった */
  safe(): void {
    this.tone(1320, 0.12, { type: 'sine', gain: 0.07 });
  }

  declare(): void {
    this.tone(660, 0.12, { type: 'sine', gain: 0.1, slideTo: 990 });
  }

  win(): void {
    [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5].forEach((f, i) =>
      this.tone(f, i === 5 ? 0.4 : 0.14, { type: 'triangle', gain: 0.18, delay: i * 0.12 }),
    );
  }

  lose(): void {
    [392, 329.63, 261.63, 196].forEach((f, i) => this.tone(f, i === 3 ? 0.5 : 0.2, { type: 'sawtooth', gain: 0.1, delay: i * 0.2 }));
  }
}
