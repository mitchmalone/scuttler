---
title: Make agent statuses correct
status: active
created: 2026-11-06
updated: 2026-11-06
links:
  - ../../DECISIONS.md 2026-11-06
  - ../../JOURNAL.md 2026-11-06 (the away recap)
  - ../done/agent-daemon-and-subagents.md (the hook adapter this shrinks)
  - herdr docs: https://herdr.dev/docs/agents/ ("How status works", "Blocked state")
  - herdr catalogue: https://herdr.dev/agent-detection/index.toml (public; the project is Apache-2.0, THIRD-PARTY-LICENSES.md)
---

# Make agent statuses correct

## Goal

An agent cell on the bar says what you would see if you switched to that pane and
looked: working, needs you, done. Not just for the shapes we have met, but forever:
the shapes live in one rule file per agent, a wrong cell is a screen capture and a new
line in that file, and every agent herdr supports from the screen (22 in its public
catalogue, 2026-11-06) is a file here too.

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

- [x] `agents/<id>.toml` bundled for all 22 agents in herdr's catalogue (claude, codex,
      copilot, cursor, gemini, cline, agy, kiro, maki, opencode, pi, qodercli, letta,
      muse, qwen, amp, devin, droid, grok, hermes, kilo, kimi), each with a provenance
      header; `rules.rs` evaluates regions (`osc_title`, `bottom_non_empty_lines(N)`,
      `top_non_empty_lines(N)`, `whole_recent`, `after_last_horizontal_rule`,
      `prompt_box_body`, `last_non_empty_above_prompt_box`, the Codex prompt-marker
      regions), matchers (`contains` case-folded, `regex`, `line_regex`, `any`, `all`,
      `not`), priority, `skip_state_update`; tests replay Claude working, idle, question
      form, Bash permission, transcript overlay, and Codex title, approval, spinner.
      `toml` and `regex` were already in the tree through tauri: no new weight.
- [x] Screen capture in `agents.rs`: the layout read carries `pane_current_command`,
      `pane_tty` and `pane_title`; `look()` runs `capture-pane -S -40` for every
      `working` / `attention` session on the 2 s layout cadence and for any session a
      hook just spoke for; the verdict settles through `settle()`.
- [x] Discovery: a pane whose foreground command is a known agent (or an interpreter
      whose command line names one, `ps -t`, cached 30 s) becomes a `pane:%N` session
      with no hook at all; a hook for that pane takes the cell over, keeping its age.
- [x] The rollup: screen `idle` after `working`/`attention` → `done`; `blocked` →
      `attention`; an overlay → no change; `read` only via a jump, as before.
- [x] The hook shrinks: Notification carries state only for `permission_prompt` and
      `elicitation_dialog`; SubagentStart/Stop carry none; PreToolUse of
      AskUserQuestion is `attention`; a blank state inherits in the store.
- [x] "seen: <rule>" on the agents panel row (`AgentSession.rule`, mirrored in the kit).
- [ ] Codex hook installer (`~/.codex/hooks.json` + `[features] hooks = true`): not
      needed for state (Codex panes are discovered and read); only for a title. Later.
- [x] Docs: README names where the rules live; DECISIONS 2026-11-06; this plan.

## Acceptance criteria

- [x] PR608's shape (bare prompt box, 25 h silent) reads idle/`done`, never `needs
you` (test `claude_bare_prompt_box_is_idle_whatever_the_title_says`); a question
      form or a permission prompt reads `needs you` (tests); the activity line reads
      `working` (test).
- [x] The away recap, the idle notification and an Esc-interrupted turn change nothing
      the screen does not show: the hook sends no state for the first two, and the
      screen look settles the third on its next 2 s tick.
- [x] A transcript viewer or model picker left open does not change the cell (test).
- [ ] `pnpm verify` green on the final commit; every rule file parses and every
      pattern compiles (test); live check on Mitch's panes after dev-install.
- [ ] Memory: `scripts/mem.sh --receipt` unchanged in kind (no new process; rule tables
      are a few KB of text); recorded at the next release.
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
- ~~Whether to ask herdr for the catalogue under a licence~~: settled 2026-11-06, herdr
  is Apache-2.0 and the files are treated as such: licence text shipped in
  `THIRD-PARTY-LICENSES.md` (source and bundle), each file's header says it is derived
  and modified, the README credits herdr.
