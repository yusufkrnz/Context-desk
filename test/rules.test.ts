import { describe, expect, it } from 'vitest';
import { analyzeRules } from '../src/core/rules.js';

const ts = {
  path: '/p/CLAUDE.md',
  scope: 'Project',
  content: [
    '# Rules',
    '- TypeScript: `any` yasak, `unknown` kullan',
    '- Files < 400 lines',
    '- Use camelCase for variables',
    '```',
    '- not an instruction, inside a fence',
    '```',
    '| Command | What |',
    '|---|---|',
    '| /deploy | ships it |',
  ].join('\n'),
};

describe('analyzeRules', () => {
  it('counts list items and table body rows, not fenced lines or headers', () => {
    const { files } = analyzeRules([ts], null);
    expect(files[0]?.instructions).toBe(4);
  });

  it('flags rules a linter could enforce', () => {
    const { findings } = analyzeRules([ts], null);
    const hints = findings.filter((f) => f.kind === 'lintable').map((f) => f.hint);
    expect(hints).toEqual(['lint:no-explicit-any', 'lint:max-lines', 'lint:naming']);
  });

  it('finds the same rule repeated across files', () => {
    const other = { path: '/home/.claude/CLAUDE.md', scope: 'User', content: '- Use camelCase for variables!' };
    const { findings } = analyzeRules([ts, other], null);
    const dup = findings.find((f) => f.kind === 'duplicate');
    expect(dup?.file).toBe('/home/.claude/CLAUDE.md');
    expect(dup?.hint).toBe('dup:/p/CLAUDE.md:4');
  });

  it('flags rule files written for a stack the project does not use', () => {
    const android = {
      path: '/home/.claude/rules/android-style.md',
      scope: 'User',
      content: '# Android Kotlin Style\n- Use Kotlin val\n- Compose with Jetpack Compose\n- Gradle builds',
    };
    const { findings } = analyzeRules([android], new Set(['python']));
    expect(findings).toContainEqual(expect.objectContaining({ kind: 'stack-mismatch', hint: 'stack:android' }));
    expect(analyzeRules([android], new Set(['android'])).findings.some((f) => f.kind === 'stack-mismatch')).toBe(false);
  });
});

describe('analyzeRules on mobile rule files', () => {
  it('recognizes Android-only files by their vocabulary, not just the word Android', () => {
    const security = {
      path: '/home/.claude/rules/mobile-security.md',
      scope: 'User',
      content: '# Mobile Security\n- Use `BuildConfig` or `local.properties`\n- EncryptedSharedPreferences for tokens\n- Android Keystore for keys\n- Use Timber with release tree',
    };
    const { findings } = analyzeRules([security], new Set(['python']));
    expect(findings).toContainEqual(expect.objectContaining({ kind: 'stack-mismatch', hint: 'stack:android' }));
  });
});

describe('detectStacks', () => {
  it('finds stacks inside monorepo subfolders, not just the root', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { detectStacks } = await import('../src/core/report.js');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cdesk-mono-'));
    fs.mkdirSync(path.join(root, 'backend'));
    fs.writeFileSync(path.join(root, 'backend', 'pyproject.toml'), '');
    fs.mkdirSync(path.join(root, 'frontend', 'dashboard'), { recursive: true });
    fs.writeFileSync(path.join(root, 'frontend', 'dashboard', 'package.json'), '{}');
    fs.mkdirSync(path.join(root, 'node_modules', 'x'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules', 'x', 'Podfile'), '');
    expect([...detectStacks(root)!].sort()).toEqual(['node', 'python']);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
