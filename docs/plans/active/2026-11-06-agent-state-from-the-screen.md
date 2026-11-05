---
title: Agent state from the screen — the herdr model, for every agent
status: planned
created: 2026-11-06
updated: 2026-11-06
links:
  - ../../DECISIONS.md 2026-11-06
  - ../../JOURNAL.md 2026-11-06 (the away recap)
  - ../done/agent-daemon-and-subagents.md (the hook adapter this shrinks)
  - herdr docs: https://herdr.dev/docs/agents/ ("How status works", "Blocked state")
  - herdr catalogue: https://herdr.dev/agent-detection/index.toml (public, unlicensed)
---

# Agent state from the screen — the herdr model, for every agent

## Goal

A cell reads `working`, `needs you` or `done` because that is what the agent's pane
shows, not because of the order its hooks happened to fire. One rule engine and one
rule file per agent, so a wrong cell is fixed by adding a screen shape to a text file,
and a new agent (Codex, Copilot, Cursor, Gemini, …) is a new file, not new Rust.

## Context

Two days of hook-sequence bugs (JOURNAL 2026-11-06): Claude's away recap re-marked done
cells `working` through SubagentStop; the idle notification a minute after every Stop
promoted every finished cell to `needs you`; AskUserQuestion, a real ask, arrives as
PreToolUse and reads `working`. Each fix found the next. herdr 0.9.5, read on
2026-11-06 (docs page and the strings in its binary; the repo is Apache-2.0 but only
ships the terminal crate; the manifests are served without licence text):

- For Claude Code and 16 other agents, **state comes from the live bottom of the pane**,
  matched against a rule table with priorities and regions (`osc_title`,
  `bottom_non_empty_lines(N)`, `after_last_horizontal_rule`, `prompt_box_body`,
  `whole_recent`). Hooks report **identity only** (session id, transcript path); the
  Claude hook ignores SubagentStop outright, with a comment naming the recap. Six
  agents that report their own state (OpenCode, Pi, Kimi, Kilo, MastraCode, OMP) are
  trusted over the screen while they report.
- **Three states**: `working`, `idle`, `blocked`. `blocked` is strict: only a visible
  approval, question or permission UI; anything unknown is `idle`, never `blocked`.
  "Done" is a rollup: went idle and not yet viewed.
- **Overlays never flip state**: transcript viewer, model picker, `/btw` are rules with
  `skip_state_update`.
- Rules are **data, versioned, patched remotely** (`herdr.dev/agent-detection/`; the
  served Claude file is 2026.10.11 and already covers Claude Code 2.1.228's new spinner
  glyphs; the binary's copy is 2026.07.13). `herdr agent explain` names the rule that
  fired.
- Agent identity is the pane's foreground process. tmux gives us that already
  (`pane_current_command`) on the layout tick agents.rs runs every 2 s.

Verified on Mitch's panes 2026-11-06: a working pane shows `✻ Precipitating… (1m 50s ·
… esc to interrupt)` above the prompt box; PR608, 25 h idle, shows a bare `❯` prompt
box and nothing above it; every pane title reads `✳ <name>` whether working or not, so
the title rule (herdr's top priority) is useless on this setup and the screen rules
carry it.

## Approach

**Hooks trigger and label; the screen decides.** The Claude hook keeps sending what the
screen cannot know — session id, pid, the prompt as title, the tool as detail — and
every event is a reason to look. State is classified from `tmux capture-pane -p -t
<pane> -S -N` (N ≈ 20 lines, plus `#{pane_title}` from the layout read) by a small rule
engine in Rust over bundled TOML, one file per agent, in herdr's manifest shape
(regions, `contains` / `regex` / `line_regex`, `any` / `all` / `not`, `priority`,
`skip_state_update`). Format-compatible on purpose: a rule can be checked against
herdr's with `herdr agent explain --file screen.txt`, and if herdr agrees to it, their
catalogue could be consumed as-is. Until then the rule files are ours, written from
what we can see.

The store keeps `done` / `read` as its own rollup: a session that leaves `working` for
`idle` becomes `done` until jumped to. `attention` is the screen's `blocked`. The hook's
state becomes a hint used only when there is no pane to read (pid-only sessions).

When to look: on every hook event for that session; on the 2 s layout tick for every
session currently `working` or `attention`; never for `idle` / `done` / `read` ones
(their next hook event wakes them). One `capture-pane` per active pane per tick, a few
milliseconds, no new process resident.

Alternatives: keep refining the hook mapping (every fix found the next; herdr's authors
abandoned it for the same agent); poll every pane every tick (cost scales with panes,
not activity); read herdr's catalogue live (licence unclear, network on a core path).

## Steps

- [ ] `agents/rules/<id>.toml` bundled (`include_str!`), starting with `claude` and
      `codex`; a `rules.rs` evaluator (regions, matchers, priority, skip) with tests
      that replay captured screens: Claude working (activity line), idle (bare prompt
      box), AskUserQuestion form, Bash permission prompt, transcript viewer overlay,
      model picker; Codex "Action Required" title, "allow command?", `[y/n]`.
- [ ] Screen capture in `agents.rs`: `capture-pane` for the pane of each `working` /
      `attention` session on the layout tick and on each hook event; agent id from
      `pane_current_command` (`claude`, `codex`, `copilot`, …); unknown command → hook
      state as today.
- [ ] The rollup: screen `idle` after `working` → `done`; `blocked` → `attention`;
      `skip_state_update` → no change; `read` only via a jump, as now.
- [ ] The hook shrinks: identity, title, detail, pid; SubagentStart/Stop send no state;
      Notification sends no state (the detail still lands on the card).
- [ ] "explain" on the agent card: the rule id that set the state and when.
- [ ] Codex hook installer (`~/.codex/hooks.json` + `[features] hooks = true`), under
      invariant 11 like the Claude one; Copilot's one SessionStart entry if Mitch uses it.
- [ ] Docs: PLUGINS/agents section on how a rule file is added; DECISIONS 2026-11-06
      already records the model; JOURNAL for any Claude Code UI shape that surprised us.

## Acceptance criteria

- [ ] PR608's shape (bare prompt box, 25 h silent) reads `done · unread`, never
      `needs you`; a pane showing a question form or a permission prompt reads
      `needs you` within one tick; a pane with the activity line reads `working`.
- [ ] The away recap, the idle notification and an Esc-interrupted turn change nothing
      the screen does not show.
- [ ] A transcript viewer or model picker left open does not change the cell.
- [ ] `pnpm verify` green; every rule file has a replayed-screen test per rule.
- [ ] Memory: `scripts/mem.sh --receipt` before → after (no new process; a few KB of
      rule tables).
- [ ] Idle CPU with eight idle agents unchanged (no capture for idle sessions).

## Out of scope

- Reading herdr's served manifests (ask first). herdr panes keep coming through
  `herdr.rs` as today.
- Agents outside tmux/herdr (a bare Ghostty tab): hook state only, as now.
- Driving agents (send keys, prompt, wait): herdr's automation surface is not ours.

## Risks / open questions

- Claude Code's UI shapes change (2.1.228 changed the spinner glyphs). Mitigation: the
  rule file is data; a wrong cell is a captured screen and a new rule, with the test
  replaying the capture.
- `capture-pane` of a pane in copy-mode or with an alternate screen returns what is
  shown, which may be scrollback: herdr reads the live bottom regardless. Check `-S`
  against `#{pane_in_mode}` and skip classification while in mode.
- Whether to ask herdr for the catalogue under a licence: Mitch's call.
