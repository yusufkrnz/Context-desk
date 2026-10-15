import { useCallback, useRef, useState } from 'react';
import type { Compaction, Composition, Signal, SignalKind, TimelinePoint } from '../../src/core/types';
import { fmtPct, fmtTime, fmtTokens } from './format';
import { useT } from './i18n';

export const KIND_COLOR: Record<SignalKind, string> = {
  correction: 'var(--s1)',
  interrupt: 'var(--s2)',
  rejection: 'var(--s3)',
};

/** Measures its own width so SVGs stay crisp at any size. */
function useWidth(initial = 600): [(el: HTMLDivElement | null) => void, number] {
  const [width, setWidth] = useState(initial);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    if (!el || typeof ResizeObserver === 'undefined') return;
    observer.current = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.round(w));
    });
    observer.current.observe(el);
  }, []);
  return [ref, width];
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

export function ContextChart({
  points,
  windowTokens,
  compactions,
  signals,
  height = 190,
}: {
  points: TimelinePoint[];
  windowTokens: number;
  compactions: Compaction[];
  signals: Signal[];
  height?: number;
}) {
  const { t, lang } = useT();
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { top: 10, right: 8, bottom: 18, left: 40 };
  const innerW = Math.max(10, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;
  const peak = Math.max(1, ...points.map((p) => p.tokens), ...compactions.map((c) => c.preTokens ?? 0));
  const dumb = windowTokens * 0.4;
  const max = Math.max(peak * 1.05, dumb * 1.1);
  const n = Math.max(1, points.length - 1);
  const x = (i: number) => pad.left + (i / n) * innerW;
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.tokens).toFixed(1)}`).join(' ');
  const area = points.length ? `${line} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z` : '';

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - rect.left) / rect.width) * n);
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };
  const hp = hover !== null ? points[hover] : undefined;

  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label="context">
        {[0, max / 2, max].map((v) => (
          <g key={v}>
            <line className="grid" x1={pad.left} x2={width - pad.right} y1={y(v)} y2={y(v)} />
            <text className="axis" x={pad.left - 6} y={y(v) + 3} textAnchor="end">
              {fmtTokens(Math.round(v))}
            </text>
          </g>
        ))}
        <line className="ref" x1={pad.left} x2={width - pad.right} y1={y(dumb)} y2={y(dumb)} />
        <text className="ref-label" x={pad.left + 4} y={y(dumb) - 4}>
          {t.dumbZoneShort} · {fmtTokens(dumb)}
        </text>
        {compactions.map((c, i) => {
          const cx = x(nearestIndex(points, c.t));
          return (
            <g key={i}>
              <line className="compact" x1={cx} x2={cx} y1={pad.top} y2={y(0)} />
              <text className="axis" x={cx + 4} y={pad.top + 9}>
                {t.compaction} {c.preTokens ? `${fmtTokens(c.preTokens)}→${fmtTokens(c.postTokens ?? 0)}` : ''}
              </text>
            </g>
          );
        })}
        <path d={area} className="series-area" />
        <path d={line} className="series-line" />
        {signals.map((s, i) => {
          const idx = nearestIndex(points, s.t);
          return (
            <circle key={i} cx={x(idx)} cy={y(points[idx]?.tokens ?? s.tokens)} r={3.5} fill={KIND_COLOR[s.kind]} className="marker">
              <title>{s.text || t[s.kind]}</title>
            </circle>
          );
        })}
        <line className="baseline" x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} />
        {hp && (
          <g pointerEvents="none">
            <line className="crosshair" x1={x(hover!)} x2={x(hover!)} y1={pad.top} y2={y(0)} />
            <circle cx={x(hover!)} cy={y(hp.tokens)} r={3} className="hover-dot" />
          </g>
        )}
        <rect x={pad.left} y={pad.top} width={innerW} height={innerH} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      </svg>
      {hp && (
        <div className="tooltip" style={{ left: Math.min(Math.max(x(hover!), 80), width - 80), top: 0 }}>
          {fmtTokens(hp.tokens)} · {fmtPct(hp.tokens / windowTokens)} {t.window} · {fmtTime(hp.t, lang)}
        </div>
      )}
    </div>
  );
}

export function Sparkline({ points, windowTokens, width = 90, height = 18 }: { points: TimelinePoint[]; windowTokens: number; width?: number; height?: number }) {
  if (points.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const max = Math.max(windowTokens * 0.4, ...points.map((p) => p.tokens));
  const n = points.length - 1;
  const d = points
    .map((p, i) => `${i ? 'L' : 'M'}${((i / n) * width).toFixed(1)},${(height - 1 - (p.tokens / max) * (height - 2)).toFixed(1)}`)
    .join(' ');
  return (
    <svg width={width} height={height} aria-hidden="true">
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

export function CompositionBar({ composition }: { composition: Composition }) {
  const { t } = useT();
  const parts = [...composition.parts].sort((a, b) => PART_ORDER.indexOf(a.key) - PART_ORDER.indexOf(b.key));
  return (
    <div className="desk">
      <div className="stack" role="img" aria-label={t.desk}>
        {parts.map((p) => (
          <div key={p.key} style={{ flexGrow: p.tokens, background: PART_COLOR[p.key] }} />
        ))}
      </div>
      <div className="desk-legend">
        {parts.map((p) => (
          <span key={p.key}>
            <i style={{ background: PART_COLOR[p.key] }} />
            {t.parts[p.key]} <b>{fmtPct(p.tokens / composition.measured)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}
