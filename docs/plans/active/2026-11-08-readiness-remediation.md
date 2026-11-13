---
title: Readiness remediation, the blockers
status: active
created: 2026-11-08
updated: 2026-11-08
links:
  - ../../reviews/2026-11-08-opensource-readiness.md (section 3 is the list)
  - ../done/2026-11-08-opensource-readiness-review.md
  - 2026-11-07-admin-rule-from-the-app.md on `feat/admin-rule-from-the-app` (B1 and B3 land there)
  - DECISIONS 2026-11-06, 2026-11-07 (the rule and the dialog)
---

# Readiness remediation, the blockers

## Goal

Close the five blockers in the readiness review's section 3 so the repo can be
announced: no passwordless root through a user-owned path, themes that are data, a
root hop that runs nothing user-owned, protected branches, clean audits.

## Context

The review (`docs/reviews/2026-11-08-opensource-readiness.md`) found B1 live on main
since v0.8.6 (`scuttler sudoers on` pins `/opt/homebrew/bin/mas`), B2 reproduced
against the shipped renderer, B3 on the unmerged admin-rule branch, B4 in GitHub
settings, B5 in two lockfiles. Section 4 (pre-announcement work) is a later plan.

## Approach

Two branches. `fix/readiness-blockers` from main carries B5 and B2 (pure code with
tests first; a dependency bump each). B1 and B3 land on `feat/admin-rule-from-the-app`
because they reshape the root half that branch introduces: the rule names a
root-owned copy of mas that the root half installs, and the root half is three
absolute commands run through `run_as_admin` with a scrubbed environment, no zsh.
B4 is Mitch's hands in GitHub settings; this plan lists what to flip.

## Steps

- [x] B5: `cargo update` for rustls, rustls-webpki, webpki-roots; `next` to `^16.4.5`;
      both audits clean; `pnpm verify` green.
- [x] B2: tests first in `packages/theme` (a non-hex colour, a newline or quote in a
      name key, a hostile `muted`, `bat_theme`, `neovim_colorscheme` all rejected;
      every built-in theme still renders), then `validatePalette` in `renderTheme`:
      colour keys are `#rrggbb`, name keys match `^[A-Za-z0-9 _.-]+$`.
- [x] B2: installed (cloned) themes contribute only data hand files (`claude.json`,
      `vscode-theme.json`, `btop.theme`); `ghostty`, `tmux.conf`, `p10k-colors.zsh`,
      `delta.gitconfig`, `neovim.lua` are rendered from the palette for them. Rust
      test; `user_themes.rs` header, THEMES.md and DECISIONS say so.
- [x] B1 (admin-rule branch): the root half installs a root-owned copy of the resolved
      mas (`/usr/local/libexec/scuttler/mas`, 0755 root:wheel) and the rule names that
      path; `updates.rs` runs that path; the status row reports a stale copy as
      "differs"; the CLI path does the same; DECISIONS 2026-11-06 and the dialog copy
      corrected.
- [x] B3 (admin-rule branch): the root half is Rust: rule text built in Rust, temp file
      created under `/etc/sudoers.d/.scuttler.XXXXXX`, `/usr/sbin/visudo -cf`,
      `/usr/bin/install -m 0444`, `/bin/rm -f` of the old name, each through
      `run_as_admin` with `/usr/bin/env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin`;
      `--user` validated; the zsh `install|remove` verbs stay for the terminal path
      but refuse env overrides when EUID is 0 and use absolute binaries.
- [ ] Live run of the dialog (plan 2026-11-07), then merge the branch.
- [ ] B4: Mitch flips rulesets on `main` and `v*` in both repos, `beebeebot` to triage,
      secret scanning, push protection, Dependabot, private vulnerability reporting;
      `dependabot.yml` added here (done 2026-11-08; the settings remain).

## Acceptance criteria

- [x] `cargo audit` and `pnpm audit --prod` report no vulnerabilities (2026-11-08).
- [x] The review's B2 proof of concept throws `PaletteError` and no file is written (2026-11-08).
- [x] `/etc/sudoers.d/scuttler` names no path outside root-owned directories (built; the live run confirms).
- [x] Nothing user-owned executes as root in the dialog path (built; the live run confirms).
- [ ] `pnpm verify` green; STATUS updated; the review's section 3 items marked.

## Out of scope

Section 4 of the review (CSP, self-update hardening, pipeline pins, setup CLI bugs,
SECURITY.md, licences, code health): the next plan.

## Risks / open questions

- A root-owned copy of mas goes stale when Homebrew upgrades mas; the status row must
  say so and the re-install must be one click.
- Dropping executable hand files from cloned themes changes what an Omarchy theme repo
  contributes; built-in and hand-made themes are unaffected.
