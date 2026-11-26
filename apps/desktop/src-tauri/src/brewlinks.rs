//! Homebrew's half-upgraded formulae (JOURNAL 2026-11-25): a `brew upgrade`
//! that dies partway can leave `<prefix>/opt/<formula>` and
//! `<prefix>/var/homebrew/linked/<formula>` pointing at the new version's keg,
//! which was never installed. Every later `brew upgrade` then aborts on the
//! first one it resolves (`Error: …/Cellar/<formula>/<version> is not a
//! directory`), one formula per run. This finds them all in one pass and, when
//! the user asks, removes those links — only the dangling symlinks, never a
//! keg — so brew sees the old keg as installed and outdated again.
//!
//! Plain filesystem functions over a prefix, so they test against a temp dir.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

/// The two directories whose links name a formula's current keg.
const LINK_DIRS: [&str; 2] = ["opt", "var/homebrew/linked"];

/// One formula whose links point at a keg that is not there. Mirrored by
/// `BrokenFormula` in the updates plugin's model.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokenFormula {
    /// The Cellar directory name (`luajit`, `python@3.13`).
    pub name: String,
    /// The version the links point at, which was never installed.
    pub missing: String,
    /// Versions still in the Cellar. Non-empty: removing the links lets brew
    /// upgrade it again. Empty: the formula is gone and the links are debris.
    pub kegs: Vec<String>,
    /// The dangling links, absolute, sorted.
    pub links: Vec<String>,
}

impl BrokenFormula {
    /// An older keg is still installed, so removing the links repairs it.
    pub fn repairable(&self) -> bool {
        !self.kegs.is_empty()
    }
}

/// Which formulae a repair touches: the two classes are never mixed, because
/// one is a fix and the other forgets a formula.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Class {
    /// An older keg remains.
    Repairable,
    /// No keg remains.
    Stale,
}

impl Class {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "repairable" => Some(Self::Repairable),
            "stale" => Some(Self::Stale),
            _ => None,
        }
    }

    fn holds(self, formula: &BrokenFormula) -> bool {
        formula.repairable() == (self == Self::Repairable)
    }
}

/// Every formula under `prefix` with a link to a missing keg, by name. A link
/// that dangles anywhere other than `<prefix>/Cellar/<formula>/<version>` is
/// not this failure and is left out. Unreadable directories read as empty.
pub fn scan(prefix: &Path) -> Vec<BrokenFormula> {
    let cellar = prefix.join("Cellar");
    let mut found: BTreeMap<String, BrokenFormula> = BTreeMap::new();
    for dir in LINK_DIRS {
        let dir = prefix.join(dir);
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let link = entry.path();
            let Some((name, version)) = missing_keg_of(&link, &cellar) else {
                continue;
            };
            let formula = found.entry(name.clone()).or_insert_with(|| BrokenFormula {
                kegs: kegs(&cellar.join(&name)),
                name,
                missing: version,
                links: Vec::new(),
            });
            formula.links.push(link.to_string_lossy().into_owned());
        }
    }
    let mut out: Vec<BrokenFormula> = found.into_values().collect();
    for formula in &mut out {
        formula.links.sort();
    }
    out
}

/// Remove the dangling links of every formula of `class`, found by a fresh
/// scan: nothing the caller says is trusted, and each link is checked again
/// the moment before it goes. Returns the paths removed.
pub fn repair(prefix: &Path, class: Class) -> Result<Vec<String>, String> {
    let cellar = prefix.join("Cellar");
    let mut removed = Vec::new();
    for formula in scan(prefix).iter().filter(|f| class.holds(f)) {
        for link in &formula.links {
            let path = Path::new(link);
            if missing_keg_of(path, &cellar).is_none() {
                continue;
            }
            // remove_file unlinks the symlink itself; it cannot follow one.
            fs::remove_file(path).map_err(|e| format!("could not remove {link}: {e}"))?;
            removed.push(link.clone());
        }
    }
    Ok(removed)
}

/// `(formula, version)` when `link` is a symlink into `cellar` whose keg is
/// missing; None for anything else, including a healthy link.
fn missing_keg_of(link: &Path, cellar: &Path) -> Option<(String, String)> {
    let meta = fs::symlink_metadata(link).ok()?;
    if !meta.file_type().is_symlink() {
        return None;
    }
    // exists() follows the link: true means the keg is there.
    if link.exists() {
        return None;
    }
    let target = fs::read_link(link).ok()?;
    let target = normalize(&link.parent()?.join(target));
    let rest = target.strip_prefix(cellar).ok()?;
    let mut parts = rest.components();
    let name = parts.next()?.as_os_str().to_str()?.to_owned();
    let version = parts.next()?.as_os_str().to_str()?.to_owned();
    if parts.next().is_some() {
        return None;
    }
    Some((name, version))
}

/// Resolve `.` and `..` without touching the disk (the target does not
/// exist, so `canonicalize` cannot be asked).
fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for part in path.components() {
        match part {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// The versions installed under one formula's Cellar directory, sorted.
fn kegs(formula_dir: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(formula_dir) else {
        return Vec::new();
    };
    let mut versions: Vec<String> = entries
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| e.file_name().to_str().map(str::to_owned))
        .filter(|name| !name.starts_with('.'))
        .collect();
    versions.sort();
    versions
}

/// The formula and version in brew's `Error: <prefix>/Cellar/<formula>/<version>
/// is not a directory` — the line a dangling link aborts an upgrade with.
pub fn missing_keg_in(line: &str) -> Option<(String, String)> {
    let path = line
        .trim()
        .strip_prefix("Error: ")?
        .strip_suffix(" is not a directory")?;
    let (_, rest) = path.split_once("/Cellar/")?;
    let (name, version) = rest.split_once('/')?;
    if name.is_empty() || version.is_empty() || version.contains('/') {
        return None;
    }
    Some((name.to_owned(), version.to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    /// A prefix with `Cellar`, `opt` and `var/homebrew/linked`, under a
    /// unique temp dir.
    fn prefix(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("scuttler-brewlinks-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        for sub in ["Cellar", "opt", "var/homebrew/linked"] {
            fs::create_dir_all(dir.join(sub)).unwrap();
        }
        dir
    }

    fn keg(prefix: &Path, name: &str, version: &str) {
        fs::create_dir_all(prefix.join("Cellar").join(name).join(version)).unwrap();
    }

    /// Both links for `name`, pointing at `version`, the way brew writes them.
    fn link(prefix: &Path, name: &str, version: &str) {
        symlink(
            format!("../Cellar/{name}/{version}"),
            prefix.join("opt").join(name),
        )
        .unwrap();
        symlink(
            format!("../../../Cellar/{name}/{version}"),
            prefix.join("var/homebrew/linked").join(name),
        )
        .unwrap();
    }

    #[test]
    fn a_healthy_prefix_has_nothing_broken() {
        let p = prefix("healthy");
        keg(&p, "git", "2.50");
        link(&p, "git", "2.50");
        assert!(scan(&p).is_empty());
        let _ = fs::remove_dir_all(&p);
    }

    #[test]
    fn a_half_upgraded_formula_is_repairable_and_names_both_links() {
        let p = prefix("half");
        keg(&p, "luajit", "2.1.1");
        link(&p, "luajit", "2.1.2");
        let broken = scan(&p);
        assert_eq!(broken.len(), 1);
        let f = &broken[0];
        assert_eq!(f.name, "luajit");
        assert_eq!(f.missing, "2.1.2");
        assert_eq!(f.kegs, vec!["2.1.1"]);
        assert!(f.repairable());
        assert_eq!(f.links.len(), 2);
        assert!(f.links[0].ends_with("opt/luajit"));
        assert!(f.links[1].ends_with("var/homebrew/linked/luajit"));
        let _ = fs::remove_dir_all(&p);
    }

    #[test]
    fn a_formula_with_no_keg_left_is_stale_not_repairable() {
        let p = prefix("stale");
        symlink(
            "../../../Cellar/powerlevel10k/1.21.0",
            p.join("var/homebrew/linked/powerlevel10k"),
        )
        .unwrap();
        let broken = scan(&p);
        assert_eq!(broken.len(), 1);
        assert!(broken[0].kegs.is_empty());
        assert!(!broken[0].repairable());
        let _ = fs::remove_dir_all(&p);
    }

    #[test]
    fn an_alias_link_groups_under_the_formula_it_points_at() {
        let p = prefix("alias");
        keg(&p, "python@3.13", "3.13.1");
        link(&p, "python@3.13", "3.13.2");
        symlink("../Cellar/python@3.13/3.13.2", p.join("opt/python3")).unwrap();
        let broken = scan(&p);
        assert_eq!(broken.len(), 1);
        assert_eq!(broken[0].name, "python@3.13");
        assert_eq!(broken[0].links.len(), 3);
        let _ = fs::remove_dir_all(&p);
    }

    #[test]
    fn links_that_dangle_outside_the_cellar_are_not_ours() {
        let p = prefix("outside");
        symlink("/nowhere/at/all", p.join("opt/odd")).unwrap();
        symlink("../Cellar/deep/1.0/bin/tool", p.join("opt/deep")).unwrap();
        fs::write(p.join("opt/plainfile"), "x").unwrap();
        assert!(scan(&p).is_empty());
        let _ = fs::remove_dir_all(&p);
    }

    #[test]
    fn repair_removes_only_the_links_of_its_class_and_never_a_keg() {
        let p = prefix("repair");
        keg(&p, "luajit", "2.1.1");
        link(&p, "luajit", "2.1.2");
        keg(&p, "git", "2.50");
        link(&p, "git", "2.50");
        symlink("../Cellar/gone/1.0", p.join("opt/gone")).unwrap();

        let removed = repair(&p, Class::Repairable).unwrap();
        assert_eq!(removed.len(), 2);
        assert!(p.join("Cellar/luajit/2.1.1").is_dir());
        assert!(fs::symlink_metadata(p.join("opt/luajit")).is_err());
        // The healthy formula and the stale one are untouched.
        assert!(p.join("opt/git").exists());
        assert!(fs::symlink_metadata(p.join("opt/gone")).is_ok());
        let left = scan(&p);
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].name, "gone");

        assert_eq!(repair(&p, Class::Stale).unwrap().len(), 1);
        assert!(scan(&p).is_empty());
        let _ = fs::remove_dir_all(&p);
    }

    #[test]
    fn the_error_line_names_the_formula_and_version() {
        assert_eq!(
            missing_keg_in("Error: /opt/homebrew/Cellar/docker-buildx/0.39.1 is not a directory"),
            Some(("docker-buildx".into(), "0.39.1".into()))
        );
        assert_eq!(
            missing_keg_in("Error: /usr/local/Cellar/python@3.13/3.13.2 is not a directory\n"),
            Some(("python@3.13".into(), "3.13.2".into()))
        );
        assert_eq!(
            missing_keg_in("Error: No such keg: /opt/homebrew/Cellar/x"),
            None
        );
        assert_eq!(
            missing_keg_in("Error: /opt/homebrew/Cellar/x/1.0/bin is not a directory"),
            None
        );
        assert_eq!(missing_keg_in("==> Upgrading 3 outdated packages"), None);
    }

    #[test]
    fn class_parses_its_two_names_only() {
        assert_eq!(Class::parse("repairable"), Some(Class::Repairable));
        assert_eq!(Class::parse("stale"), Some(Class::Stale));
        assert_eq!(Class::parse("all"), None);
    }
}
