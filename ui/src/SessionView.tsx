import type { Project, SessionSummary } from '../../src/core/types';
import { Stat, href } from './App';
import { CompositionBar, ContextChart, KIND_COLOR, Legend } from './charts';
import { fmtDate, fmtDuration, fmtMoment, fmtTime, fmtTokens } from './format';
import { useT } from './i18n';

export function SessionView({ project, session: s }: { project: Project; session: SessionSummary }) {
  const { t, lang } = useT();
  const tools = s.tools.filter((x) => x.calls > 0).slice(0, 10);
  const maxOut = Math.max(1, ...tools.map((x) => x.outputTokens));

  return (
    <>
      <a className="back" href={href.project(project.id)}>
        ← {project.name}
      </a>
      <section className="hero">
        <h1>{s.title}</h1>
        <p className="muted">
          {fmtDate(s.start, lang)} {fmtTime(s.start, lang)} · {s.models.join(', ')}
          {s.branch ? ` · ${s.branch}` : ''}
        </p>
      </section>

      <section className="stats">
        <Stat label={t.activeTime} value={fmtDuration(s.activeMinutes)} />
        <Stat label={t.apiCalls} value={String(s.apiCalls)} />
        <Stat label={t.peak} value={fmtTokens(s.peakTokens)} sub={`${t.window} ${fmtTokens(s.windowTokens)}`} />
        <Stat label={t.compactions} value={String(s.compactions.length)} />
        <Stat label={t.steering} value={String(s.signals.length)} />
        <Stat label={t.subagentsLabel} value={String(s.subagents)} />
      </section>

      <section className="card">
        <h2>{t.contextOverTime}</h2>
        <p className="sub">{t.contextSub}</p>
        {s.timeline.length > 1 ? (
          <>
            <Legend
              items={[
                { color: KIND_COLOR.correction, label: t.correction },
                { color: KIND_COLOR.interrupt, label: t.interrupt },
                { color: KIND_COLOR.rejection, label: t.rejection },
              ]}
            />
            <ContextChart points={s.timeline} windowTokens={s.windowTokens} compactions={s.compactions} signals={s.signals} />
          </>
        ) : (
          <p className="muted">{t.noTimeline}</p>
        )}
      </section>

      <div className="grid2">
        <section className="card">
          <h2>{t.atPeak}</h2>
          <p className="sub">{t.atPeakSub}</p>
          {s.composition ? <CompositionBar composition={s.composition} /> : <p className="muted">{t.none}</p>}
        </section>

        <section className="card">
          <h2>{t.tools}</h2>
          <table className="list compact">
            <thead>
              <tr>
                <th />
                <th className="num">{t.calls}</th>
                <th className="num">{t.errors}</th>
                <th>{t.output}</th>
              </tr>
            </thead>
            <tbody>
              {tools.map((x) => (
                <tr key={x.name}>
                  <td className="mono small">{x.name.replace(/^mcp__/, '')}</td>
                  <td className="num">{x.calls}</td>
                  <td className="num">{x.errors || ''}</td>
                  <td>
                    <span className="peak">
                      <span className="peak-bar" aria-hidden="true">
                        <span style={{ width: `${(x.outputTokens / maxOut) * 100}%` }} />
                      </span>
                      ~{fmtTokens(x.outputTokens)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className="card">
        <h2>{t.signalsList}</h2>
        {s.signals.length === 0 && <p className="muted">{t.none}</p>}
        <ul className="signals">
          {s.signals.map((sig, i) => (
            <li key={i}>
              <i style={{ background: KIND_COLOR[sig.kind] }} />
              <span className="muted small mono">{fmtMoment(sig.t, s.start, lang)}</span>
              <span className="small">{t[sig.kind]}</span>
              <span className="muted small">{sig.tokens ? `${fmtTokens(sig.tokens)} ${t.tokens}` : ''}</span>
              {sig.text && <q>{sig.text}</q>}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>{t.repeatedErrors}</h2>
        <p className="sub">{t.repeatedErrorsSub}</p>
        {s.repeatedErrors.length === 0 && <p className="muted">{t.none}</p>}
        <ul className="errors">
          {s.repeatedErrors.map((e, i) => (
            <li key={i}>
              <span className="count">
                {e.count} {t.times}
              </span>
              <span className="mono small muted">{e.tool}</span>
              <code>{e.sample}</code>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
