---
title: Agents per-session hover card (a tile grid per tmux session / herdr workspace)
status: planned
created: 2026-11-27
updated: 2026-11-27
links:
  - Notion: "Agents: per-session hover card (tile grid per tmux session / herdr workspace)" (Fleet / The Backlog)
  - plans/active/2026-11-27-agents-claude-session-files.md (the `rule` text the footer shows)
---

# Agents per-session hover card

## Goal

Hovering an agent box on the bar opens one card for that tmux session (or herdr
workspace, or the loose box): every agent as a tile whose state reads without reading
text. The last feature for 0.9.

## Context

- `BarAgents` (`packages/tui/src/bar/components.tsx`) groups cells with `groupAgents`
  (`muxGroup`, sorted by `muxIndex`) and opens a per-agent `BarCard` on hovering a cell
  (`agent:<session>`). The site demo (`apps/www/src/components/demo/bar.tsx`) and the
  app (`apps/desktop/src/bar/modules.tsx`) both render `BarAgents`: the card is built
  there and imported, never copied (invariant 10).
- State glyphs: `AgentStateIcon` (ring, breathing ring with dot, filled check, bare
  check, moon). State colours: `.bar-agent-<state>` (working accent, attention warn,
  done fg, read and idle dim).
- Helpers already there: `agentDoing`, `agentAge`, `agentDuration`, `agentCrumbs`,
  `agentMeta`, `agentStateLabel`.

## Decisions (from the card's answered questions)

- **Hover is per session.** Hovering anywhere on a box (a cell or the box's padding)
  opens the session card; the per-agent card goes. Hover key `agents:<group>`
  (`agents:` + `__loose` for the loose box).
- **Grid**: 4 columns, sized for 16 tiles (4 × 4); more than 16 shows the first 15 and a
  `+N more` tile. Tab order (`muxIndex`), then id.
- **Tile**: state glyph, title (or agent name), one status line (`agentDoing` verb and
  object while working, `needs you · 4m` for attention, `done · 1h ago` via `agentAge`,
  idle `idle · 3h`), tab label (`muxLabel` with its index) at the foot.
- **State without text, theme tokens only**: attention is a solid fill in the warn
  token with ink-coloured text; working an accent border (2 px); done (unread) a
  diagonal stripe texture in `--fg` at low alpha; read and idle dimmed (dim text, no
  border emphasis). No animation beyond the glyphs' existing spin and breathe.
- **Header**: the session name (tmux session / herdr workspace / "outside tmux") and
  counts, attention first: `1 needs you · 2 working · 3 done`.
- **Per-agent detail**: kept as a footer line for the tile under the pointer: crumbs,
  the turn clock and the `rule` (`seen: session file busy`). With no tile hovered, the
  footer is the hint `click a tile to jump · done marks read`.
- **Click a tile** jumps (the existing `onJump`); done marks read, as today.
- **Height**: `data-hover-height` is an estimate (header + rows × tile + footer);
  `cardRef` corrects it, as the other cards do.

## Steps

- [ ] Mock: page `06 Agents session card` on the settings-redesign canvas, the strip
      with boxes and the card open, 3, 7 and 16 agents, every state; Mitch approves
- [ ] Pure helpers in `format.ts`, tests first: `sessionCounts`, `tileStatus`,
      `sessionTiles` (cap and `+N more`), `sessionCardHeight`
- [ ] `BarAgents`: box-level hover, `BarAgentSessionCard` with tiles and footer; CSS in
      `bar.css` with theme tokens only
- [ ] Stories in `Bar.stories.tsx`: 3 agents mixed, 16 agents, loose box, herdr group
- [ ] Site demo renders the same component (it already imports `BarAgents`; check its
      fixtures cover several states in one group)
- [ ] `pnpm verify`; STATUS; live check on an installed build

## Acceptance criteria

- [ ] Hover a session box: one card with a tile per agent, correct states, tab order
- [ ] Click a tile jumps; done becomes read
- [ ] The site demo shows the same card
- [ ] `pnpm verify` green; no new IPC

## Out of scope

- Context %, tokens and cost on tiles (needs transcript data, a separate step)
- Keyboard navigation inside the card

## Risks / open questions

- Mitch's design inspiration image on the Notion card couldn't be downloaded here; the
  mock follows the card text until he shares it.
