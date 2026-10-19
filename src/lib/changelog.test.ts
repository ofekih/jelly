import { describe, expect, it } from 'vitest';
import pkg from '../../package.json';
import { CHANGELOG, CURRENT_VERSION, displayVersion, hasUnseenRelease } from './changelog';

const parse = (v: string) => v.split('.').map(Number);
const compare = (a: string, b: string) => {
  const [pa, pb] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
};

describe('changelog', () => {
  it('keeps package.json in sync with the newest entry', () => {
    expect(pkg.version).toBe(CURRENT_VERSION);
  });

  it('has well-formed entries, strictly newest first', () => {
    for (const entry of CHANGELOG) {
      expect(entry.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.title.trim()).not.toBe('');
      expect(entry.highlights.length).toBeGreaterThan(0);
    }
    for (let i = 1; i < CHANGELOG.length; i++) {
      expect(compare(CHANGELOG[i - 1].version, CHANGELOG[i].version)).toBeGreaterThan(0);
      expect(CHANGELOG[i - 1].date >= CHANGELOG[i].date).toBe(true);
    }
  });

  it('nudges only for newer major/minor releases', () => {
    expect(hasUnseenRelease(undefined, '2.0.0')).toBe(true);
    expect(hasUnseenRelease('1.2.0', '2.0.0')).toBe(true);
    expect(hasUnseenRelease('2.0.0', '2.1.0')).toBe(true);
    expect(hasUnseenRelease('2.0.0', '2.0.3')).toBe(false);
    expect(hasUnseenRelease('2.1.0', '2.0.0')).toBe(false);
    expect(hasUnseenRelease('2.0.0', '2.0.0')).toBe(false);
  });

  it('hides the patch number', () => {
    expect(displayVersion('2.0.0')).toBe('2.0');
  });
});
