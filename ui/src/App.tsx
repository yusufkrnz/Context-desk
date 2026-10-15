import { useEffect, useMemo, useState } from 'react';
import type { Report, RuleFinding, SessionSummary } from '../../src/core/types';
import { CompositionBar, ContextChart, KIND_COLOR, Sparkline } from './charts';
import { computeFacts, scopedFindings } from './facts';
import { fmtDate, fmtDuration, fmtMoment, fmtTokens, homeShort } from './format';
import { LangContext, detectLang, dictionaries, type Dict, type Lang, useT } from './i18n';

interface Selection {
  project: string | null;
  session: string | null;
}

// Selection lives in the URL so reloads and shared links keep it.
function readHash(): Selection {
  const q = new URLSearchParams(location.hash.replace(/^#\/?\??/, ''));
  return { project: q.get('p'), session: q.get('s') };
}
function writeHash(sel: Selection): void {
  const q = new URLSearchParams();
  if (sel.project) q.set('p', sel.project);
  if (sel.session) q.set('s', sel.session);
  location.hash = q.toString();
}

export function App() {
  const [lang, setLang] = useState<Lang>(detectLang);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState(false);
  const [sel, setSel] = useState<Selection>(readHash);

  useEffect(() => {
    fetch('/api/report')
      .then((r) => (r.ok ? (r.json() as Promise<Report>) : Promise.reject(new Error(String(r.status)))))
      .then(setReport)
      .catch(() => setError(true));
    const onHash = () => setSel(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem('cd-lang', lang);
    } catch {
      // per-viewer convenience only
    }
  }, [lang]);

  const ctx = useMemo(() => ({ lang, t: dictionaries[lang] }), [lang]);
  const t = ctx.t;

  return (
    <LangContext.Provider value={ctx}>
      <header className="bar">
        <span className="brand">context-desk</span>
        {report && (
          <span className="bar-meta mono">
            {homeShort(report.source.dir)} · {report.totals.sessions} {t.sessions} · {fmtDuration(report.totals.activeMinutes)}
          </span>
        )}
        <span className="bar-meta">{t.localOnly}</span>
        <span className="lang">
          {(['tr', 'en'] as Lang[]).map((l) => (
            <button key={l} className={l === lang ? 'on' : ''} onClick={() => setLang(l)}>
              {l.toUpperCase()}
            </button>
          ))}
        </span>
      </header>
      {error ? (
        <p className="state">{t.loadError}</p>
      ) : !report ? (
        <p className="state">{t.loading}</p>
      ) : report.totals.sessions === 0 ? (
        <p className="state">{t.empty}</p>
      ) : (
        <Dashboard report={report} sel={sel} />
      )}
    </LangContext.Provider>
  );
}

function Dashboard({ report, sel }: { report: Report; sel: Selection }) {
  const { t, lang } = useT();
  const project = report.projects.find((p) => p.id === sel.project) ?? null;
  const rows = useMemo(() => {
    const list = (project ? [project] : report.projects).flatMap((p) => p.sessions.map((s) => ({ p, s })));
    return list.sort((a, b) => b.s.start.localeCompare(a.s.start));
  }, [report, project]);
  const current = rows.find((r) => r.s.id === sel.session) ?? rows[0];
  const findings = useMemo(() => scopedFindings(report.projects, project), [report, project]);
  const facts = useMemo(
    () => computeFacts(rows.map((r) => r.s), project, findings, lang),
    [rows, project, findings, lang],
  );
  const globalFiles = project ? project.ruleFiles.filter((f) => f.scope === 'User').length : 0;

  return (
    <div className="grid">
      <aside className="panel projects">
        <h2>{t.projects}</h2>
        <ul>
          <ProjectRow
            active={!project}
            name={t.all}
            count={report.totals.sessions}
            peak={report.totals.peakTokens}
            onClick={() => writeHash({ project: null, session: null })}
          />
          {report.projects.map((p) => (
            <ProjectRow
              key={p.id}
              active={project?.id === p.id}
              name={p.name}
              title={homeShort(p.path)}
              count={p.sessions.length}
              peak={p.peakTokens}
              onClick={() => writeHash({ project: p.id, session: null })}
            />
          ))}
        </ul>
      </aside>

      <section className="panel facts">
        <h2>
          {t.facts}
          {project && <span> · {project.name}</span>}
        </h2>
        <dl>
          {facts.map((f) => (
            <div key={f.label} className={f.tone}>
              <dt>{f.label}</dt>
              <dd>{f.text}</dd>
            </div>
          ))}
        </dl>
        <p className="note">{t.heuristicNote}</p>
      </section>

      <section className="panel sessions">
        <table>
          <thead>
            <tr>
              <th />
              <th className="spark-col" />
              <th className="num">{t.peak}</th>
              <th className="num">{t.steer}</th>
              <th className="num">{t.compact}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, s }) => (
              <tr
                key={s.id}
                className={current?.s.id === s.id ? 'on' : ''}
                onClick={() => writeHash({ project: project?.id ?? null, session: s.id })}
              >
                <td className="title-cell">
                  <div className="ellipsis">{s.title}</div>
                  <div className="muted small">
                    {fmtDate(s.start, lang)} · {fmtDuration(s.activeMinutes)}
                    {!project && ` · ${p.name}`}
                  </div>
                </td>
                <td className="spark-col">
                  <Sparkline points={s.timeline} windowTokens={s.windowTokens} />
                </td>
                <td className="num mono">{fmtTokens(s.peakTokens)}</td>
                <td className="num mono">{s.signals.length || ''}</td>
                <td className="num mono">{s.compactions.length || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel detail">{current && <SessionDetail s={current.s} />}</section>

      <section className="panel rules">
        <h2>
          {t.findings} <span>{findings.length}</span>
        </h2>
        {globalFiles > 0 && (
          <p className="note top">
            + {globalFiles} {t.globalNote}
          </p>
        )}
        <Findings findings={findings} t={t} />
      </section>
    </div>
  );
}

function ProjectRow(props: { active: boolean; name: string; title?: string; count: number; peak: number; onClick: () => void }) {
  return (
    <li>
      <button className={props.active ? 'on' : ''} onClick={props.onClick} title={props.title}>
        <span className="ellipsis">{props.name}</span>
        <span className="muted mono small">{props.count}</span>
        <span className="mono small">{fmtTokens(props.peak)}</span>
      </button>
    </li>
  );
}

function SessionDetail({ s }: { s: SessionSummary }) {
  const { t, lang } = useT();
  return (
    <>
      <h2 className="ellipsis" title={s.title}>
        {s.title}
      </h2>
      <p className="meta muted small">
        {fmtDate(s.start, lang)} · {fmtDuration(s.activeMinutes)} · {s.apiCalls} {t.calls} · {t.peak.toLowerCase()} {fmtTokens(s.peakTokens)} / {fmtTokens(s.windowTokens)}
        {s.subagents ? ` · ${s.subagents} ${t.subagents}` : ''}
        {s.branch ? ` · ${s.branch}` : ''}
      </p>
      {s.timeline.length > 1 ? (
        <ContextChart points={s.timeline} windowTokens={s.windowTokens} compactions={s.compactions} signals={s.signals} />
      ) : (
        <p className="muted small">{t.noTimeline}</p>
      )}
      <p className="legend small muted">
        <i style={{ background: KIND_COLOR.correction }} /> {t.correction}
        <i style={{ background: KIND_COLOR.interrupt }} /> {t.interrupt}
        <i style={{ background: KIND_COLOR.rejection }} /> {t.rejection}
        <i className="dash" /> {t.dumbZone}
      </p>

      {s.composition && (
        <>
          <h3>
            {t.desk} <span className="muted">· {fmtTokens(s.composition.measured)} · {t.deskNote}</span>
          </h3>
          <CompositionBar composition={s.composition} />
        </>
      )}

      {s.signals.length > 0 && (
        <ul className="signals">
          {s.signals.map((sig, i) => (
            <li key={i}>
              <i style={{ background: KIND_COLOR[sig.kind] }} />
              <span className="mono muted">{fmtMoment(sig.t, s.start, lang)}</span>
              <span className="mono muted">{sig.tokens ? fmtTokens(sig.tokens) : '–'}</span>
              <span className="ellipsis" title={sig.text}>
                {sig.text ? `“${sig.text}”` : t[sig.kind]}
              </span>
            </li>
          ))}
        </ul>
      )}

      {s.repeatedErrors.length > 0 && (
        <>
          <h3>{t.repeated}</h3>
          <ul className="errors">
            {s.repeatedErrors.map((e, i) => (
              <li key={i}>
                <span className="mono count">{e.count}×</span>
                <span className="mono muted">{e.tool}</span>
                <span className="mono ellipsis" title={e.sample}>
                  {e.sample}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/** Auto-memory files live under an encoded project folder; the folder name adds nothing. */
function shortPath(path: string): string {
  return homeShort(path).replace(/^~\/\.claude\/projects\/[^/]+\//, '~/.claude/projects/…/');
}

function hintText(f: RuleFinding, t: Dict): string {
  const [key, ...rest] = f.hint.split(':');
  if (key === 'dup') {
    const ref = rest.join(':');
    const at = ref.lastIndexOf(':');
    return `${t.hints.dup} ${shortPath(ref.slice(0, at)).replace(/^.*\//, '')}:${ref.slice(at + 1)}`;
  }
  if (key === 'stack') return `${rest.join(':')}: ${t.hints.stack}`;
  if (key === 'import') return t.hints.import ?? '';
  return t.hints[f.hint] ?? f.hint;
}

/** The rule as written, without its list marker or decorative emoji. */
function cleanRule(text: string): string {
  return text
    .replace(/^\s*([-*+]|\d+[.)])\s+/, '')
    .replace(/[\p{Extended_Pictographic}\u{FE0F}]/gu, '')
    .trim();
}

const KIND_ORDER: RuleFinding['kind'][] = ['stack-mismatch', 'size', 'count', 'duplicate', 'lintable', 'import'];

function Findings({ findings, t }: { findings: RuleFinding[]; t: Dict }) {
  if (findings.length === 0) return <p className="muted small">{t.noFindings}</p>;
  const sorted = [...findings].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  return (
    <table className="findings">
      <tbody>
        {sorted.map((f, i) => (
          <tr key={i} className={f.kind}>
            <td className="kind">{t.findingKinds[f.kind]}</td>
            <td className="mono where" title={f.file === '*' ? '' : shortPath(f.file)}>
              {f.file === '*' ? '' : f.file.replace(/^.*\//, '')}
              {f.line ? `:${f.line}` : ''}
            </td>
            <td>
              {(f.kind === 'lintable' || f.kind === 'duplicate' || f.kind === 'import') && (
                <span className="rule">{cleanRule(f.text)} </span>
              )}
              <span className="muted">{hintText(f, t)}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
