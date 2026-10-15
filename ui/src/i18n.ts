import { createContext, useContext } from 'react';

export type Lang = 'tr' | 'en';

const en = {
  localOnly: 'local only, nothing uploaded',
  loading: 'Reading sessions…',
  loadError: 'Could not load the report.',
  empty: 'No Claude Code sessions found.',
  all: 'All projects',
  projects: 'Projects',
  sessions: 'sessions',
  facts: 'What the data says',
  findings: 'Rule files',
  noFindings: 'No findings.',
  none: 'None.',
  date: 'Date',
  active: 'Active',
  peak: 'Peak',
  steer: 'Steer',
  compact: 'Cmp',
  calls: 'calls',
  window: 'window',
  tokens: 'tokens',
  subagents: 'subagents',
  dumbZone: '40% of window (rule of thumb, not a measurement)',
  dumbZoneShort: '40%',
  compaction: 'compaction',
  correction: 'correction',
  interrupt: 'interrupt',
  rejection: 'rejected tool call',
  desk: 'At the peak',
  deskNote: 'total measured, split estimated',
  repeated: 'Repeated errors',
  globalNote: 'global files (~/.claude) load here too',
  heuristicNote: 'Corrections are detected from phrases ("no", "wrong", "yine olmadı"); interrupts and rejections are exact.',
  noTimeline: 'No measured context.',
  footerProject: 'also by the author:',
  findingKinds: {
    'stack-mismatch': 'wrong stack',
    size: 'size',
    count: 'count',
    duplicate: 'duplicate',
    lintable: 'automatable',
    import: 'import',
  },
  parts: {
    rules: 'rules',
    conversation: 'conversation',
    toolOutput: 'tool output',
    summary: 'summary',
    attachments: 'attachments',
    system: 'other',
  },
  hints: {
    'size:file': 'large file, competes for attention every turn',
    'size:total': 'rule files are large in total',
    'count:total': 'many instructions; compliance drops as the count grows (IFScale)',
    'lint:no-explicit-any': '@typescript-eslint/no-explicit-any',
    'lint:formatter': 'a formatter can enforce this',
    'lint:naming': 'a naming lint rule can enforce this',
    'lint:imports': 'import sorting can be automated',
    'lint:max-lines': 'max-lines / max-lines-per-function',
    'lint:max-depth': 'max-depth',
    'lint:no-console': 'no-console',
    'lint:force-unwrap': 'SwiftLint / detekt',
    'hook:secret-scan': 'secret scanner in a pre-commit hook',
    'hook:run-tests': 'a hook can run this every time',
    stack: "not this project's stack, still loaded every session",
    dup: 'also in',
    import: 'pulls in another file',
  } as Record<string, string>,
};

const tr: typeof en = {
  localOnly: 'yerel, hiçbir şey yüklenmedi',
  loading: 'Oturumlar okunuyor…',
  loadError: 'Rapor yüklenemedi.',
  empty: 'Claude Code oturumu bulunamadı.',
  all: 'Tüm projeler',
  projects: 'Projeler',
  sessions: 'oturum',
  facts: 'Veri ne diyor',
  findings: 'Kural dosyaları',
  noFindings: 'Bulgu yok.',
  none: 'Yok.',
  date: 'Tarih',
  active: 'Süre',
  peak: 'Zirve',
  steer: 'Müd.',
  compact: 'Özt.',
  calls: 'çağrı',
  window: 'pencere',
  tokens: 'token',
  subagents: 'alt ajan',
  dumbZone: "pencerenin %40'ı (pratik kural, ölçüm değil)",
  dumbZoneShort: '%40',
  compaction: 'özetleme',
  correction: 'düzeltme',
  interrupt: 'durdurma',
  rejection: 'reddedilen araç',
  desk: 'Zirvede masa',
  deskNote: 'toplam ölçüm, dağılım tahmin',
  repeated: 'Geri dönen hatalar',
  globalNote: 'global dosya (~/.claude) burada da yükleniyor',
  heuristicNote: 'Düzeltmeler ifadelerden yakalanır ("hayır", "yanlış", "yine olmadı"); durdurma ve ret kesin veridir.',
  noTimeline: 'Ölçülmüş context yok.',
  footerProject: 'yazarın diğer projesi:',
  findingKinds: {
    'stack-mismatch': 'yanlış stack',
    size: 'boyut',
    count: 'sayı',
    duplicate: 'tekrar',
    lintable: 'otomatikleşir',
    import: 'import',
  },
  parts: {
    rules: 'kurallar',
    conversation: 'konuşma',
    toolOutput: 'araç çıktısı',
    summary: 'özet',
    attachments: 'ekler',
    system: 'diğer',
  },
  hints: {
    'size:file': 'büyük dosya, her turda dikkat için yarışıyor',
    'size:total': 'kural dosyalarının toplamı büyük',
    'count:total': 'çok talimat; sayı arttıkça uyum düşüyor (IFScale)',
    'lint:no-explicit-any': '@typescript-eslint/no-explicit-any',
    'lint:formatter': 'formatter zorlayabilir',
    'lint:naming': 'isimlendirme lint kuralı zorlayabilir',
    'lint:imports': 'import sıralaması otomatikleşir',
    'lint:max-lines': 'max-lines / max-lines-per-function',
    'lint:max-depth': 'max-depth',
    'lint:no-console': 'no-console',
    'lint:force-unwrap': 'SwiftLint / detekt',
    'hook:secret-scan': "pre-commit hook'ta secret tarayıcı",
    'hook:run-tests': 'hook her seferinde çalıştırabilir',
    stack: "bu projenin stack'i değil, yine de her oturumda yükleniyor",
    dup: 'şurada da var:',
    import: 'başka bir dosyayı içeri alıyor',
  },
};

export const dictionaries: Record<Lang, typeof en> = { en, tr };
export type Dict = typeof en;

export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem('cd-lang');
    if (saved === 'tr' || saved === 'en') return saved;
  } catch {
    // storage may be unavailable; fall through to the browser language
  }
  return navigator.language.toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

export const LangContext = createContext<{ lang: Lang; t: Dict }>({ lang: 'en', t: en });
export const useT = () => useContext(LangContext);
