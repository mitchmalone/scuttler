//! Appearance inputs: what the machine says right now, reported to the windows as
//! an `appearance-input` event. Policy is TypeScript (`@scuttler/core/appearance`
//! picks the theme, `lib/wallpaper.ts` the wallpaper and the active Focus); Rust
//! only reads and reports.
//!
//! - `~/Library/Preferences/.GlobalPreferences.plist` — `AppleInterfaceStyle` is
//!   `Dark` or absent. Read through `defaults` (the plist is binary), on change of
//!   the file, never on a timer. Needs no permission.
//! - `~/Library/DoNotDisturb/DB/` — the Focus database. **Needs Full Disk Access**
//!   (JOURNAL 2026-11-23), so it is read only while Focus mode wallpaper is on
//!   (invariant 12: off reads nothing and watches nothing); the user grants access
//!   when turning it on (invariant 1, DECISIONS 2026-11-23).
//!   `Assertions.json` holds a Focus someone turned on (here or synced) and the
//!   last "turned Focus off"; `ModeConfigurations.json` names every mode and its
//!   schedule. A Focus a schedule turned on is in no file: TypeScript evaluates the
//!   schedules itself.

use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

/// Seconds between the Unix epoch and Apple's reference date (2001-01-01 UTC).
const APPLE_EPOCH_OFFSET: f64 = 978_307_200.0;

/// Whether scuttler can read the Focus database right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FocusAccess {
    /// Readable (Full Disk Access granted).
    Granted,
    /// macOS refused the read: Full Disk Access is not granted.
    Denied,
    /// Not looking: Focus mode wallpaper is off.
    Off,
}

/// One enabled time schedule. Minutes after local midnight; days 0 = Monday.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusSchedule {
    pub start: u32,
    pub end: u32,
    pub days: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusMode {
    pub id: String,
    pub name: String,
    pub schedules: Vec<FocusSchedule>,
    /// Smart Activation is on: macOS may turn this Focus on in ways no file records.
    pub smart: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceInputs {
    pub system_dark: bool,
    pub focus_access: FocusAccess,
    /// A Focus turned on by hand (or synced from another device), if any.
    pub asserted_focus: Option<String>,
    /// When Focus was last turned off by hand (Unix seconds): a schedule that
    /// started before this is not running.
    pub focus_cleared_at: Option<f64>,
    /// Every configured Focus, sorted by name.
    pub modes: Vec<FocusMode>,
}

fn dnd_dir(home: &Path) -> PathBuf {
    home.join("Library/DoNotDisturb/DB")
}

/// The asserted Focus from the assertions file's text. Pure; tested on fixtures.
pub fn parse_active_focus(json: &str) -> Option<String> {
    let v: Value = serde_json::from_str(json).ok()?;
    v.get("data")?
        .as_array()?
        .iter()
        .filter_map(|d| d.get("storeAssertionRecords")?.as_array())
        .flatten()
        .filter_map(|r| {
            r.get("assertionDetails")?
                .get("assertionDetailsModeIdentifier")?
                .as_str()
                .map(str::to_string)
        })
        .next()
}

/// The latest "turn Focus off" request (Unix seconds). Pure.
pub fn parse_cleared_at(json: &str) -> Option<f64> {
    let v: Value = serde_json::from_str(json).ok()?;
    v.get("data")?
        .as_array()?
        .iter()
        .filter_map(|d| d.get("storeInvalidationRequestRecords")?.as_array())
        .flatten()
        .filter_map(|r| r.get("invalidationRequestDateTimestamp")?.as_f64())
        .map(|t| t + APPLE_EPOCH_OFFSET)
        .reduce(f64::max)
}

/// `timePeriodWeekdays` → day indices, 0 = Monday. Inferred from this Mac's
/// configurations (a Mon–Fri schedule stores 31, every day 127): bit 0 is Monday.
pub fn weekdays(bits: u64) -> Vec<u8> {
    (0..7u8).filter(|d| bits & (1 << d) != 0).collect()
}

/// `enabledSetting` 2 is on (1 and 0 are off and unset — inferred, JOURNAL 2026-11-23).
fn trigger_on(t: &Value) -> bool {
    t.get("enabledSetting").and_then(Value::as_u64) == Some(2)
}

fn class_of(t: &Value) -> &str {
    t.get("class").and_then(Value::as_str).unwrap_or("")
}

fn schedule_of(t: &Value) -> Option<FocusSchedule> {
    let n = |k: &str| t.get(k).and_then(Value::as_u64);
    let start = n("timePeriodStartTimeHour")? * 60 + n("timePeriodStartTimeMinute").unwrap_or(0);
    let end = n("timePeriodEndTimeHour")? * 60 + n("timePeriodEndTimeMinute").unwrap_or(0);
    Some(FocusSchedule {
        start: u32::try_from(start).ok()?,
        end: u32::try_from(end).ok()?,
        days: weekdays(n("timePeriodWeekdays").unwrap_or(127)),
    })
}

/// Every configured mode (id, display name, enabled schedules, smart), sorted by
/// name. Pure.
pub fn parse_modes(json: &str) -> Vec<FocusMode> {
    let Ok(v) = serde_json::from_str::<Value>(json) else {
        return Vec::new();
    };
    let mut out: Vec<FocusMode> = v
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|d| d.get("modeConfigurations")?.as_object())
        .flatten()
        .filter_map(|(id, cfg)| {
            let name = cfg.get("mode")?.get("name")?.as_str()?;
            let triggers: Vec<&Value> = cfg
                .get("triggers")
                .and_then(|t| t.get("triggers"))
                .and_then(Value::as_array)
                .map(|a| a.iter().filter(|t| trigger_on(t)).collect())
                .unwrap_or_default();
            Some(FocusMode {
                id: id.clone(),
                name: name.to_string(),
                schedules: triggers
                    .iter()
                    .filter(|t| class_of(t) == "DNDModeConfigurationScheduleTrigger")
                    .filter_map(|t| schedule_of(t))
                    .collect(),
                smart: triggers
                    .iter()
                    .any(|t| class_of(t) == "DNDModeConfigurationSmartTrigger"),
            })
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Read one database file, telling "macOS refused" apart from "not there".
fn read_db(path: &Path) -> Result<Option<String>, FocusAccess> {
    match std::fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == ErrorKind::PermissionDenied => Err(FocusAccess::Denied),
        Err(_) => Ok(None),
    }
}

/// The Focus half of the inputs, from a database directory. Testable on a temp dir.
pub fn focus_inputs(dir: &Path) -> (FocusAccess, Option<String>, Option<f64>, Vec<FocusMode>) {
    let configs = match read_db(&dir.join("ModeConfigurations.json")) {
        Ok(text) => text,
        Err(access) => return (access, None, None, Vec::new()),
    };
    let assertions = read_db(&dir.join("Assertions.json")).ok().flatten();
    (
        FocusAccess::Granted,
        assertions.as_deref().and_then(parse_active_focus),
        assertions.as_deref().and_then(parse_cleared_at),
        configs.as_deref().map(parse_modes).unwrap_or_default(),
    )
}

/// `defaults read -g AppleInterfaceStyle` → "Dark" when dark; the key is absent in light.
pub fn system_dark() -> bool {
    std::process::Command::new("defaults")
        .args(["read", "-g", "AppleInterfaceStyle"])
        .output()
        .map(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).trim() == "Dark")
        .unwrap_or(false)
}

fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp"))
}

/// Focus mode wallpaper on: the only thing that makes scuttler read the Focus database.
static FOCUS_ON: AtomicBool = AtomicBool::new(false);

pub fn inputs() -> AppearanceInputs {
    let (focus_access, asserted_focus, focus_cleared_at, modes) =
        if FOCUS_ON.load(Ordering::Relaxed) {
            focus_inputs(&dnd_dir(&home()))
        } else {
            (FocusAccess::Off, None, None, Vec::new())
        };
    AppearanceInputs {
        system_dark: system_dark(),
        focus_access,
        asserted_focus,
        focus_cleared_at,
        modes,
    }
}

enum Msg {
    /// A watched file changed.
    Changed,
    /// Focus mode wallpaper turned on or off.
    Focus(bool),
}

static WATCHER: OnceLock<Mutex<Sender<Msg>>> = OnceLock::new();

/// Turn Focus reading on or off (boot, and every config change). On watches the
/// database directory and reports at once; off drops the watch.
pub fn configure(focus_wallpaper: bool) {
    let was = FOCUS_ON.swap(focus_wallpaper, Ordering::Relaxed);
    if was == focus_wallpaper {
        return;
    }
    if let Some(tx) = WATCHER.get() {
        // A poisoned lock only means a sender panicked; the channel is fine.
        let tx = tx.lock().unwrap_or_else(|e| e.into_inner());
        let _ = tx.send(Msg::Focus(focus_wallpaper));
    }
}

/// Watch Preferences always (light/dark drives the theme) and the Focus database
/// while Focus mode wallpaper is on; on any change re-read and emit if something
/// moved.
pub fn watch(app: AppHandle) {
    let (tx, rx) = std::sync::mpsc::channel::<Msg>();
    let fs_tx = tx.clone();
    let _ = WATCHER.set(Mutex::new(tx));
    std::thread::spawn(move || {
        use notify::{RecursiveMode, Watcher};
        let mut watcher = match notify::recommended_watcher(move |_res| {
            let _ = fs_tx.send(Msg::Changed);
        }) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("[scuttler appearance] watcher failed: {e}");
                return;
            }
        };
        let home = home();
        let prefs = home.join("Library/Preferences");
        if let Err(e) = watcher.watch(&prefs, RecursiveMode::NonRecursive) {
            eprintln!(
                "[scuttler appearance] watch {} failed: {e}",
                prefs.display()
            );
        }
        let dnd = dnd_dir(&home);
        let set_dnd = |w: &mut notify::RecommendedWatcher, on: bool| {
            let res = if on {
                w.watch(&dnd, RecursiveMode::NonRecursive)
            } else {
                w.unwatch(&dnd)
            };
            if let Err(e) = res {
                // Denied without Full Disk Access; the inputs say so.
                eprintln!("[scuttler appearance] focus watch ({on}): {e}");
            }
        };
        if FOCUS_ON.load(Ordering::Relaxed) {
            set_dnd(&mut watcher, true);
        }
        let mut last = inputs();
        loop {
            let Ok(msg) = rx.recv() else {
                return;
            };
            if let Msg::Focus(on) = msg {
                set_dnd(&mut watcher, on);
            }
            // Preferences/ is chatty; coalesce a burst, then look once.
            while let Ok(more) = rx.recv_timeout(std::time::Duration::from_millis(250)) {
                if let Msg::Focus(on) = more {
                    set_dnd(&mut watcher, on);
                }
            }
            let now = inputs();
            if now != last {
                eprintln!(
                    "[scuttler appearance] dark={} focus={:?} access={:?}",
                    now.system_dark, now.asserted_focus, now.focus_access
                );
                let _ = app.emit("appearance-input", &now);
            }
            last = now;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_focus_from_assertions() {
        let json = r#"{"data":[{"storeAssertionRecords":[{"assertionDetails":{"assertionDetailsModeIdentifier":"com.apple.focus.work"}}]}]}"#;
        assert_eq!(
            parse_active_focus(json).as_deref(),
            Some("com.apple.focus.work")
        );
        assert_eq!(
            parse_active_focus(r#"{"data":[{"storeAssertionRecords":[]}]}"#),
            None
        );
        assert_eq!(parse_active_focus("not json"), None);
    }

    #[test]
    fn cleared_at_is_the_latest_request_in_unix_seconds() {
        let json = r#"{"data":[{"storeInvalidationRequestRecords":[
            {"invalidationRequestDateTimestamp":817079950.0},
            {"invalidationRequestDateTimestamp":817000000.0}
        ]}]}"#;
        assert_eq!(
            parse_cleared_at(json),
            Some(817079950.0 + APPLE_EPOCH_OFFSET)
        );
        assert_eq!(parse_cleared_at(r#"{"data":[{}]}"#), None);
    }

    #[test]
    fn weekday_bits_start_on_monday() {
        assert_eq!(weekdays(31), vec![0, 1, 2, 3, 4]);
        assert_eq!(weekdays(127), vec![0, 1, 2, 3, 4, 5, 6]);
        assert_eq!(weekdays(0b110_0000), vec![5, 6]);
    }

    #[test]
    fn modes_carry_enabled_schedules_and_smart_activation() {
        // Shaped like this Mac's file (2026-11-23): Work on a Mon–Fri schedule with
        // Smart Activation; Do Not Disturb with a schedule that is switched off.
        let json = r#"{"data":[{"modeConfigurations":{
            "com.apple.focus.work":{"mode":{"name":"Work"},"triggers":{"triggers":[
                {"class":"DNDModeConfigurationSmartTrigger","enabledSetting":2},
                {"class":"DNDModeConfigurationScheduleTrigger","enabledSetting":2,
                 "timePeriodStartTimeHour":9,"timePeriodStartTimeMinute":0,
                 "timePeriodEndTimeHour":17,"timePeriodEndTimeMinute":30,
                 "timePeriodWeekdays":31}]}},
            "com.apple.donotdisturb.mode.default":{"mode":{"name":"Do Not Disturb"},"triggers":{"triggers":[
                {"class":"DNDModeConfigurationScheduleTrigger","enabledSetting":1,
                 "timePeriodStartTimeHour":9,"timePeriodEndTimeHour":17,"timePeriodWeekdays":127}]}},
            "junk":{"mode":{}}
        }}]}"#;
        let modes = parse_modes(json);
        assert_eq!(modes.len(), 2);
        assert_eq!(modes[0].name, "Do Not Disturb");
        assert!(modes[0].schedules.is_empty());
        assert!(!modes[0].smart);
        assert_eq!(modes[1].id, "com.apple.focus.work");
        assert_eq!(
            modes[1].schedules,
            vec![FocusSchedule {
                start: 9 * 60,
                end: 17 * 60 + 30,
                days: vec![0, 1, 2, 3, 4]
            }]
        );
        assert!(modes[1].smart);
        assert!(parse_modes("{}").is_empty());
    }

    #[test]
    fn a_missing_database_is_granted_and_empty() {
        let dir = std::env::temp_dir().join(format!("scuttler-dnd-none-{}", std::process::id()));
        let (access, asserted, cleared, modes) = focus_inputs(&dir);
        assert_eq!(access, FocusAccess::Granted);
        assert!(asserted.is_none() && cleared.is_none() && modes.is_empty());
    }

    #[test]
    fn an_unreadable_database_is_denied() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("scuttler-dnd-deny-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("ModeConfigurations.json");
        std::fs::write(&file, "{}").unwrap();
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o000)).unwrap();
        let (access, _, _, _) = focus_inputs(&dir);
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600)).unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
        assert_eq!(access, FocusAccess::Denied);
    }
}
