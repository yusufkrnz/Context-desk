import { useCallback, useId, useRef, useState } from 'react';
import type { Compaction, Composition, ContextBucket, Signal, SignalKind, TimelinePoint } from '../../src/core/types';
import { interventions, steeringRate } from './facts';
import { fmtPct, fmtTime, fmtTokens } from './format';
import { useT } from './i18n';

export const KIND_COLOR: Record<SignalKind, string> = {
  correction: 'var(--s1)',
  interrupt: 'var(--s2)',
  rejection: 'var(--s3)',
};
const KINDS: SignalKind[] = ['correction', 'interrupt', 'rejection'];

/** Measures its own box so SVGs stay crisp at any size. */
function useSize(initial = { w: 600, h: 240 }): [(el: HTMLDivElement | null) => void, { w: number; h: number }] {
  const [size, setSize] = useState(initial);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    if (!el || typeof ResizeObserver === 'undefined') return;
    observer.current = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r && r.width > 0 && r.height > 0) setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    observer.current.observe(el);
  }, []);
  return [ref, size];
}

function nearestIndex(points: TimelinePoint[], iso: string): number {
  const target = Date.parse(iso);
  let best = 0;
  let bestDiff = Infinity;
  points.forEach((p, i) => {
    const d = Math.abs(Date.parse(p.t) - target);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  });
  return best;
}

/** Fills its parent; the parent decides the height. */
export function ContextChart({
  points,
  windowTokens,
  compactions,
  signals,
  quote,
}: {
  points: TimelinePoint[];
  windowTokens: number;
  compactions: Compaction[];
  signals: Signal[];
  quote: (text: string) => string;
}) {
  const { t, lang } = useT();
  const gid = useId().replace(/:/g, '');
  const [ref, { w: width, h: height }] = useSize();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { top: 16, right: 12, bottom: 22, left: 44 };
  const innerW = Math.max(10, width - pad.left - pad.right);
  const innerH = Math.max(10, height - pad.top - pad.bottom);
  const peak = Math.max(1, ...points.map((p) => p.tokens), ...compactions.map((c) => c.preTokens ?? 0));
  const dumb = windowTokens * 0.4;
  const max = Math.max(peak * 1.08, dumb * 1.15);
  const n = Math.max(1, points.length - 1);
  const x = (i: number) => pad.left + (i / n) * innerW;
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.tokens).toFixed(1)}`).join(' ');
  const area = points.length ? `${line} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z` : '';
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - rect.left) / rect.width) * n);
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };
  const hp = hover !== null ? points[hover] : undefined;

  return (
    <div className="chart fill" ref={ref}>
      <svg width={width} height={height} role="img" aria-label={t.contextTitle}>
        <defs>
          <linearGradient id={`g${gid}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--s1)" stopOpacity="0.35" />
            <stop offset="1" stopColor="var(--s1)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line className="gridline" x1={pad.left} x2={width - pad.right} y1={y(v)} y2={y(v)} />
            <text className="axis" x={pad.left - 8} y={y(v) + 3} textAnchor="end">
              {fmtTokens(Math.round(v))}
            </text>
          </g>
        ))}
        <rect className="zone" x={pad.left} y={pad.top} width={innerW} height={Math.max(0, y(dumb) - pad.top)} />
        <line className="ref" x1={pad.left} x2={width - pad.right} y1={y(dumb)} y2={y(dumb)} />
        <text className="ref-label" x={width - pad.right - 4} y={y(dumb) - 5} textAnchor="end">
          {t.dumbZoneShort} · {fmtTokens(dumb)}
        </text>
        {compactions.map((c, i) => {
          const cx = x(nearestIndex(points, c.t));
          return (
            <g key={i}>
              <line className="compact" x1={cx} x2={cx} y1={pad.top} y2={y(0)} />
              <text className="axis strong" x={cx + 5} y={pad.top + 10}>
                {t.compaction} {c.preTokens ? `${fmtTokens(c.preTokens)} → ${fmtTokens(c.postTokens ?? 0)}` : ''}
              </text>
            </g>
          );
        })}
        <path d={area} fill={`url(#g${gid})`} />
        <path d={line} className="series-line" />
        {signals.map((s, i) => {
          const idx = nearestIndex(points, s.t);
          return (
            <circle key={i} cx={x(idx)} cy={y(points[idx]?.tokens ?? s.tokens)} r={4} fill={KIND_COLOR[s.kind]} className="marker">
              <title>{quote(s.text) || t[s.kind]}</title>
            </circle>
          );
        })}
        {hp && (
          <g pointerEvents="none">
            <line className="crosshair" x1={x(hover!)} x2={x(hover!)} y1={pad.top} y2={y(0)} />
            <circle cx={x(hover!)} cy={y(hp.tokens)} r={4} className="hover-dot" />
          </g>
        )}
        <rect x={pad.left} y={pad.top} width={innerW} height={innerH} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      </svg>
      {hp && (
        <div className="tooltip" style={{ left: Math.min(Math.max(x(hover!), 90), width - 90), top: 4 }}>
          <b>{fmtTokens(hp.tokens)}</b> · {fmtPct(hp.tokens / windowTokens)} {t.window} · {fmtTime(hp.t, lang)}
        </div>
      )}
    </div>
  );
}

export function SteeringBars({ buckets }: { buckets: ContextBucket[] }) {
  const { t } = useT();
  const [ref, { w: width, h: height }] = useSize({ w: 360, h: 160 });
  const [hover, setHover] = useState<number | null>(null);
  const pad = { top: 18, right: 4, bottom: 30, left: 4 };
  const innerH = Math.max(10, height - pad.top - pad.bottom);
  const slot = (width - pad.left - pad.right) / buckets.length;
  const barW = Math.min(34, slot * 0.56);
  const max = Math.max(0.05, ...buckets.map(steeringRate)) * 1.1;
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;
  const hb = hover !== null ? buckets[hover] : undefined;

  return (
    <div className="chart fill" ref={ref}>
      <svg width={width} height={height} role="img" aria-label={t.steeringTitle}>
        {buckets.map((b, i) => {
          const n = interventions(b);
          const cx = pad.left + slot * i + slot / 2;
          let acc = 0;
          const segs = KINDS.map((k) => {
            const c = k === 'correction' ? b.corrections : k === 'interrupt' ? b.interrupts : b.rejections;
            const v = n ? c / n : 0;
            const seg = { k, y0: acc, y1: acc + v };
            acc += v;
            return seg;
          }).filter((s) => s.y1 > s.y0);
          return (
            <g key={b.label} opacity={n < 10 ? 0.35 : 1} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={pad.left + slot * i} y={0} width={slot} height={height} fill="transparent" />
              {segs.map((s, si) => (
                <rect
                  key={s.k}
                  x={cx - barW / 2}
                  y={y(s.y1)}
                  width={barW}
                  height={Math.max(0, y(s.y0) - y(s.y1) - (si > 0 ? 1.5 : 0))}
                  rx={si === segs.length - 1 ? 3 : 0}
                  fill={KIND_COLOR[s.k]}
                />
              ))}
              {n > 0 && steeringRate(b) > 0 && (
                <text className="value" x={cx} y={y(steeringRate(b)) - 5} textAnchor="middle">
                  {fmtPct(steeringRate(b))}
                </text>
              )}
              <text className="axis" x={cx} y={height - 16} textAnchor="middle">
                {b.label}
              </text>
              <text className="axis faint" x={cx} y={height - 4} textAnchor="middle">
                n={n}
              </text>
            </g>
          );
        })}
        <line className="baseline" x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} />
      </svg>
      {hb && hover !== null && (
        <div className="tooltip" style={{ left: Math.min(Math.max(pad.left + slot * hover + slot / 2, 80), width - 80), top: 0 }}>
          <b>{hb.label}</b> · {fmtPct(steeringRate(hb))}
          <br />
          {t.correction} {hb.corrections} · {t.interrupt} {hb.interrupts} · {t.rejection} {hb.rejections}
          {interventions(hb) < 10 ? ` · ${t.fewData}` : ''}
        </div>
      )}
    </div>
  );
}

export function Sparkline({ points, width = 84, height = 22 }: { points: TimelinePoint[]; width?: number; height?: number }) {
  if (points.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const max = Math.max(1, ...points.map((p) => p.tokens));
  const n = points.length - 1;
  const coords = points.map((p, i) => [(i / n) * width, height - 2 - (p.tokens / max) * (height - 4)] as const);
  const d = coords.map(([cx, cy], i) => `${i ? 'L' : 'M'}${cx.toFixed(1)},${cy.toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height} aria-hidden="true">
      <path d={`${d} L${width},${height} L0,${height} Z`} className="spark-area" />
      <path d={d} className="series-line thin" />
    </svg>
  );
}

const PART_ORDER = ['toolOutput', 'conversation', 'rules', 'summary', 'attachments', 'system'] as const;
const PART_COLOR: Record<string, string> = {
  toolOutput: 'var(--s1)',
  conversation: 'var(--s2)',
  rules: 'var(--s3)',
  summary: 'var(--s4)',
  attachments: 'var(--s5)',
  system: 'var(--s6)',
};

export function CompositionBars({ composition }: { composition: Composition }) {
  const { t } = useT();
  const parts = [...composition.parts].sort((a, b) => PART_ORDER.indexOf(a.key) - PART_ORDER.indexOf(b.key));
  return (
    <div className="desk">
      <div className="stack" role="img" aria-label={t.deskTitle}>
        {parts.map((p) => (
          <div key={p.key} style={{ flexGrow: p.tokens, background: PART_COLOR[p.key] }} />
        ))}
      </div>
      <ul>
        {parts.map((p) => (
          <li key={p.key}>
            <i style={{ background: PART_COLOR[p.key] }} />
            <span>{t.parts[p.key]}</span>
            <span className="mono">{fmtTokens(p.tokens)}</span>
            <span className="mono muted">{fmtPct(p.tokens / composition.measured)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
