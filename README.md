# context-desk

See what your AI coding sessions actually looked like: how full the context got, when it was compacted, when you had to step in, and what your rule files (CLAUDE.md, AGENTS.md, `.cursor/rules`) cost on every turn.

```bash
npx context-desk
```

It reads your local Claude Code history (`~/.claude/projects`), analyzes it on your machine and opens a report at `http://127.0.0.1:4777`. **Nothing is uploaded.** The server listens on loopback only, and snippets shown in the report are redacted (keys, tokens, passwords, connection strings, emails, IBANs, phone numbers).

## What you get

- **When do you have to step in?** Your corrections, interrupts and rejected tool calls, grouped by how full the context was at that moment.
- **Per project:** sessions with their context curves, peak size, compactions and steering moments.
- **Per session:** the measured context over time, the 40% line, compactions (before → after), what was on the desk at the peak, tool output sizes, and errors that came back.
- **Rule files:** size, instruction count, duplicates across files, rules a linter or hook could enforce instead, and rule files written for a stack the project doesn't use.

## Options

```
--dir <path>     Claude Code projects folder (default: ~/.claude/projects, or $CLAUDE_CONFIG_DIR/projects)
--port <n>       Local port (default: 4777)
--json <file>    Write the report as JSON and exit
--no-open        Don't open the browser
```

## How it measures

| Number | Source |
|---|---|
| Context size, compactions | Measured: token usage the model returned on each call |
| Interrupts, rejected tool calls | Exact: recorded in the transcript |
| Corrections | Heuristic: Turkish and English phrases like "no", "wrong", "I told you", "yine olmadı". Tuned for precision, so it undercounts rather than overcounts |
| What was on the desk | Estimated from text length (~3.5 chars per token); the remainder is shown as "Other" |
| The 40% line | A practitioner's rule of thumb (Dex Horthy), not a measurement |

## Background

Built alongside a Medium piece on why agents seem to get worse a few hours into a session. Sources behind the checks: IFScale (instruction count vs. compliance), Chroma's Context Rot, Lost in the Middle, HumanLayer on CLAUDE.md, Drew Breunig on context failures.

Support for Codex and Cursor history is planned.

## Development

```bash
npm install
npm test          # vitest, includes edge-case suites
npm run build     # CLI (tsc) + UI (vite) into dist/
node dist/cli/index.js
```

MIT
