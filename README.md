# context-desk

See why your coding agent drifts: what filled its context, when it was compacted, and where you had to step in. Built from your own Claude Code history.

```bash
npx context-desk
```

![Problem, what it does, what you do with it](docs/problem-solution-impact.svg)

![The report on the author's own 28 sessions](docs/dashboard.png)

## What it found on the author's history

28 sessions, 8 projects, measured by this tool:

| Finding | Number |
|---|---|
| Context before the first message | median 53K tokens |
| Sessions past 40% of the window | 14 of 28 |
| Largest compaction | 968K → 28K |
| Rule files in a FastAPI project written for Android/iOS | 4 of 8 |
| Rules a linter or hook could enforce instead | 12 |

## How it measures

| | Source |
|---|---|
| Context size, compactions | measured: token usage returned on each model call |
| Interrupts, rejected tool calls | exact: recorded in the transcript |
| Corrections | phrases like "no", "wrong", "I told you", "yine olmadı"; tuned to undercount |
| What filled the context | estimated from text length; what can't be placed shows as "other" |
| The 40% line | a practitioner's rule of thumb (Dex Horthy), not a measurement |

Runs on `127.0.0.1` only. Nothing is uploaded. Snippets are redacted (keys, tokens, passwords, connection strings, emails, IBANs, phone numbers).

## Options

```
--dir <path>     projects folder (default ~/.claude/projects)
--port <n>       default 4777
--json <file>    write the report as JSON and exit
--no-open        don't open the browser
```

Codex and Cursor history: planned.

## Development

```bash
npm install && npm test && npm run build
node dist/cli/index.js
```

MIT
