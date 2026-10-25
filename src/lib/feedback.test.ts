import { describe, expect, it } from 'vitest';
import { buildDiagnostics, buildFeedbackInput, DIAGNOSTIC_MAX, diagnosticsRows, FEEDBACK_LIMITS } from './feedback';

const env = {
  appVersion: '3.4.0',
  build: 'abc123',
  userAgent: 'Mozilla/5.0 (iPhone)',
  platform: 'iPhone',
  width: 390.4,
  height: 844,
  standalone: true,
  group: 'Eat',
  list: 'Restaurants',
};

describe('buildDiagnostics', () => {
  it('formats the viewport and keeps the fields', () => {
    expect(buildDiagnostics(env)).toEqual({
      appVersion: '3.4.0',
      build: 'abc123',
      platform: 'iPhone',
      userAgent: 'Mozilla/5.0 (iPhone)',
      viewport: '390×844',
      standalone: true,
      group: 'Eat',
      list: 'Restaurants',
    });
  });

  it('clips long values to the rules caps and fills blanks', () => {
    const d = buildDiagnostics({ ...env, userAgent: 'x'.repeat(2000), platform: '' });
    expect(d.userAgent).toHaveLength(DIAGNOSTIC_MAX.userAgent);
    expect(d.platform).toBe('unknown');
  });
});

describe('buildFeedbackInput', () => {
  const diagnostics = buildDiagnostics(env);

  it('trims and leaves out empty contact and uid keys', () => {
    const input = buildFeedbackInput({ kind: 'bug', message: '  It broke  ', contact: '  ', uid: null, diagnostics });
    expect(input).toEqual({ kind: 'bug', message: 'It broke', diagnostics });
    expect(input && 'contact' in input).toBe(false);
    expect(input && 'uid' in input).toBe(false);
  });

  it('keeps contact and uid when given', () => {
    const input = buildFeedbackInput({ kind: 'idea', message: 'More lists', contact: 'me@x.com', uid: 'u1', diagnostics });
    expect(input).toMatchObject({ contact: 'me@x.com', uid: 'u1' });
  });

  it('rejects empty or too-long messages', () => {
    expect(buildFeedbackInput({ kind: 'idea', message: '   ', diagnostics })).toBeNull();
    expect(buildFeedbackInput({ kind: 'idea', message: 'a'.repeat(FEEDBACK_LIMITS.message + 1), diagnostics })).toBeNull();
    expect(buildFeedbackInput({ kind: 'idea', message: 'a'.repeat(FEEDBACK_LIMITS.message), diagnostics })).not.toBeNull();
  });
});

describe('diagnosticsRows', () => {
  it('says signed out without a uid', () => {
    const rows = diagnosticsRows(buildDiagnostics(env), null);
    expect(rows.find(([k]) => k === 'Account')?.[1]).toBe('Signed out');
    expect(rows.find(([k]) => k === 'Installed app')?.[1]).toBe('Yes');
  });
});
