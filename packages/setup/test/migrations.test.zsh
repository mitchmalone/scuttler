#!/bin/zsh
source "${0:A:h}/harness.zsh"
cli="$SCUTTLER_BASE/bin/scuttler"
log="$T/migrations.log"

# the shipped directory: the README plus the real migrations, each of which
# must fall through on a home that has nothing for it to do (rename.test.zsh
# covers what they do on one that has)
assert_file "$SCUTTLER_BASE/migrations/README.md" "README ships"
shipped=("$SCUTTLER_BASE"/migrations/*.zsh(N))
assert_eq 1 "${#shipped}" "one real migration ships (the rename)"
out="$("$cli" migrate 2>&1)"; rc=$?
assert_eq 0 "$rc" "shipped migrations run clean on an empty home"
assert_match "counts the shipped one" "$out" "1 ran, 0 already done"
assert_eq "2026-11-01-rename-to-scuttler.zsh" "$(cat "$(sc_migrations_record)")" "recorded once"
assert_no_file "$HOME/.zshrc" "nothing rendered on a home without the shell base"

# fixtures under $T from here on
export SCUTTLER_MIGRATIONS_DIR="$T/migrations"
assert_ok "missing dir is fine" "$cli" migrate 2>/dev/null
mkdir -p "$SCUTTLER_MIGRATIONS_DIR"
assert_ok "empty dir is fine" "$cli" migrate 2>/dev/null

# sorted order, lib loaded, each recorded
cat > "$SCUTTLER_MIGRATIONS_DIR/2026-01-02-second.zsh" <<'M'
print -r -- "second $(sc_tilde "$HOME/x")" >> "$MIGRATION_LOG"
M
cat > "$SCUTTLER_MIGRATIONS_DIR/2026-01-01-first.zsh" <<'M'
sc_state_init
print -r -- "first" >> "$MIGRATION_LOG"
exit 0   # a subshell: this must not end the run
M
export MIGRATION_LOG="$log"
out="$("$cli" migrate 2>&1)"; rc=$?
assert_eq 0 "$rc" "two migrations exit 0"
assert_eq $'first\nsecond ~/x' "$(cat "$log")" "ran in sorted order with lib loaded"
assert_eq $'2026-11-01-rename-to-scuttler.zsh\n2026-01-01-first.zsh\n2026-01-02-second.zsh' "$(cat "$(sc_migrations_record)")" "record lists both after the shipped one"
assert_match "counts" "$out" "2 ran, 0 already done"

# second run: nothing re-runs
out="$("$cli" migrate 2>&1)"
assert_eq $'first\nsecond ~/x' "$(cat "$log")" "nothing re-ran"
assert_match "counts again" "$out" "0 ran, 2 already done"

# a failure stops the run, is not recorded, and later ones wait
cat > "$SCUTTLER_MIGRATIONS_DIR/2026-01-03-broken.zsh" <<'M'
print -r -- "broken" >> "$MIGRATION_LOG"
false
print -r -- "unreachable" >> "$MIGRATION_LOG"
M
cat > "$SCUTTLER_MIGRATIONS_DIR/2026-01-04-later.zsh" <<'M'
print -r -- "later" >> "$MIGRATION_LOG"
M
out="$("$cli" migrate 2>&1)"; rc=$?
assert_eq 1 "$rc" "failure exits 1"
assert_match "names the culprit" "$out" "2026-01-03-broken.zsh: failed"
assert_eq $'first\nsecond ~/x\nbroken' "$(cat "$log")" "err_exit inside, later one not run"
assert_fails "broken not recorded" sc_migration_done 2026-01-03-broken.zsh
assert_fails "later not recorded" sc_migration_done 2026-01-04-later.zsh

# fix it; the rerun picks up where it stopped
print 'print -r -- "fixed" >> "$MIGRATION_LOG"' > "$SCUTTLER_MIGRATIONS_DIR/2026-01-03-broken.zsh"
assert_ok "rerun succeeds" "$cli" migrate 2>/dev/null
assert_eq $'first\nsecond ~/x\nbroken\nfixed\nlater' "$(cat "$log")" "resumed in order"
assert_eq 5 "$(wc -l < "$(sc_migrations_record)" | tr -d ' ')" "five recorded (the shipped one included)"

t_done
