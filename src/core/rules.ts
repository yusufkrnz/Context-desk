import { estimateTokens } from './text.js';
import type { RuleFile, RuleFinding } from './types.js';

export interface RuleSource {
  path: string;
  scope: string;
  content: string;
}

export type Stack = 'android' | 'ios' | 'python' | 'node';

// Case-sensitive on purpose: "React"/"Swift" are stacks, "react quickly"/"swift feedback" are prose.
const STACK_KEYWORDS: Record<Stack, RegExp> = {
  android: /\b(Kotlin|Jetpack Compose|Compose|Gradle|Android|kotlin|gradle|android|Espresso|BuildConfig|SharedPreferences|EncryptedSharedPreferences|Keystore|Timber|ViewModels?|detekt)\b/g,
  ios: /\b(Swift|SwiftUI|Xcode|iOS|swiftui|xcode)\b(?![\w-]*\s*(feedback|release|cadence|response|turnaround))/g,
  python: /\b(Python|pytest|FastAPI|Django|pydantic|Pydantic|Alembic|python|fastapi|django)\b/g,
  node: /\b(TypeScript|React|Node\.?js|npm|Next\.js|Vite|typescript|node\.js|nodejs)\b(?!\s+(quickly|calmly|to)\b)/g,
};

// Rules a linter, formatter or hook can enforce on every change,
// instead of hoping the model notices them in a crowded context.
const LINTABLE: { re: RegExp; hint: string; needs?: RegExp }[] = [
  { re: /`any`|\bany\s+(types?|tipi?)\b|\b(typescript|types?)\b[^.]*\bany\b(?!\s+(time|case|way))/i, hint: 'lint:no-explicit-any' },
  {
    re: /\b(indent|indentation|girinti|semicolons?|noktalı virgül|single quotes?|double quotes?|tırnak|trailing comma|line length|satır uzunluğu)\b/i,
    hint: 'lint:formatter',
    // "paragraf girinti" in a writing guide is not a formatter rule
    needs: /\b(code|kod|files?|dosya|editor|spaces?|tabs?|boşluk|prettier|eslint|ruff|black|semicolons?|noktalı|quotes?|tırnak|comma|\d+)\b|\.(ts|js|py|kt|swift)\b/i,
  },
  { re: /\b(camelCase|PascalCase|snake_case|kebab-case)\b/, hint: 'lint:naming' },
  { re: /\b(import order|sort imports|import sırası)\b/i, hint: 'lint:imports' },
  { re: /(files?|dosya(lar)?|functions?|fonksiyon(lar)?)\s*[<≤]\s*\d+\s*(lines|satır)/i, hint: 'lint:max-lines' },
  { re: /\b(nesting|iç içe)\s*[<≤]\s*\d+/i, hint: 'lint:max-depth' },
  { re: /\bconsole\.log\b|\bprint\(\)/, hint: 'lint:no-console' },
  { re: /(`!!`|force unwrap|minimize\s+`?!`?)/i, hint: 'lint:force-unwrap' },
  { re: /(hardcoded|hard-coded|repoya yazılmaz|no (api )?keys? in code|secrets?.*(\.env|repo))/i, hint: 'hook:secret-scan' },
  { re: /\b(run|çalıştır)\w*\b.*\b(tests?|pytest|lint)\b.*\b(before|önce|after|sonra)\b/i, hint: 'hook:run-tests' },
];

const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+\S/;
const LIST_MARKER = /^\s*([-*+]|\d+[.)])\s+/;
const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;
const IMPORT_LINE = /^\s*@([\w./~-]+\.mdc?)\s*$/;
const FENCE = /^\s*(`{3,}|~{3,})/;
const THEMATIC_BREAK = /^\s*([*_-])(\s*\1){2,}\s*$/;
const FRONTMATTER = /^---\n[\s\S]*?\n---(\n|$)/;

export const LIMITS = {
  fileTokens: 2000,
  totalTokens: 5000,
  totalInstructions: 150,
};

interface Line {
  file: string;
  n: number;
  text: string;
}

function splitLines(content: string): string[] {
  const text = content.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  return text ? text.split('\n') : [];
}

/** Lines that read as one instruction each: list items and table body rows, outside code fences and frontmatter. */
function instructionLines(src: RuleSource): Line[] {
  const out: Line[] = [];
  let lines = splitLines(src.content);
  const fm = lines.join('\n').match(FRONTMATTER);
  // blank the frontmatter instead of dropping it so line numbers stay right
  if (fm) {
    const n = fm[0].replace(/\n$/, '').split('\n').length;
    lines = lines.map((l, i) => (i < n ? '' : l));
  }
  // HTML comments are not shown to the model; blank them, keeping line numbers
  lines = lines.join('\n').replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, '')).split('\n');
  let fence: string | null = null;
  let inTable = false;
  lines.forEach((raw, i) => {
    const f = raw.match(FENCE)?.[1];
    if (f) {
      if (fence === null) fence = f;
      else if (f[0] === fence[0] && f.length >= fence.length && raw.trim() === f) fence = null;
      return;
    }
    if (fence !== null) return;
    // A table starts at a header row followed by a separator; only body rows are instructions.
    if (TABLE_SEP.test(raw)) {
      inTable = raw.includes('|') && (lines[i - 1] ?? '').includes('|');
      return;
    }
    if (raw.includes('|') && TABLE_SEP.test(lines[i + 1] ?? '')) return;
    if (inTable && raw.includes('|')) {
      out.push({ file: src.path, n: i + 1, text: raw.trim() });
      return;
    }
    inTable = false;
    if (THEMATIC_BREAK.test(raw)) return;
    if (LIST_ITEM.test(raw)) out.push({ file: src.path, n: i + 1, text: raw.trim() });
  });
  return out;
}

function normalizeRule(text: string): string {
  return text
    .replace(LIST_MARKER, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stackCounts(content: string): Map<Stack, number> {
  const counts = new Map<Stack, number>();
  for (const [stack, re] of Object.entries(STACK_KEYWORDS) as [Stack, RegExp][]) {
    counts.set(stack, content.match(re)?.length ?? 0);
  }
  return counts;
}

/** A file "belongs" to another stack only if that stack dominates and the project's own stack barely appears. */
function foreignStack(content: string, projectStacks: Set<Stack>): Stack | null {
  const counts = stackCounts(content);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  let best: Stack | null = null;
  let bestCount = 0;
  for (const [stack, count] of counts) {
    if (count > bestCount) {
      best = stack;
      bestCount = count;
    }
  }
  if (!best || bestCount < 3 || bestCount / total < 0.6 || projectStacks.has(best)) return null;
  const own = [...projectStacks].reduce((sum, st) => sum + (counts.get(st) ?? 0), 0);
  return own >= 2 ? null : best;
}

/** Cursor .mdc rules with `alwaysApply: false` load only when matching files are touched. */
function isConditional(content: string): boolean {
  const fm = content.replace(/\r\n?/g, '\n').match(FRONTMATTER)?.[0] ?? '';
  return /^alwaysApply:\s*false\s*$/m.test(fm);
}

export function analyzeRules(
  sources: RuleSource[],
  projectStacks: Set<Stack> | null,
): { files: RuleFile[]; findings: RuleFinding[]; totalTokens: number } {
  const files: RuleFile[] = [];
  const findings: RuleFinding[] = [];
  const seen = new Map<string, Line>();
  let totalTokens = 0;
  let totalInstructions = 0;

  // the same file can be recorded more than once; the last copy wins
  const unique = [...new Map(sources.map((s) => [s.path, s])).values()];
  for (const src of unique) {
    const lines = instructionLines(src);
    const tokens = estimateTokens(src.content.length);
    const conditional = isConditional(src.content);
    const scope = src.scope;
    if (!conditional) {
      totalTokens += tokens;
      totalInstructions += lines.length;
    }
    files.push({
      path: src.path,
      scope,
      tokens,
      lines: splitLines(src.content).length,
      instructions: lines.length,
      conditional,
    });

    if (tokens > LIMITS.fileTokens) {
      findings.push({ kind: 'size', scope, file: src.path, line: null, text: `~${tokens} tokens`, hint: 'size:file' });
    }

    // an empty set means "folder exists, stack not recognized" (Go, Rust…): foreign single-stack files still count
    const stack = projectStacks ? foreignStack(src.content, projectStacks) : null;
    if (stack) {
      findings.push({ kind: 'stack-mismatch', scope, file: src.path, line: null, text: stack, hint: `stack:${stack}` });
    }

    splitLines(src.content).forEach((raw, i) => {
      const imp = raw.match(IMPORT_LINE)?.[1];
      if (imp) findings.push({ kind: 'import', scope, file: src.path, line: i + 1, text: imp, hint: `import:${imp}` });
    });

    for (const line of lines) {
      const lint = LINTABLE.find((l) => l.re.test(line.text) && (!l.needs || l.needs.test(line.text)));
      if (lint) findings.push({ kind: 'lintable', scope, file: line.file, line: line.n, text: line.text, hint: lint.hint });

      const key = normalizeRule(line.text);
      if (key.length < 15) continue;
      const prev = seen.get(key);
      if (prev) {
        findings.push({ kind: 'duplicate', scope, file: line.file, line: line.n, text: line.text, hint: `dup:${prev.file}:${prev.n}` });
      } else {
        seen.set(key, line);
      }
    }
  }

  if (totalTokens > LIMITS.totalTokens) {
    findings.push({ kind: 'size', scope: 'Total', file: '*', line: null, text: `~${totalTokens} tokens`, hint: 'size:total' });
  }
  if (totalInstructions > LIMITS.totalInstructions) {
    findings.push({ kind: 'count', scope: 'Total', file: '*', line: null, text: String(totalInstructions), hint: 'count:total' });
  }

  return { files, findings, totalTokens };
}
