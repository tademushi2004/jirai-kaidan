/** 音量・ミュート・「振動と点滅を減らす」の設定（端末に保存） */
export interface Settings {
  muted: boolean;
  /** 0〜1 */
  volume: number;
  /** 画面の振動・点滅・端末の振動をやめ、動きを短くする */
  reduceMotion: boolean;
}

const KEY = 'jirai-kaidan:settings';

export function defaultSettings(): Settings {
  let reduce = false;
  try {
    reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    /* 取得できなければ既定のまま */
  }
  return { muted: false, volume: 0.7, reduceMotion: reduce };
}

export function loadSettings(): Settings {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const v = JSON.parse(raw) as Partial<Settings>;
    return {
      muted: typeof v.muted === 'boolean' ? v.muted : d.muted,
      volume: typeof v.volume === 'number' && v.volume >= 0 && v.volume <= 1 ? v.volume : d.volume,
      reduceMotion: typeof v.reduceMotion === 'boolean' ? v.reduceMotion : d.reduceMotion,
    };
  } catch {
    return d;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 保存できない環境でも動く */
  }
}
