import { describe, expect, it } from 'vitest';
import { classifyHuman, isHumanText, normalizeError, ownWords, redact } from '../src/core/text.js';

describe('classifyHuman', () => {
  it.each([
    'hayır, öyle değil',
    'yine aynı hata geliyor',
    'bunu sana söylemiştim',
    'neden bunu sildin',
    'Hâlâ çalışmıyor',
    'no, use pytest',
    'I told you not to use any',
    'that is wrong',
    "it still doesn't work",
  ])('flags "%s" as a correction', (text) => {
    expect(classifyHuman(text)).toBe('correction');
  });

  it.each(['yap', 'devam', 'deploy et', 'tekrar dene lütfen bir de testleri yaz', 'Now add a login page', 'nothing else'])(
    'leaves "%s" alone',
    (text) => {
      expect(classifyHuman(text)).toBeNull();
    },
  );

  it('detects interrupts', () => {
    expect(classifyHuman('[Request interrupted by user for tool use]')).toBe('interrupt');
  });

  it('ignores corrections that only appear inside pasted material', () => {
    const msg = '<pasted_content id="a1">error: wrong type, still broken</pasted_content id="a1"> bunu özetle';
    expect(classifyHuman(msg)).toBeNull();
  });
});

describe('isHumanText', () => {
  it('rejects harness-generated messages', () => {
    expect(isHumanText('<command-name>/clear</command-name>')).toBe(false);
    expect(isHumanText('This session is being continued from a previous conversation')).toBe(false);
    expect(isHumanText('fix the login bug')).toBe(true);
  });
});

describe('redact', () => {
  it('masks secrets and emails', () => {
    const out = redact('SECRET_KEY="abc123xyz" mail me at a.b@example.com key sk-ant-REDACTEDREDACTED12');
    expect(out).not.toContain('abc123xyz');
    expect(out).not.toContain('a.b@example.com');
    expect(out).not.toContain('REDACTEDREDACTED12');
  });
});

describe('normalizeError', () => {
  it('groups errors that only differ in paths and numbers', () => {
    const a = normalizeError('Exit code 1\nFile /Users/a/x.py, line 12: NameError');
    const b = normalizeError('Exit code 1\nFile /Users/b/y.py, line 40: NameError');
    expect(a).toBe(b);
  });
});

describe('ownWords', () => {
  it('drops pasted content', () => {
    expect(ownWords('<pasted_content id="x">long log</pasted_content id="x"> neden?')).toBe('neden?');
  });
});
