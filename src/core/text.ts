import type { SignalKind } from './types.js';

/** Rough token estimate. Mixed prose/code averages ~3.5 chars per token. */
export function estimateTokens(chars: number): number {
  return Math.round(chars / 3.5);
}

/** Fixed estimate for an image block; base64 length says nothing about tokens. */
export const IMAGE_TOKENS = 1600;

// Order matters: whole blocks and structured secrets first, generic shapes last.
const KEY_NAME = String.raw`[\w-]*?(?:api[_-]?key|secret|token|passwd|password|pass(?![a-z])|pwd|private[_-]?key|credentials?|şifre|sifre|parola)[\w-]*`;
// Config names that contain a secret-ish word but hold no secret.
const BENIGN_KEY = /^(max|num|total|input|output|prompt|completion)[_-]?tokens?$|^token(izer|s|_count|_limit)$/i;
type Replacer = string | ((substring: string, ...groups: string[]) => string);
const MASKS: [RegExp, Replacer][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, '•••'],
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+@/gi, '$1•••@'],
  [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{6,}/gi, '$1 •••'],
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]*/g, '•••'],
  [/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, '•••'],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, '•••'],
  // KEY="quoted value, spaces allowed"  (also \"escaped\" JSON inside tool output)
  [
    new RegExp(String.raw`(?<![\w-])(${KEY_NAME})(\\?["']?\s*[=:]\s*)(\\?["'])(.*?)\3`, 'giu'),
    (m: string, key: string, sep: string, q: string) => (BENIGN_KEY.test(key) ? m : `${key}${sep}${q}•••${q}`),
  ],
  // KEY=bare-value
  [
    new RegExp(String.raw`(?<![\w-])(${KEY_NAME})(\s*[=:]\s*)(?!•••)([^\s"',\\]+)`, 'giu'),
    (m: string, key: string, sep: string) => (BENIGN_KEY.test(key) ? m : `${key}${sep}•••`),
  ],
  [/([?&](?:key|apikey|api_key|sig|signature|token|access_token|auth|code)=)[^&\s#]+/gi, '$1•••'],
  // IBAN (TR and others) and Turkish mobile numbers
  [/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,4})?\b/g, '•••'],
  [/(\+?90[\s-]?)?\(?0?5\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g, '•••'],
  [/\b(sk|pk|rk|ghp|gho|ghs|xox[abprs])[-_][A-Za-z0-9_-]{10,}/g, '•••'],
  // long opaque strings; '/' excluded so file paths stay readable
  [/(?<![\w/.-])[A-Za-z0-9+_-]{32,}={0,2}(?![\w/])/g, '•••'],
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b/gi, '•••'],
];

export function redact(text: string): string {
  return MASKS.reduce((out, [re, to]) => out.replace(re, to as (substring: string, ...args: string[]) => string), text);
}

export function trimText(text: string, max = 180): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Strips pasted blocks and system wrappers so only the person's own words remain. */
export function ownWords(text: string): string {
  return text
    .replace(/<pasted_content[^>]*>[\s\S]*?<\/pasted_content[^>]*>/g, ' ')
    .replace(/<system-reminder[^>]*>[\s\S]*?<\/system-reminder>/g, ' ')
    .replace(/(`{3,}|~{3,})[\s\S]*?(\1|$)/g, ' ')
    .trim();
}

const MACHINE_PREFIXES = [
  '<command-name>',
  '<command-message>',
  '<local-command',
  '<task-notification>',
  '<bash-input>',
  '<bash-stdout>',
  '<bash-stderr>',
  '<user-prompt-submit-hook>',
  'Base directory for this skill',
  'This session is being continued',
  'Caveat:',
  'Your response above was stopped',
];

const IMAGE_TAG = /\[Image[^\]]*\]/g;

/** True when a "user" entry was typed by a person rather than produced by the harness. */
export function isHumanText(text: string): boolean {
  // A screenshot tag followed by typed words is still a person talking.
  const t = text.replace(IMAGE_TAG, ' ').trimStart();
  if (!t) return false;
  return !MACHINE_PREFIXES.some((p) => t.startsWith(p));
}

const INTERRUPT = /^\[Request interrupted by user/;

// Phrases people use when steering an agent back. Kept narrow on purpose:
// a false positive inflates the chart, a miss only makes it conservative.
// Word edges that understand Turkish letters and emoji ("olmadı😡", "hayır:(").
const S = String.raw`(?<![\p{L}\p{N}])`;
const E = String.raw`(?![\p{L}\p{N}])`;
const re = (src: string) => new RegExp(src, 'u');

const CORRECTION_PATTERNS: RegExp[] = [
  // Turkish
  re(`${S}hay[ıi]r${E}`),
  // "yanlış" but not "yanlış mı anladım" (own doubt) or "yanlışlıkla" (own accident)
  re(String.raw`${S}yanl[ıi][şs]${E}(?!\s*m[ıi]${E})`),
  re(`${S}olmam[ıi][şs]`),
  re(String.raw`(?<!sorun\s)${S}olmad[ıi]${E}`),
  // also typed without Turkish letters, or with the final r dropped
  re(`${S}[çc]al[ıi][şs]m[ıi]yo`),
  re(`${S}(hala|hâlâ|halen) (ayn[ıi]|olmuyor|[çc]al[ıi][şs]m[ıi]yo|hata|bozuk|yok|g[öo]r[üu]nm[üu]yor|gelmiyor)`),
  re(`${S}yine (ayn[ıi]|hata|olmad[ıi]|bozuldu|yanl[ıi][şs]|olmuyor)`),
  re(`${S}(söylemiştim|demiştim|dedim ya|anlatmıştım)`),
  re(`${S}neden (böyle|bunu|öyle|bunları|sildin|değiştirdin|yaptın)`),
  // "geri al" as an order, not "geri alırız" / "geri aldırım"
  re(String.raw`${S}geri al(${E}|ır m[ıi]s[ıi]n)`),
  re(`${S}(bozdun|bozmuşsun)`),
  re(`${S}(istemedim|istememiştim)`),
  re(`${S}bu değil${E}`),
  re(`${S}öyle değil`),
  // English
  re(String.raw`^(no|nope)${E}(?!\s*(worries|problem|prob|need)${E})`),
  re(String.raw`(?<!(nothing|go|anything)\s)${S}wrong${E}`),
  re(`${S}not what i (asked|meant|wanted)`),
  // "I asked you to X, now also Y" is a follow-up, so "asked" is left out
  re(`${S}i (told|said) you`),
  re(`${S}(still|again) (not(?! sure)|broken|failing|wrong|the same|doesn'?t)`),
  re(`${S}(doesn'?t|does not|didn'?t|did not) work`),
  re(`${S}(revert|undo) (it|this|that|the)`),
  re(`${S}that'?s not (it|right|what)`),
  re(`${S}why did you`),
  re(`${S}you (broke|deleted|removed|ignored)`),
];

export function classifyHuman(text: string): SignalKind | null {
  if (INTERRUPT.test(text.trim())) return 'interrupt';
  const own = ownWords(text);
  // Long messages are usually new instructions or pasted material, not a nudge.
  if (!own || own.length > 600) return null;
  const variants = [own.toLowerCase(), own.toLocaleLowerCase('tr-TR')];
  return CORRECTION_PATTERNS.some((re) => variants.some((v) => re.test(v))) ? 'correction' : null;
}

export function isRejection(toolResultText: string): boolean {
  return (
    toolResultText.includes("doesn't want to proceed with this tool use") ||
    toolResultText.includes('The user rejected') ||
    toolResultText.includes('tool use was rejected')
  );
}

/** Collapses volatile parts so the same failure groups together across retries. */
export function normalizeError(text: string): string {
  return text
    .toLowerCase()
    .replace(/<\/?[a-z_-]+>/g, ' ')
    .replace(/[a-z]:\\[^\s'"]+/g, '<path>')
    .replace(/(^|[\s'"(=:])(\/[\w.@-]+)+\/?/g, '$1<path>')
    .replace(/0x[0-9a-f]+/g, '<hex>')
    .replace(/\b[0-9a-f]{8,}\b/g, '<id>')
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}
