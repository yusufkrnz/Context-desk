# context-desk

[![npm](https://img.shields.io/npm/v/context-desk?color=2a78d6)](https://www.npmjs.com/package/context-desk)
[![license](https://img.shields.io/npm/l/context-desk?color=1baf7a)](https://github.com/yusufkrnz/Context-desk/blob/main/LICENSE)

See why your coding agent drifts: what filled its context, when it was compacted, and where you had to step in. Built from your own Claude Code history, on your machine.

```bash
npx context-desk
```

![context-desk demo: run one command, see your sessions](https://raw.githubusercontent.com/yusufkrnz/Context-desk/main/docs/demo.gif)

<sub>Recorded on the author's real history in share mode: names are replaced, numbers are not.</sub>

![Problem, what it does, what you do with it](https://raw.githubusercontent.com/yusufkrnz/Context-desk/main/docs/problem-solution-impact.svg)

## What you see

| | |
|---|---|
| **Headline numbers** | context before your first message, sessions past 40% of the window, largest compaction, where you step in most, rule files that don't belong |
| **Context over a session** | measured size on every model call, compactions (before → after), your corrections and interrupts on the curve |
| **When you step in** | share of interventions by how full the context was |
| **At the peak** | what filled the context: tool output, conversation, rules, summary |
| **Rule files** | wrong-stack files, duplicates, rules a linter or hook could enforce instead |

Pick a project from the top bar, click a session to see its curve. **Share mode** hides project names, session titles, paths and message text, so you can post a screenshot.

## Requirements

- Node.js 18+
- Claude Code history in `~/.claude/projects` (or `$CLAUDE_CONFIG_DIR/projects`)

Runs on `127.0.0.1` only. Nothing is uploaded. Snippets are redacted (keys, tokens, passwords, connection strings, emails, IBANs, phone numbers).

## On the author's history

Snapshot of 28 sessions across 8 projects, 2026-10-15:

| | |
|---|---|
| Context before the first message | median **53K** tokens |
| Sessions past 40% of the window | **15 of 28** |
| Largest compaction | **968K → 28K** |
| Rule files in a Python project written for Android/iOS | **4 of 8** |
| Rules a linter or hook could enforce instead | **12** |

## How it measures

| | Source |
|---|---|
| Context size, compactions | measured: token usage returned on each model call |
| Interrupts, rejected tool calls | exact: recorded in the transcript |
| Corrections | phrases like "no", "wrong", "I told you", "yine olmadı"; tuned to undercount |
| What filled the context | estimated from text length; what can't be placed shows as "Other" |
| The 40% line | a practitioner's rule of thumb (Dex Horthy), not a measurement |

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
