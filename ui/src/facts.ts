import { bucketize } from '../../src/core/buckets';
import type { ContextBucket, Project, RuleFinding, SessionSummary } from '../../src/core/types';
import { fmtTokens } from './format';
import type { Dict } from './i18n';

export interface Kpi {
  id: string;
  label: string;
  value: string;
  sub: string;
  warn: boolean;
}

const MIN_BUCKET_N = 10;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

export const interventions = (b: ContextBucket) => b.humanMessages + b.interrupts + b.rejections;
export const steeringRate = (b: ContextBucket) => {
  const n = interventions(b);
  return n ? (b.corrections + b.interrupts + b.rejections) / n : 0;
};

/** Global rule findings live on every project; a project view shows its own plus wrong-stack ones. */
export function scopedFindings(projects: Project[], project: Project | null): RuleFinding[] {
  if (project) return project.ruleFindings.filter((f) => f.scope !== 'User' || f.kind === 'stack-mismatch');
  const seen = new Map<string, RuleFinding>();
  for (const p of projects) {
    for (const f of p.ruleFindings) {
      if (f.scope === 'User' && f.kind !== 'stack-mismatch') seen.set(`${f.kind}|${f.file}|${f.line}|${f.hint}`, f);
    }
  }
  return [...seen.values()];
}

/** Headline numbers for the selected scope. Every value is computed from the report; nothing is filled in. */
export function computeKpis(sessions: SessionSummary[], findings: RuleFinding[], t: Dict): Kpi[] {
  const kpis: Kpi[] = [];
  const measured = sessions.filter((s) => s.timeline.length > 0);

  if (measured.length) {
    kpis.push({
      id: 'start',
      label: t.kpi.start,
      value: fmtTokens(median(measured.map((s) => s.timeline[0]!.tokens))),
      sub: t.kpi.startSub,
      warn: false,
    });
    const over = measured.filter((s) => s.peakTokens > s.windowTokens * 0.4).length;
    kpis.push({
      id: 'over',
      label: t.kpi.over,
      value: `${over}/${measured.length}`,
      sub: t.kpi.overSub,
      warn: over > 0,
    });
  }

  const compactions = sessions.flatMap((s) => s.compactions);
  const drop = (c: (typeof compactions)[number]) => (c.preTokens ?? 0) - (c.postTokens ?? 0);
  const biggest = compactions.length ? compactions.reduce((a, b) => (drop(b) > drop(a) ? b : a)) : null;
  kpis.push({
    id: 'compaction',
    label: t.kpi.compaction,
    value:
      biggest && biggest.preTokens !== null && biggest.postTokens !== null
        ? `${fmtTokens(biggest.preTokens)}→${fmtTokens(biggest.postTokens)}`
        : String(compactions.length),
    sub: compactions.length ? t.kpi.compactionSub(compactions.length) : t.kpi.compactionNone,
    warn: compactions.length > 0,
  });

  const buckets = bucketize(sessions).filter((b) => interventions(b) >= MIN_BUCKET_N);
  const worst = buckets.length ? buckets.reduce((a, b) => (steeringRate(b) > steeringRate(a) ? b : a)) : null;
  if (worst && steeringRate(worst) > 0) {
    kpis.push({
      id: 'steering',
      label: t.kpi.steering,
      value: `${Math.round(steeringRate(worst) * 100)}%`,
      sub: t.kpi.steeringSub(worst.label, interventions(worst)),
      warn: false,
    });
  }

  const lintable = findings.filter((f) => f.kind === 'lintable').length;
  const wrong = findings.filter((f) => f.kind === 'stack-mismatch').length;
  const dups = findings.filter((f) => f.kind === 'duplicate').length;
  kpis.push({
    id: 'rules',
    label: wrong ? t.kpi.wrongStack : t.kpi.automatable,
    value: String(wrong || lintable),
    sub: wrong ? t.kpi.wrongStackSub(lintable) : t.kpi.automatableSub(dups),
    warn: wrong > 0,
  });

  return kpis;
}
