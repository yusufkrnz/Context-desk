import type { Lang } from './i18n';

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 2).replace(/\.?0+$/, '')}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

export function fmtDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function fmtPct(x: number): string {
  if (!Number.isFinite(x)) return '–';
  return `${Math.round(x * 100)}%`;
}

export function fmtDate(iso: string, lang: Lang): string {
  if (!iso) return '–';
  return new Date(iso).toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtTime(iso: string, lang: Lang): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString(lang === 'tr' ? 'tr-TR' : 'en-US', { hour: '2-digit', minute: '2-digit' });
}

export function homeShort(path: string): string {
  return path.replace(/^\/(Users|home)\/[^/]+/, '~');
}

/** Time of day, with the date added when it falls on another day than the session start. */
export function fmtMoment(iso: string, startIso: string, lang: Lang): string {
  if (!iso) return '';
  const sameDay = new Date(iso).toDateString() === new Date(startIso).toDateString();
  if (sameDay) return fmtTime(iso, lang);
  const day = new Date(iso).toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-US', { day: 'numeric', month: 'short' });
  return `${day} ${fmtTime(iso, lang)}`;
}
