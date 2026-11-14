import { describe, expect, it, vi } from 'vitest';

// The sheet's decision only: the native modules behind Panel are not loaded.
vi.mock('react-native', () => ({}));
vi.mock('react-native-gesture-handler', () => ({}));
vi.mock('react-native-reanimated', () => ({ default: {} }));
vi.mock('react-native-safe-area-context', () => ({}));
vi.mock('react-native-worklets', () => ({}));
vi.mock('../i18n', () => ({ t: (k: string) => k }));
vi.mock('../theme', () => ({}));

const { settle } = await import('./Panel');

describe('dragging the sheet', () => {
  const h = 800;
  it('comes back on a small drag', () => {
    expect(settle(60, 0, h)).toBe('open');
  });
  it('stays at half on a short swipe', () => {
    expect(settle(250, 200, h)).toBe('half');
    expect(settle(400, 0, h)).toBe('half'); // let go at half
  });
  it('closes on a long or fast one', () => {
    expect(settle(650, 0, h)).toBe('close');
    expect(settle(100, 2500, h)).toBe('close'); // a flick
    expect(settle(400, 1200, h)).toBe('close'); // from half, down again
  });
  it('goes back up from half', () => {
    expect(settle(400, -1500, h)).toBe('open');
  });
});
