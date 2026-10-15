import { bucketize } from '../../src/core/buckets';
import type { Project, RuleFinding, SessionSummary } from '../../src/core/types';
import { fmtTokens } from './format';
import type { Lang } from './i18n';

export interface Fact {
  /** Short label for the left column, e.g. "Start load". */
  label: string;
  text: string;
  tone: 'neutral' | 'warn';
}

const MIN_BUCKET_N = 10;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

/** Global rule findings live on every project; project-scope view shows its own plus wrong-stack ones. */
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

/** Plain statements computed from the report. Nothing is shown unless the data supports it. */
export function computeFacts(sessions: SessionSummary[], project: Project | null, findings: RuleFinding[], lang: Lang): Fact[] {
  const tr = lang === 'tr';
  const facts: Fact[] = [];
  const measured = sessions.filter((s) => s.timeline.length > 0);

  if (measured.length) {
    const start = median(measured.map((s) => s.timeline[0]!.tokens));
    facts.push({
      label: tr ? 'Başlangıç yükü' : 'Start load',
      text: tr
        ? `Oturumlar, sen ilk mesajı yazmadan medyan ${fmtTokens(start)} token ile açılıyor.`
        : `Sessions open at a median ${fmtTokens(start)} tokens before your first message.`,
      tone: 'neutral',
    });

    const over = measured.filter((s) => s.peakTokens > s.windowTokens * 0.4).length;
    facts.push({
      label: tr ? '%40 çizgisi' : '40% line',
      text:
        over === 0
          ? tr
            ? `${measured.length} oturumun hiçbiri pencerenin %40'ını geçmedi.`
            : `None of ${measured.length} sessions went past 40% of the window.`
          : tr
            ? `${measured.length} oturumun ${over} tanesi pencerenin %40'ını geçti.`
            : `${over} of ${measured.length} sessions went past 40% of the window.`,
      tone: over > 0 ? 'warn' : 'neutral',
    });
  }

  const compactions = sessions.flatMap((s) => s.compactions);
  if (compactions.length) {
    const biggest = compactions.reduce((a, b) => ((b.preTokens ?? 0) - (b.postTokens ?? 0) > (a.preTokens ?? 0) - (a.postTokens ?? 0) ? b : a));
    const drop = biggest.preTokens !== null && biggest.postTokens !== null ? `${fmtTokens(biggest.preTokens)} → ${fmtTokens(biggest.postTokens)}` : '';
    facts.push({
      label: tr ? 'Özetleme' : 'Compaction',
      text: tr
        ? `${compactions.length} kez özetlendi${drop ? `; en büyüğü ${drop}` : ''}. Sohbet içinde verdiğin talimatlar bu adımda kaybolabilir.`
        : `Compacted ${compactions.length} time${compactions.length > 1 ? 's' : ''}${drop ? `; largest ${drop}` : ''}. Instructions given mid-chat can be lost here.`,
      tone: 'warn',
    });
  }

  const toolTotals = new Map<string, number>();
  for (const s of sessions) for (const t of s.tools) toolTotals.set(t.name, (toolTotals.get(t.name) ?? 0) + t.outputTokens);
  const toolSum = [...toolTotals.values()].reduce((a, b) => a + b, 0);
  const top = [...toolTotals.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top && toolSum > 0) {
    const share = Math.round((top[1] / toolSum) * 100);
    facts.push({
      label: tr ? 'Araç çıktısı' : 'Tool output',
      text: tr
        ? `Araç çıktılarının %${share}'i ${top[0]} aracından geldi (~${fmtTokens(top[1])} token).`
        : `${share}% of tool output came from ${top[0]} (~${fmtTokens(top[1])} tokens).`,
      tone: 'neutral',
    });
  }

  const buckets = bucketize(sessions).filter((b) => b.humanMessages + b.interrupts + b.rejections >= MIN_BUCKET_N);
  const anySteering = buckets.some((b) => b.corrections + b.interrupts + b.rejections > 0);
  if (buckets.length && anySteering) {
    const rate = (b: (typeof buckets)[number]) =>
      (b.corrections + b.interrupts + b.rejections) / (b.humanMessages + b.interrupts + b.rejections);
    const worst = buckets.reduce((a, b) => (rate(b) > rate(a) ? b : a));
    const n = worst.humanMessages + worst.interrupts + worst.rejections;
    facts.push({
      label: tr ? 'Müdahale' : 'Steering',
      text: tr
        ? `En çok araya girdiğin aralık ${worst.label}: müdahalelerin %${Math.round(rate(worst) * 100)}'i düzeltme, durdurma ya da ret (n=${n}).`
        : `You step in most at ${worst.label}: ${Math.round(rate(worst) * 100)}% of interventions were corrections, stops or rejections (n=${n}).`,
      tone: 'neutral',
    });
  }

  const ruleFiles = project ? project.ruleFiles : [];
  const wrongStack = findings.filter((f) => f.kind === 'stack-mismatch').length;
  const lintable = findings.filter((f) => f.kind === 'lintable').length;
  const dups = findings.filter((f) => f.kind === 'duplicate').length;
  if (project && ruleFiles.length) {
    facts.push({
      label: tr ? 'Kural dosyaları' : 'Rule files',
      text: tr
        ? `${ruleFiles.length} dosya her oturuma yükleniyor (~${fmtTokens(project.ruleTokens)} token)${wrongStack ? `; ${wrongStack} tanesi bu projenin stack'i için yazılmamış` : ''}.`
        : `${ruleFiles.length} files load into every session (~${fmtTokens(project.ruleTokens)} tokens)${wrongStack ? `; ${wrongStack} were written for another stack` : ''}.`,
      tone: wrongStack ? 'warn' : 'neutral',
    });
  }
  if (lintable || dups) {
    facts.push({
      label: tr ? 'Devredilebilir' : 'Automatable',
      text: tr
        ? `${lintable} kuralı linter ya da hook zorlayabilir${dups ? `; ${dups} kural başka dosyada zaten var` : ''}.`
        : `${lintable} rules could be enforced by a linter or hook${dups ? `; ${dups} rules already exist in another file` : ''}.`,
      tone: 'neutral',
    });
  }

  return facts;
}
