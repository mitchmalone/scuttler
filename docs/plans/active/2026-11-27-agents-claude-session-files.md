---
title: Agents read Claude Code's own session state as a second signal
status: active
created: 2026-11-27
updated: 2026-11-27
links:
  - Notion: "Agents: read Claude Code's own session state (~/.claude/sessions) as a second signal" (Fleet / The Backlog)
  - DECISIONS 2026-11-06 (the screen decides agent state)
  - JOURNAL 2026-08-19 (scrubbed TMUX_PANE)
---

# Agents read Claude Code's own session state as a second signal

## Goal

Claude cells stop flickering or sticking when Claude Code redraws its UI. Claude's own
`busy`/`idle` report and the transcript's turn end back up the screen rules, which stay
the only source for attention. Nothing resident is added.

## Context

- `agents.rs` (1827 lines): the 2 s layout tick runs `reap` → `discover` → `look`;
  `look` reads `capture-pane` for working/attention/poked sessions and `settle` folds the
  rules' verdict (`rules.rs`) into the session, recording `rule`.
- Checked on this Mac (Claude Code 2.1.332): `~/.claude/sessions/<pid>.json` holds
  `pid`, `sessionId`, `cwd`, `status` (`busy` | `idle` | `shell`), `statusUpdatedAt`
  (ms), `updatedAt`, `name`, `kind` (`interactive`), `tmux` (`gogogo:@208.%208`:
  session, window id, pane id). Beside each is a `<pid>.<hash>.key` file: **never read**,
  only `*.json` is opened.
- Transcripts: `~/.claude/projects/<cwd with / and . as ->/<sessionId>.jsonl`.
- agents-deck (`backend/internal/claude/`): Claude's report first, transcript second,
  hooks last, screen only for the question text.

## Approach

A new module, `claude_sessions.rs`, plain functions with no Tauri runtime:

- `scan(dir, cache) -> Vec<ClaudeSession>`: list `*.json` in `$CLAUDE_CONFIG_DIR/sessions`
  (default `~/.claude/sessions`), re-parse only files whose (size, mtime) changed. Lenient:
  unknown fields ignored, unknown `status` is no opinion. A file whose pid is dead is
  ignored (the reaper already checks pids).
- `turn_end(path, cache) -> Option<TurnEnd>`: read only the bytes appended since the last
  read; the last real message decides: assistant `stop_reason: "end_turn"`, an API error,
  or a user block starting `[Request interrupted by user`. Meta, sidechain and summary
  lines are skipped.

In `agents.rs`, on the same tick:

1. **Identity.** A Claude session file's `tmux` pane id (`%208`) matches a session by
   `mux_target`, or by `sessionId` for hook-made sessions; it fills a missing
   `mux_target` (the scrubbed `TMUX_PANE` case) and lets `discover` name a Claude pane
   with no hook.
2. **Signal order** (DECISIONS entry): screen attention wins (neither file nor transcript
   shows a permission prompt or question); otherwise the session file's `busy`/`idle`
   settles working vs not when it disagrees with the screen; the transcript's turn end
   settles working → done when the screen still says working after a 30 s grace (Esc
   emits no hook). `shell`, a missing file or a stale one is no opinion: the screen
   rules as today.
3. **Cost.** A Claude pane whose file says `idle` and that isn't in attention skips
   `capture-pane`.
4. **Why.** `rule` names the source: `seen: session file busy`, `seen: transcript
end_turn`, or the screen rule as now.

## Steps

- [x] Tests first: fixtures for session files (busy, idle, shell, missing, garbage,
      unknown fields) and transcript tails (end_turn, API error, interrupted, sidechain
      and meta skipped, partial last line, appended-bytes reads)
- [x] `claude_sessions.rs`: scan with the (size, mtime) cache, `CLAUDE_CONFIG_DIR`,
      `*.json` only; transcript tail reader with per-file offsets
- [x] `agents.rs`: pane identity, the signal order in `settle`, the idle skip in `look`,
      `rule` text; tests for each disagreement case
- [x] DECISIONS: the signal order; JOURNAL: the format as observed on 2.1.332
- [x] Receipt: unchanged by construction. Nothing resident is added (no process,
      watcher or window; two small caches on the existing tick), and the reference config
      has the agents monitor off, so this code doesn't run there. Not re-measured.
- [ ] Live: a busy session shows working with `seen: session file busy` while the
      spinner glyph changes; Esc mid-turn settles to done within ~30 s

## Acceptance criteria

- [ ] Replayed fixtures cover busy, idle, shell, missing, interrupted, end_turn
- [ ] Screen still decides attention
- [ ] `pnpm verify` green; receipt unchanged

## Out of scope

- Context %, tokens and cost from the transcript tail (a separate step)
- Background jobs (`jobs/<id>/state.json`) and `claude agents --json`
- Other agents' session state

## Notes from the build (2026-11-27)

- A lag rule the card didn't have: a session file older than our last state change
  wins only after 5 s of disagreement, because Claude rewrites the file a moment after
  the hook fires; without it a stale `idle` flipped a just-started turn to done.
- Installed on Mitch's Mac: every session's state matched the screen on the first read
  (no disagreement yet to show the new `rule` texts).

## Risks / open questions

- Private, undocumented format: parse leniently, never the single source.
- A long transcript: the first read seeks to the last ~64 KB, not the whole file.
