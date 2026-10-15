import type { Project } from '../../src/core/types';
import { PeakCell, Stat, Tabs, activeTab, href, type TabDef } from './App';
import { KIND_COLOR, Sparkline } from './charts';
import { fmtDate, fmtDuration, fmtTokens, homeShort } from './format';
import { useT } from './i18n';
import { RulesPanel, isGlobal } from './RulesPanel';

export function ProjectView({ project, tab }: { project: Project; tab: string | null }) {
  const { t, lang } = useT();
  const own = project.ruleFiles.filter((f) => !isGlobal(f.scope));
  const globalCount = project.ruleFiles.length - own.length;
  // stack mismatches are project-specific even for global files
  const findings = project.ruleFindings.filter((f) => !isGlobal(f.scope) || f.kind === 'stack-mismatch');
  const tabs: TabDef[] = [
    { id: 'sessions', label: t.sessions, count: project.sessions.length },
    { id: 'rules', label: t.ruleFiles, count: findings.length },
  ];
  const active = activeTab(tabs, tab);

  return (
    <>
      <a className="back" href={href.overview('projects')}>
        ← {t.projects}
      </a>
      <section className="hero">
        <h1>{project.name}</h1>
        <p className="muted mono">{homeShort(project.path)}</p>
      </section>

      <section className="stats">
        <Stat label={t.sessions} value={String(project.sessions.length)} />
        <Stat label={t.activeTime} value={fmtDuration(project.activeMinutes)} />
        <Stat label={t.steering} value={String(project.signals)} />
        <Stat label={t.compactions} value={String(project.compactions)} />
        <Stat label={t.peak} value={fmtTokens(project.peakTokens)} />
        <Stat label={t.ruleFiles} value={`~${fmtTokens(project.ruleTokens)}`} sub={`${project.ruleFiles.length} ${t.files}`} />
      </section>

      <Tabs tabs={tabs} active={active} link={(id) => href.project(project.id, id)} />

      {active === 'sessions' && (
        <section className="card flush">
          <ul className="sessions">
            {project.sessions.map((s) => (
              <li key={s.id}>
                <a href={href.session(project.id, s.id)}>
                  <div className="s-main">
                    <div className="s-title">{s.title}</div>
                    <div className="muted small">
                      {fmtDate(s.start, lang)} · {fmtDuration(s.activeMinutes)} · {s.humanMessages} {t.messages}
                      {s.subagents ? ` · ${s.subagents} ${t.subagents}` : ''}
                    </div>
                  </div>
                  <Sparkline points={s.timeline} windowTokens={s.windowTokens} />
                  <div className="s-meta">
                    <PeakCell tokens={s.peakTokens} />
                    <span className="dots" aria-label={`${s.signals.length} ${t.steering}`}>
                      {s.signals.slice(0, 12).map((sig, i) => (
                        <i key={i} style={{ background: KIND_COLOR[sig.kind] }} />
                      ))}
                      {s.signals.length > 12 && <span className="muted small">+{s.signals.length - 12}</span>}
                    </span>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {active === 'rules' && (
        <section className="card">
          <p className="sub">{t.ruleFilesSub}</p>
          {globalCount > 0 && (
            <p className="note">
              + {globalCount} {t.globalOnProject} <a href={href.overview('rules')}>{t.overview}</a>
            </p>
          )}
          <RulesPanel files={own} findings={findings} />
        </section>
      )}
    </>
  );
}
