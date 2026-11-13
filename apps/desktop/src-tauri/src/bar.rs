//! The bar, scuttler's menubar replacement: one status-level, non-activating
//! panel per display (`screens.rs` reconciles them), pinned to the top edge,
//! visible on every space, with hover cards that grow the window downward.
//! Gated by `bar.enabled` in config (default off; off spawns and polls nothing,
//! invariant 12). The strip itself renders from `packages/tui/src/bar`.
//!
//! Data gathering stays here as plain testable functions behind `bar_snapshot`
//! (DECISIONS 2026-08-15); plugins, agents and awake ride the same snapshot.

use std::process::Command;

use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_nspanel::{tauri_panel, CollectionBehavior, PanelLevel, StyleMask, WebviewWindowExt};

use crate::error::{CmdError, CmdResult};

/// Logical bar height, matching the Sketchybar setup it replaces.
pub const BAR_HEIGHT: f64 = 30.0;

/// Extra logical height while a hover card is open — the strip can't host a
/// popover inside 30px, so the whole window grows downward briefly. The page
/// asks for the height its card needs; this is the fallback. The ceiling is
/// the display itself (`frame`) — a fixed one clipped the usage card once it
/// listed every account's windows (2026-09-30); this cap only guards against
/// a runaway measurement.
const DROPDOWN_EXTRA: f64 = 130.0;
const DROPDOWN_MAX: f64 = 4000.0;

/// Extra height the open hover card wants, 0 when closed, and which bar
/// (`bar-{i}`) is hosting it; the reframe heartbeat must agree with the hover
/// state or it snaps the window back mid-hover.
static DROPDOWN_EXTRA_PX: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
static DROPDOWN_BAR: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

/// Wanted logical height of bar `index`: the strip, plus the open card on the
/// one bar that is hosting it.
fn wanted_height(index: usize) -> f64 {
    let extra = if DROPDOWN_BAR.load(std::sync::atomic::Ordering::Relaxed) == index {
        f64::from(DROPDOWN_EXTRA_PX.load(std::sync::atomic::Ordering::Relaxed))
    } else {
        0.0
    };
    BAR_HEIGHT + extra
}

/// `bar-{i}` → `i`.
fn bar_index(label: &str) -> Option<usize> {
    label.strip_prefix("bar-")?.parse().ok()
}

/// Open/close a hover dropdown by resizing the bar window that asked (only
/// that display's bar grows). Cards declare their own height — the agent card
/// is short, the battery card isn't.
pub fn set_dropdown(app: &AppHandle, label: &str, open: bool, height: Option<f64>) {
    let extra = if open {
        height.unwrap_or(DROPDOWN_EXTRA).clamp(0.0, DROPDOWN_MAX)
    } else {
        0.0
    };
    if let Some(index) = bar_index(label) {
        DROPDOWN_BAR.store(index, std::sync::atomic::Ordering::Relaxed);
    }
    DROPDOWN_EXTRA_PX.store(extra as u32, std::sync::atomic::Ordering::Relaxed);
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || sync(&handle));
}

/// Synthetic hover: WebKit refuses to process hover for a never-active
/// accessory window even with an always-active tracking area (proven
/// 2026-08-16), so hover is driven from Rust — poll the global cursor
/// (permission-free) and feed window-local coordinates to the page, which
/// resolves the hovered element itself. `(-1, -1)` means "cursor left".
/// Each bar hears only about its own display.
fn watch_mouse(app: AppHandle) {
    std::thread::spawn(move || {
        let mut was_inside: Option<usize> = None;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(125));
            // Off means off: no cursor polling while the bar is hidden. Fall
            // through once to send the "left" event if the cursor was inside.
            let inside = if enabled() { mouse_in_bar() } else { None };
            if inside.is_none() && was_inside.is_none() {
                continue;
            }
            if let Some(prev) = was_inside {
                if inside.map(|(i, ..)| i) != Some(prev) {
                    if let Some(window) = app.get_webview_window(&format!("bar-{prev}")) {
                        let _ = window.eval("window.__barMouse && window.__barMouse(-1,-1)");
                    }
                }
            }
            if let Some((i, x, y)) = inside {
                if let Some(window) = app.get_webview_window(&format!("bar-{i}")) {
                    let _ = window.eval(format!(
                        "window.__barMouse && window.__barMouse({x:.1},{y:.1})"
                    ));
                }
            }
            was_inside = inside.map(|(i, ..)| i);
        }
    });
}

/// Which bar the cursor is inside (strip, or strip + dropdown while open) and
/// the cursor in that window's CSS coordinates. Bars hang from the top edge of
/// their screen, so screen-local is window-local.
fn mouse_in_bar() -> Option<(usize, f64, f64)> {
    let (mx, my) = crate::screens::mouse()?;
    crate::screens::all()
        .into_iter()
        .enumerate()
        .find_map(|(i, s)| {
            let (x, y) = (mx - s.x, my - s.y);
            // A bar that stepped aside for a fullscreen app hears no hover.
            let inside = !is_covered(s.id)
                && (0.0..=s.width).contains(&x)
                && (0.0..=wanted_height(i)).contains(&y);
            inside.then_some((i, x, y))
        })
}

tauri_panel! {
    panel!(BarPanel {
        config: {
            can_become_key_window: false,
            is_floating_panel: true
        }
    })
}

/// The support threads (push, reframe, triggers, mouse, wifi, widgets) spawn
/// once per process and are never torn down (hidden, not destroyed). While the
/// bar is toggled off each loop still wakes on its timer but returns before
/// doing any work: no snapshot, no `aerospace`/`ipconfig`/`networksetup`
/// spawns, no cursor reads, no widget ticks. Turning the bar back on pushes
/// immediately and the loops resume on their next wake.
static THREADS_STARTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// `bar.enabled`, mirrored so the heartbeat knows whether to show or hide.
static ENABLED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Whether `bar.enabled` is on right now; the support threads gate their work on it.
pub(crate) fn enabled() -> bool {
    ENABLED.load(std::sync::atomic::Ordering::Relaxed)
}

/// `bar.hideOverFullscreen`, mirrored for the threads that look.
static YIELDS: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);

/// Ids of the displays the frontmost app covers edge to edge, as of the last
/// look (cover.rs). `sync` hides the bar on these and shows it again when the
/// display leaves the list: a borderless-fullscreen game draws its own top
/// strip where the bar would sit (DECISIONS 2026-11-13).
static COVERED: std::sync::Mutex<Vec<u32>> = std::sync::Mutex::new(Vec::new());

/// Until when the stream thread keeps looking after an app switch, a Space
/// change or a workspace switch. One look is not enough: the event can beat
/// the window to the screen (a launch, the fullscreen animation).
static LOOK_UNTIL: std::sync::Mutex<Option<std::time::Instant>> = std::sync::Mutex::new(None);
const LOOK_FOR: std::time::Duration = std::time::Duration::from_millis(2500);

fn is_covered(display: u32) -> bool {
    COVERED.lock().is_ok_and(|c| c.contains(&display))
}

/// Something moved in front: look now and for a little while after.
fn arm_look() {
    if let Ok(mut until) = LOOK_UNTIL.lock() {
        *until = Some(std::time::Instant::now() + LOOK_FOR);
    }
    push();
}

fn look_armed() -> bool {
    let Ok(mut until) = LOOK_UNTIL.lock() else {
        return false;
    };
    match *until {
        Some(t) if t > std::time::Instant::now() => true,
        Some(_) => {
            // One last look as the window closes, then stand down.
            *until = None;
            true
        }
        None => false,
    }
}

/// Ask which displays the frontmost app covers and re-sync the bars if the
/// answer changed. Any thread; the window-server read stays off the main one.
/// Off means off: with the option off nothing is asked, and whatever was
/// hidden comes back.
fn look(app: &AppHandle) {
    let now = if YIELDS.load(std::sync::atomic::Ordering::Relaxed) {
        crate::cover::covered_now(&crate::screens::all())
    } else {
        Vec::new()
    };
    let changed = {
        let Ok(mut covered) = COVERED.lock() else {
            return;
        };
        let changed = *covered != now;
        *covered = now;
        changed
    };
    if changed {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || sync(&handle));
    }
}

/// Hot-apply `bar.hideOverFullscreen` from the config watcher, and set it at
/// startup before the bar is built.
pub fn set_hide_over_fullscreen(app: &AppHandle, on: bool) {
    YIELDS.store(on, std::sync::atomic::Ordering::Relaxed);
    if enabled() {
        let handle = app.clone();
        std::thread::spawn(move || look(&handle));
    }
}

/// Which display id each `bar-{i}` was last framed to and whether that display
/// was notched — so `sync` only re-frames and re-announces the notch on change.
static ASSIGNED: std::sync::Mutex<Vec<(u32, bool)>> = std::sync::Mutex::new(Vec::new());

/// Hot-apply `bar.enabled` from the config watcher (DECISIONS 2026-08-16):
/// on → build/show the windows; off → hide them.
/// Hide, never destroy: tearing the NSPanel subclass down mid-run-loop threw
/// an ObjC exception that crossed into tao's run-loop observer and aborted the
/// whole process (crash report + JOURNAL 2026-08-16). Hidden panels idle — the
/// support threads skip invisible windows.
pub fn set_enabled(app: &AppHandle, on: bool) {
    ENABLED.store(on, std::sync::atomic::Ordering::Relaxed);
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if on && handle.get_webview_window("bar-0").is_none() {
            if let Err(e) = init(&handle) {
                eprintln!("[scuttler bar] enable failed: {e:?}");
            }
            return;
        }
        sync(&handle);
        if on {
            // Resume promptly instead of waiting for the next tick, and find
            // out what is in front now.
            arm_look();
        }
    });
}

/// Create one bar per display and start the support threads. Called at setup
/// only when `bar.enabled`. Main thread.
pub fn init(app: &AppHandle) -> CmdResult<()> {
    ENABLED.store(true, std::sync::atomic::Ordering::Relaxed);
    sync(app);
    let up = (0..)
        .take_while(|i| app.get_webview_window(&format!("bar-{i}")).is_some())
        .count();
    if up == 0 {
        return Err(CmdError::Internal("no bar window came up".into()));
    }
    eprintln!("[scuttler bar] {up} bar(s) up");
    crate::bar_constrain::prevent_app_nap();
    if !THREADS_STARTED.swap(true, std::sync::atomic::Ordering::SeqCst) {
        crate::bar_modules::start();
        crate::widgets::start(app.clone());
        watch(app.clone());
        watch_triggers(app.clone());
        watch_mouse(app.clone());
        start_stream(app.clone());
        crate::front_app::watch(arm_look);
    }
    // Whatever is in front may already cover a display.
    arm_look();
    Ok(())
}

/// Reconcile bar windows to the displays: `bar-{i}` sits on the `i`-th screen
/// (main first — screens.rs order). Missing windows are built, every window is
/// re-framed if it drifted (display mode changes strand it off-screen, JOURNAL
/// 2026-08-16), the notch profile is re-announced when a window lands on a
/// different display, and windows beyond the screen count (a display went
/// away) are hidden — never destroyed. Main thread; a no-op when nothing moved.
fn sync(app: &AppHandle) {
    let enabled = ENABLED.load(std::sync::atomic::Ordering::Relaxed);
    let screens = crate::screens::all();
    for (i, screen) in screens.iter().enumerate() {
        let label = format!("bar-{i}");
        if app.get_webview_window(&label).is_none() {
            if !enabled {
                continue;
            }
            let notched = crate::screens::notched(screen.id);
            if let Err(e) = build(app, &label, notched) {
                eprintln!("[scuttler bar] {label} build failed: {e:?}");
                continue;
            }
            let mut assigned = ASSIGNED.lock().unwrap();
            if assigned.len() <= i {
                assigned.resize(i + 1, (0, false));
            }
            assigned[i] = (screen.id, notched);
        }
        let Some(window) = app.get_webview_window(&label) else {
            continue;
        };
        if !enabled {
            let _ = window.hide();
            continue;
        }
        if is_covered(screen.id) {
            if window.is_visible().unwrap_or(false) {
                let _ = window.hide();
            }
            continue;
        }
        frame(&window, i, screen);
        // Landed on a different display than last time → its notch profile
        // may differ; the page swaps layouts live.
        let notched = crate::screens::notched(screen.id);
        let mut assigned = ASSIGNED.lock().unwrap();
        if assigned.len() <= i {
            assigned.resize(i + 1, (0, false));
        }
        if assigned[i] != (screen.id, notched) {
            assigned[i] = (screen.id, notched);
            let _ = window.eval(format!(
                "window.__barNotched && window.__barNotched({notched})"
            ));
        }
        if !window.is_visible().unwrap_or(false) {
            let _ = window.show();
        }
    }
    // Surplus windows: their display went away.
    for i in screens.len().. {
        let Some(window) = app.get_webview_window(&format!("bar-{i}")) else {
            break;
        };
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
            eprintln!("[scuttler bar] bar-{i} hidden: display gone");
        }
    }
}

/// Assert bar `index`'s frame on `screen` (logical points — no scale math, so
/// mixed-density displays frame correctly). Only touches the window if the
/// frame differs: the heartbeat runs this every few seconds.
fn frame(window: &tauri::WebviewWindow, index: usize, screen: &crate::screens::Screen) {
    let want_pos = tauri::LogicalPosition::new(screen.x, screen.y);
    let want_size = tauri::LogicalSize::new(screen.width, wanted_height(index).min(screen.height));
    let scale = window.scale_factor().unwrap_or(screen.scale);
    let moved = window
        .outer_position()
        .map(|p| p.to_logical::<f64>(scale) != want_pos)
        .unwrap_or(true);
    let resized = window
        .outer_size()
        .map(|s| s.to_logical::<f64>(scale) != want_size)
        .unwrap_or(true);
    if moved || resized {
        let _ = window.set_size(want_size);
        let _ = window.set_position(want_pos);
    }
}

/// Build one bar window as a floating, non-activating NSPanel. The frame is
/// set afterwards by `frame` (from `sync`) — it must come after the panel
/// conversion anyway (JOURNAL 2026-08-15).
fn build(app: &AppHandle, label: &str, notched: bool) -> CmdResult<()> {
    // Which layout profile this display uses (bar.notchedModules). Injected
    // before page scripts run so the very first render picks correctly;
    // `__barNotched` updates it if the window later moves display.
    let window = WebviewWindowBuilder::new(app, label, WebviewUrl::App("bar.html".into()))
        .initialization_script(format!("window.__notched = {notched};"))
        .decorations(false)
        .transparent(true)
        .resizable(false)
        .shadow(false)
        .skip_taskbar(true)
        .accept_first_mouse(true)
        .visible(false)
        // Never-focused webview in a background accessory app: WebKit
        // throttles its JS timers to a crawl (bar went stale/blank,
        // 2026-08-16). Updates are Rust-pushed below, but keep WebKit
        // honest for anything timer-driven that remains.
        .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
        .build()
        .map_err(|e| CmdError::Internal(format!("bar window: {e}")))?;

    let panel = window
        .to_panel::<BarPanel>()
        .map_err(|e| CmdError::Internal(format!("bar to_panel: {e}")))?;
    // Floating (4): above tiled windows, below MainMenu (24) so the native
    // auto-hidden menu bar slides OVER the bar, Sketchybar-style. At this
    // level AppKit constrains frames out of the menu-bar reserve — the
    // bar_constrain override (installed below, once the class exists)
    // makes y=0 legal again.
    panel.set_level(PanelLevel::Floating.value());
    if !crate::bar_constrain::install(c"BarPanel") {
        eprintln!("[scuttler bar] constrain override failed; bar may sit low");
    }
    panel.set_style_mask(StyleMask::empty().nonactivating_panel().into());
    panel.set_collection_behavior(
        CollectionBehavior::new()
            .can_join_all_spaces()
            .full_screen_auxiliary()
            .stationary()
            .into(),
    );
    panel.set_hides_on_deactivate(false);
    panel.order_front_regardless();

    // Fresh handle: the pre-conversion one can point at the old NSWindow.
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| CmdError::Internal(format!("{label} missing post-conversion")))?;
    let _ = window.with_webview(|platform| {
        if !crate::bar_constrain::disable_occlusion_detection(platform.inner().cast()) {
            eprintln!("[scuttler bar] occlusion-detection override unavailable");
        }
        if !crate::bar_constrain::enable_hover_events(platform.inner().cast()) {
            eprintln!("[scuttler bar] hover tracking unavailable");
        }
    });
    Ok(())
}

/// What a poke asks for. `Workspace` means AeroSpace may have changed the
/// list or the focus, so the next snapshot asks it; `State` is everything
/// else (agents, plugins, widgets, the front app) and can serve the cached
/// workspace list.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Poke {
    State,
    Workspace,
}

/// The one way into the push thread. Set once by `start_stream`; before the
/// bar has ever been enabled there is nothing to push to and pokes are dropped.
static POKES: std::sync::OnceLock<std::sync::mpsc::Sender<Poke>> = std::sync::OnceLock::new();

/// The clock the bar lives by when nothing pokes it: one tick a second.
const TICK: std::time::Duration = std::time::Duration::from_secs(1);
/// A burst of pokes (a plugin, three agents and a trigger inside one frame)
/// becomes one snapshot.
const COALESCE: std::time::Duration = std::time::Duration::from_millis(30);

/// Ask the bar to re-snapshot. Non-blocking: agents, plugins, widgets, the
/// trigger watcher and the enable toggle all drop a poke on one channel and
/// one thread does the work in order, so two snapshots can never land swapped
/// (they did, from ten call sites on ten threads, until v0.8.5).
pub(crate) fn push() {
    poke(Poke::State);
}

pub(crate) fn poke(what: Poke) {
    // Off means off: nothing is snapshotted for a hidden bar.
    if !enabled() {
        return;
    }
    if let Some(tx) = POKES.get() {
        let _ = tx.send(what);
    }
}

/// The bar's heartbeat lives in Rust, not the webview: WKWebView throttles JS
/// timers in never-focused windows, so the webview only *listens*. Push via
/// direct eval — the lowest-level path into the page, with no event-system or
/// capability plumbing that can fail silently (which it did, 2026-08-16).
/// One thread: waits for a poke (or the tick), coalesces the burst behind it,
/// snapshots, evals. A snapshot identical to the last one is not re-sent; the
/// page gets a bare tick so its clock still moves.
fn start_stream(app: AppHandle) {
    let (tx, rx) = std::sync::mpsc::channel();
    if POKES.set(tx).is_err() {
        return;
    }
    std::thread::spawn(move || loop {
        let what = match rx.recv_timeout(TICK) {
            Ok(first) => drain(&rx, first, COALESCE),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => Poke::State,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return,
        };
        if !enabled() {
            continue;
        }
        if look_armed() {
            look(&app);
        }
        run_push(&app, what == Poke::Workspace);
    });
}

/// Swallow every poke that lands within `window` of the first and answer with
/// the strongest ask among them. The window is a deadline, not a quiet period:
/// a steady stream of pokes cannot starve the push.
fn drain(rx: &std::sync::mpsc::Receiver<Poke>, first: Poke, window: std::time::Duration) -> Poke {
    let deadline = std::time::Instant::now() + window;
    let mut what = first;
    while let Some(left) = deadline.checked_duration_since(std::time::Instant::now()) {
        match rx.recv_timeout(left) {
            Ok(Poke::Workspace) => what = Poke::Workspace,
            Ok(Poke::State) => {}
            Err(_) => break,
        }
    }
    what
}

/// The last snapshot pushed, so a workspace trigger can be answered from memory
/// (`push_focus`) before the next full snapshot spawns anything, and so an
/// unchanged snapshot is recognised and not re-sent.
static LAST: std::sync::Mutex<Option<(BarSnapshot, String)>> = std::sync::Mutex::new(None);

/// The focus the hook reported most recently and how many times it has: a
/// snapshot that started before a switch and finished after it would otherwise
/// put the old workspace back for a tick.
static FOCUS_GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static PENDING_FOCUS: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

fn run_push(app: &AppHandle, ask_aerospace: bool) {
    let gen = FOCUS_GEN.load(std::sync::atomic::Ordering::SeqCst);
    let mut snap = snapshot_with(ask_aerospace);
    if FOCUS_GEN.load(std::sync::atomic::Ordering::SeqCst) != gen {
        let pending = PENDING_FOCUS.lock().ok().and_then(|p| p.clone());
        settle_focus(&mut snap, pending.as_deref());
    }
    if snap.focused.is_none() && !snap.workspaces.is_empty() {
        eprintln!("[scuttler bar] push without focus: {snap:?}");
    }
    let Ok(json) = serde_json::to_string(&snap) else {
        return;
    };
    let changed = {
        let Ok(mut last) = LAST.lock() else {
            return;
        };
        let changed = last.as_ref().is_none_or(|(_, prev)| *prev != json);
        *last = Some((snap, json.clone()));
        changed
    };
    if changed {
        eval_all(app, &push_script(&json));
    } else {
        eval_all(app, "window.__barTick && window.__barTick()");
    }
}

/// A focus the hook reported while a snapshot was in flight wins over what the
/// snapshot saw: the hook fires after the switch, the snapshot may predate it.
fn settle_focus(snap: &mut BarSnapshot, pending: Option<&str>) {
    let Some(name) = pending else {
        return;
    };
    snap.focused = Some(name.to_owned());
    if !snap.workspaces.iter().any(|w| w == name) {
        snap.workspaces.push(name.to_owned());
    }
}

/// The instant path for a workspace switch: AeroSpace's hook writes the new
/// name into `triggers/workspace`, and the bar shows it from the last snapshot
/// in memory — no process spawned, nothing asked. The full snapshot that
/// follows corrects anything else (front app, a workspace that appeared).
/// An unknown name (a workspace the list has not seen) still shows: the cells
/// catch up on the full push. Runs on the watcher's thread, ahead of the
/// stream on purpose — it is the one event a human is watching for.
pub(crate) fn push_focus(app: &AppHandle, name: &str) {
    if !enabled() || name.is_empty() {
        return;
    }
    if let Ok(mut pending) = PENDING_FOCUS.lock() {
        *pending = Some(name.to_owned());
    }
    FOCUS_GEN.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let json = {
        let Ok(mut last) = LAST.lock() else {
            return;
        };
        let Some((snap, json)) = last.as_mut() else {
            return;
        };
        settle_focus(snap, Some(name));
        let Ok(fresh) = serde_json::to_string(snap) else {
            return;
        };
        *json = fresh.clone();
        fresh
    };
    eval_all(app, &push_script(&json));
}

/// The snapshot goes over as a JSON *string* for `JSON.parse`, not as an
/// object literal: JavaScriptCore's parser is several times slower than its
/// JSON reader on a 40 KB literal, and this runs on every change.
fn push_script(json: &str) -> String {
    // infallible: a &str always serialises as one JSON string.
    let quoted = serde_json::to_string(json).unwrap_or_default();
    format!("window.__barPush && window.__barPush(JSON.parse({quoted}))")
}

/// Run one script in every visible bar window.
fn eval_all(app: &AppHandle, script: &str) {
    for i in 0.. {
        let Some(window) = app.get_webview_window(&format!("bar-{i}")) else {
            break;
        };
        // Toggled-off or display-less bars are hidden, not destroyed — skip them.
        if !window.is_visible().unwrap_or(false) {
            continue;
        }
        if let Err(e) = window.eval(script) {
            eprintln!("[scuttler bar] eval failed on bar-{i}: {e}");
        }
    }
}

/// Event-driven refresh: anything touching a file in
/// `~/.config/scuttler/triggers/` makes the bar re-snapshot immediately.
/// Aerospace's `exec-on-workspace-change` points here — polling is only the
/// fallback. The generated hook writes the focused workspace's name into
/// `triggers/workspace`, and that name goes to the bar before anything else
/// happens (`push_focus`); a bare `touch` (an older hook, a user's own) still
/// works, it just waits for the snapshot. It's also a hackable surface: any
/// script can poke the bar.
fn watch_triggers(app: AppHandle) {
    let dir = crate::config::config_dir().join("triggers");
    if let Err(e) = std::fs::create_dir_all(&dir) {
        eprintln!("[scuttler bar] triggers dir failed: {e}");
        return;
    }
    std::thread::spawn(move || {
        use notify::{RecursiveMode, Watcher};
        let (tx, rx) = std::sync::mpsc::channel();
        let mut watcher = match notify::recommended_watcher(tx) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("[scuttler bar] trigger watcher failed: {e}");
                return;
            }
        };
        if let Err(e) = watcher.watch(&dir, RecursiveMode::NonRecursive) {
            eprintln!("[scuttler bar] trigger watch failed: {e}");
            return;
        }
        let workspace_file = dir.join("workspace");
        while let Ok(first) = rx.recv() {
            // The workspace name first, before any coalescing or spawning: this
            // is the one event a human is watching for.
            let mut what = Poke::State;
            if event_names(&first).any(|n| n == "workspace") {
                what = Poke::Workspace;
                HOOK_SEEN.store(true, std::sync::atomic::Ordering::Relaxed);
                if let Some(name) = read_trigger_name(&workspace_file) {
                    push_focus(&app, &name);
                }
                // A switch can bring a fullscreen window in or take it away
                // without changing the front app.
                arm_look();
            }
            let mut events = vec![first];
            // Coalesce bursts, then push a fresh snapshot immediately.
            while let Ok(ev) = rx.recv_timeout(std::time::Duration::from_millis(30)) {
                events.push(ev);
            }
            // `widget.<id>` / `plugin.<id>` files ask that widget or plugin to
            // refresh now (docs/WIDGETS.md, docs/PLUGINS.md).
            for name in events
                .iter()
                .filter_map(|ev| ev.as_ref().ok())
                .flat_map(|ev| ev.paths.iter())
                .filter_map(|p| p.file_name().and_then(|n| n.to_str()))
            {
                if let Some(id) = widget_trigger_id(name) {
                    crate::widgets::poke(id);
                    crate::plugins::poke(id);
                } else if let Some(id) = name.strip_prefix("plugin.").filter(|id| !id.is_empty()) {
                    crate::plugins::poke(id);
                }
            }
            poke(what);
        }
    });
}

/// File names an event touched.
fn event_names(ev: &Result<notify::Event, notify::Error>) -> impl Iterator<Item = &str> {
    ev.as_ref()
        .ok()
        .into_iter()
        .flat_map(|ev| ev.paths.iter())
        .filter_map(|p| p.file_name().and_then(|n| n.to_str()))
}

/// The workspace name the hook wrote, `None` for a bare touch or junk. A name
/// is one short line of what AeroSpace accepts in `aerospace workspace`.
fn read_trigger_name(path: &std::path::Path) -> Option<String> {
    let raw = std::fs::read_to_string(path).ok()?;
    let name = raw.trim();
    (!name.is_empty() && name.len() <= 64 && name.chars().all(valid_workspace_char))
        .then(|| name.to_owned())
}

/// What a workspace name may contain before it goes near a command line.
fn valid_workspace_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')
}

/// `widget.<id>` → `<id>`; anything else is a plain bar poke.
fn widget_trigger_id(name: &str) -> Option<&str> {
    name.strip_prefix("widget.").filter(|id| !id.is_empty())
}

/// Displays come and go (dock/undock) and mode changes strand the bar at stale
/// coordinates — observed 2026-08-16 at y=-111, invisibly off-screen. There is
/// no clean cross-platform "screens changed" event in Tauri, so reconcile
/// windows to screens on a heartbeat; `sync` is a no-op when nothing moved.
fn watch(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(5));
        // Off means off: `set_enabled` already hid the windows.
        if !enabled() {
            continue;
        }
        // The backstop for what no event announces: a window going
        // borderless-fullscreen while its app is already in front.
        look(&app);
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || sync(&handle));
    });
}

/// Everything the bar renders in one poll. All sources are optional-by-design:
/// no aerospace → no workspaces, no battery (desktop Mac) → no battery cell.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BarSnapshot {
    pub workspaces: Vec<String>,
    pub focused: Option<String>,
    pub front_app: Option<String>,
    pub battery_pct: Option<u8>,
    pub on_ac: bool,
    pub charging: bool,
    /// The user's charge limit, when set (battery.rs) — the strip's "adjusted charge".
    pub charge_limit: Option<u8>,
    pub wifi: crate::bar_modules::WifiState,
    pub agents: Vec<crate::agents::AgentSession>,
    /// Keep-awake session state (power.rs) — cheap in-memory read.
    pub awake: crate::power::AwakeState,
    /// User widgets (widgets.rs) — last view per widget, in-memory read.
    pub widgets: Vec<crate::widgets::WidgetState>,
    /// Plugins (plugins.rs, docs/PLUGINS.md) — last state per plugin; the
    /// first-party usage plugin rides here too.
    pub plugins: Vec<crate::plugins::PluginState>,
}

/// A fresh read of everything (the `bar_snapshot` command's first paint).
pub fn snapshot() -> BarSnapshot {
    snapshot_with(true)
}

/// Whether AeroSpace's hook has written `triggers/workspace` in this process.
/// Once it has, a switch always announces itself and the tick can serve the
/// cached workspace list; until then every tick asks, as it always did, so a
/// config without the hook still sees its switches within a second.
static HOOK_SEEN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// How long the workspace list is served from memory once the hook is known
/// to be alive. Workspaces that appear or vanish without a focus change (a
/// window moved to a new one) show within this.
const WORKSPACES_TTL: std::time::Duration = std::time::Duration::from_secs(5);

/// The cached answer: when it was read, the names, the focused one.
struct WorkspaceCache {
    at: std::time::Instant,
    names: Vec<String>,
    focused: Option<String>,
}

static WORKSPACES: std::sync::Mutex<Option<WorkspaceCache>> = std::sync::Mutex::new(None);

/// Names and focus from AeroSpace, one spawn — or the cached pair while the
/// hook is alive and the cache is young.
fn workspaces(fresh: bool) -> (Vec<String>, Option<String>) {
    if !fresh && HOOK_SEEN.load(std::sync::atomic::Ordering::Relaxed) {
        if let Ok(cache) = WORKSPACES.lock() {
            if let Some(c) = cache.as_ref() {
                if c.at.elapsed() < WORKSPACES_TTL {
                    return (c.names.clone(), c.focused.clone());
                }
            }
        }
    }
    let raw = aerospace(&[
        "list-workspaces",
        "--all",
        "--format",
        "%{workspace}%{tab}%{workspace-is-focused}",
    ]);
    let (names, mut focused) = raw
        .as_deref()
        .map(parse_workspace_table)
        .unwrap_or_default();
    if focused.is_none() && !names.is_empty() {
        // Belt and braces: the table said nothing is focused (mid-switch race,
        // or a version without %{workspace-is-focused}) — ask directly.
        focused = aerospace(&["list-workspaces", "--focused"])
            .map(|out| parse_lines(&out).into_iter().next())
            .unwrap_or_default();
        eprintln!("[scuttler bar] focus fallback used; table={raw:?} → focused={focused:?}");
    }
    if let Ok(mut cache) = WORKSPACES.lock() {
        *cache = Some(WorkspaceCache {
            at: std::time::Instant::now(),
            names: names.clone(),
            focused: focused.clone(),
        });
    }
    (names, focused)
}

/// Everything the bar renders. `fresh` asks AeroSpace even when the cache is
/// young — a trigger said something changed.
fn snapshot_with(fresh: bool) -> BarSnapshot {
    let (workspaces, focused) = workspaces(fresh);
    let (battery_pct, on_ac, charging) = crate::battery::cached();
    BarSnapshot {
        workspaces,
        focused,
        front_app: crate::front_app::name(),
        battery_pct,
        on_ac,
        charging,
        charge_limit: crate::battery::charge_limit(),
        wifi: crate::bar_modules::wifi(),
        agents: crate::agents::list(),
        awake: crate::power::state(),
        widgets: crate::widgets::snapshot(),
        plugins: crate::plugins::snapshot(),
    }
}

/// One aerospace round-trip for names + focus: lines of `name\ttrue|false`.
fn parse_workspace_table(out: &str) -> (Vec<String>, Option<String>) {
    let mut names = Vec::new();
    let mut focused = None;
    for line in parse_lines(out) {
        let (name, is_focused) = match line.split_once('\t') {
            Some((n, f)) => (n.trim().to_owned(), f.trim() == "true"),
            None => (line, false),
        };
        if is_focused {
            focused = Some(name.clone());
        }
        names.push(name);
    }
    (names, focused)
}

/// Focus a workspace (bar click). The name comes from our own snapshot, but
/// validate anyway — it ends up as a process argument.
pub fn switch_workspace(ws: &str) -> CmdResult<()> {
    if ws.is_empty() || !ws.chars().all(valid_workspace_char) {
        return Err(CmdError::Internal(format!("bad workspace name: {ws:?}")));
    }
    aerospace(&["workspace", ws])
        .map(|_| ())
        .ok_or_else(|| CmdError::Internal("aerospace workspace switch failed".into()))
}

/// The aerospace CLI, wherever Homebrew put it (one locator for the bar and the
/// desktop layer: deps.rs).
pub(crate) fn aerospace(args: &[&str]) -> Option<String> {
    let bin = crate::deps::locate(crate::deps::Dep::Aerospace.binary())?;
    let out = Command::new(bin).args(args).output().ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

fn parse_lines(out: &str) -> Vec<String> {
    out.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(str::to_owned)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_workspace_table() {
        let out = "1\tfalse\n2\ttrue\n3\tfalse\n";
        assert_eq!(
            parse_workspace_table(out),
            (
                vec!["1".into(), "2".into(), "3".into()],
                Some("2".to_owned())
            )
        );
        // Old aerospace without --format support still yields plain names.
        assert_eq!(
            parse_workspace_table("1\n2\n"),
            (vec!["1".into(), "2".into()], None)
        );
        assert_eq!(parse_workspace_table(""), (vec![], None));
    }

    #[test]
    fn a_burst_of_pokes_is_one_push_and_a_workspace_ask_wins() {
        use std::sync::mpsc::channel;
        let (tx, rx) = channel();
        tx.send(Poke::State).unwrap();
        tx.send(Poke::Workspace).unwrap();
        tx.send(Poke::State).unwrap();
        let first = rx.recv().unwrap();
        let what = drain(&rx, first, std::time::Duration::from_millis(20));
        assert_eq!(what, Poke::Workspace);
        assert!(rx.try_recv().is_err(), "the burst was swallowed whole");
        // Nothing behind the first poke: the ask stands as it was.
        tx.send(Poke::State).unwrap();
        let first = rx.recv().unwrap();
        assert_eq!(
            drain(&rx, first, std::time::Duration::from_millis(5)),
            Poke::State
        );
    }

    #[test]
    fn a_focus_reported_mid_snapshot_wins_and_joins_the_list() {
        let mut snap = snapshot_fixture(vec!["1", "2"], Some("1"));
        settle_focus(&mut snap, None);
        assert_eq!(snap.focused.as_deref(), Some("1"));
        settle_focus(&mut snap, Some("2"));
        assert_eq!(snap.focused.as_deref(), Some("2"));
        settle_focus(&mut snap, Some("9"));
        assert_eq!(snap.focused.as_deref(), Some("9"));
        assert_eq!(snap.workspaces, vec!["1", "2", "9"]);
    }

    fn snapshot_fixture(workspaces: Vec<&str>, focused: Option<&str>) -> BarSnapshot {
        BarSnapshot {
            workspaces: workspaces.into_iter().map(str::to_owned).collect(),
            focused: focused.map(str::to_owned),
            front_app: None,
            battery_pct: None,
            on_ac: false,
            charging: false,
            charge_limit: None,
            wifi: Default::default(),
            agents: Vec::new(),
            awake: Default::default(),
            widgets: Vec::new(),
            plugins: Vec::new(),
        }
    }

    #[test]
    fn the_push_script_parses_json_rather_than_a_literal() {
        let script = push_script(r#"{"focused":"a\"b","workspaces":["1"]}"#);
        assert!(script.starts_with("window.__barPush && window.__barPush(JSON.parse(\""));
        assert!(script.contains(r#"\"focused\":\"a\\\"b\""#));
        assert!(script.ends_with("\"))"));
    }

    #[test]
    fn trigger_name_is_one_clean_line_or_nothing() {
        let dir = std::env::temp_dir().join(format!("scuttler-trigger-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("workspace");
        std::fs::write(&f, "").unwrap();
        assert_eq!(read_trigger_name(&f), None, "a bare touch");
        std::fs::write(&f, "3\n").unwrap();
        assert_eq!(read_trigger_name(&f), Some("3".into()));
        std::fs::write(&f, "dev.main").unwrap();
        assert_eq!(read_trigger_name(&f), Some("dev.main".into()));
        std::fs::write(&f, "1; rm -rf /").unwrap();
        assert_eq!(read_trigger_name(&f), None);
        assert_eq!(read_trigger_name(&dir.join("missing")), None);
    }

    #[test]
    fn rejects_bad_workspace_names() {
        assert!(switch_workspace("").is_err());
        assert!(switch_workspace("1; rm -rf /").is_err());
    }

    #[test]
    fn parses_workspace_lines() {
        assert_eq!(parse_lines("1\n2\n\n3\n"), vec!["1", "2", "3"]);
        assert!(parse_lines("").is_empty());
    }
}
