---
title: Open-source release readiness review
status: planned # ROADMAP "Open-source readiness review"; trigger: before the first public announcement
created: 2026-08-17
updated: 2026-11-01 (rewritten for the current scope; not started)
links:
  - ../../STANDARDS.md
  - ../../RELEASING.md
  - ../../ROADMAP.md
---

# Open-source release readiness review

## Goal

Audit the repository for security defects, poor engineering practice, standards drift and
release-readiness gaps, and leave a prioritised, evidence-backed report that drives the
hardening work before the first public announcement. The repo has been public since v0.2.0;
this is about being _announced_, not visible.

## Context

scuttlarr spans a privileged macOS boundary (Rust/Tauri: AppKit, process launch, the
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
access, the Claude hook, everything written outside `~/.config/scuttlarr`), then review
each module systematically. Combine manual review with the gate, `cargo audit`, `pnpm
audit`, secret scanning and targeted static searches. Record only reproducible findings,
each with severity, evidence, impact and a concrete remediation.

## Steps

- [ ] Map shipped artefacts, trust boundaries, permissions, IPC, persistence and network use
      (AGENTS invariants 1–3, 11, 12 as the checklist).
- [ ] Rust/Tauri: native FFI, subprocesses, filesystem handling, SQLite, config, `selfupdate.rs`,
      `sleep_override.rs`, `widget_secrets.rs`, `plugins.rs`/`runtime.rs` (what user code can
      reach), `hooks.rs`.
- [ ] TypeScript: the desktop UI, the kit, the plugin loader (blob-URL modules, shared
      globals), the site, the reference widgets and bundled scripts.
- [ ] `packages/setup`: every write outside the overlay, the sudoers rule, `remove`.
- [ ] Release supply chain: `release.sh`, the workflow, the tap, notarization, `SHA256SUMS`.
- [ ] Verification, dependency, secret and repository-hygiene checks; test gaps.
- [ ] The report: open-source blockers, pre-announcement work, accepted residual risk.
      STATUS points at it; this plan closes.

## Acceptance criteria

- [ ] Every first-party source, config and workflow file is in the review inventory.
- [ ] Findings carry severity, evidence, impact and remediation; uncertainty is explicit.
- [ ] `pnpm verify`, `cargo audit`, `pnpm audit` and secret-scanning results are recorded.
- [ ] The report separates blockers, pre-announcement work and accepted residual risk.
- [ ] `docs/STATUS.md` points to the report and this plan is in `done/`.

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
