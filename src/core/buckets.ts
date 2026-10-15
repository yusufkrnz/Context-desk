// Pure, no Node imports: shared by the report builder and the browser UI.
import type { ContextBucket, SessionSummary } from './types.js';

const BUCKETS: [string, number, number | null][] = [
  ['0–25K', 0, 25_000],
  ['25–50K', 25_000, 50_000],
  ['50–100K', 50_000, 100_000],
  ['100–200K', 100_000, 200_000],
  ['200–400K', 200_000, 400_000],
  ['400K+', 400_000, null],
];

function bucketOf(tokens: number): number {
  const i = BUCKETS.findIndex(([, min, max]) => tokens >= min && (max === null || tokens < max));
  return i === -1 ? BUCKETS.length - 1 : i;
}

export function bucketize(sessions: SessionSummary[]): ContextBucket[] {
  const buckets: ContextBucket[] = BUCKETS.map(([label, minTokens, maxTokens]) => ({
    label,
    minTokens,
    maxTokens,
    humanMessages: 0,
    corrections: 0,
    interrupts: 0,
    rejections: 0,
  }));
  for (const s of sessions) {
    // Before the first reply there is nothing to steer, so those moments are left out.
    for (const tokens of s.humanContexts) if (tokens > 0) buckets[bucketOf(tokens)]!.humanMessages += 1;
    for (const sig of s.signals) {
      if (sig.tokens <= 0) continue;
      const b = buckets[bucketOf(sig.tokens)]!;
      if (sig.kind === 'correction') b.corrections += 1;
      else if (sig.kind === 'interrupt') b.interrupts += 1;
      else b.rejections += 1;
    }
  }
  return buckets;
}
