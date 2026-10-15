import { useEffect, useMemo, useState } from 'react';
import type { Report } from '../../src/core/types';
import { Legend, KIND_COLOR, SteeringByContext } from './charts';
import { fmtDate, fmtDuration, fmtTokens, homeShort } from './format';
import { LangContext, detectLang, dictionaries, type Lang, useT } from './i18n';
import { ProjectView } from './ProjectView';
import { RulesPanel, globalRuleData } from './RulesPanel';
import { SessionView } from './SessionView';

type Route = (
  | { view: 'overview' }
  | { view: 'project'; pid: string }
  | { view: 'session'; pid: string; sid: string }
) & { tab: string | null };

function parseHash(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?');
  const tab = new URLSearchParams(query).get('tab');
  const parts = path.split('/').map(decodeURIComponent);
  if (parts[0] === 'p' && parts[1] && parts[2] === 's' && parts[3]) return { view: 'session', pid: parts[1], sid: parts[3], tab };
  if (parts[0] === 'p' && parts[1]) return { view: 'project', pid: parts[1], tab };
  return { view: 'overview', tab };
}

// The tab lives in the URL so back/forward and shared links land on the same tab.
const withTab = (base: string, tab?: string) => (tab ? `${base}?tab=${encodeURIComponent(tab)}` : base);
export const href = {
  overview: (tab?: string) => withTab('#/', tab),
  project: (pid: string, tab?: string) => withTab(`#/p/${encodeURIComponent(pid)}`, tab),
  session: (pid: string, sid: string, tab?: string) =>
    withTab(`#/p/${encodeURIComponent(pid)}/s/${encodeURIComponent(sid)}`, tab),
};

export interface TabDef {
  id: string;
  label: string;
  count?: number;
}

/** Picks the active tab from the URL, falling back to the first one. */
export function activeTab(tabs: TabDef[], requested: string | null): string {
  return tabs.some((t) => t.id === requested) ? requested! : tabs[0]!.id;
}

export function Tabs({ tabs, active, link }: { tabs: TabDef[]; active: string; link: (id: string) => string }) {
  return (
    <nav className="tabs" role="tablist">
      {tabs.map((t) => (
        <a key={t.id} role="tab" aria-selected={t.id === active} className={t.id === active ? 'on' : ''} href={link(t.id)}>
          {t.label}
          {t.count !== undefined && <span className="count-badge">{t.count}</span>}
        </a>
      ))}
    </nav>
  );
}

export function App() {
  const [lang, setLang] = useState<Lang>(detectLang);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState(false);
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));

  useEffect(() => {
    fetch('/api/report')
      .then((r) => (r.ok ? (r.json() as Promise<Report>) : Promise.reject(new Error(String(r.status)))))
      .then(setReport)
      .catch(() => setError(true));
  }, []);

  useEffect(() => {
    const onHash = () => {
      const next = parseHash(location.hash);
      setRoute((prev) => {
        // switching tabs keeps the scroll position; changing pages starts at the top
        const samePage = prev.view === next.view && JSON.stringify({ ...prev, tab: null }) === JSON.stringify({ ...next, tab: null });
        if (!samePage) window.scrollTo(0, 0);
        return next;
      });
    };
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

  let body: JSX.Element;
  if (error) body = <p className="state">{t.loadError}</p>;
  else if (!report) body = <p className="state">{t.loading}</p>;
  else if (report.totals.sessions === 0) body = <p className="state">{t.empty}</p>;
  else if (route.view === 'overview') body = <Overview report={report} tab={route.tab} />;
  else {
    const project = report.projects.find((p) => p.id === route.pid);
    const session = route.view === 'session' ? project?.sessions.find((s) => s.id === route.sid) : undefined;
    if (!project) body = <Overview report={report} tab={null} />;
    else if (route.view === 'session' && session) body = <SessionView project={project} session={session} tab={route.tab} />;
    else body = <ProjectView project={project} tab={route.view === 'project' ? route.tab : null} />;
  }

  return (
    <LangContext.Provider value={ctx}>
      <header className="top">
        <a className="brand" href={href.overview()}>
          <span className="logo" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          context-desk
        </a>
        <span className="badge">{t.localOnly}</span>
        <div className="lang" role="group" aria-label="Language">
          {(['tr', 'en'] as Lang[]).map((l) => (
            <button key={l} className={l === lang ? 'on' : ''} onClick={() => setLang(l)}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </header>
      <main>{body}</main>
      <footer>
        <span>{t.footer}</span>
        <span>
          {t.footerProject} <a href="https://rendip.app" target="_blank" rel="noreferrer">rendip.app</a>
        </span>
      </footer>
    </LangContext.Provider>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function Overview({ report, tab }: { report: Report; tab: string | null }) {
  const { t, lang } = useT();
  const { totals } = report;
  const global = globalRuleData(report.projects);
  const tabs: TabDef[] = [
    { id: 'steering', label: t.tabSteering },
    { id: 'projects', label: t.projects, count: report.projects.length },
    ...(global.files.length ? [{ id: 'rules', label: t.ruleFiles, count: global.findings.length }] : []),
  ];
  const active = activeTab(tabs, tab);

  return (
    <>
      <section className="hero">
        <h1>{t.tagline}</h1>
        <p className="muted mono">{homeShort(report.source.dir)}</p>
      </section>

      <section className="stats">
        <Stat label={t.projects} value={String(totals.projects)} />
        <Stat label={t.sessions} value={String(totals.sessions)} />
        <Stat label={t.activeTime} value={fmtDuration(totals.activeMinutes)} />
        <Stat label={t.steering} value={String(totals.signals)} />
        <Stat label={t.compactions} value={String(totals.compactions)} />
        <Stat label={t.peak} value={fmtTokens(totals.peakTokens)} />
      </section>

      <Tabs tabs={tabs} active={active} link={(id) => href.overview(id)} />

      {active === 'steering' && (
        <section className="card">
          <h2>{t.whenTitle}</h2>
          <p className="sub">{t.whenSub}</p>
          <Legend
            items={[
              { color: KIND_COLOR.correction, label: t.correction },
              { color: KIND_COLOR.interrupt, label: t.interrupt },
              { color: KIND_COLOR.rejection, label: t.rejection },
            ]}
          />
          <SteeringByContext buckets={report.signalsByContext} />
          <p className="note">{t.whenNote}</p>
        </section>
      )}

      {active === 'projects' && (
        <section className="card flush">
          <div className="table-wrap">
            <table className="list">
              <thead>
                <tr>
                  <th>{t.project}</th>
                  <th className="num">{t.sessions}</th>
                  <th className="num">{t.activeTime}</th>
                  <th className="num">{t.peak}</th>
                  <th className="num">{t.steering}</th>
                  <th className="num">{t.compactions}</th>
                  <th className="num">{t.lastActive}</th>
                </tr>
              </thead>
              <tbody>
                {report.projects.map((p) => (
                  <tr key={p.id} className="link" onClick={() => (location.hash = href.project(p.id))}>
                    <td>
                      <a href={href.project(p.id)}>{p.name}</a>
                      <div className="muted mono small">{homeShort(p.path)}</div>
                    </td>
                    <td className="num">{p.sessions.length}</td>
                    <td className="num">{fmtDuration(p.activeMinutes)}</td>
                    <td className="num">
                      <PeakCell tokens={p.peakTokens} />
                    </td>
                    <td className="num">{p.signals}</td>
                    <td className="num">{p.compactions}</td>
                    <td className="num muted">{fmtDate(p.lastActive, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {active === 'rules' && (
        <section className="card">
          <p className="sub">{t.globalRulesSub}</p>
          <RulesPanel files={global.files} findings={global.findings} />
        </section>
      )}
    </>
  );
}

export function PeakCell({ tokens }: { tokens: number }) {
  const pct = Math.min(1, tokens / 1_000_000);
  return (
    <span className="peak">
      <span className="peak-bar" aria-hidden="true">
        <span style={{ width: `${Math.max(2, pct * 100)}%` }} />
      </span>
      {fmtTokens(tokens)}
    </span>
  );
}
