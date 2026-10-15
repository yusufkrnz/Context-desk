import type { RuleSource } from './rules.js';
import {
  IMAGE_TOKENS,
  classifyHuman,
  estimateTokens,
  isHumanText,
  isRejection,
  normalizeError,
  ownWords,
  redact,
  trimText,
} from './text.js';
import type {
  Compaction,
  Composition,
  CompositionKey,
  CompositionPart,
  RepeatedError,
  SessionSummary,
  Signal,
  TimelinePoint,
  ToolUsage,
} from './types.js';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const finiteOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const IDLE_GAP_MS = 15 * 60_000;
const MAX_TIMELINE_POINTS = 400;
const SMALL_WINDOW = 200_000;

// Attachments that describe the harness itself rather than adding text the model reads
// on every turn; their weight is covered by the "system" remainder.
const NON_CONTENT_ATTACHMENTS = new Set([
  'instructions',
  'nested_memory',
  'prompt_snapshot',
  'deferred_tools_record',
  'credential_org',
  'auto_mode',
  'command_permissions',
  'thinking_drop',
  'remote_session_change',
  'workflow_size_guideline_change',
  'total_tokens_reminder',
]);

export interface ParsedSession {
  summary: SessionSummary;
  cwd: string | null;
  ruleSources: RuleSource[];
}

type Acc = Record<Exclude<CompositionKey, 'system'>, number>;

const emptyAcc = (): Acc => ({ rules: 0, conversation: 0, toolOutput: 0, summary: 0, attachments: 0 });

function blockChars(content: unknown): { chars: number; images: number; text: string } {
  if (typeof content === 'string') return { chars: content.length, images: 0, text: content };
  let chars = 0;
  let images = 0;
  let text = '';
  for (const b of arr(content)) {
    if (!isObj(b)) continue;
    if (b.type === 'image') images += 1;
    else if (b.type === 'text') {
      chars += str(b.text).length;
      text += str(b.text);
    } else chars += JSON.stringify(b).length;
  }
  return { chars, images, text };
}

function contextTokens(usage: Obj): number {
  return num(usage.input_tokens) + num(usage.cache_read_input_tokens) + num(usage.cache_creation_input_tokens);
}

function downsample(points: TimelinePoint[]): TimelinePoint[] {
  if (points.length <= MAX_TIMELINE_POINTS) return points;
  const size = points.length / MAX_TIMELINE_POINTS;
  const out: TimelinePoint[] = [];
  for (let i = 0; i < MAX_TIMELINE_POINTS; i++) {
    const bin = points.slice(Math.floor(i * size), Math.floor((i + 1) * size));
    // keep the biggest point of each bin so peaks survive
    const best = bin.reduce((a, b) => (b.tokens > a.tokens ? b : a), bin[0]!);
    out.push(best);
  }
  return out;
}

function buildComposition(measured: number, at: string, acc: Acc): Composition {
  const keys = Object.keys(acc) as (keyof Acc)[];
  let estimated = keys.reduce((s, k) => s + acc[k], 0);
  // Estimates can overshoot the measured size; scale them down instead of showing >100%.
  const scale = estimated > measured && estimated > 0 ? measured / estimated : 1;
  const parts: CompositionPart[] = keys.map((key) => ({ key, tokens: Math.round(acc[key] * scale) }));
  estimated = parts.reduce((s, p) => s + p.tokens, 0);
  parts.push({ key: 'system', tokens: Math.max(0, measured - estimated) });
  return { measured, at, parts: parts.filter((p) => p.tokens > 0) };
}

export function parseSession(id: string, entries: unknown[], subagents = 0): ParsedSession {
  let cwd: string | null = null;
  let commandTitle = '';
  const models = new Set<string>();
  const ruleSources = new Map<string, RuleSource>();
  const toolNames = new Map<string, string>();
  const tools = new Map<string, ToolUsage>();
  const errors = new Map<string, RepeatedError>();
  /** requestId -> index in timeline */
  const requests = new Map<string, number>();
  const timeline: TimelinePoint[] = [];
  const compactions: Compaction[] = [];
  const signals: Signal[] = [];
  const stamps: number[] = [];
  const humanContexts: number[] = [];

  let title = '';
  let firstPrompt = '';
  let branch: string | null = null;
  let humanMessages = 0;
  let lastContext = 0;
  let peak = 0;
  let acc = emptyAcc();
  let composition: Composition | null = null;

  const tool = (name: string): ToolUsage => {
    let t = tools.get(name);
    if (!t) {
      t = { name, calls: 0, errors: 0, outputTokens: 0 };
      tools.set(name, t);
    }
    return t;
  };

  let afterRejection = false;
  for (const [index, e] of entries.entries()) {
    // subagent work running inside this file doesn't define the session's time or place
    if (!isObj(e) || e.isSidechain === true) continue;
    const ts = str(e.timestamp);
    const ms = ts ? Date.parse(ts) : NaN;
    if (Number.isFinite(ms)) stamps.push(ms);
    // a session belongs to the folder it started in, even after `cd`s
    if (cwd === null && typeof e.cwd === 'string' && e.cwd) cwd = e.cwd;
    if (typeof e.gitBranch === 'string' && e.gitBranch) branch = e.gitBranch;

    switch (e.type) {
      case 'ai-title':
      case 'summary':
        title = str(e.aiTitle) || str(e.summary) || title;
        break;

      case 'system':
        if (e.subtype === 'compact_boundary') {
          const meta = isObj(e.compactMetadata) ? e.compactMetadata : {};
          const post = finiteOrNull(meta.postTokens);
          compactions.push({
            t: ts,
            trigger: str(meta.trigger) || 'unknown',
            preTokens: finiteOrNull(meta.preTokens),
            postTokens: post,
          });
          // rule files are reloaded from disk; everything else on the desk is replaced by the summary
          acc = { ...emptyAcc(), rules: acc.rules };
          // without a post-size the context is unknown until the next reply; 0 keeps it out of the buckets
          lastContext = post ?? 0;
        }
        break;

      case 'attachment': {
        const a = isObj(e.attachment) ? e.attachment : {};
        const kind = str(a.type);
        if (kind === 'instructions') {
          for (const f of arr(a.files)) {
            if (!isObj(f) || !str(f.path)) continue;
            const isNew = !ruleSources.has(str(f.path));
            ruleSources.set(str(f.path), { path: str(f.path), scope: str(f.type), content: str(f.content) });
            if (isNew) acc.rules += estimateTokens(str(f.content).length);
          }
        } else if (kind === 'nested_memory') {
          const c = isObj(a.content) ? a.content : {};
          const path = str(a.path);
          if (path && !ruleSources.has(path)) {
            ruleSources.set(path, { path, scope: 'Nested', content: str(c.content) });
            acc.rules += estimateTokens(str(c.content).length);
          }
        } else if (!NON_CONTENT_ATTACHMENTS.has(kind)) {
          acc.attachments += estimateTokens(JSON.stringify(a).length);
        }
        break;
      }

      case 'assistant': {
        const msg = isObj(e.message) ? e.message : {};
        if (str(msg.model) && !str(msg.model).startsWith('<')) models.add(str(msg.model));
        for (const b of arr(msg.content)) {
          if (!isObj(b)) continue;
          if (b.type === 'text') acc.conversation += estimateTokens(str(b.text).length);
          if (b.type === 'tool_use') {
            const name = str(b.name) || 'unknown';
            toolNames.set(str(b.id), name);
            tool(name).calls += 1;
            acc.conversation += estimateTokens(JSON.stringify(b.input ?? {}).length);
          }
        }
        const usage = isObj(msg.usage) ? msg.usage : null;
        if (!usage) break;
        const tokens = contextTokens(usage);
        if (tokens <= 0) break;
        const req = str(e.requestId) || str(e.uuid) || `#${index}`;
        // One API response is written as several entries (one per content block) sharing the usage.
        // The last write of a request carries its final usage. Entries without a timestamp
        // still count as calls but can't be placed on the timeline.
        const seen = requests.get(req);
        if (seen === undefined) {
          requests.set(req, ts ? timeline.length : -1);
          if (ts) timeline.push({ t: ts, tokens });
        } else if (seen >= 0 && timeline[seen]) {
          timeline[seen] = { t: ts || timeline[seen]!.t, tokens };
        }
        afterRejection = false;
        lastContext = tokens;
        if (tokens > peak) {
          peak = tokens;
          composition = buildComposition(tokens, ts, acc);
        }
        break;
      }

      case 'user': {
        if (e.isMeta === true) break;
        const msg = isObj(e.message) ? e.message : {};
        const content = msg.content;
        if (e.isCompactSummary === true) {
          acc.summary += estimateTokens(blockChars(content).chars);
          break;
        }
        // several text blocks in one entry are one message
        const blockTexts: string[] = [];
        for (const b of arr(content)) {
          if (!isObj(b)) continue;
          if (b.type === 'text') blockTexts.push(str(b.text));
          else if (b.type === 'image') acc.conversation += IMAGE_TOKENS;
          else if (b.type === 'tool_result') {
            // a result whose call was lost (e.g. to compaction) still fills the desk, but isn't a tool of its own
            const name = toolNames.get(str(b.tool_use_id));
            const out = blockChars(b.content);
            const outTokens = estimateTokens(out.chars) + out.images * IMAGE_TOKENS;
            const t = name ? tool(name) : { name: 'unknown', calls: 0, errors: 0, outputTokens: 0 };
            t.outputTokens += outTokens;
            acc.toolOutput += outTokens;
            const text = out.text || (typeof b.content === 'string' ? b.content : '');
            if (isRejection(text)) {
              signals.push({ t: ts, kind: 'rejection', tokens: lastContext, text: '' });
              afterRejection = true;
            } else if (b.is_error === true) {
              t.errors += 1;
              const key = `${t.name}|${normalizeError(text)}`;
              const prev = errors.get(key);
              if (prev) {
                prev.count += 1;
                prev.last = ts;
              } else {
                errors.set(key, { tool: t.name, sample: trimText(redact(text), 160), count: 1, first: ts, last: ts });
              }
            }
          }
        }
        const texts = typeof content === 'string' ? [content] : blockTexts.length ? [blockTexts.join('\n')] : [];
        for (const text of texts) {
          acc.conversation += estimateTokens(text.length);
          const kind = classifyHuman(text);
          if (kind === 'interrupt') {
            // rejecting a tool call also writes an interrupt line; that is one moment, not two
            const echo = afterRejection && text.includes('for tool use');
            if (!echo) signals.push({ t: ts, kind, tokens: lastContext, text: '' });
            afterRejection = false;
            continue;
          }
          if (!isHumanText(text)) {
            const cmd = text.match(/<command-name>\s*([^<]+?)\s*<\/command-name>/)?.[1];
            const args = text.match(/<command-args>([^<]*)<\/command-args>/)?.[1]?.trim();
            if (cmd && !commandTitle) commandTitle = trimText(redact(args ? `${cmd} ${args}` : cmd), 140);
            continue;
          }
          humanMessages += 1;
          humanContexts.push(lastContext);
          if (!firstPrompt) firstPrompt = trimText(redact(ownWords(text) || text), 140);
          if (kind === 'correction') {
            signals.push({ t: ts, kind, tokens: lastContext, text: trimText(redact(ownWords(text)), 180) });
          }
        }
        break;
      }

      default:
        break;
    }
  }

  stamps.sort((a, b) => a - b);
  let activeMs = 0;
  for (let i = 1; i < stamps.length; i++) {
    const gap = stamps[i]! - stamps[i - 1]!;
    if (gap > 0 && gap <= IDLE_GAP_MS) activeMs += gap;
  }


  const iso = (ms: number | undefined) => (ms === undefined || Number.isNaN(ms) ? '' : new Date(ms).toISOString());
  const peakPre = compactions.reduce((m, c) => Math.max(m, c.preTokens ?? 0), 0);
  const observedPeak = Math.max(peak, peakPre);
  const oneM = [...models].some((m) => m.includes('[1m]'));

  return {
    cwd,
    ruleSources: [...ruleSources.values()],
    summary: {
      id,
      title: title || firstPrompt || commandTitle || id.slice(0, 8),
      firstPrompt,
      start: iso(stamps[0]),
      end: iso(stamps[stamps.length - 1]),
      activeMinutes: Math.round(activeMs / 60_000),
      models: [...models],
      branch,
      apiCalls: requests.size,
      humanMessages,
      humanContexts,
      peakTokens: observedPeak,
      windowTokens: oneM || observedPeak > SMALL_WINDOW ? 1_000_000 : SMALL_WINDOW,
      timeline: downsample(timeline),
      compactions,
      signals,
      repeatedErrors: [...errors.values()]
        .filter((r) => r.count >= 2)
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      composition,
      tools: [...tools.values()].sort((a, b) => b.outputTokens - a.outputTokens),
      subagents,
    },
  };
}
