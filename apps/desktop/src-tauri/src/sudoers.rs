//! The sudoers rule, installed and removed from the app behind the system
//! admin dialog (`authorization.rs`), one password, once (DECISIONS
//! 2026-11-07). What runs as root is three absolute commands from this file,
//! under an empty environment: nothing user-owned executes as root, not the
//! bundled zsh CLI, not a rc file, not a binary off PATH (DECISIONS
//! 2026-11-08, the readiness review's B3). The rule names scuttler's
//! root-owned copy of mas under `/usr/local/libexec/scuttler`, which the same
//! step makes, never Homebrew's user-writable path (B1). The CLI
//! (`packages/setup/lib/sudoers.zsh`) writes the identical rule from a
//! terminal; a test holds the two texts equal.
//!
//! Then the user half, as the user and asking nothing: `scuttler sudoers
//! record | forget` for the manifest, `sudoers status` for the verdict. Both
//! doors — the updates panel's `{"sudoers":"on"}` message and Settings →
//! Machine's `setup_run` verb — land here.

use std::path::{Path, PathBuf};

use crate::authorization::{self, Declined};
use crate::setup::{self, SetupOutput};

/// The root-owned copy of mas the rule names and the panel runs. The scripts
/// below spell it and `/etc/sudoers.d/scuttler` out in full: they are what
/// root executes, and a constant is easier to read than a format string.
/// `/etc/sudoers.d/scuttlarr` is the previous name's file (DECISIONS
/// 2026-11-01); its rule names the old Homebrew path, so it goes whenever this
/// one is written or removed.
pub const MAS_COPY: &str = "/usr/local/libexec/scuttler/mas";
/// The empty environment the root step runs under.
const ROOT_PATH: &str = "PATH=/usr/bin:/bin:/usr/sbin:/sbin";

/// The root half of "allow admin", as `/bin/sh -c` text. `$1` is the rule,
/// `$2` the mas to copy (empty: none). The temp file is made inside
/// `/etc/sudoers.d` (root-only, so no one swaps it between visudo's check
/// and install), with a dot in its name (sudo ignores such files). stderr
/// is folded into stdout because the dialog's pipe carries stdout only.
const INSTALL_SCRIPT: &str = r#"exec 2>&1
set -eu
umask 022
rule=$1
src=$2
tmp=$(/usr/bin/mktemp /etc/sudoers.d/.scuttler.XXXXXX)
trap '/bin/rm -f "$tmp"' EXIT
/usr/bin/printf '%s\n' "$rule" > "$tmp"
/usr/sbin/visudo -cf "$tmp" >/dev/null
if [ -n "$src" ]; then
  /usr/bin/install -d -m 0755 /usr/local/libexec/scuttler
  /usr/bin/install -m 0755 "$src" /usr/local/libexec/scuttler/mas
fi
/usr/bin/install -m 0444 "$tmp" /etc/sudoers.d/scuttler
/bin/rm -f /etc/sudoers.d/scuttlarr
echo "rule written"
"#;

/// The root half of "remove the rule".
const REMOVE_SCRIPT: &str = r#"exec 2>&1
set -u
/bin/rm -f /etc/sudoers.d/scuttler /etc/sudoers.d/scuttlarr /usr/local/libexec/scuttler/mas
/bin/rmdir /usr/local/libexec/scuttler 2>/dev/null || true
echo "rule removed"
"#;

/// The dialog's body, under the system header ("scuttler wants to make
/// changes"). Says what the rule allows, that updates still ask for Touch ID,
/// and where it comes off.
pub fn prompt(mas: Option<&Path>) -> String {
    let allows = match mas {
        Some(_) => "exactly two things: switching macOS sleep off while an awake hold runs (pmset), and App Store updates through a root-owned copy of mas that this step makes",
        None => "exactly one thing: switching macOS sleep off while an awake hold runs (pmset). App Store updates join it once mas is installed",
    };
    format!(
        "Let scuttler keep your Mac awake and update App Store apps.\n\n\
         This writes one rule to /etc/sudoers.d/scuttler allowing {allows}. \
         Each App Store update still asks for Touch ID first. \
         Remove it any time in Settings → Machine."
    )
}

/// A sudoers User_List is a grammar; the name must not be one. Same check as
/// the CLI's `_sc_sudoers_valid_user`.
pub fn valid_user(user: &str) -> bool {
    let mut chars = user.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_alphanumeric() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
}

/// The rule, byte for byte what `sc_sudoers_rule` writes (`sudoers.zsh`):
/// the two pmset commands, and with `mas` the four mas forms at the
/// root-owned copy, for `user`, no password.
pub fn rule_text(user: &str, mas: bool) -> String {
    let mut out = String::from(
        "# Written by `scuttler sudoers on`; `scuttler sudoers off` removes it.\n\
         # Lets scuttler's awake switch macOS sleep off while a hold is armed, and back on.\n\
         Cmnd_Alias SCUTTLER_SLEEP = /usr/bin/pmset -a disablesleep 1, /usr/bin/pmset -a disablesleep 0\n",
    );
    let aliases = if mas {
        out.push_str(&format!(
            "# Lets the updates panel upgrade App Store apps (mas requires root); the app\n\
             # asks for Touch ID, Apple Watch or your password before each run. The path is\n\
             # scuttler's root-owned copy of mas, not Homebrew's: a user-writable path in a\n\
             # NOPASSWD rule would be root for anything running as you.\n\
             Cmnd_Alias SCUTTLER_UPDATES = {m} upgrade, {m} upgrade *, {m} update, {m} update *\n",
            m = MAS_COPY
        ));
        "SCUTTLER_SLEEP, SCUTTLER_UPDATES"
    } else {
        out.push_str(
            "# mas was not installed when this was written; rerun `scuttler sudoers on` after installing it.\n",
        );
        "SCUTTLER_SLEEP"
    };
    out.push_str(&format!("{user} ALL=(root) NOPASSWD: {aliases}\n"));
    out
}

/// argv for `/usr/bin/env`: an empty environment, a fixed PATH, `/bin/sh`
/// running one of the scripts above with its positional arguments.
pub fn root_argv(on: bool, rule: &str, mas: Option<&Path>) -> Vec<String> {
    let mut argv: Vec<String> = vec!["-i".into(), ROOT_PATH.into(), "/bin/sh".into(), "-c".into()];
    if on {
        argv.push(INSTALL_SCRIPT.into());
        argv.push("sh".into());
        argv.push(rule.trim_end_matches('\n').to_string());
        argv.push(mas.map(|p| p.display().to_string()).unwrap_or_default());
    } else {
        argv.push(REMOVE_SCRIPT.into());
        argv.push("sh".into());
    }
    argv
}

/// `sudoers status --mas <src> --user <name>`: the pins the rule was written
/// with, so status rebuilds the same text and checks the copy against `src`.
pub fn status_args(mas: Option<&Path>, user: &str) -> Vec<String> {
    let mut args = vec!["sudoers".to_string(), "status".into()];
    if let Some(mas) = mas {
        args.push("--mas".into());
        args.push(mas.display().to_string());
    }
    args.push("--user".into());
    args.push(user.into());
    args
}

fn login_user() -> String {
    std::env::var("USER")
        .ok()
        .filter(|u| !u.is_empty() && u != "root")
        .or_else(|| {
            std::process::Command::new("/usr/bin/id")
                .arg("-un")
                .output()
                .ok()
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        })
        .unwrap_or_default()
}

/// The mas to copy: the one the panel found. Must be an absolute path to a
/// file; anything else means "no mas" rather than a guess.
fn mas_source() -> Option<PathBuf> {
    crate::updates::locate_mas().filter(|p| p.is_absolute() && p.is_file())
}

/// Turn the rule on or off: the dialog and the root step, then the user half.
/// `Err` is the dialog's refusal; `Ok(false)` means the password was taken
/// but the rule is not in the state asked for (the output says why).
pub fn set(base: &Path, on: bool) -> Result<SetupOutput, Declined> {
    let user = login_user();
    if !valid_user(&user) {
        return Err(Declined::Unavailable(format!(
            "the login name {user:?} cannot go in a sudoers rule"
        )));
    }
    let mas = mas_source();
    let rule = rule_text(&user, mas.is_some());
    let argv = root_argv(on, &rule, mas.as_deref());
    let argv_refs: Vec<&str> = argv.iter().map(String::as_str).collect();
    let root_out = authorization::run_as_admin(
        &prompt(mas.as_deref()),
        Path::new("/usr/bin/env"),
        &argv_refs,
    )?;
    let user_out = setup::run_args(base, &["sudoers", if on { "record" } else { "forget" }])
        .unwrap_or_else(|e| SetupOutput {
            ok: false,
            output: e.to_string(),
            base: base.display().to_string(),
        });
    let status_args = status_args(mas.as_deref(), &user);
    let status = setup::run_args(
        base,
        &status_args.iter().map(String::as_str).collect::<Vec<_>>(),
    )
    .map(|o| o.ok)
    .unwrap_or(false);
    crate::updates::refresh();
    Ok(SetupOutput {
        ok: status == on,
        output: format!("{}{}", root_out, user_out.output),
        base: user_out.base,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rule_names_the_root_owned_copy_never_homebrew() {
        let rule = rule_text("mitch", true);
        assert!(rule.contains(
            "/usr/local/libexec/scuttler/mas upgrade, /usr/local/libexec/scuttler/mas upgrade *"
        ));
        assert!(rule.contains(
            "/usr/local/libexec/scuttler/mas update, /usr/local/libexec/scuttler/mas update *"
        ));
        assert!(!rule.contains("/opt/homebrew"));
        assert!(rule.ends_with("mitch ALL=(root) NOPASSWD: SCUTTLER_SLEEP, SCUTTLER_UPDATES\n"));
        let rule = rule_text("mitch", false);
        assert!(rule.contains("rerun"));
        assert!(rule.ends_with("mitch ALL=(root) NOPASSWD: SCUTTLER_SLEEP\n"));
    }

    /// The CLI writes the same bytes: `sudoers status` compares the file to
    /// its own rendering, so a drift here would read as "differs".
    #[test]
    fn rule_text_matches_the_cli() {
        let base = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../packages/setup");
        for (mas, env_mas) in [(true, "/x/bin/mas"), (false, "")] {
            // `-f`: no rc files, so this Mac's `.zshenv` cannot put a mas on PATH.
            let out = std::process::Command::new("/bin/zsh")
                .arg("-f")
                .arg("-c")
                .arg("source \"$SCUTTLER_BASE/lib/core.zsh\"; source \"$SCUTTLER_BASE/lib/manifest.zsh\"; source \"$SCUTTLER_BASE/lib/sudoers.zsh\"; sc_sudoers_rule")
                .env("SCUTTLER_BASE", &base)
                .env("SCUTTLER_RULE_USER", "bob")
                .env("SCUTTLER_MAS_BIN", env_mas)
                .env("PATH", "/usr/bin:/bin")
                .output()
                .expect("zsh runs");
            assert!(
                out.status.success(),
                "{}",
                String::from_utf8_lossy(&out.stderr)
            );
            assert_eq!(
                String::from_utf8_lossy(&out.stdout),
                rule_text("bob", mas),
                "mas={mas}"
            );
        }
    }

    #[test]
    fn user_names_are_names_not_user_lists() {
        assert!(valid_user("mitch"));
        assert!(valid_user("_mbsetupuser"));
        assert!(valid_user("a.b-c"));
        assert!(!valid_user(""));
        assert!(!valid_user("bob ALL=(ALL) NOPASSWD: ALL"));
        assert!(!valid_user("ALL,bob"));
        assert!(!valid_user("-x"));
        assert!(!valid_user("a\nb"));
    }

    #[test]
    fn root_argv_is_an_empty_env_and_absolute_paths_only() {
        let argv = root_argv(true, "RULE\n", Some(Path::new("/opt/homebrew/bin/mas")));
        assert_eq!(&argv[..4], ["-i", ROOT_PATH, "/bin/sh", "-c"]);
        assert_eq!(argv[5], "sh");
        assert_eq!(argv[6], "RULE");
        assert_eq!(argv[7], "/opt/homebrew/bin/mas");
        // Every command in the scripts is spelled with its directory.
        for script in [INSTALL_SCRIPT, REMOVE_SCRIPT] {
            for line in script.lines().map(str::trim) {
                let first = line.split_whitespace().next().unwrap_or("");
                let ok = first.is_empty()
                    || first.starts_with('/')
                    || first.contains('=')
                    || matches!(
                        first,
                        "exec"
                            | "set"
                            | "umask"
                            | "trap"
                            | "if"
                            | "fi"
                            | "echo"
                            | "tmp=$(/usr/bin/mktemp"
                    );
                assert!(ok, "relative command in root script: {line}");
            }
        }
        let off = root_argv(false, "", None);
        assert_eq!(off.len(), 6);
        assert!(off[4].contains("/etc/sudoers.d/scuttler"));
        assert!(off[4].contains(MAS_COPY));
    }

    #[test]
    fn status_args_carry_the_pins() {
        assert_eq!(
            status_args(Some(Path::new("/x/mas")), "bob"),
            ["sudoers", "status", "--mas", "/x/mas", "--user", "bob"]
        );
        assert_eq!(
            status_args(None, "bob"),
            ["sudoers", "status", "--user", "bob"]
        );
    }

    #[test]
    fn prompt_names_the_commands_and_the_way_out() {
        let p = prompt(Some(Path::new("/x/mas")));
        assert!(p.contains("/etc/sudoers.d/scuttler"));
        assert!(p.contains("root-owned copy of mas"));
        assert!(p.contains("pmset"));
        assert!(p.contains("Touch ID"));
        assert!(p.contains("Settings → Machine"));
        let p = prompt(None);
        assert!(p.contains("exactly one thing"));
        assert!(p.contains("once mas is installed"));
    }
}
