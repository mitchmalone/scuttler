//! The sudoers rule, installed and removed from the app: the bundled CLI's
//! root half (`scuttler sudoers install|remove`) runs as root under the
//! system admin dialog (`authorization.rs`), then its user half
//! (`sudoers on|off`) records the manifest as the user, asking nothing. One
//! password, once, in Apple's dialog; the rule text stays the CLI's
//! (`packages/setup/lib/sudoers.zsh`), the app passes what root cannot look
//! up: the mas path it will run and the user's name (DECISIONS 2026-11-07).
//!
//! Plain functions over `setup::run_args`; both doors — the updates panel's
//! `{"sudoers":"on"}` message and Settings → Machine's `setup_run` verb — land
//! here.

use std::path::Path;

use crate::authorization::{self, Declined};
use crate::setup::{self, SetupOutput, SetupVerb};

/// The dialog's body, under the system header ("scuttler wants to make
/// changes"). Says what the rule allows, that updates still ask for Touch ID,
/// and where it comes off.
pub fn prompt(mas: Option<&Path>) -> String {
    let allows = match mas {
        Some(_) => "exactly two things: switching macOS sleep off while an awake hold runs (pmset), and App Store updates (mas upgrade)",
        None => "exactly one thing: switching macOS sleep off while an awake hold runs (pmset). App Store updates join it once mas is installed",
    };
    format!(
        "Let scuttler keep your Mac awake and update App Store apps.\n\n\
         This writes one rule to /etc/sudoers.d/scuttler allowing {allows}. \
         Each App Store update still asks for Touch ID first. \
         Remove it any time in Settings → Machine."
    )
}

/// `install --mas <path> --user <name>` or `remove`, as the CLI's argv after
/// `sudoers`. `--mas` is the path the updates panel runs under `sudo -n`, so
/// the rule and the command agree byte for byte.
pub fn root_args(on: bool, mas: Option<&Path>, user: &str) -> Vec<String> {
    let mut args = vec!["sudoers".to_string()];
    if on {
        args.push("install".into());
        if let Some(mas) = mas {
            args.push("--mas".into());
            args.push(mas.display().to_string());
        }
        args.push("--user".into());
        args.push(user.into());
    } else {
        args.push("remove".into());
    }
    args
}

/// The user half's argv: `on` with the same pins, so it finds the file in
/// place and records the manifest without regenerating a different rule.
pub fn user_args(on: bool, mas: Option<&Path>, user: &str) -> Vec<String> {
    let mut args = root_args(on, mas, user);
    args[1] = if on { "on".into() } else { "off".into() };
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

/// Turn the rule on or off: the dialog, the root half, then the user half.
/// `Err` is the dialog's refusal; `Ok(false)` means the password was taken
/// but the rule is not in the state asked for (the output says why).
pub fn set(base: &Path, on: bool) -> Result<SetupOutput, Declined> {
    let mas = crate::updates::locate_mas();
    let user = login_user();
    let cli = base.join("bin/scuttler");
    let root = root_args(on, mas.as_deref(), &user);
    // zsh runs the CLI with stderr folded into the pipe (the API returns
    // only stdout) and colour off; `$0` is the CLI so it finds its base.
    let mut argv = vec!["-c", "NO_COLOR=1 exec \"$0\" \"$@\" 2>&1"];
    let cli_s = cli.display().to_string();
    argv.push(&cli_s);
    argv.extend(root.iter().map(String::as_str));
    let root_out =
        authorization::run_as_admin(&prompt(mas.as_deref()), Path::new("/bin/zsh"), &argv)?;
    let user_args = user_args(on, mas.as_deref(), &user);
    let user_out = setup::run_args(
        base,
        &user_args.iter().map(String::as_str).collect::<Vec<_>>(),
    )
    .unwrap_or_else(|e| SetupOutput {
        ok: false,
        output: e.to_string(),
        base: base.display().to_string(),
    });
    let status = setup::run_at(base, SetupVerb::SudoersStatus)
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
    fn root_args_pin_mas_and_user_for_install_only() {
        assert_eq!(
            root_args(true, Some(Path::new("/opt/homebrew/bin/mas")), "mitch"),
            [
                "sudoers",
                "install",
                "--mas",
                "/opt/homebrew/bin/mas",
                "--user",
                "mitch"
            ]
        );
        assert_eq!(
            root_args(true, None, "mitch"),
            ["sudoers", "install", "--user", "mitch"]
        );
        assert_eq!(
            root_args(false, Some(Path::new("/x/mas")), "mitch"),
            ["sudoers", "remove"]
        );
    }

    #[test]
    fn user_args_are_on_off_with_the_same_pins() {
        assert_eq!(
            user_args(true, Some(Path::new("/x/mas")), "bob"),
            ["sudoers", "on", "--mas", "/x/mas", "--user", "bob"]
        );
        assert_eq!(user_args(false, None, "bob"), ["sudoers", "off"]);
    }

    #[test]
    fn prompt_names_the_commands_and_the_way_out() {
        let p = prompt(Some(Path::new("/x/mas")));
        assert!(p.contains("/etc/sudoers.d/scuttler"));
        assert!(p.contains("mas upgrade"));
        assert!(p.contains("pmset"));
        assert!(p.contains("Touch ID"));
        assert!(p.contains("Settings → Machine"));
        let p = prompt(None);
        assert!(p.contains("exactly one thing"));
        assert!(p.contains("once mas is installed"));
    }
}
