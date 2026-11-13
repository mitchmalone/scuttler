//! One-shot home migrations across the two renames: launcharr → scuttlarr
//! (DECISIONS 2026-09-11) and scuttlarr → scuttler (DECISIONS 2026-11-01).
//!
//! Every path the app owned under an old name moves to its new spot, once, at
//! startup, before anything reads it. Each move is `rename` — atomic on the same
//! volume, a no-op when the new path already exists or the old one doesn't — so a
//! fresh install, an already-migrated home and a two-hop upgrade all fall straight
//! through. The hops run oldest first, so a launcharr home lands on scuttler.
//!
//! Paths (old → new), all relative to `$HOME`, per hop:
//! - `.config/<old>` → `.config/<new>` (config, scripts, plugins, hooks, widgets,
//!   triggers, themes). The `.build/` cache inside is purged afterwards: plugin
//!   bundles bind to the host's shared-module global, which was renamed, so they
//!   must rebuild.
//! - `.local/share/<old>` → `.local/share/<new>` (usage mirrors, zsh plugins)
//! - `.local/state/<old>` → `.local/state/<new>` (manifest, agents socket, awake,
//!   `current/theme/`). The second hop leaves a symlink at the old state path for
//!   one release: the Machine rung's generated shell files import the theme from
//!   it by absolute path, and a hard break would leave every new terminal unthemed
//!   until `scuttler shell --apply` ran. The setup migration
//!   `2026-11-01-rename-to-scuttler.zsh` re-renders those files and removes the
//!   symlink. Config gets no symlink: one owner (AGENTS invariant 11).
//! - `Library/Application Support/<old bundle id>` → `<new bundle id>` (frecency
//!   SQLite, icon + thumb caches) — first hop only. The bundle id stays
//!   `com.mitchmalone.scuttlarr` through the second hop: the 0.8.0 updater refuses
//!   a bundle whose id differs from its own, so a new id would have broken the one
//!   upgrade path, and it would have reset every TCC grant. Inside that dir the
//!   database file renames (`scuttlarr.db` → `scuttler.db`).
//! - `Library/LaunchAgents/<old>.plist` is removed; it pointed at the old bundle
//!   path, which the cask rename retires. The login item is re-registered from
//!   config on every startup anyway (`apply_launch_at_login`).
//!
//! Names inside `config.json` that are the app's own — the built-in theme
//! `scuttlarr`, a pair or Focus mapping naming it, a `themes.scuttlarr` override,
//! and custom shortcuts bound to the `scuttlarr — …` rows — are rewritten in place
//! (`rewrite_config`). Frecency history keyed `scuttlarr:*` is rewritten when the
//! database opens (`frecency::open`).
//!
//! What is deliberately *not* moved: `~/Library/Logs/<old>.log` (history, cheap
//! to leave), `.bak-<old>` backups next to adopted files (they belong to the
//! user), the root-owned `/etc/sudoers.d/scuttlarr` (the app cannot; its rule
//! keeps working, and `scuttler sudoers on` replaces it), the editor theme
//! installs (the next apply installs under the new name), and anything in
//! `~/.claude*/settings.json` — the hook paths there are mended by `hooks::boot`
//! through its existing stale-path repair, which is the manifest rule (AGENTS
//! invariant 11) applied to a file we don't own.

use std::path::{Path, PathBuf};

use serde_json::Value;

/// One rename, oldest first.
struct Hop {
    old: &'static str,
    new: &'static str,
    /// Application Support dir move, when the bundle id changed with the name.
    bundle: Option<(&'static str, &'static str)>,
    /// Leave `~/.local/state/<old>` pointing at the new dir (see module docs).
    state_symlink: bool,
}

const HOPS: [Hop; 2] = [
    Hop {
        old: "launcharr",
        new: "scuttlarr",
        bundle: Some(("com.mitchmalone.launcharr", "com.mitchmalone.scuttlarr")),
        state_symlink: false,
    },
    Hop {
        old: "scuttlarr",
        new: "scuttler",
        bundle: None,
        state_symlink: true,
    },
];

/// The bundle id, unchanged by the second hop (module docs).
pub const BUNDLE_ID: &str = "com.mitchmalone.scuttlarr";

/// The name before this one, for the compatibility surfaces that still read it
/// (Keychain service, plugin import alias, the setup CLI's env fallback).
pub const PREVIOUS: &str = "scuttlarr";

/// What one run did, for the log. Empty means nothing to do.
pub fn migrate(home: &Path) -> Vec<String> {
    let mut log = Vec::new();
    for hop in &HOPS {
        migrate_hop(home, hop, &mut log);
    }
    log
}

fn migrate_hop(home: &Path, hop: &Hop, log: &mut Vec<String>) {
    let mut pairs: Vec<(PathBuf, PathBuf)> = vec![
        (
            home.join(".config").join(hop.old),
            home.join(".config").join(hop.new),
        ),
        (
            home.join(".local/share").join(hop.old),
            home.join(".local/share").join(hop.new),
        ),
        (
            home.join(".local/state").join(hop.old),
            home.join(".local/state").join(hop.new),
        ),
    ];
    let support = home.join("Library/Application Support");
    match hop.bundle {
        Some((old, new)) => pairs.push((support.join(old), support.join(new))),
        None => pairs.push((
            support.join(BUNDLE_ID).join(format!("{}.db", hop.old)),
            support.join(BUNDLE_ID).join(format!("{}.db", hop.new)),
        )),
    }
    let mut moved_config = false;
    for (old, new) in &pairs {
        // A symlink left by an earlier run of this hop is not a dir to move.
        if old.is_symlink() {
            continue;
        }
        match crate::config::migrate_home(old, new) {
            Ok(true) => {
                moved_config |= old.ends_with(Path::new(".config").join(hop.old));
                log.push(format!("moved {} → {}", old.display(), new.display()));
            }
            Ok(false) => {}
            Err(e) => log.push(format!("could not move {}: {e}", old.display())),
        }
    }
    // Plugin bundles compiled under the old name bind to the old shared global.
    let build = home.join(".config").join(hop.new).join(".build");
    if moved_config && build.is_dir() {
        match std::fs::remove_dir_all(&build) {
            Ok(()) => log.push("purged plugin build cache (rebuilds on load)".into()),
            Err(e) => log.push(format!("could not purge {}: {e}", build.display())),
        }
    }
    if moved_config {
        let config = home.join(".config").join(hop.new).join("config.json");
        match rewrite_config_file(&config, hop.old, hop.new) {
            Ok(true) => log.push(format!("renamed {} in config.json", hop.old)),
            Ok(false) => {}
            Err(e) => log.push(format!("could not rewrite {}: {e}", config.display())),
        }
    }
    if hop.state_symlink {
        let old_state = home.join(".local/state").join(hop.old);
        let new_state = home.join(".local/state").join(hop.new);
        if new_state.is_dir() && !old_state.exists() && !old_state.is_symlink() {
            match std::os::unix::fs::symlink(&new_state, &old_state) {
                Ok(()) => log.push(format!(
                    "linked {} → {} (one release; the setup migration removes it)",
                    old_state.display(),
                    new_state.display()
                )),
                Err(e) => log.push(format!("could not link {}: {e}", old_state.display())),
            }
        }
    }
    // The generated aerospace.toml names us twice: its header and the
    // `exec-on-workspace-change` touch of `~/.config/<name>/triggers/workspace`
    // — the bar's fast path. Left alone, the hook touches a dir that no longer
    // exists and workspace switches fall back to the 1 Hz poll (JOURNAL
    // 2026-11-04). Ours by its header (invariant 11), so rewriting is adopt, not
    // overwrite; runs on every boot because it is one small read.
    match rewrite_aerospace_toml(
        &crate::desktop::aerospace_toml_path_in(home),
        hop.old,
        hop.new,
    ) {
        Ok(true) => log.push(format!("renamed {} in aerospace.toml", hop.old)),
        Ok(false) => {}
        Err(e) => log.push(format!("could not rewrite aerospace.toml: {e}")),
    }
    let plist = home
        .join("Library/LaunchAgents")
        .join(format!("{}.plist", hop.old));
    if plist.exists() {
        match std::fs::remove_file(&plist) {
            Ok(()) => log.push(format!("removed {}", plist.display())),
            Err(e) => log.push(format!("could not remove {}: {e}", plist.display())),
        }
    }
}

/// Rename the app's own name where it appears as a value in `config.json`:
/// the active theme, the light/dark pair, Focus mappings, the `themes` override
/// key, and custom shortcuts bound to the built-in `<old> — …` rows. Nothing
/// else is touched — a user's own theme called `<old>-ish` is theirs.
pub fn rewrite_config(config: &mut Value, old: &str, new: &str) -> bool {
    let Some(root) = config.as_object_mut() else {
        return false;
    };
    let mut changed = false;
    let mut rename_str = |v: &mut Value| {
        if v.as_str() == Some(old) {
            *v = Value::String(new.into());
            changed = true;
        }
    };
    if let Some(theme) = root.get_mut("theme") {
        rename_str(theme);
    }
    if let Some(appearance) = root.get_mut("appearance").and_then(Value::as_object_mut) {
        if let Some(pair) = appearance.get_mut("pair").and_then(Value::as_object_mut) {
            for key in ["light", "dark"] {
                if let Some(v) = pair.get_mut(key) {
                    rename_str(v);
                }
            }
        }
        if let Some(focus) = appearance.get_mut("focus").and_then(Value::as_object_mut) {
            for v in focus.values_mut() {
                match v {
                    Value::String(_) => rename_str(v),
                    Value::Object(pair) => {
                        for key in ["light", "dark"] {
                            if let Some(v) = pair.get_mut(key) {
                                rename_str(v);
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    if let Some(themes) = root.get_mut("themes").and_then(Value::as_object_mut) {
        if let Some(override_) = themes.remove(old) {
            if !themes.contains_key(new) {
                themes.insert(new.into(), override_);
            }
            changed = true;
        }
    }
    let prefix = format!("{old} — ");
    if let Some(shortcuts) = root.get_mut("shortcuts").and_then(Value::as_object_mut) {
        for v in shortcuts.values_mut() {
            if let Some(name) = v.as_str().and_then(|s| s.strip_prefix(&prefix)) {
                *v = Value::String(format!("{new} — {name}"));
                changed = true;
            }
        }
    }
    changed
}

fn rewrite_config_file(path: &Path, old: &str, new: &str) -> std::io::Result<bool> {
    if !path.is_file() {
        return Ok(false);
    }
    let raw = std::fs::read_to_string(path)?;
    let Ok(mut json) = serde_json::from_str::<Value>(&raw) else {
        // A hand-edit we can't parse is left exactly as it is.
        return Ok(false);
    };
    if !rewrite_config(&mut json, old, new) {
        return Ok(false);
    }
    let pretty = serde_json::to_string_pretty(&json)?;
    let tmp = path.with_extension(format!("json.tmp-{}", std::process::id()));
    std::fs::write(&tmp, pretty + "\n").and_then(|()| std::fs::rename(&tmp, path))?;
    Ok(true)
}

/// Repoint a generated `aerospace.toml` from `<old>` to `<new>`: the header and
/// every `.config/<old>/` path (the trigger touch, the header's config.json
/// hint). A file without our `<old>` header — foreign, or already ours — is
/// left exactly as it is.
fn rewrite_aerospace_toml(path: &Path, old: &str, new: &str) -> std::io::Result<bool> {
    if !path.is_file() {
        return Ok(false);
    }
    let raw = std::fs::read_to_string(path)?;
    if !raw.starts_with(&format!("# generated by {old}")) {
        return Ok(false);
    }
    let out = raw
        .replacen(
            &format!("# generated by {old}"),
            &format!("# generated by {new}"),
            1,
        )
        .replace(&format!(".config/{old}/"), &format!(".config/{new}/"));
    if out == raw {
        return Ok(false);
    }
    let tmp = path.with_extension(format!("toml.tmp-{}", std::process::id()));
    std::fs::write(&tmp, out).and_then(|()| std::fs::rename(&tmp, path))?;
    Ok(true)
}

/// The bundle folder an upgrade across the rename leaves behind: the 0.8.0
/// updater swaps a `scuttler.app` into `/Applications/scuttlarr.app`, so the
/// first launch of this build renames its own folder and relaunches from the new
/// path (the login item re-registers against it). Returns the new path when a
/// rename happened.
pub fn rename_bundle_folder(exe: &Path) -> Option<PathBuf> {
    let bundle = exe
        .ancestors()
        .find(|p| p.extension().and_then(|e| e.to_str()) == Some("app"))?;
    let old_name = format!("{}.app", HOPS[1].old);
    if bundle.file_name()?.to_str()? != old_name {
        return None;
    }
    let new = bundle.with_file_name(format!("{}.app", HOPS[1].new));
    if new.exists() {
        return None;
    }
    std::fs::rename(bundle, &new).ok()?;
    Some(new)
}

/// Startup entry: run the pure migration against the real home, forget an old
/// LaunchAgent if one was loaded (best-effort — the file is already gone, and a
/// stale job for a missing binary is harmless), and move the bundle folder if
/// this build is running from the previous name's.
pub fn boot() {
    if let Some(home) = dirs::home_dir() {
        let log = migrate(&home);
        for line in &log {
            eprintln!("[scuttler rename] {line}");
        }
        // The hook path changed under a running AeroSpace: ask it to re-read.
        if log.iter().any(|l| l.contains("aerospace.toml")) {
            crate::desktop::reload_aerospace();
        }
        if log.iter().any(|l| l.contains("LaunchAgents")) {
            for hop in &HOPS {
                let _ = std::process::Command::new("launchctl")
                    .args(["remove", hop.old])
                    .output();
            }
        }
    }
    if let Some(new) = std::env::current_exe()
        .ok()
        .and_then(|exe| rename_bundle_folder(&exe))
    {
        eprintln!(
            "[scuttler rename] moved the bundle to {} — relaunching",
            new.display()
        );
        let path = new.to_string_lossy().into_owned();
        let _ = std::process::Command::new("/bin/sh")
            .args(["-c", &crate::login_item::relaunch_script(), &path])
            .spawn();
        std::thread::sleep(std::time::Duration::from_millis(300));
        std::process::exit(0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn scratch() -> PathBuf {
        // The clock alone is not unique: it ticks in microseconds here, and two
        // tests starting in the same one shared a home and raced on its files.
        static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!(
            "scuttler-rename-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn fresh_home_is_a_no_op() {
        let home = scratch();
        assert!(migrate(&home).is_empty());
    }

    #[test]
    fn a_launcharr_home_lands_on_scuttler_in_one_run() {
        let home = scratch();
        for rel in [
            ".config/launcharr/.build/amaran",
            ".config/launcharr/plugins/amaran",
            ".local/share/launcharr/mirrors",
            ".local/state/launcharr",
            "Library/Application Support/com.mitchmalone.launcharr/icons",
            "Library/LaunchAgents",
        ] {
            std::fs::create_dir_all(home.join(rel)).unwrap();
        }
        std::fs::write(home.join(".config/launcharr/config.json"), "{}").unwrap();
        std::fs::write(home.join("Library/LaunchAgents/launcharr.plist"), "x").unwrap();

        let log = migrate(&home);
        assert!(
            home.join(".config/scuttler/config.json").exists(),
            "{log:?}"
        );
        assert!(home.join(".config/scuttler/plugins/amaran").is_dir());
        assert!(!home.join(".config/scuttler/.build").exists());
        assert!(!home.join(".config/launcharr").exists());
        assert!(!home.join(".config/scuttlarr").exists());
        assert!(home.join(".local/share/scuttler/mirrors").is_dir());
        assert!(home.join(".local/state/scuttler").is_dir());
        assert!(home.join(".local/state/scuttlarr").is_symlink());
        assert!(home
            .join("Library/Application Support/com.mitchmalone.scuttlarr/icons")
            .is_dir());
        assert!(!home.join("Library/LaunchAgents/launcharr.plist").exists());

        // Second run: nothing left to do.
        assert!(migrate(&home).is_empty());
    }

    #[test]
    fn a_scuttlarr_home_moves_and_keeps_its_bundle_dir() {
        let home = scratch();
        for rel in [
            ".config/scuttlarr/.build/lights",
            ".config/scuttlarr/plugins/lights",
            ".local/share/scuttlarr/mirrors",
            ".local/state/scuttlarr/current/theme",
            "Library/Application Support/com.mitchmalone.scuttlarr/icons",
            "Library/LaunchAgents",
        ] {
            std::fs::create_dir_all(home.join(rel)).unwrap();
        }
        let support = home.join("Library/Application Support/com.mitchmalone.scuttlarr");
        std::fs::write(support.join("scuttlarr.db"), "db").unwrap();
        std::fs::write(
            home.join(".config/scuttlarr/config.json"),
            r#"{"theme":"scuttlarr","shortcuts":{"Cmd+T":"scuttlarr — Theme switcher"}}"#,
        )
        .unwrap();
        std::fs::write(home.join("Library/LaunchAgents/scuttlarr.plist"), "x").unwrap();

        let log = migrate(&home);
        assert_eq!(log.len(), 8, "{log:?}");
        assert!(!home.join(".config/scuttlarr").exists());
        assert!(home.join(".config/scuttler/plugins/lights").is_dir());
        assert!(!home.join(".config/scuttler/.build").exists());
        assert!(home.join(".local/share/scuttler/mirrors").is_dir());
        assert!(home.join(".local/state/scuttler/current/theme").is_dir());
        // The old state path still resolves — generated shell files import from it.
        assert!(home.join(".local/state/scuttlarr").is_symlink());
        assert!(home.join(".local/state/scuttlarr/current/theme").is_dir());
        assert!(support.join("icons").is_dir());
        assert!(support.join("scuttler.db").exists());
        assert!(!support.join("scuttlarr.db").exists());
        assert!(!home.join("Library/LaunchAgents/scuttlarr.plist").exists());
        let cfg: Value = serde_json::from_str(
            &std::fs::read_to_string(home.join(".config/scuttler/config.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(cfg["theme"], "scuttler");
        assert_eq!(cfg["shortcuts"]["Cmd+T"], "scuttler — Theme switcher");

        assert!(migrate(&home).is_empty());
    }

    #[test]
    fn a_generated_aerospace_toml_follows_the_rename() {
        let home = scratch();
        let toml = home.join(".config/aerospace/aerospace.toml");
        std::fs::create_dir_all(toml.parent().unwrap()).unwrap();
        std::fs::write(
            &toml,
            "# generated by scuttlarr — edit ~/.config/scuttlarr/config.json\n\
             exec-on-workspace-change = ['/bin/bash', '-c',\n\
             \x20 'touch \"$HOME/.config/scuttlarr/triggers/workspace\"'\n]\n",
        )
        .unwrap();
        let log = migrate(&home);
        assert_eq!(log, vec!["renamed scuttlarr in aerospace.toml".to_string()]);
        let out = std::fs::read_to_string(&toml).unwrap();
        assert!(out.starts_with("# generated by scuttler — edit ~/.config/scuttler/config.json"));
        assert!(out.contains("$HOME/.config/scuttler/triggers/workspace"));
        assert!(!out.contains("scuttlarr"));
        assert!(migrate(&home).is_empty());
    }

    #[test]
    fn a_foreign_aerospace_toml_is_left_alone() {
        let home = scratch();
        let toml = home.join(".config/aerospace/aerospace.toml");
        std::fs::create_dir_all(toml.parent().unwrap()).unwrap();
        let hand = "# mine\nexec-on-workspace-change = ['touch', '/tmp/scuttlarr']\n";
        std::fs::write(&toml, hand).unwrap();
        assert!(migrate(&home).is_empty());
        assert_eq!(std::fs::read_to_string(&toml).unwrap(), hand);
    }

    #[test]
    fn never_overwrites_an_existing_new_home() {
        let home = scratch();
        std::fs::create_dir_all(home.join(".config/scuttlarr")).unwrap();
        std::fs::create_dir_all(home.join(".config/scuttler")).unwrap();
        std::fs::write(home.join(".config/scuttlarr/config.json"), "old").unwrap();
        std::fs::write(home.join(".config/scuttler/config.json"), "new").unwrap();
        assert!(migrate(&home).is_empty());
        assert_eq!(
            std::fs::read_to_string(home.join(".config/scuttler/config.json")).unwrap(),
            "new"
        );
        assert!(home.join(".config/scuttlarr/config.json").exists());
    }

    #[test]
    fn config_rename_touches_only_the_apps_own_names() {
        let mut cfg = json!({
            "theme": "scuttlarr",
            "appearance": {
                "pair": { "light": "scuttlarr", "dark": "dracula" },
                "focus": { "Work": "scuttlarr", "Sleep": { "light": "scuttlarr", "dark": "nord" } }
            },
            "themes": { "scuttlarr": { "accent": "#f00" }, "scuttlarr-ish": {} },
            "shortcuts": { "Cmd+T": "scuttlarr — Theme switcher", "Cmd+S": "Safari" }
        });
        assert!(rewrite_config(&mut cfg, "scuttlarr", "scuttler"));
        assert_eq!(
            cfg,
            json!({
                "theme": "scuttler",
                "appearance": {
                    "pair": { "light": "scuttler", "dark": "dracula" },
                    "focus": { "Work": "scuttler", "Sleep": { "light": "scuttler", "dark": "nord" } }
                },
                "themes": { "scuttler": { "accent": "#f00" }, "scuttlarr-ish": {} },
                "shortcuts": { "Cmd+T": "scuttler — Theme switcher", "Cmd+S": "Safari" }
            })
        );
        // Idempotent, and a config that never named us is left alone.
        assert!(!rewrite_config(&mut cfg, "scuttlarr", "scuttler"));
        let mut other = json!({ "theme": "nord" });
        assert!(!rewrite_config(&mut other, "scuttlarr", "scuttler"));
    }

    #[test]
    fn unparseable_config_is_left_exactly_as_it_is() {
        let home = scratch();
        let path = home.join("config.json");
        std::fs::write(&path, "{ not json").unwrap();
        assert!(!rewrite_config_file(&path, "scuttlarr", "scuttler").unwrap());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{ not json");
    }

    #[test]
    fn bundle_folder_renames_only_from_the_old_name() {
        let root = scratch();
        let old = root.join("scuttlarr.app");
        std::fs::create_dir_all(old.join("Contents/MacOS")).unwrap();
        let exe = old.join("Contents/MacOS/scuttler");
        std::fs::write(&exe, "").unwrap();
        assert_eq!(rename_bundle_folder(&exe), Some(root.join("scuttler.app")));
        assert!(root.join("scuttler.app/Contents/MacOS/scuttler").exists());
        assert!(!old.exists());

        let exe = root.join("scuttler.app/Contents/MacOS/scuttler");
        assert_eq!(rename_bundle_folder(&exe), None);
        assert_eq!(
            rename_bundle_folder(Path::new("/tmp/target/debug/scuttler")),
            None
        );
    }

    #[test]
    fn bundle_folder_rename_yields_to_an_existing_new_bundle() {
        let root = scratch();
        std::fs::create_dir_all(root.join("scuttlarr.app/Contents/MacOS")).unwrap();
        std::fs::create_dir_all(root.join("scuttler.app")).unwrap();
        let exe = root.join("scuttlarr.app/Contents/MacOS/scuttler");
        std::fs::write(&exe, "").unwrap();
        assert_eq!(rename_bundle_folder(&exe), None);
        assert!(root.join("scuttlarr.app").exists());
    }
}
