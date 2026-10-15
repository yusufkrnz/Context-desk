import { useCallback, useRef, useState, type ReactNode } from 'react';
import type { Composition, Compaction, ContextBucket, Signal, SignalKind, TimelinePoint } from '../../src/core/types';
import { fmtPct, fmtTime, fmtTokens } from './format';
import { useT } from './i18n';

export const KIND_COLOR: Record<SignalKind, string> = {
  correction: 'var(--s1)',
  interrupt: 'var(--s2)',
  rejection: 'var(--s3)',
};
const KINDS: SignalKind[] = ['correction', 'interrupt', 'rejection'];

/** Measures its own width so SVGs stay crisp at any size. */
function useWidth(initial = 720): [(el: HTMLDivElement | null) => void, number] {
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

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(x, 90), width - 90);
  return (
    <div className="tooltip" style={{ left, top: y }}>
      {children}
    </div>
  );
}

export function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label}>
          <i style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export const steeringTotal = (b: ContextBucket) => b.corrections + b.interrupts + b.rejections;
export const interventionTotal = (b: ContextBucket) => b.humanMessages + b.interrupts + b.rejections;
const MIN_N = 10;

export function SteeringByContext({ buckets }: { buckets: ContextBucket[] }) {
  const { t } = useT();
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const height = 260;
  const pad = { top: 28, right: 8, bottom: 44, left: 44 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const rates = buckets.map((b) => (interventionTotal(b) ? steeringTotal(b) / interventionTotal(b) : 0));
  const max = Math.max(0.1, ...rates) * 1.15;
  const slot = innerW / buckets.length;
  const barW = Math.min(64, slot * 0.6);
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;
  const ticks = [0, max / 2, max].map((v) => Math.round(v * 100) / 100);

  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label={t.whenTitle}>
        {ticks.map((v) => (
          <g key={v}>
            <line className="grid" x1={pad.left} x2={width - pad.right} y1={y(v)} y2={y(v)} />
            <text className="axis" x={pad.left - 8} y={y(v) + 4} textAnchor="end">
              {fmtPct(v)}
            </text>
          </g>
        ))}
        {buckets.map((b, i) => {
          const n = interventionTotal(b);
          const cx = pad.left + slot * i + slot / 2;
          const dim = n < MIN_N;
          let acc = 0;
          const segs = KINDS.map((k) => {
            const count = k === 'correction' ? b.corrections : k === 'interrupt' ? b.interrupts : b.rejections;
            const v = n ? count / n : 0;
            const seg = { k, y0: acc, y1: acc + v };
            acc += v;
            return seg;
          }).filter((s) => s.y1 > s.y0);
          return (
            <g key={b.label} opacity={dim ? 0.35 : 1} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={pad.left + slot * i} y={pad.top} width={slot} height={innerH} fill="transparent" />
              {segs.map((s, si) => {
                const top = y(s.y1);
                const h = Math.max(0, y(s.y0) - y(s.y1) - (si > 0 ? 2 : 0));
                const isTop = si === segs.length - 1;
                return (
                  <path
                    key={s.k}
                    d={roundedTop(cx - barW / 2, top, barW, h, isTop ? 4 : 0)}
                    fill={KIND_COLOR[s.k]}
                  />
                );
              })}
              {n > 0 && (
                <text className="value" x={cx} y={y(rates[i]!) - 8} textAnchor="middle">
                  {fmtPct(rates[i]!)}
                </text>
              )}
              <text className="axis" x={cx} y={height - 24} textAnchor="middle">
                {b.label}
              </text>
              <text className="axis muted" x={cx} y={height - 8} textAnchor="middle">
                n={n}
                {dim && n > 0 ? ` · ${t.fewData}` : ''}
              </text>
            </g>
          );
        })}
        <line className="baseline" x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} />
      </svg>
      {hover !== null && buckets[hover] && (
        <Tooltip x={pad.left + slot * hover + slot / 2} y={pad.top} width={width}>
          <strong>
            {t.bucket} {buckets[hover]!.label}
          </strong>
          <div>
            {t.rate}: {fmtPct(rates[hover]!)}
          </div>
          <div className="row">
            <i style={{ background: KIND_COLOR.correction }} /> {t.correction}: {buckets[hover]!.corrections}
          </div>
          <div className="row">
            <i style={{ background: KIND_COLOR.interrupt }} /> {t.interrupt}: {buckets[hover]!.interrupts}
          </div>
          <div className="row">
            <i style={{ background: KIND_COLOR.rejection }} /> {t.rejection}: {buckets[hover]!.rejections}
          </div>
          <div className="muted">
            {interventionTotal(buckets[hover]!)} {t.interventions}
          </div>
        </Tooltip>
      )}
    </div>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return '';
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
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
}: {
  points: TimelinePoint[];
  windowTokens: number;
  compactions: Compaction[];
  signals: Signal[];
}) {
  const { t, lang } = useT();
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const height = 300;
  const pad = { top: 20, right: 16, bottom: 28, left: 52 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const peak = Math.max(1, ...points.map((p) => p.tokens), ...compactions.map((c) => c.preTokens ?? 0));
  const dumb = windowTokens * 0.4;
  const max = Math.max(peak * 1.08, dumb * 1.1);
  const n = Math.max(1, points.length - 1);
  const x = (i: number) => pad.left + (i / n) * innerW;
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.tokens).toFixed(1)}`).join(' ');
  const area = points.length ? `${line} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z` : '';
  const ticks = [0, max / 2, max];

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - rect.left) / rect.width) * n);
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };

  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label={t.contextOverTime}>
        <defs>
          <linearGradient id="ctx-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--s1)" stopOpacity="0.28" />
            <stop offset="1" stopColor="var(--s1)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line className="grid" x1={pad.left} x2={width - pad.right} y1={y(v)} y2={y(v)} />
            <text className="axis" x={pad.left - 8} y={y(v) + 4} textAnchor="end">
              {fmtTokens(Math.round(v))}
            </text>
          </g>
        ))}
        <rect className="zone" x={pad.left} y={pad.top} width={innerW} height={Math.max(0, y(dumb) - pad.top)} />
        <line className="ref" x1={pad.left} x2={width - pad.right} y1={y(dumb)} y2={y(dumb)} />
        <text className="ref-label" x={width - pad.right - 4} y={y(dumb) - 6} textAnchor="end">
          {fmtTokens(dumb)} · {t.dumbZone}
        </text>
        {compactions.map((c, i) => {
          const cx = x(nearestIndex(points, c.t));
          return (
            <g key={i}>
              <line className="compact" x1={cx} x2={cx} y1={pad.top} y2={y(0)} />
              <text className="ref-label" x={cx + 4} y={pad.top + 12}>
                {t.compactions.toLowerCase()} {c.preTokens ? `${fmtTokens(c.preTokens)}→${fmtTokens(c.postTokens ?? 0)}` : ''}
              </text>
            </g>
          );
        })}
        <path d={area} fill="url(#ctx-fill)" />
        <path d={line} className="series-line" />
        {signals.map((s, i) => {
          const idx = nearestIndex(points, s.t);
          return (
            <circle key={i} cx={x(idx)} cy={y(points[idx]?.tokens ?? s.tokens)} r={5} fill={KIND_COLOR[s.kind]} className="marker">
              <title>{s.text || t[s.kind]}</title>
            </circle>
          );
        })}
        <line className="baseline" x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} />
        {hover !== null && points[hover] && (
          <g pointerEvents="none">
            <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={pad.top} y2={y(0)} />
            <circle cx={x(hover)} cy={y(points[hover]!.tokens)} r={4} className="hover-dot" />
          </g>
        )}
        <rect
          x={pad.left}
          y={pad.top}
          width={innerW}
          height={innerH}
          fill="transparent"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        />
      </svg>
      {hover !== null && points[hover] && (
        <Tooltip x={x(hover)} y={pad.top} width={width}>
          <strong>{fmtTokens(points[hover]!.tokens)} {t.tokens}</strong>
          <div className="muted">
            #{hover + 1} · {fmtTime(points[hover]!.t, lang)} · {fmtPct(points[hover]!.tokens / windowTokens)} {t.window}
          </div>
        </Tooltip>
      )}
    </div>
  );
}

export function Sparkline({ points, windowTokens, width = 140, height = 32 }: { points: TimelinePoint[]; windowTokens: number; width?: number; height?: number }) {
  if (points.length < 2) return <svg width={width} height={height} />;
  const max = Math.max(windowTokens * 0.4, ...points.map((p) => p.tokens));
  const n = points.length - 1;
  const d = points
    .map((p, i) => `${i ? 'L' : 'M'}${((i / n) * width).toFixed(1)},${(height - 2 - (p.tokens / max) * (height - 4)).toFixed(1)}`)
    .join(' ');
  const dumbY = height - 2 - 0.4 * windowTokens / max * (height - 4);
  return (
    <svg width={width} height={height} aria-hidden="true">
      <line className="ref" x1={0} x2={width} y1={dumbY} y2={dumbY} />
      <path d={d} className="series-line thin" />
    </svg>
  );
}

const PART_COLOR: Record<string, string> = {
  toolOutput: 'var(--s1)',
  conversation: 'var(--s2)',
  rules: 'var(--s3)',
  summary: 'var(--s4)',
  attachments: 'var(--s5)',
  system: 'var(--s6)',
};
const PART_ORDER = ['toolOutput', 'conversation', 'rules', 'summary', 'attachments', 'system'];

export function CompositionBar({ composition }: { composition: Composition }) {
  const { t } = useT();
  const parts = [...composition.parts].sort((a, b) => PART_ORDER.indexOf(a.key) - PART_ORDER.indexOf(b.key));
  return (
    <div>
      <div className="stack" role="img" aria-label={t.atPeak}>
        {parts.map((p) => (
          <div
            key={p.key}
            style={{ flexGrow: p.tokens, background: PART_COLOR[p.key] }}
            title={`${t.parts[p.key]}: ${fmtTokens(p.tokens)}`}
          />
        ))}
      </div>
      <table className="parts">
        <tbody>
          {parts.map((p) => (
            <tr key={p.key}>
              <td>
                <i style={{ background: PART_COLOR[p.key] }} />
                {t.parts[p.key]}
              </td>
              <td className="num">{fmtTokens(p.tokens)}</td>
              <td className="num muted">{fmtPct(p.tokens / composition.measured)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
