import { useEffect, useMemo, useState } from 'react';
import { bucketize } from '../../src/core/buckets';
import type { Report, RuleFinding, SessionSummary } from '../../src/core/types';
import { CompositionBars, ContextChart, KIND_COLOR, Sparkline, SteeringBars } from './charts';
import { computeKpis, scopedFindings, type Kpi } from './facts';
import { fmtDate, fmtDuration, fmtTokens } from './format';
import { LangContext, detectLang, dictionaries, type Dict, type Lang, useT } from './i18n';
import { makeNamer, type Namer } from './mask';

interface Selection {
  project: string | null;
  session: string | null;
  share: boolean;
}

// Selection lives in the URL so reloads and shared links keep it.
function readHash(): Selection {
  const q = new URLSearchParams(location.hash.replace(/^#\/?\??/, ''));
  return { project: q.get('p'), session: q.get('s'), share: q.get('share') === '1' };
}
function writeHash(sel: Selection): void {
  const q = new URLSearchParams();
  if (sel.project) q.set('p', sel.project);
  if (sel.session) q.set('s', sel.session);
  if (sel.share) q.set('share', '1');
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
  const namer = useMemo(() => (report ? makeNamer(report, sel.share, t) : null), [report, sel.share, t]);
  const project = report?.projects.find((p) => p.id === sel.project) ?? null;

  return (
    <LangContext.Provider value={ctx}>
      <header className="bar">
        <span className="brand">
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <rect x="1" y="11" width="16" height="2.5" rx="1.25" fill="currentColor" />
            <rect x="3" y="4" width="4" height="7" rx="1" fill="var(--s1)" />
            <rect x="8" y="6.5" width="4" height="4.5" rx="1" fill="var(--s2)" />
            <rect x="13" y="8.5" width="3" height="2.5" rx="1" fill="var(--s3)" />
          </svg>
          context-desk
        </span>
        {report && namer && (
          <select
            className="scope"
            value={project?.id ?? ''}
            onChange={(e) => writeHash({ ...sel, project: e.target.value || null, session: null })}
            aria-label={t.project}
          >
            <option value="">
              {t.all} · {report.totals.sessions} {t.sessions}
            </option>
            {report.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {namer.project(p)} · {p.sessions.length} {t.sessions}
              </option>
            ))}
          </select>
        )}
        {project && namer && !namer.share && <span className="bar-meta mono">{namer.path(project)}</span>}
        <span className="spacer" />
        <label className="toggle" title={t.shareHint}>
          <input type="checkbox" checked={sel.share} onChange={(e) => writeHash({ ...sel, share: e.target.checked })} />
          <span className="track" aria-hidden="true" />
          {t.share}
        </label>
        <span className="pill">
          <i aria-hidden="true" />
          {t.localOnly}
        </span>
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
      ) : !report || !namer ? (
        <p className="state">{t.loading}</p>
      ) : report.totals.sessions === 0 ? (
        <p className="state">{t.empty}</p>
      ) : (
        <Dashboard report={report} sel={sel} namer={namer} />
      )}
    </LangContext.Provider>
  );
}

function Dashboard({ report, sel, namer }: { report: Report; sel: Selection; namer: Namer }) {
  const { t, lang } = useT();
  const project = report.projects.find((p) => p.id === sel.project) ?? null;
  const rows = useMemo(() => {
    const list = (project ? [project] : report.projects).flatMap((p) => p.sessions.map((s) => ({ p, s })));
    return list.sort((a, b) => b.s.start.localeCompare(a.s.start));
  }, [report, project]);
  const sessions = useMemo(() => rows.map((r) => r.s), [rows]);
  const current = rows.find((r) => r.s.id === sel.session) ?? rows[0];
  const findings = useMemo(() => scopedFindings(report.projects, project), [report, project]);
  const kpis = useMemo(() => computeKpis(sessions, findings, t), [sessions, findings, t]);
  const buckets = useMemo(() => bucketize(sessions), [sessions]);
  const globalFiles = project ? project.ruleFiles.filter((f) => f.scope === 'User').length : 0;

  return (
    <main className="dashboard">
      <section className="kpis">
        {kpis.map((k) => (
          <KpiTile key={k.id} kpi={k} />
        ))}
      </section>

      <section className="card context">
        {current ? (
          <>
            <header>
              <div className="min0">
                <h2 className="ellipsis">{namer.session(current.s)}</h2>
                <p className="muted small">
                  {!project && `${namer.project(current.p)} · `}
                  {fmtDate(current.s.start, lang)} · {fmtDuration(current.s.activeMinutes)} · {current.s.apiCalls} {t.calls}
                  {current.s.subagents ? ` · ${current.s.subagents} ${t.subagents}` : ''}
                  {current.s.repeatedErrors.length ? ` · ${current.s.repeatedErrors.length} ${t.repeated}` : ''}
                </p>
              </div>
              <div className="headline">
                <span className="mono big">{fmtTokens(current.s.peakTokens)}</span>
                <span className="muted small">
                  {t.peak} / {fmtTokens(current.s.windowTokens)} {t.window}
                </span>
              </div>
            </header>
            <div className="chart-box">
              {current.s.timeline.length > 1 ? (
                <ContextChart
                  points={current.s.timeline}
                  windowTokens={current.s.windowTokens}
                  compactions={current.s.compactions}
                  signals={current.s.signals}
                  quote={namer.quote}
                />
              ) : (
                <p className="muted small">{t.noTimeline}</p>
              )}
            </div>
            <footer className="legend">
              <span>
                <i style={{ background: KIND_COLOR.correction }} />
                {t.correction}
              </span>
              <span>
                <i style={{ background: KIND_COLOR.interrupt }} />
                {t.interrupt}
              </span>
              <span>
                <i style={{ background: KIND_COLOR.rejection }} />
                {t.rejection}
              </span>
              <span>
                <i className="dash" />
                {t.dumbZone}
              </span>
            </footer>
          </>
        ) : null}
      </section>

      <section className="card sessions">
        <header>
          <h3>{t.sessionsTitle}</h3>
          <span className="muted small">{rows.length}</span>
        </header>
        <ul>
          {rows.map(({ p, s }) => (
            <li key={s.id}>
              <button className={current?.s.id === s.id ? 'on' : ''} onClick={() => writeHash({ ...sel, session: s.id })}>
                <span className="s-text min0">
                  <span className="ellipsis">{namer.session(s)}</span>
                  <span className="muted small ellipsis">
                    {fmtDate(s.start, lang)}
                    {!project && ` · ${namer.project(p)}`}
                  </span>
                </span>
                <Sparkline points={s.timeline} />
                <span className="s-num">
                  <span className="mono">{fmtTokens(s.peakTokens)}</span>
                  <span className="dots">
                    {s.signals.slice(0, 6).map((sig, i) => (
                      <i key={i} style={{ background: KIND_COLOR[sig.kind] }} />
                    ))}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="card steering">
        <header>
          <h3>{t.steeringTitle}</h3>
          <span className="muted small">{t.steeringSub}</span>
        </header>
        <div className="chart-box">
          <SteeringBars buckets={buckets} />
        </div>
        <p className="foot muted">{t.heuristicNote}</p>
      </section>

      <section className="card deskcard">
        <header>
          <h3>{t.deskTitle}</h3>
          <span className="muted small">{t.deskSub}</span>
        </header>
        {current?.s.composition ? <CompositionBars composition={current.s.composition} /> : <p className="muted small">{t.noTimeline}</p>}
      </section>

      <section className="card rules">
        <header>
          <h3>{t.rulesTitle}</h3>
          <span className="muted small">{globalFiles ? t.globalNote(globalFiles) : findings.length}</span>
        </header>
        <Findings findings={findings} t={t} namer={namer} />
      </section>
    </main>
  );
}

function KpiTile({ kpi }: { kpi: Kpi }) {
  return (
    <div className={`kpi ${kpi.warn ? 'warn' : ''}`}>
      <span className="kpi-label">{kpi.label}</span>
      <span className="kpi-value mono">{kpi.value}</span>
      <span className="kpi-sub">{kpi.sub}</span>
    </div>
  );
}

function hintText(f: RuleFinding, t: Dict, namer: Namer): string {
  const [key, ...rest] = f.hint.split(':');
  if (key === 'dup') {
    const ref = rest.join(':');
    const at = ref.lastIndexOf(':');
    return `${t.hints.dup} ${namer.file(ref.slice(0, at)).replace(/^.*\//, '')}:${ref.slice(at + 1)}`;
  }
  if (key === 'stack') return `${rest.join(':')} · ${t.hints.stack}`;
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

function Findings({ findings, t, namer }: { findings: RuleFinding[]; t: Dict; namer: Namer }) {
  if (findings.length === 0) return <p className="muted small">{t.noFindings}</p>;
  const counts = KIND_ORDER.map((k) => [k, findings.filter((f) => f.kind === k).length] as const).filter(([, n]) => n > 0);
  const sorted = [...findings].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  return (
    <>
      <div className="chips">
        {counts.map(([k, n]) => (
          <span key={k} className={`chip ${k}`}>
            <b className="mono">{n}</b> {t.findingKinds[k]}
          </span>
        ))}
      </div>
      <ul className="findings">
        {sorted.map((f, i) => (
          <li key={i} className={f.kind}>
            <span className="mono file ellipsis" title={namer.share ? '' : f.file}>
              {f.file === '*' ? '' : namer.file(f.file).replace(/^.*\//, '')}
              {f.line ? `:${f.line}` : ''}
            </span>
            <span className="ellipsis">
              {!namer.share && (f.kind === 'lintable' || f.kind === 'duplicate') && <span className="rule">{cleanRule(f.text)} </span>}
              <span className="muted">{hintText(f, t, namer)}</span>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
