// Shared between the analysis engine (Node) and the UI (browser).
// Everything here is derived locally from transcript files; nothing leaves the machine.

export interface Report {
  generatedAt: string;
  source: { tool: 'claude-code'; dir: string; files: number; skippedLines: number };
  totals: Totals;
  /** Steering signals bucketed by how full the context was when they happened. */
  signalsByContext: ContextBucket[];
  projects: Project[];
}

export interface Totals {
  projects: number;
  sessions: number;
  activeMinutes: number;
  apiCalls: number;
  humanMessages: number;
  signals: number;
  compactions: number;
  peakTokens: number;
}

export interface ContextBucket {
  label: string;
  minTokens: number;
  maxTokens: number | null;
  humanMessages: number;
  corrections: number;
  interrupts: number;
  rejections: number;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  sessions: SessionSummary[];
  activeMinutes: number;
  humanMessages: number;
  signals: number;
  compactions: number;
  peakTokens: number;
  lastActive: string;
  ruleFiles: RuleFile[];
  ruleFindings: RuleFinding[];
  /** Estimated tokens of all rule files loaded at session start. */
  ruleTokens: number;
}

export interface SessionSummary {
  id: string;
  title: string;
  firstPrompt: string;
  start: string;
  end: string;
  activeMinutes: number;
  models: string[];
  branch: string | null;
  apiCalls: number;
  humanMessages: number;
  /** Context size before each typed message (0 = before the first reply). */
  humanContexts: number[];
  peakTokens: number;
  /** Inferred from the largest context observed: 200K unless a turn went past it. */
  windowTokens: number;
  timeline: TimelinePoint[];
  compactions: Compaction[];
  signals: Signal[];
  repeatedErrors: RepeatedError[];
  composition: Composition | null;
  tools: ToolUsage[];
  subagents: number;
}

export interface TimelinePoint {
  /** ISO timestamp */
  t: string;
  tokens: number;
}

export interface Compaction {
  t: string;
  trigger: string;
  preTokens: number | null;
  postTokens: number | null;
}

export type SignalKind = 'correction' | 'interrupt' | 'rejection';

export interface Signal {
  t: string;
  kind: SignalKind;
  /** Context size of the turn right before this signal. */
  tokens: number;
  /** Redacted, trimmed user text (empty for rejections). */
  text: string;
}

export interface RepeatedError {
  tool: string;
  sample: string;
  count: number;
  first: string;
  last: string;
}

/** What the context was made of at the session's peak. Token counts are estimates except `measured`. */
export interface Composition {
  measured: number;
  at: string;
  parts: CompositionPart[];
}

export type CompositionKey =
  | 'rules'
  | 'conversation'
  | 'toolOutput'
  | 'summary'
  | 'attachments'
  | 'system';

export interface CompositionPart {
  key: CompositionKey;
  tokens: number;
}

export interface ToolUsage {
  name: string;
  calls: number;
  errors: number;
  outputTokens: number;
}

export interface RuleFile {
  path: string;
  scope: string;
  tokens: number;
  lines: number;
  instructions: number;
  /** Loaded only for matching files (Cursor `alwaysApply: false`); left out of totals. */
  conditional: boolean;
}

export type RuleFindingKind = 'size' | 'count' | 'lintable' | 'duplicate' | 'stack-mismatch' | 'import';

export interface RuleFinding {
  kind: RuleFindingKind;
  /** Scope of the file it came from: User (global), Project, Local, AutoMem, Nested; Total for project-wide sums. */
  scope: string;
  file: string;
  line: number | null;
  text: string;
  /** Short machine-friendly hint, rendered by the UI in the user's language. */
  hint: string;
}
