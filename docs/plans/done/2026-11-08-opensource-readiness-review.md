---
title: Open-source release readiness review
status: done # the report: ../../reviews/2026-11-08-opensource-readiness.md
created: 2026-08-17
updated: 2026-11-08 (done: five parallel reviews, report written, remediation is the next plan)
links:
  - ../../STANDARDS.md
  - ../../RELEASING.md
  - ../../ROADMAP.md
  - ../../reviews/2026-11-08-opensource-readiness.md
---

# Open-source release readiness review

## Goal

Audit the repository for security defects, poor engineering practice, standards drift and
release-readiness gaps, and leave a prioritised, evidence-backed report that drives the
hardening work before the first public announcement. The repo has been public since v0.2.0;
this is about being _announced_, not visible.

## Context

scuttler spans a privileged macOS boundary (Rust/Tauri: AppKit, process launch, the
filesystem, a sudoers rule, self-update that swaps the bundle), a React interface, a shared
pure TypeScript engine, a Bun runtime for user plugins and widgets (code the user installs
and we run), the Theme rung (writes into editor and shell configs), the Machine rung (zsh,
macOS defaults, a root-owned file), a static Next.js site, and local + GitHub release
automation with a shared Homebrew tap. The review covers source, configuration,
capabilities, dependencies, tests, documentation, generated artefacts and the release
supply chain — `pnpm verify` is not the assurance case. The 2026-10-19 code-health pass
(`done/2026-10-19-cleanup-bugs-and-guardrails.md`) covered engineering practice but not
security, dependencies or secrets.

## Approach

Inventory every shipped and runtime surface, inspect high-risk boundaries first
(self-update verification, the sudoers rule, plugin/widget execution and their Keychain
access, the Claude hook, everything written outside `~/.config/scuttler`), then review
each module systematically. Combine manual review with the gate, `cargo audit`, `pnpm
audit`, secret scanning and targeted static searches. Record only reproducible findings,
each with severity, evidence, impact and a concrete remediation.

## Steps

- [x] Map shipped artefacts, trust boundaries, permissions, IPC, persistence and network use
      (AGENTS invariants 1–3, 11, 12 as the checklist).
- [x] Rust/Tauri: native FFI, subprocesses, filesystem handling, SQLite, config, `selfupdate.rs`,
      `sleep_override.rs`, `widget_secrets.rs`, `plugins.rs`/`runtime.rs` (what user code can
      reach), `hooks.rs`.
- [x] TypeScript: the desktop UI, the kit, the plugin loader (blob-URL modules, shared
      globals), the site, the reference widgets and bundled scripts.
- [x] `packages/setup`: every write outside the overlay, the sudoers rule, `remove`.
- [x] Release supply chain: `release.sh`, the workflow, the tap, notarization, `SHA256SUMS`.
- [x] Verification, dependency, secret and repository-hygiene checks; test gaps.
- [x] The report: open-source blockers, pre-announcement work, accepted residual risk.
      STATUS points at it; this plan closes.

Done 2026-11-08: `docs/reviews/2026-11-08-opensource-readiness.md`. Five blockers
(B1 the mas NOPASSWD pin is root for anything running as the user; B2 installed
themes are code; B3 the admin dialog runs user-owned shell as root; B4 main, tags and
repo security settings; B5 `next` and `rustls` advisories), a pre-announcement list,
proposed residual risk, tool results and the inventory. Four residual checks need a
live run (R1 to R4 in the report).

## Acceptance criteria

- [x] Every first-party source, config and workflow file is in the review inventory.
- [x] Findings carry severity, evidence, impact and remediation; uncertainty is explicit.
- [x] `pnpm verify`, `cargo audit`, `pnpm audit` and secret-scanning results are recorded.
- [x] The report separates blockers, pre-announcement work and accepted residual risk.
- [x] `docs/STATUS.md` points to the report and this plan is in `done/`.

## Out of scope

- Implementing the remediation backlog beyond trivial documentation corrections.
- Dynamic penetration testing of third-party services or macOS internals.
- Signing, notarization and hands-on checks that need Mitch's credentials or a physical Mac.

## Risks / open questions

- Generated build output (`dist/`, `target/`) may differ from source; only tracked and
  released artefacts are security-relevant, but stale local output can still reveal release
  hygiene problems.
- Tool availability may constrain automated checks; a gap is recorded, never treated as a
  pass.
