# Rust standards (delta from the jig standard)

- No `unwrap()`/`expect()` outside tests — errors are values; use `thiserror` for domain errors.
- Tauri commands stay thin: parse/validate → call a plain function → map the error. Logic lives in testable modules, not command handlers.
- `cargo clippy -- -D warnings` and `cargo test` are part of `verify` (add them to the root verify script).
- `rustfmt` on save/commit; don't fight the formatter.
- Performance budgets, if the product has them, are requirements — put the table in `AGENTS.md` and test against it.
