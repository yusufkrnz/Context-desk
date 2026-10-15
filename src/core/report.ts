import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import { analyzeRules, type RuleSource, type Stack } from './rules.js';
import { parseSession, type ParsedSession } from './session.js';
import { bucketize } from './buckets.js';
import type { Project, Report, SessionSummary } from './types.js';

export { bucketize };

export function defaultProjectsDir(): string {
  const base = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  return join(base, 'projects');
}

const STACK_MARKERS: [Stack, string[]][] = [
  ['android', ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts']],
  ['ios', ['Package.swift', 'Podfile']],
  ['python', ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile']],
  ['node', ['package.json']],
];

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.venv', 'venv', '__pycache__', '.next', 'Pods']);

/** Stacks used in a project folder. Looks two levels down so monorepos (backend/, frontend/app/) count. */
export function detectStacks(path: string, depth = 2): Set<Stack> | null {
  if (!existsSync(path)) return null;
  const stacks = new Set<Stack>();
  const visit = (dir: string, level: number): boolean => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return false;
    }
    for (const [stack, markers] of STACK_MARKERS) {
      if (markers.some((m) => names.includes(m))) stacks.add(stack);
    }
    if (names.some((n) => n.endsWith('.xcodeproj') || n.endsWith('.xcworkspace'))) stacks.add('ios');
    if (level < depth) {
      for (const n of names) {
        if (n.startsWith('.') || SKIP_DIRS.has(n)) continue;
        const child = join(dir, n);
        if (isDir(child)) visit(child, level + 1);
      }
    }
    return true;
  };
  return visit(path, 0) ? stacks : null;
}

async function readJsonl(file: string): Promise<{ entries: unknown[]; skipped: number }> {
  const entries: unknown[] = [];
  let skipped = 0;
  const rl = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  let first = true;
  for await (const raw of rl) {
    const line = first ? raw.replace(/^\uFEFF/, '') : raw;
    first = false;
    if (!line.trim()) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) entries.push(value);
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  return { entries, skipped };
}

function countSubagents(projectDir: string, sessionId: string): number {
  const dir = join(projectDir, sessionId, 'subagents');
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.jsonl')).length;
  } catch {
    return 0;
  }
}

function projectId(path: string): string {
  const name = basename(path).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'root';
  // the hash keeps /w/my-app and /w/my/app apart
  return `${name}-${createHash('sha1').update(path).digest('hex').slice(0, 6)}`;
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false; // dangling symlink, permission error
  }
}

export interface Progress {
  (done: number, total: number): void;
}

export async function buildReport(dir = defaultProjectsDir(), onProgress?: Progress): Promise<Report> {
  if (!existsSync(dir)) throw new Error(`No Claude Code history found at ${dir}`);

  const files: { projectDir: string; file: string; id: string }[] = [];
  for (const name of readdirSync(dir)) {
    const projectDir = join(dir, name);
    if (!isDir(projectDir)) continue;
    for (const f of readdirSync(projectDir)) {
      if (f.endsWith('.jsonl')) files.push({ projectDir, file: join(projectDir, f), id: f.replace(/\.jsonl$/, '') });
    }
  }

  let skippedLines = 0;
  const parsed: (ParsedSession & { folder: string })[] = [];
  for (const [i, f] of files.entries()) {
    const { entries, skipped } = await readJsonl(f.file);
    skippedLines += skipped;
    const p = parseSession(f.id, entries, countSubagents(f.projectDir, f.id));
    if (p.summary.apiCalls > 0 || p.summary.humanMessages > 0) parsed.push({ ...p, folder: basename(f.projectDir) });
    onProgress?.(i + 1, files.length);
  }

  // A session without cwd borrows the cwd its folder siblings used.
  const folderCwd = new Map<string, string>();
  for (const p of parsed) if (p.cwd && !folderCwd.has(p.folder)) folderCwd.set(p.folder, p.cwd);

  const byProject = new Map<string, (ParsedSession & { folder: string })[]>();
  for (const p of parsed) {
    const key = p.cwd ?? folderCwd.get(p.folder) ?? p.folder;
    byProject.set(key, [...(byProject.get(key) ?? []), p]);
  }

  const projects: Project[] = [];
  for (const [path, list] of byProject) {
    list.sort((a, b) => a.summary.start.localeCompare(b.summary.start));
    // later sessions win: they saw the most recent version of each rule file
    const rules = new Map<string, RuleSource>();
    for (const p of list) for (const r of p.ruleSources) rules.set(r.path, r);
    const analysis = analyzeRules([...rules.values()], detectStacks(path));
    const sessions: SessionSummary[] = list.map((p) => p.summary).reverse();
    projects.push({
      id: projectId(path),
      name: basename(path) || path,
      path,
      sessions,
      activeMinutes: sum(sessions, (s) => s.activeMinutes),
      humanMessages: sum(sessions, (s) => s.humanMessages),
      signals: sum(sessions, (s) => s.signals.length),
      compactions: sum(sessions, (s) => s.compactions.length),
      peakTokens: Math.max(0, ...sessions.map((s) => s.peakTokens)),
      lastActive: sessions.reduce((m, s) => (s.end > m ? s.end : m), ''),
      ruleFiles: analysis.files,
      ruleFindings: analysis.findings,
      ruleTokens: analysis.totalTokens,
    });
  }
  projects.sort((a, b) => b.lastActive.localeCompare(a.lastActive));

  const all = projects.flatMap((p) => p.sessions);
  return {
    generatedAt: new Date().toISOString(),
    source: { tool: 'claude-code', dir, files: files.length, skippedLines },
    totals: {
      projects: projects.length,
      sessions: all.length,
      activeMinutes: sum(all, (s) => s.activeMinutes),
      apiCalls: sum(all, (s) => s.apiCalls),
      humanMessages: sum(all, (s) => s.humanMessages),
      signals: sum(all, (s) => s.signals.length),
      compactions: sum(all, (s) => s.compactions.length),
      peakTokens: Math.max(0, ...all.map((s) => s.peakTokens)),
    },
    signalsByContext: bucketize(all),
    projects,
  };
}

function sum<T>(items: T[], f: (x: T) => number): number {
  return items.reduce((s, x) => s + f(x), 0);
}
