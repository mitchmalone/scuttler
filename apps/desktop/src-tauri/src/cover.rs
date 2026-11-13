//! Which displays the frontmost app covers edge to edge: a game in borderless
//! fullscreen, a video, a native-fullscreen window. The bar hides on those
//! (`bar.hideOverFullscreen`, DECISIONS 2026-11-13) instead of sitting on top
//! of the app's own top strip.
//!
//! The read is `CGWindowListCopyWindowInfo`: bounds, layer, alpha and owner
//! pid are public to every process; only window *titles* and pixels sit behind
//! Screen Recording, and neither is asked for. Nothing here needs a permission
//! (invariant 1). One call costs a few milliseconds (a window-server round
//! trip), so callers run it on events and the bar's heartbeat, never per tick.

use std::ffi::c_void;

use objc2::runtime::AnyObject;
use objc2_foundation::{NSArray, NSDictionary, NSString};

use crate::screens::Screen;

/// One on-screen window, as far as covering goes. Frame in CG global points,
/// top-left origin: the space `Screen` lives in.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Window {
    pub pid: i32,
    /// 0 is the normal window level; the bar, the Dock and menus sit above it.
    pub layer: i64,
    pub alpha: f64,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// A window a point short of an edge still covers it (fractional scaling).
const SLACK: f64 = 1.0;

impl Window {
    fn covers(&self, s: &Screen) -> bool {
        self.x <= s.x + SLACK
            && self.y <= s.y + SLACK
            && self.x + self.width >= s.x + s.width - SLACK
            && self.y + self.height >= s.y + s.height - SLACK
    }
}

/// Ids of the displays that a visible, normal-level window of `front_pid`
/// covers whole. Pure: the tiled and floating cases never reach here as
/// covering, because a tiled window stops at the bar's gap.
pub fn covered(windows: &[Window], front_pid: i32, screens: &[Screen]) -> Vec<u32> {
    screens
        .iter()
        .filter(|s| {
            windows
                .iter()
                .any(|w| w.pid == front_pid && w.layer == 0 && w.alpha > 0.0 && w.covers(s))
        })
        .map(|s| s.id)
        .collect()
}

/// The displays the frontmost app covers right now. Thread-safe reads.
pub fn covered_now(screens: &[Screen]) -> Vec<u32> {
    let Some(pid) = crate::front_app::pid() else {
        return Vec::new();
    };
    covered(&on_screen(), pid, screens)
}

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGWindowListCopyWindowInfo(option: u32, relative_to: u32) -> *mut c_void;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRelease(cf: *const c_void);
}

/// kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements.
const ON_SCREEN_NO_DESKTOP: u32 = (1 << 0) | (1 << 4);

type Dict = NSDictionary<NSString, AnyObject>;

/// Every on-screen window, front to back. Empty when the window server
/// answers nothing.
fn on_screen() -> Vec<Window> {
    let key = NSString::from_str;
    let (pid_k, layer_k, alpha_k, bounds_k) = (
        key("kCGWindowOwnerPID"),
        key("kCGWindowLayer"),
        key("kCGWindowAlpha"),
        key("kCGWindowBounds"),
    );
    let (x_k, y_k, w_k, h_k) = (key("X"), key("Y"), key("Width"), key("Height"));
    let mut out = Vec::new();
    // SAFETY: the call returns a retained CFArray of CFDictionaries (or null),
    // toll-free bridged to NSArray<NSDictionary>; it is read while retained
    // and released once. The values under the four window keys are documented
    // as CFNumber, CFNumber, CFNumber and a CGRect dictionary of CFNumbers
    // (X, Y, Width, Height), so the NSNumber getters below match their types;
    // a missing key skips the window instead of being dereferenced.
    unsafe {
        let list = CGWindowListCopyWindowInfo(ON_SCREEN_NO_DESKTOP, 0);
        if list.is_null() {
            return out;
        }
        let array: &NSArray<NSDictionary> = &*(list as *const _);
        for dict in array.iter() {
            let dict: &Dict = &*(&*dict as *const _ as *const _);
            let (Some(pid), Some(layer), Some(bounds)) = (
                dict.objectForKey(&pid_k),
                dict.objectForKey(&layer_k),
                dict.objectForKey(&bounds_k),
            ) else {
                continue;
            };
            let bounds: &Dict = &*(&*bounds as *const _ as *const _);
            let (Some(x), Some(y), Some(w), Some(h)) = (
                bounds.objectForKey(&x_k),
                bounds.objectForKey(&y_k),
                bounds.objectForKey(&w_k),
                bounds.objectForKey(&h_k),
            ) else {
                continue;
            };
            out.push(Window {
                pid: objc2::msg_send![&*pid, intValue],
                layer: objc2::msg_send![&*layer, longLongValue],
                alpha: dict
                    .objectForKey(&alpha_k)
                    .map(|a| objc2::msg_send![&*a, doubleValue])
                    .unwrap_or(1.0),
                x: objc2::msg_send![&*x, doubleValue],
                y: objc2::msg_send![&*y, doubleValue],
                width: objc2::msg_send![&*w, doubleValue],
                height: objc2::msg_send![&*h, doubleValue],
            });
        }
        CFRelease(list);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const MAIN: Screen = Screen {
        id: 1,
        x: 0.0,
        y: 0.0,
        width: 2560.0,
        height: 1440.0,
        scale: 2.0,
    };
    const SIDE: Screen = Screen {
        id: 2,
        x: 2560.0,
        y: 0.0,
        width: 1920.0,
        height: 1080.0,
        scale: 1.0,
    };

    fn win(pid: i32, x: f64, y: f64, width: f64, height: f64) -> Window {
        Window {
            pid,
            layer: 0,
            alpha: 1.0,
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn a_borderless_fullscreen_game_covers_its_display() {
        // The frame World of Warcraft reported on 2026-11-13.
        let game = win(7, 0.0, 0.0, 2560.0, 1440.0);
        assert_eq!(covered(&[game], 7, &[MAIN, SIDE]), vec![1]);
    }

    #[test]
    fn only_the_frontmost_app_counts() {
        // The game sits behind a terminal: the bar stays.
        let game = win(7, 0.0, 0.0, 2560.0, 1440.0);
        let terminal = win(9, 8.0, 38.0, 1264.0, 1394.0);
        assert!(covered(&[terminal, game], 9, &[MAIN]).is_empty());
    }

    #[test]
    fn a_tiled_window_under_the_bar_does_not_cover() {
        let tiled = win(7, 8.0, 38.0, 2544.0, 1394.0);
        assert!(covered(&[tiled], 7, &[MAIN]).is_empty());
        // Nor does a maximised one that stops at the bar's strip.
        let maximised = win(7, 0.0, 30.0, 2560.0, 1410.0);
        assert!(covered(&[maximised], 7, &[MAIN]).is_empty());
    }

    #[test]
    fn the_display_covered_is_the_one_the_window_is_on() {
        let video = win(7, 2560.0, 0.0, 1920.0, 1080.0);
        assert_eq!(covered(&[video], 7, &[MAIN, SIDE]), vec![2]);
    }

    #[test]
    fn a_window_spanning_both_displays_covers_both() {
        let wall = win(7, 0.0, 0.0, 4480.0, 1440.0);
        assert_eq!(covered(&[wall], 7, &[MAIN, SIDE]), vec![1, 2]);
    }

    #[test]
    fn overlays_and_invisible_windows_are_not_cover() {
        let overlay = Window {
            layer: 25,
            ..win(7, 0.0, 0.0, 2560.0, 1440.0)
        };
        let clear = Window {
            alpha: 0.0,
            ..win(7, 0.0, 0.0, 2560.0, 1440.0)
        };
        assert!(covered(&[overlay, clear], 7, &[MAIN]).is_empty());
    }

    #[test]
    fn a_point_of_slack_still_covers() {
        let nearly = win(7, 0.5, 0.5, 2559.0, 1439.0);
        assert_eq!(covered(&[nearly], 7, &[MAIN]), vec![1]);
    }

    /// Live: prints what the window server says. Run with a fullscreen app in
    /// front: `cargo test --lib cover -- --ignored --nocapture`.
    #[test]
    #[ignore = "reads the live window server"]
    fn live_window_list() {
        let screens = crate::screens::all();
        let windows = on_screen();
        assert!(!windows.is_empty());
        for w in &windows {
            println!("{w:?}");
        }
        for s in &screens {
            let pids: Vec<i32> = windows
                .iter()
                .filter(|w| w.layer == 0 && w.alpha > 0.0 && w.covers(s))
                .map(|w| w.pid)
                .collect();
            println!("display {} covered by pids {pids:?}", s.id);
        }
        println!(
            "front pid {:?} covers {:?}",
            crate::front_app::pid(),
            covered_now(&screens)
        );
    }
}
