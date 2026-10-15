import { describe, expect, it } from 'vitest';
import { analyzeRules, type RuleSource } from '../src/core/rules.js';

const src = (content: string, path = '/p/CLAUDE.md', scope = 'Project'): RuleSource => ({ path, scope, content });
const instr = (content: string) => analyzeRules([src(content)], null).files[0]?.instructions;
const lint = (content: string) =>
  analyzeRules([src(content)], null)
    .findings.filter((f) => f.kind === 'lintable')
    .map((f) => f.hint);
const kinds = (sources: RuleSource[], stacks: Set<'android' | 'ios' | 'python' | 'node'> | null, kind: string) =>
  analyzeRules(sources, stacks).findings.filter((f) => f.kind === kind);

describe('bugs', () => {
  it('handles CRLF line endings like LF', () => {
    const lf = '# R\n- Use camelCase for vars\n```\n- fenced\n```\n| a | b |\n|---|---|\n| x | y |\n';
    const crlf = lf.replace(/\n/g, '\r\n');
    expect(instr(crlf)).toBe(instr(lf));
    expect(lint(crlf)).toEqual(lint(lf));
  });

  it('treats ~~~ as a code fence', () => {
    expect(instr('- real rule here\n~~~\n- inside tilde fence\n- also inside\n~~~')).toBe(1);
  });

  it('does not close a 4-backtick fence on an inner ``` line', () => {
    const c = ['- real rule here', '````md', '```', '- example inside outer fence', '```', '````'].join('\n');
    expect(instr(c)).toBe(1);
  });

  it('does not count a "* * *" thematic break as an instruction', () => {
    expect(instr('- one real rule\n\n* * *\n\n- another real rule')).toBe(2);
  });

  it('does not count YAML frontmatter list entries (.mdc globs) as instructions', () => {
    const mdc = ['---', 'description: TS rules', 'globs:', '  - "src/**/*.ts"', '  - "test/**/*.ts"', 'alwaysApply: false', '---', '- Prefer unknown over any'].join('\n');
    expect(instr(mdc)).toBe(1);
  });

  it('reports 0 lines for an empty file and does not count the trailing newline as a line', () => {
    const r = analyzeRules([src(''), src('- a\n- b\n', '/p/AGENTS.md')], null);
    expect(r.files[0]?.lines).toBe(0);
    expect(r.files[1]?.lines).toBe(2);
  });

  it('does not report a file as a duplicate of itself when the same path is passed twice', () => {
    const s = src('- Always write tests for new endpoints');
    const r = analyzeRules([s, s], null);
    expect(r.findings.filter((f) => f.kind === 'duplicate')).toEqual([]);
    expect(r.files).toHaveLength(1);
  });

  it('detects duplicates regardless of list marker (numbered vs bullet)', () => {
    const a = src('1. Run pytest before every commit');
    const b = src('- Run pytest before every commit', '/home/.claude/CLAUDE.md', 'User');
    expect(kinds([a, b], null, 'duplicate')).toHaveLength(1);
  });

  it('detects duplicates differing only in emoji/case/punctuation', () => {
    const a = src('- ✅ Use `val` over `var`!');
    const b = src('* use val over var', '/home/.claude/rules/x.md', 'User');
    expect(kinds([a, b], null, 'duplicate')).toHaveLength(1);
  });

  it('does not flag prose "avoid any ..." / "if any ... never" as lint:no-explicit-any', () => {
    expect(lint('- Avoid any network calls in unit tests')).toEqual([]);
    expect(lint('- If any migration fails, never retry silently')).toEqual([]);
    expect(lint('- Ask at any time; don\'t guess requirements')).toEqual([]);
  });

  it('still flags real no-any rules', () => {
    expect(lint('- TypeScript: `any` forbidden')).toEqual(['lint:no-explicit-any']);
    expect(lint('- No `any` in public APIs')).toEqual(['lint:no-explicit-any']);
  });

  it('does not flag size limits in MB as lint:max-lines', () => {
    expect(lint('- Upload files < 10 MB only')).toEqual([]);
  });

  it('does not treat "react"/"swift" used as plain English as stack signals', () => {
    const prose = src(
      '- React quickly to failing alerts\n- Give swift feedback on PRs\n- React to reviewer comments within a day\n- Keep a swift release cadence\n- React calmly to incidents',
      '/home/.claude/rules/team.md',
      'User',
    );
    expect(kinds([prose], new Set(['python']), 'stack-mismatch')).toEqual([]);
  });

  it('does not flag a mixed-stack overview file that also covers the project stack', () => {
    const overview = src(
      [
        '| Project | Type |',
        '|---|---|',
        '| Web | React + Vite frontend |',
        '| Backend | FastAPI + PostgreSQL |',
        '| SaaS | Fastify + React, TypeScript |',
        '| Video | FastAPI + Next.js |',
        '- TypeScript: `any` forbidden',
        '- Python: use pydantic models',
      ].join('\n'),
      '/home/.claude/CLAUDE.md',
      'User',
    );
    expect(kinds([overview], new Set(['python']), 'stack-mismatch')).toEqual([]);
  });

  it('still flags a single-stack Android file in a Python project', () => {
    const android = src('# Android Kotlin\n- Kotlin val\n- Jetpack Compose state hoisting\n- Gradle cache', '/home/.claude/rules/a.md', 'User');
    expect(kinds([android], new Set(['python']), 'stack-mismatch')).toHaveLength(1);
  });

  it('does not count stack keywords inside words (scenarios, portfolios, nodejs-free "node graph")', () => {
    const s = src('- Cover all scenarios\n- Update portfolios\n- Draw the node graph\n- More scenarios\n- iOSish? no', '/x.md');
    expect(kinds([s], new Set(['python']), 'stack-mismatch')).toEqual([]);
  });
});

describe('proposals', () => {
  // Formatter keywords (girinti/indent/quotes) should only count with a code-context word (code, kod, file, .ts, editor), not in prose/doc-writing rules.
  it('does not flag Turkish "girinti" used outside formatting context', () => {
    expect(lint('- Blog yazılarında paragraf girinti kullanma, kısa tut')).toEqual([]);
  });

  // Findings should carry the source scope (or a `global` flag) so the UI can show findings for ~/.claude files once instead of per project.
  it('findings carry the scope of the rule file they came from', () => {
    const g = src('# Android\n- Kotlin\n- Gradle\n- Jetpack Compose\n- Use camelCase names', '/home/.claude/rules/android.md', 'User');
    const f = analyzeRules([g], new Set(['python'])).findings;
    expect(f.length).toBeGreaterThan(0);
    for (const x of f) expect((x as unknown as { scope?: string }).scope).toBe('User');
  });

  // .mdc rules with alwaysApply:false and globs are only loaded when matching files are touched; exclude them from always-loaded token totals.
  it('excludes glob-scoped .mdc rules from the always-loaded token total', () => {
    const mdc = src('---\nglobs: "*.ts"\nalwaysApply: false\n---\n' + '- rule text here\n'.repeat(50), '/p/.cursor/rules/ts.mdc', 'Project');
    expect(analyzeRules([mdc], null).totalTokens).toBe(0);
  });

  // GFM tables without a leading pipe ("a | b") should count body rows as instructions too.
  it('counts body rows of tables without leading pipes', () => {
    expect(instr('Cmd | What\n--- | ---\n/deploy | ships it\n/test | runs tests')).toBe(2);
  });

  // Lines inside HTML comments are stripped by Claude Code before loading; do not count them.
  it('ignores list items inside HTML comments', () => {
    expect(instr('- real rule\n<!--\n- commented out rule\n-->')).toBe(1);
  });

  // Decided 2026-10-15: postponed; similarity matching risks false positives. Re-enable when implemented.
  it.skip('flags near-duplicate rules across files', () => {
    const a = src('- Use val over var for immutability');
    const b = src('- Prefer val over var for immutability', '/home/.claude/rules/k.md', 'User');
    expect(kinds([a, b], null, 'duplicate')).toHaveLength(1);
  });

  // A file that only imports another (@AGENTS.md) should surface the import so the user sees what actually gets loaded.
  it('reports @imports in a rule file', () => {
    const r = analyzeRules([src('@AGENTS.md\n')], null);
    expect(r.findings.some((f) => f.text.includes('AGENTS.md'))).toBe(true);
  });

  // Stack mismatch should apply when the project has a stack outside the known set (empty Set means "known dir, no recognized stack"), e.g. a Go repo still shouldn't get Android rules.
  it('flags single-stack files when project stacks is an empty set (unrecognized stack)', () => {
    const android = src('# Android Kotlin\n- Kotlin\n- Jetpack Compose\n- Gradle', '/home/.claude/rules/a.md', 'User');
    expect(kinds([android], new Set(), 'stack-mismatch')).toHaveLength(1);
  });
});
