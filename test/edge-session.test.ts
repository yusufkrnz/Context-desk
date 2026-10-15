import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildReport, bucketize } from '../src/core/report.js';
import { parseSession } from '../src/core/session.js';
import type { SessionSummary } from '../src/core/types.js';

// ---------- synthetic helpers ----------
const t = (min: number) => new Date(Date.UTC(2026, 0, 1, 10, 0) + min * 60_000).toISOString();
const usage = (ctx: number) => ({ input_tokens: ctx, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 10 });

let seq = 0;
const human = (min: number, text: string, extra: Record<string, unknown> = {}) => ({
  type: 'user',
  cwd: '/w/app',
  timestamp: t(min),
  uuid: `u${seq++}`,
  message: { role: 'user', content: text },
  ...extra,
});
const reply = (min: number, ctx: number, req: string | null = `r${seq++}`, extra: Record<string, unknown> = {}) => ({
  type: 'assistant',
  cwd: '/w/app',
  timestamp: t(min),
  ...(req === null ? {} : { requestId: req }),
  message: { model: 'claude-x', content: [{ type: 'text', text: 'ok' }], usage: usage(ctx) },
  ...extra,
});
const toolUse = (min: number, ctx: number, id: string, name = 'Bash') => ({
  type: 'assistant',
  cwd: '/w/app',
  timestamp: t(min),
  requestId: `r${seq++}`,
  message: { model: 'claude-x', content: [{ type: 'tool_use', id, name, input: {} }], usage: usage(ctx) },
});
const toolResult = (min: number, id: string, content: unknown, isError = false) => ({
  type: 'user',
  cwd: '/w/app',
  timestamp: t(min),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content }] },
});

const tmpRoots: string[] = [];
function makeProjectsDir(layout: Record<string, Record<string, unknown[] | string>>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cdesk-edge-'));
  tmpRoots.push(root);
  for (const [folder, files] of Object.entries(layout)) {
    fs.mkdirSync(path.join(root, folder), { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      const body = typeof content === 'string' ? content : content.map((e) => JSON.stringify(e)).join('\n');
      fs.mkdirSync(path.dirname(path.join(root, folder, name)), { recursive: true });
      fs.writeFileSync(path.join(root, folder, name), body);
    }
  }
  return root;
}
afterAll(() => {
  for (const r of tmpRoots) fs.rmSync(r, { recursive: true, force: true });
});

const sessionWith = (over: Partial<SessionSummary>): SessionSummary => ({
  id: 'x', title: '', firstPrompt: '', start: '', end: '', activeMinutes: 0, models: [], branch: null,
  apiCalls: 0, humanMessages: 0, humanContexts: [], peakTokens: 0, windowTokens: 200_000, timeline: [],
  compactions: [], signals: [], repeatedErrors: [], composition: null, tools: [], subagents: 0, ...over,
});

// =====================================================================
describe('bugs', () => {
  it('invalid timestamp does not poison start/end or active time', () => {
    const { summary } = parseSession('s', [
      human(0, 'start'),
      { ...reply(1, 1000), timestamp: 'not-a-date' },
      reply(2, 2000),
      human(3, 'more'),
    ]);
    expect(summary.start).toBe(t(0));
    expect(summary.end).toBe(t(3));
    expect(summary.activeMinutes).toBe(3);
  });

  it('assistant entries with neither requestId nor uuid are still counted as separate API calls', () => {
    const { summary } = parseSession('s', [human(0, 'go'), reply(1, 1000, null), reply(2, 5000, null), reply(3, 9000, null)]);
    expect(summary.apiCalls).toBe(3);
    expect(summary.timeline.map((p) => p.tokens)).toEqual([1000, 5000, 9000]);
  });

  it('rejecting a tool use is one steering signal, not rejection + interrupt', () => {
    // Real shape: tool_result (rejection) followed by a "[Request interrupted by user for tool use]" text entry.
    const { summary } = parseSession('s', [
      human(0, 'go'),
      toolUse(1, 10_000, 'tu1'),
      toolResult(2, 'tu1', "The user doesn't want to proceed with this tool use. The tool use was rejected.", true),
      { ...human(2, ''), message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } },
    ]);
    expect(summary.signals).toHaveLength(1);
    expect(summary.signals[0]!.kind).toBe('rejection');
  });

  it('timeline and peakTokens agree when the same requestId is re-written with a larger usage', () => {
    const { summary } = parseSession('s', [human(0, 'go'), reply(1, 10_000, 'rq'), reply(1, 12_000, 'rq')]);
    expect(Math.max(...summary.timeline.map((p) => p.tokens))).toBe(summary.peakTokens);
  });

  it('non-finite compaction preTokens (1e400 parses to Infinity) does not become peakTokens', () => {
    const entries = [
      human(0, 'go'),
      reply(1, 50_000),
      JSON.parse('{"type":"system","subtype":"compact_boundary","timestamp":"2026-01-01T10:02:00.000Z","compactMetadata":{"trigger":"auto","preTokens":1e400,"postTokens":1e400}}'),
    ];
    const { summary } = parseSession('s', entries);
    expect(Number.isFinite(summary.peakTokens)).toBe(true);
    expect(summary.compactions[0]!.preTokens).toBeNull();
  });

  it('a user entry with two text blocks is one human message', () => {
    const { summary } = parseSession('s', [
      reply(0, 5000),
      { ...human(1, ''), message: { role: 'user', content: [{ type: 'text', text: 'look at this' }, { type: 'text', text: 'and fix it' }] } },
    ]);
    expect(summary.humanMessages).toBe(1);
    expect(summary.humanContexts).toEqual([5000]);
  });

  it('a session without cwd is grouped with its folder siblings, not as a separate project', async () => {
    const dir = makeProjectsDir({
      '-w-app': {
        'a.jsonl': [human(0, 'one'), reply(1, 1000)],
        'b.jsonl': [human(2, 'two'), reply(3, 1000)].map(({ cwd: _c, ...rest }) => rest),
      },
    });
    const r = await buildReport(dir);
    expect(r.totals.projects).toBe(1);
    expect(r.projects[0]!.sessions).toHaveLength(2);
  });

  it('different cwds never share a project id (slug collision)', async () => {
    const withCwd = (cwd: string) => [human(0, 'x', { cwd }), { ...reply(1, 1000), cwd }];
    const dir = makeProjectsDir({
      p1: { 'a.jsonl': withCwd('/w/my-app') },
      p2: { 'b.jsonl': withCwd('/w/my/app') },
    });
    const r = await buildReport(dir);
    expect(r.projects).toHaveLength(2);
    expect(new Set(r.projects.map((p) => p.id)).size).toBe(2);
  });

  it('a dangling symlink in the projects dir does not crash the report', async () => {
    const dir = makeProjectsDir({ p1: { 'a.jsonl': [human(0, 'x'), reply(1, 1000)] } });
    fs.symlinkSync(path.join(dir, 'does-not-exist'), path.join(dir, 'broken-link'));
    const r = await buildReport(dir);
    expect(r.totals.sessions).toBe(1);
  });

  it('JSON lines that parse to non-objects are counted as skipped', async () => {
    const dir = makeProjectsDir({
      p1: { 'a.jsonl': [JSON.stringify(human(0, 'x')), JSON.stringify(reply(1, 1000)), '42', 'null', '[1,2]', '"str"'].join('\n') },
    });
    const r = await buildReport(dir);
    expect(r.source.skippedLines).toBe(4);
  });

  it('a UTF-8 BOM on the first line does not drop the entry', async () => {
    const dir = makeProjectsDir({
      p1: { 'a.jsonl': '﻿' + [JSON.stringify(human(0, 'first prompt')), JSON.stringify(reply(1, 1000))].join('\n') },
    });
    const r = await buildReport(dir);
    expect(r.source.skippedLines).toBe(0);
    expect(r.projects[0]!.sessions[0]!.firstPrompt).toBe('first prompt');
  });

  // ---- sanity checks that should hold (regression guards) ----
  it('empty file and malformed-only file produce no sessions but are counted', async () => {
    const dir = makeProjectsDir({ p1: { 'empty.jsonl': '', 'junk.jsonl': '{oops\nnot json\n{"a":' } });
    const r = await buildReport(dir);
    expect(r.totals.sessions).toBe(0);
    expect(r.source.files).toBe(2);
    expect(r.source.skippedLines).toBe(3);
  });

  it('missing projects dir throws a clear error', async () => {
    await expect(buildReport(path.join(os.tmpdir(), 'cdesk-nope-' + Date.now()))).rejects.toThrow(/No Claude Code history/);
  });

  it('non-directory files in projects dir are ignored; subagents are counted per session', async () => {
    const dir = makeProjectsDir({
      p1: {
        's1.jsonl': [human(0, 'x'), reply(1, 1000)],
        's1/subagents/agent-a.jsonl': [reply(1, 10)],
        's1/subagents/agent-b.jsonl': [reply(1, 10)],
        's1/subagents/notes.txt': 'x',
      },
    });
    fs.writeFileSync(path.join(dir, 'stray.json'), '{}');
    const r = await buildReport(dir);
    expect(r.totals.sessions).toBe(1);
    expect(r.projects[0]!.sessions[0]!.subagents).toBe(2);
  });

  it('meta-only session is filtered out of the report', async () => {
    const dir = makeProjectsDir({ p1: { 'm.jsonl': [human(0, 'Caveat: x', { isMeta: true }), human(1, '<command-name>/x</command-name>')] } });
    const r = await buildReport(dir);
    expect(r.totals.sessions).toBe(0);
  });

  it('zero / missing usage does not create API calls', () => {
    const { summary } = parseSession('s', [
      human(0, 'x'),
      { ...reply(1, 0) },
      { type: 'assistant', timestamp: t(2), requestId: 'q', message: { content: [] } },
    ]);
    expect(summary.apiCalls).toBe(0);
    expect(summary.timeline).toEqual([]);
  });

  it('multiple compactions, one without metadata', () => {
    const { summary } = parseSession('s', [
      human(0, 'x'),
      reply(1, 150_000),
      { type: 'system', subtype: 'compact_boundary', timestamp: t(2), compactMetadata: { trigger: 'auto', preTokens: 160_000, postTokens: 20_000 } },
      reply(3, 90_000),
      { type: 'system', subtype: 'compact_boundary', timestamp: t(4) },
    ]);
    expect(summary.compactions).toHaveLength(2);
    expect(summary.compactions[1]).toEqual({ t: t(4), trigger: 'unknown', preTokens: null, postTokens: null });
    expect(summary.peakTokens).toBe(160_000);
  });

  it('tool_result with text + image blocks; unknown tool_use_id goes to "unknown"', () => {
    const { summary } = parseSession('s', [
      human(0, 'x'),
      toolUse(1, 1000, 'tu1', 'Read'),
      toolResult(2, 'tu1', [{ type: 'text', text: 'a'.repeat(350) }, { type: 'image', source: { data: 'b'.repeat(9999) } }]),
      toolResult(3, 'ghost', 'boom', true),
    ]);
    const read = summary.tools.find((x) => x.name === 'Read')!;
    expect(read.outputTokens).toBe(100 + 1600);
    // approved proposal: orphan results are not listed as a tool
    expect(summary.tools.find((x) => x.name === 'unknown')).toBeUndefined();
  });

  it('interrupts are signals but not human messages', () => {
    const { summary } = parseSession('s', [human(0, 'x'), reply(1, 3000), human(2, '[Request interrupted by user]')]);
    expect(summary.humanMessages).toBe(1);
    expect(summary.signals.map((s) => s.kind)).toEqual(['interrupt']);
  });

  it('long session downsampling keeps the peak, stays <= 400 points, preserves order', () => {
    const entries: unknown[] = [human(0, 'x')];
    for (let i = 0; i < 5003; i++) entries.push({ ...reply(0, 1000 + (i === 3777 ? 999_000 : i)), timestamp: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString() });
    const { summary } = parseSession('s', entries);
    expect(summary.timeline.length).toBeLessThanOrEqual(400);
    expect(Math.max(...summary.timeline.map((p) => p.tokens))).toBe(1_000_000);
    const ts = summary.timeline.map((p) => Date.parse(p.t));
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
    expect(summary.windowTokens).toBe(1_000_000);
  });

  it('window inference: exactly 200K stays 200K; [1m] model forces 1M', () => {
    expect(parseSession('a', [human(0, 'x'), reply(1, 200_000)]).summary.windowTokens).toBe(200_000);
    const m = { ...reply(1, 1000) } as Record<string, unknown>;
    m.message = { model: 'claude-x[1m]', content: [], usage: usage(1000) };
    expect(parseSession('b', [human(0, 'x'), m]).summary.windowTokens).toBe(1_000_000);
  });

  it('bucket boundaries: 25_000 -> 25–50K, 400_000 -> 400K+, 0 excluded', () => {
    const b = bucketize([sessionWith({ humanContexts: [0, 24_999, 25_000, 399_999, 400_000] })]);
    expect(b.map((x) => x.humanMessages)).toEqual([1, 1, 0, 0, 1, 1]);
  });

  it('activeMinutes with duplicate and unsorted timestamps', () => {
    const { summary } = parseSession('s', [human(5, 'x'), reply(5, 1000), reply(0, 1000), human(0, 'y'), reply(10, 1000)]);
    expect(summary.activeMinutes).toBe(10);
    expect(summary.start).toBe(t(0));
  });
});

// =====================================================================
describe('proposals', () => {
  // Proposal: sidechain entries should not extend the main session's start/end/active time or vote on its cwd.
  it('sidechain timestamps and cwd are ignored', () => {
    const { summary, cwd } = parseSession('s', [
      human(0, 'x'),
      reply(1, 1000),
      { ...reply(10, 1000), isSidechain: true, cwd: '/w/other' },
      { ...reply(11, 1000), isSidechain: true, cwd: '/w/other' },
      { ...reply(12, 1000), isSidechain: true, cwd: '/w/other' },
    ]);
    expect(summary.end).toBe(t(1));
    expect(cwd).toBe('/w/app');
  });

  // Proposal: a session's project is the cwd it started in (first entry), not the most frequent cwd after `cd`s.
  it('session spanning multiple cwds is grouped by its starting cwd', () => {
    const { cwd } = parseSession('s', [
      human(0, 'x', { cwd: '/w/app' }),
      { ...reply(1, 1000), cwd: '/w/app/sub' },
      { ...reply(2, 1000), cwd: '/w/app/sub' },
    ]);
    expect(cwd).toBe('/w/app');
  });

  // Proposal: after a compaction without postTokens the context size is unknown; signals before the next reply get 0 (excluded from buckets) instead of the stale pre-compaction size.
  it('signal right after metadata-less compaction is not attributed to the pre-compaction size', () => {
    const { summary } = parseSession('s', [
      human(0, 'x'),
      reply(1, 180_000),
      { type: 'system', subtype: 'compact_boundary', timestamp: t(2) },
      human(3, 'no, wrong'),
    ]);
    expect(summary.signals[0]!.tokens).toBe(0);
  });

  // Proposal: when one requestId is written several times, the last (final) usage is the one kept on the timeline.
  it('repeated requestId keeps the last usage on the timeline', () => {
    const { summary } = parseSession('s', [human(0, 'x'), reply(1, 10_000, 'rq'), reply(2, 12_000, 'rq')]);
    expect(summary.timeline).toEqual([{ t: t(2), tokens: 12_000 }]);
  });

  // Proposal: tool_results whose tool_use_id is unknown (e.g. tool_use lost to compaction) are not reported as a tool named "unknown".
  it('orphan tool_result is not listed as an "unknown" tool', () => {
    const { summary } = parseSession('s', [human(0, 'x'), reply(1, 1000), toolResult(2, 'ghost', 'out')]);
    expect(summary.tools.map((x) => x.name)).not.toContain('unknown');
  });

  // Proposal: a session started with a slash command uses the command as firstPrompt/title instead of falling back to the id.
  it('slash-command-only session gets a readable title', () => {
    const { summary } = parseSession('abcdef123456', [
      human(0, '<command-name>/review</command-name>\n<command-message>review</command-message>'),
      reply(1, 1000),
    ]);
    expect(summary.title).not.toBe('abcdef12');
  });

  // Proposal: entries without a timestamp should not produce timeline points / compactions with t === ''.
  it('assistant entry without timestamp is not added to the timeline with an empty t', () => {
    const { timestamp: _x, ...noTs } = reply(1, 5000) as Record<string, unknown>;
    const { summary } = parseSession('s', [human(0, 'x'), noTs]);
    expect(summary.timeline.every((p) => p.t !== '')).toBe(true);
  });

  // Proposal: project lastActive is the max end across its sessions, not the end of the latest-started one.
  it('project lastActive is the latest end across sessions', async () => {
    const dir = makeProjectsDir({
      p1: {
        'long.jsonl': [human(0, 'a'), reply(1, 1000), ...Array.from({ length: 30 }, (_, i) => reply(10 + i * 10, 1000))],
        'short.jsonl': [human(5, 'b'), reply(6, 1000)],
      },
    });
    const r = await buildReport(dir);
    expect(r.projects[0]!.lastActive).toBe(t(300));
  });
});
