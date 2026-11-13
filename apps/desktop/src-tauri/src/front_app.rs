//! The frontmost app, from NSWorkspace: an in-memory AppKit read and an
//! activation observer, no `lsappinfo` spawns (the bar paid two per tick until
//! v0.8.5). Read-only AppKit; objc2's bindings need no main-thread marker here.

use std::ptr::NonNull;

use objc2_app_kit::{
    NSWorkspace, NSWorkspaceActiveSpaceDidChangeNotification,
    NSWorkspaceDidActivateApplicationNotification,
};
use objc2_foundation::NSNotification;

/// Display name of the frontmost app, if any.
pub fn name() -> Option<String> {
    NSWorkspace::sharedWorkspace()
        .frontmostApplication()?
        .localizedName()
        .map(|n| n.to_string())
}

/// Process id of the frontmost app, if any.
pub fn pid() -> Option<i32> {
    Some(
        NSWorkspace::sharedWorkspace()
            .frontmostApplication()?
            .processIdentifier(),
    )
}

/// Call `on_change` on the main thread each time an app comes to the front or
/// the active Space changes (a native-fullscreen window is its own Space, and
/// entering one activates nothing). Registered once for the life of the
/// process; the observer tokens are leaked on purpose (there is no un-watch —
/// the bar never stops caring).
pub fn watch(on_change: impl Fn() + Send + Sync + 'static) {
    let block = block2::RcBlock::new(move |_: NonNull<NSNotification>| on_change());
    let center = NSWorkspace::sharedWorkspace().notificationCenter();
    // SAFETY: both names are valid NSNotificationName constants, no object
    // filter, no queue (the block runs on the posting thread, AppKit's main
    // thread), and the block is retained by the center for as long as each
    // observer lives.
    for name in unsafe {
        [
            NSWorkspaceDidActivateApplicationNotification,
            NSWorkspaceActiveSpaceDidChangeNotification,
        ]
    } {
        let token = unsafe {
            center.addObserverForName_object_queue_usingBlock(Some(name), None, None, &block)
        };
        std::mem::forget(token);
    }
}
