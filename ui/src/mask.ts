import type { Project, Report, SessionSummary } from '../../src/core/types';
import { homeShort } from './format';
import type { Dict } from './i18n';

/** How names are shown. Share mode swaps them for stable aliases; the numbers stay real. */
export interface Namer {
  share: boolean;
  project(p: Project): string;
  path(p: Project): string;
  session(s: SessionSummary): string;
  quote(text: string): string;
  file(path: string): string;
}

const letter = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26)}`);

export function makeNamer(report: Report, share: boolean, t: Dict): Namer {
  const projectAlias = new Map<string, string>();
  const sessionAlias = new Map<string, string>();
  report.projects.forEach((p, i) => {
    projectAlias.set(p.id, `${t.project} ${letter(i)}`);
    // number sessions in the order they happened, per project
    [...p.sessions]
      .sort((a, b) => a.start.localeCompare(b.start))
      .forEach((s, j) => sessionAlias.set(s.id, `${t.session} ${letter(i)}${j + 1}`));
  });

  return {
    share,
    project: (p) => (share ? projectAlias.get(p.id) ?? t.project : p.name),
    path: (p) => (share ? '~/…' : homeShort(p.path)),
    session: (s) => (share ? sessionAlias.get(s.id) ?? t.session : s.title),
    quote: (text) => (share ? '' : text),
    // global rule file names (android-style.md, CLAUDE.md) say nothing personal; folders might
    file: (path) => {
      const base = path.replace(/^.*\//, '');
      return share ? base : homeShort(path).replace(/^~\/\.claude\/projects\/[^/]+\//, '~/.claude/projects/…/');
    },
  };
}
