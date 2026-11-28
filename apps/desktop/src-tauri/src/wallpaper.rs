//! The desktop picture, set the way macOS offers apps: `NSWorkspace
//! setDesktopImageURL:forScreen:options:error:` on every display. No permission
//! (the System Events route this replaces cost an Automation prompt, invariant 1),
//! and like every app it reaches only the current Space on each display — Apple
//! has no API for the others (DECISIONS 2026-11-23). Which image, and when, is
//! TypeScript's (`lib/wallpaper.ts`); this module only sets one and picks one.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;
use std::time::Duration;

use tauri::AppHandle;

use crate::error::{CmdError, CmdResult};

static APP: OnceLock<AppHandle> = OnceLock::new();

/// Keep a handle for the main-thread hop (NSScreen is main-thread only).
pub fn init(app: &AppHandle) {
    let _ = APP.set(app.clone());
}

/// Extensions macOS shows as a desktop picture.
const IMAGE_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "heic", "heif", "tif", "tiff", "webp", "gif",
];

/// A path worth handing to AppKit: an existing file with an image extension.
pub fn is_image(path: &Path) -> bool {
    path.is_file()
        && path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| IMAGE_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

/// Set `path` as the desktop picture on every display (current Space). Returns
/// how many displays took it.
pub fn set(path: &str) -> Result<usize, String> {
    let file = PathBuf::from(path);
    if !is_image(&file) {
        return Err(format!("not an image file: {path}"));
    }
    let app = APP.get().ok_or("wallpaper: not initialised")?;
    let (tx, rx) = std::sync::mpsc::channel();
    let owned = path.to_owned();
    app.run_on_main_thread(move || {
        let _ = tx.send(set_on_main(&owned));
    })
    .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|_| "wallpaper: the main thread did not answer".to_string())?
}

fn set_on_main(path: &str) -> Result<usize, String> {
    use objc2_app_kit::{NSScreen, NSWorkspace};
    use objc2_foundation::{MainThreadMarker, NSDictionary, NSString, NSURL};
    // run_on_main_thread guarantees this; the marker is how objc2 proves it.
    let mtm = MainThreadMarker::new().ok_or("wallpaper: not on the main thread")?;
    let url = NSURL::fileURLWithPath(&NSString::from_str(path));
    let workspace = NSWorkspace::sharedWorkspace();
    let options = NSDictionary::new();
    let mut set = 0;
    let mut last_err = None;
    for screen in NSScreen::screens(mtm).iter() {
        // SAFETY: `options` is an empty dictionary, so its generic value type is
        // vacuously correct; `url` and `screen` are live, retained objects.
        let res = unsafe {
            workspace.setDesktopImageURL_forScreen_options_error(&url, &screen, &options)
        };
        match res {
            Ok(()) => set += 1,
            Err(e) => last_err = Some(e.localizedDescription().to_string()),
        }
    }
    match (set, last_err) {
        (0, Some(e)) => Err(e),
        (n, _) => Ok(n),
    }
}

/// The theme's current background (`theme.rs` remembers it), set again — what
/// "use the theme's" means once a Focus wallpaper ends. None when the theme
/// ships no backgrounds.
pub fn reapply_theme_background() -> Result<Option<String>, String> {
    let remembered = std::fs::read_to_string(
        crate::config::state_dir()
            .join("current")
            .join("background"),
    )
    .ok()
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty());
    match remembered {
        Some(path) if is_image(Path::new(&path)) => set(&path).map(|_| Some(path)),
        _ => Ok(None),
    }
}

/// The system file dialog, images only — the settings window is an ordinary
/// activating window, so the sheet lands where the user is looking (the same
/// `choose file` desktop.rs uses; invariant 13's file-picker exception).
pub fn pick_image() -> CmdResult<Option<String>> {
    let out = Command::new("/usr/bin/osascript")
        .args([
            "-e",
            r#"POSIX path of (choose file of type {"public.image"} with prompt "Choose a wallpaper")"#,
        ])
        .output()?;
    if !out.status.success() {
        // -128 = user cancelled; anything else is a real failure.
        let err = String::from_utf8_lossy(&out.stderr);
        return if err.contains("-128") {
            Ok(None)
        } else {
            Err(CmdError::Internal(format!("file dialog: {}", err.trim())))
        };
    }
    let path = String::from_utf8_lossy(&out.stdout).trim().to_owned();
    Ok((!path.is_empty()).then_some(path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_existing_images_qualify() {
        let dir = std::env::temp_dir().join(format!("scuttler-wp-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let img = dir.join("Dunes.HEIC");
        let txt = dir.join("notes.txt");
        std::fs::write(&img, b"x").unwrap();
        std::fs::write(&txt, b"x").unwrap();
        assert!(is_image(&img));
        assert!(!is_image(&txt));
        assert!(!is_image(&dir.join("missing.jpg")));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
