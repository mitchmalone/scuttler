//! The system admin-rights dialog, once, to write the sudoers rule from a
//! click (DECISIONS 2026-11-07): `AuthorizationCreate` for
//! `system.privilege.admin` with our own prompt text, then
//! `AuthorizationExecuteWithPrivileges` to run the bundled CLI's root half as
//! root. The dialog is Apple's: it names the app, takes the account password
//! (Touch ID is not offered for this right, spike 2026-11-07), and the app
//! never sees what was typed. Apple deprecated the execute call in 10.7 and
//! ships it still; `osascript … with administrator privileges` is the same
//! call with a worse header. A helper daemon is the alternative and is out of
//! scope (the plan).
//!
//! Security.framework-only module (the AGENTS rule): everything that touches
//! the authorization ref lives here. Blocking by design: callers run it on a
//! worker thread, the dialog is modal to the user, not to the panel.

use std::io::Read;
use std::path::Path;

use security_framework::authorization::{Authorization, AuthorizationItemSetBuilder, Flags};

/// Apple's `errAuthorizationCanceled`: Cancel on the dialog.
const CANCELED: i32 = -60006;
/// The right every admin-password dialog asks for.
const ADMIN_RIGHT: &str = "system.privilege.admin";
/// `kAuthorizationEnvironmentPrompt`: the body text under the header.
const PROMPT_KEY: &str = "prompt";

/// Why the run did not happen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Declined {
    /// Cancel on the dialog.
    Cancelled,
    /// Authorization refused (no admin account, policy) or could not start
    /// the tool.
    Unavailable(String),
}

impl std::fmt::Display for Declined {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Declined::Cancelled => f.write_str("not approved"),
            Declined::Unavailable(why) => write!(f, "admin dialog unavailable: {why}"),
        }
    }
}

/// Show the admin dialog with `prompt` as its body and, on a password, run
/// `program args…` as root. Returns what the tool wrote to stdout; its exit
/// status is not reported by the API, so callers verify the effect
/// themselves (the sudoers rule is read back by `sudoers status`).
pub fn run_as_admin(prompt: &str, program: &Path, args: &[&str]) -> Result<String, Declined> {
    let rights = AuthorizationItemSetBuilder::new()
        .add_right(ADMIN_RIGHT)
        .map_err(|e| Declined::Unavailable(e.to_string()))?
        .build();
    let env = AuthorizationItemSetBuilder::new()
        .add_string(PROMPT_KEY, prompt)
        .map_err(|e| Declined::Unavailable(e.to_string()))?
        .build();
    let auth = Authorization::new(
        Some(rights),
        Some(env),
        Flags::INTERACTION_ALLOWED | Flags::EXTEND_RIGHTS | Flags::PREAUTHORIZE,
    )
    .map_err(|e| {
        if e.code() == CANCELED {
            Declined::Cancelled
        } else {
            Declined::Unavailable(e.to_string())
        }
    })?;
    let mut pipe = auth
        .execute_with_privileges_piped(program, args, Flags::DEFAULTS)
        .map_err(|e| Declined::Unavailable(e.to_string()))?;
    let mut out = String::new();
    // The pipe closes when the tool exits; a read error after that is noise.
    let _ = pipe.read_to_string(&mut out);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// At the Mac: `cargo test --lib authorization -- --ignored --nocapture`.
    /// Puts up the dialog; a password runs `id -u` as root and prints 0.
    /// Note the header: from a test binary it names the binary, from the
    /// built app it should name scuttler.
    #[test]
    #[ignore]
    fn shows_the_dialog_and_runs_as_root() {
        let out = run_as_admin(
            "scuttler spike: runs id -u as root and nothing else.",
            Path::new("/usr/bin/id"),
            &["-u"],
        );
        eprintln!("verdict: {out:?}");
        if let Ok(out) = out {
            assert_eq!(out.trim(), "0");
        }
    }

    #[test]
    fn declined_reads_like_the_sheet() {
        assert_eq!(Declined::Cancelled.to_string(), "not approved");
        assert_eq!(
            Declined::Unavailable("x".into()).to_string(),
            "admin dialog unavailable: x"
        );
    }
}
