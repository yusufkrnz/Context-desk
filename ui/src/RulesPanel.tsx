import type { Project, RuleFile, RuleFinding } from '../../src/core/types';
import { fmtTokens, homeShort } from './format';
import { useT, type Dict } from './i18n';

export const isGlobal = (scope: string) => scope === 'User';

/** Global (~/.claude) rule files and their findings, deduplicated across projects. */
export function globalRuleData(projects: Project[]): { files: RuleFile[]; findings: RuleFinding[] } {
  const files = new Map<string, RuleFile>();
  const findings = new Map<string, RuleFinding>();
  for (const p of projects) {
    for (const f of p.ruleFiles) if (isGlobal(f.scope)) files.set(f.path, f);
    for (const f of p.ruleFindings) {
      // stack mismatches depend on the project, so they stay on the project page
      if (isGlobal(f.scope) && f.kind !== 'stack-mismatch') findings.set(`${f.kind}|${f.file}|${f.line}|${f.hint}`, f);
    }
  }
  return { files: [...files.values()], findings: [...findings.values()] };
}

function hintText(f: RuleFinding, t: Dict): string {
  const [key, ...rest] = f.hint.split(':');
  if (key === 'dup') {
    const ref = rest.join(':');
    const at = ref.lastIndexOf(':');
    return `${t.hints.dup} ${homeShort(ref.slice(0, at))}:${ref.slice(at + 1)}`;
  }
  if (key === 'stack') return `${t.hints.stack} (${rest.join(':')})`;
  if (key === 'import') return t.hints.import ?? '';
  return t.hints[f.hint] ?? f.hint;
}

const KIND_ORDER: RuleFinding['kind'][] = ['stack-mismatch', 'size', 'count', 'duplicate', 'lintable', 'import'];

export function RulesPanel({ files, findings }: { files: RuleFile[]; findings: RuleFinding[] }) {
  const { t } = useT();
  const max = Math.max(1, ...files.map((f) => f.tokens));
  const sorted = [...findings].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));

  return (
    <div className="rules">
      <ul className="files">
        {files.map((f) => (
          <li key={f.path}>
            <div className="file-head">
              <span className="mono">{homeShort(f.path)}</span>
              <span className="muted small">
                {isGlobal(f.scope) ? t.global : f.scope}
                {f.conditional ? ' · conditional' : ''}
              </span>
            </div>
            <div className="file-bar" aria-hidden="true">
              <span style={{ width: `${(f.tokens / max) * 100}%` }} />
            </div>
            <div className="muted small">
              ~{fmtTokens(f.tokens)} {t.tokens} · {f.instructions} {t.instructions}
            </div>
          </li>
        ))}
      </ul>
      <div>
        <h3>
          {t.findings} <span className="muted">({findings.length})</span>
        </h3>
        {sorted.length === 0 && <p className="muted">{t.noFindings}</p>}
        <ul className="findings">
          {sorted.map((f, i) => (
            <li key={i} className={`finding ${f.kind}`}>
              <span className="kind">{t.findingKinds[f.kind]}</span>
              {f.file !== '*' && (
                <span className="mono small muted">
                  {homeShort(f.file)}
                  {f.line ? `:${f.line}` : ''}
                </span>
              )}
              {f.kind !== 'stack-mismatch' && f.kind !== 'size' && f.kind !== 'count' && <code>{f.text}</code>}
              <span className="hint">{hintText(f, t)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
