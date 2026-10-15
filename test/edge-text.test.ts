import { describe, expect, it } from 'vitest';
import { classifyHuman, isHumanText, normalizeError, ownWords, redact } from '../src/core/text.js';

// All data below is synthetic.
const leaks = (input: string, secret: string) => expect(redact(input)).not.toContain(secret);

describe('bugs', () => {
  describe('classifyHuman false positives', () => {
    it.each([
      ['question about own understanding', 'yanlış mı anladım ben'],
      ['conditional future undo (geri al prefix)', 'beğenmezsem geri alırız'],
      ['conditional future undo, colloquial', 'bi dene olmazsa geri aldırım sana'],
      ['"yanlışlıkla" = I accidentally did it', 'yanlışlıkla dosyayı ben sildim, tekrar oluştur'],
      ['"sorun olmadı" = no problem happened', 'hiç sorun olmadı, devam et'],
      ['English "no worries"', 'no worries, take your time'],
      ['English "no problem"', 'no problem, now add the footer'],
      ['"nothing wrong"', 'nothing wrong with it, ship it'],
      ['"what could go wrong"', 'what could go wrong? just deploy'],
      ['"wrong" only inside a code fence', 'bunu ekle:\n```\nconst wrong = 1;\n```'],
      ['"no" only inside a code fence', '```\nno\n```\nbu çıktıyı yorumla'],
    ])('%s: "%s"', (_why, text) => {
      expect(classifyHuman(text)).toBeNull();
    });
  });

  describe('classifyHuman misses due to boundary/casing', () => {
    it.each([
      ['emoji right after word', 'olmadı😡'],
      ['sad face after word', 'hayır:('],
      ['all-caps Turkish dotted I', 'İSTEMEDİM BUNU'],
      ['all-caps dotless I', 'HALA ÇALIŞMIYOR'],
    ])('%s: "%s"', (_why, text) => {
      expect(classifyHuman(text)).toBe('correction');
    });
  });

  describe('isHumanText', () => {
    it('a person who pasted a screenshot then typed is still human', () => {
      expect(isHumanText('[Image #1] bu ekranda buton kaymış, düzelt')).toBe(true);
    });
  });

  describe('ownWords', () => {
    it('strips system-reminder even when it carries attributes', () => {
      expect(ownWords('<system-reminder type="x">yine olmadı</system-reminder> devam')).toBe('devam');
    });
  });

  describe('redact leaks', () => {
    it('DATABASE_URL password with a dotless host', () => {
      leaks('DATABASE_URL=postgres://admin:S3cretPw@localhost:5432/app', 'S3cretPw');
    });
    it('escaped JSON inside a tool result', () => {
      leaks('{\\"password\\": \\"hunter2xyz\\"}', 'hunter2xyz');
    });
    it('quoted value containing spaces', () => {
      leaks('"password": "correct horse battery staple"', 'battery staple');
    });
    it('DB_PASS / *_PASS env vars', () => {
      leaks('DB_PASS=hunter2xyz', 'hunter2xyz');
    });
    it('short Bearer token in Authorization header', () => {
      leaks('Authorization: Bearer abc123def456ghi', 'abc123def456ghi');
    });
    it('JWT payload segment (short segments slip under the 32-char rule)', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpM';
      leaks(`token yok, header: ${jwt}`, 'eyJzdWIiOiIxMjM0NTY3ODkwIn0');
    });
    it('bare AWS access key id', () => {
      leaks('aws configure: AKIAIOSFODNN7EXAMPLE', 'AKIAIOSFODNN7EXAMPLE');
    });
    it('PEM private key short last line', () => {
      const pem = [
        '-----BEGIN RSA PRIVATE KEY-----',
        'MIIEowIBAAKCAQEAu1SU1LfVLPHCozMxH2Mo4lgOEePzNm0tRgeLezV6ffAt0gun',
        'VTLw7onLRnrq0/IzW7yWR7QkrmBL7jTKEn5u+qKhbwKfBstIs+bMY2Zkp18gnTxK',
        'Zq9fakeTailLine==',
        '-----END RSA PRIVATE KEY-----',
      ].join('\n');
      leaks(pem, 'Zq9fakeTailLine');
    });
    it('private_key field', () => {
      leaks('private_key: abcDEF123ghi', 'abcDEF123ghi');
    });
  });

  describe('redact over-redaction', () => {
    it('keeps long file paths readable', () => {
      const p = '/Users/someone/Desktop/context-desk/src/core/text.ts';
      expect(redact(`edited ${p}`)).toContain(p);
    });
    it('does not treat package@version as an email', () => {
      expect(redact('npm i react@18.3.1')).toContain('react@18.3.1');
    });
  });

  describe('normalizeError', () => {
    it('does not eat "and/or" as a path', () => {
      expect(normalizeError('expected string and/or number')).toContain('and/or');
    });
  });
});

describe('proposals', () => {
  // Diacritic-less Turkish should count: hayir / yanlis / olmadi / calismiyor.
  it.each(['hayir oyle degil', 'yine olmadi', 'hala calismiyor', 'yanlis yaptin'])('diacritic-less "%s"', (t) => {
    expect(classifyHuman(t)).toBe('correction');
  });

  // Colloquial truncation "çalışmıyo" (dropped final r) should count.
  it('colloquial "çalışmıyo"', () => {
    expect(classifyHuman('hala çalışmıyo')).toBe('correction');
  });

  // English "nope" should count like "no".
  it('"nope"', () => {
    expect(classifyHuman('nope, use the other one')).toBe('correction');
  });

  // Questions with "still not" are curiosity, not steering.
  it('"still not sure" question', () => {
    expect(classifyHuman('still not sure which is better, what do you think?')).toBeNull();
  });

  // "I asked you to X, now also Y" is a follow-up, not a correction.
  it('"i asked you to" as a recap', () => {
    expect(classifyHuman('i asked you to add tests earlier, now also add docs')).toBeNull();
  });

  // User's own environment breaking is not the agent's fault.
  it('"internetim bozuldu"', () => {
    expect(classifyHuman('internetim bozuldu, kaldığın yerden devam et')).toBeNull();
  });

  // "yanlış X getiriyor" about a feature's output — owner decides; proposal: count it.
  it('"yanlış öneriler getiriyor, rapor ver"', () => {
    expect(classifyHuman('yanlış öneriler getiriyor, rapor ver')).toBe('correction');
  });

  // Decided 2026-10-15: rejected. Claude Code itself writes "Caveat:" messages; a person rarely starts with it.
  it('"Caveat:" prefix stays machine text', () => {
    expect(isHumanText("Caveat: don't touch prod")).toBe(false);
  });

  // Turkish secret keys (şifre/parola) should be masked for this user base.
  it('Turkish key names', () => {
    leaks('şifre: gizli123abc', 'gizli123abc');
    leaks('parola=gizli456def', 'gizli456def');
  });

  // Generic ?key= / &sig= query params should be masked.
  it('URL query key', () => {
    leaks('https://api.example.test/v1?key=shortkey99', 'shortkey99');
  });

  // Turkish phone numbers are PII.
  it('Turkish phone', () => {
    leaks('beni ara: +90 532 123 45 67', '532 123 45 67');
  });

  // IBAN is PII (26 chars, under the 32-char generic rule).
  it('IBAN', () => {
    leaks('IBAN: TR330006100519786457841326', 'TR330006100519786457841326');
  });

  // Non-secret config like max_tokens / tokenizer should stay readable.
  it('max_tokens not masked', () => {
    expect(redact('max_tokens=4096')).toBe('max_tokens=4096');
  });

  // Windows paths should group like POSIX paths.
  it('Windows paths normalize', () => {
    expect(normalizeError('File C:\\Users\\a\\x.py failed')).toBe(normalizeError('File C:\\Users\\b\\y.py failed'));
  });
});
