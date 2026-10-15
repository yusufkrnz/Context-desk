import { describe, expect, it } from 'vitest';
import { parseSession } from '../src/core/session.js';

const t = (min: number) => new Date(Date.UTC(2026, 9, 1, 10, min)).toISOString();
const base = { cwd: '/work/app', gitBranch: 'main', sessionId: 's1' };

const usage = (ctx: number) => ({ input_tokens: 2, cache_read_input_tokens: ctx - 1002, cache_creation_input_tokens: 1000, output_tokens: 50 });

const entries = [
  { ...base, type: 'attachment', timestamp: t(0), attachment: { type: 'instructions', files: [{ path: '/work/app/CLAUDE.md', type: 'Project', content: '- use pytest\n'.repeat(70) }] } },
  { ...base, type: 'user', timestamp: t(0), message: { role: 'user', content: 'add a login endpoint' } },
  { ...base, type: 'assistant', timestamp: t(1), requestId: 'r1', message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'pytest' } }], usage: usage(20_000) } },
  { ...base, type: 'user', timestamp: t(2), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', is_error: true, content: 'Exit code 1\nFile /work/app/a.py, line 3: NameError' }] } },
  { ...base, type: 'assistant', timestamp: t(3), requestId: 'r2', message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 'tu2', name: 'Bash', input: { command: 'pytest' } }], usage: usage(60_000) } },
  // same request written again for the next content block
  { ...base, type: 'assistant', timestamp: t(3), requestId: 'r2', message: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'running' }], usage: usage(60_000) } },
  { ...base, type: 'user', timestamp: t(4), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu2', is_error: true, content: 'Exit code 1\nFile /work/app/b.py, line 9: NameError' }] } },
  { ...base, type: 'user', timestamp: t(5), message: { role: 'user', content: 'hayır, yine aynı hata' } },
  { ...base, type: 'user', timestamp: t(5), message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } },
  { ...base, type: 'user', timestamp: t(6), isMeta: true, message: { role: 'user', content: 'Caveat: hidden' } },
  { ...base, type: 'system', subtype: 'compact_boundary', timestamp: t(7), compactMetadata: { trigger: 'auto', preTokens: 180_000, postTokens: 25_000 } },
  { ...base, type: 'user', timestamp: t(7), isCompactSummary: true, message: { role: 'user', content: 'This session is being continued... summary' } },
  { ...base, type: 'user', timestamp: t(8), message: { role: 'user', content: 'I told you to use pytest' } },
  { ...base, type: 'assistant', timestamp: t(9), requestId: 'r3', message: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'ok' }], usage: usage(30_000) } },
  { ...base, type: 'ai-title', aiTitle: 'Login endpoint' },
  // idle for an hour, then one more message
  { ...base, type: 'user', timestamp: t(70), message: { role: 'user', content: 'thanks' } },
];

describe('parseSession', () => {
  const { summary, cwd, ruleSources } = parseSession('s1', entries, 2);

  it('reads session metadata', () => {
    expect(cwd).toBe('/work/app');
    expect(summary.title).toBe('Login endpoint');
    expect(summary.firstPrompt).toBe('add a login endpoint');
    expect(summary.branch).toBe('main');
    expect(summary.models).toEqual(['claude-opus-5-5']);
    expect(summary.subagents).toBe(2);
    expect(ruleSources.map((r) => r.path)).toEqual(['/work/app/CLAUDE.md']);
  });

  it('counts one API call per request, not per written entry', () => {
    expect(summary.apiCalls).toBe(3);
    expect(summary.timeline.map((p) => p.tokens)).toEqual([20_000, 60_000, 30_000]);
  });

  it('uses the compaction pre-size as the peak when it is larger than any observed turn', () => {
    expect(summary.peakTokens).toBe(180_000);
    expect(summary.compactions).toEqual([{ t: t(7), trigger: 'auto', preTokens: 180_000, postTokens: 25_000 }]);
  });

  it('records steering signals with the context size at that moment', () => {
    expect(summary.signals.map((s) => [s.kind, s.tokens])).toEqual([
      ['correction', 60_000],
      ['interrupt', 60_000],
      ['correction', 25_000],
    ]);
    expect(summary.humanMessages).toBe(4);
  });

  it('groups the same failure across retries', () => {
    expect(summary.repeatedErrors).toHaveLength(1);
    expect(summary.repeatedErrors[0]).toMatchObject({ tool: 'Bash', count: 2 });
    expect(summary.tools[0]).toMatchObject({ name: 'Bash', calls: 2, errors: 2 });
  });

  it('ignores idle gaps when measuring active time', () => {
    expect(summary.activeMinutes).toBe(9);
  });

  it('breaks the peak context into parts that add up to the measured size', () => {
    const c = summary.composition!;
    expect(c.measured).toBe(60_000);
    expect(c.parts.reduce((s, p) => s + p.tokens, 0)).toBe(60_000);
    expect(c.parts.find((p) => p.key === 'rules')?.tokens).toBeGreaterThan(0);
  });
});
