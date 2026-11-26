import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings, loadSettings, saveSettings } from '../src/fx/settings';
import { reactionLine } from '../src/ui/text';

function fakeStorage(init: Record<string, string> = {}) {
  const data = { ...init };
  return {
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => void (data[k] = v),
    data,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('設定', () => {
  it('保存先がなくても既定値で動く', () => {
    expect(loadSettings()).toEqual(defaultSettings());
    expect(() => saveSettings(defaultSettings())).not.toThrow();
  });
  it('保存して読み戻せる', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    saveSettings({ muted: true, volume: 0.25, reduceMotion: true });
    expect(loadSettings()).toEqual({ muted: true, volume: 0.25, reduceMotion: true });
  });
  it('壊れた値・範囲外の値は既定値に戻す', () => {
    vi.stubGlobal('localStorage', fakeStorage({ 'jirai-kaidan:settings': '{"muted":"yes","volume":9}' }));
    expect(loadSettings()).toEqual(defaultSettings());
    vi.stubGlobal('localStorage', fakeStorage({ 'jirai-kaidan:settings': 'これはJSONではない' }));
    expect(loadSettings()).toEqual(defaultSettings());
  });
  it('OSの「動きを減らす」設定を既定にする', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    expect(defaultSettings().reduceMotion).toBe(true);
  });
});

describe('AIの反応の文言', () => {
  it('強さごとに違う口ぶりで、乱数の端でも文が返る', () => {
    for (const lv of ['weak', 'medium', 'strong'] as const) {
      for (const x of [0, 0.5, 0.999999]) expect(reactionLine(lv, x)).toMatch(/^「.+」$/);
    }
    expect(reactionLine('weak', 0)).not.toBe(reactionLine('strong', 0));
  });
});
