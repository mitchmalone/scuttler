//! The frontmost app, from NSWorkspace: an in-memory AppKit read and an
//! activation observer, no `lsappinfo` spawns (the bar paid two per tick until
//! v0.8.5). Read-only AppKit; objc2's bindings need no main-thread marker here.

use std::ptr::NonNull;

use objc2_app_kit::{NSWorkspace, NSWorkspaceDidActivateApplicationNotification};
use objc2_foundation::NSNotification;

/// Display name of the frontmost app, if any.
pub fn name() -> Option<String> {
    NSWorkspace::sharedWorkspace()
        .frontmostApplication()?
        .localizedName()
        .map(|n| n.to_string())
}

/// Call `on_change` on the main thread each time an app comes to the front.
/// Registered once for the life of the process; the observer token is leaked
/// on purpose (there is no un-watch — the bar never stops caring).
pub fn watch(on_change: impl Fn() + Send + Sync + 'static) {
    let block = block2::RcBlock::new(move |_: NonNull<NSNotification>| on_change());
    let center = NSWorkspace::sharedWorkspace().notificationCenter();
    // SAFETY: the name is a valid NSNotificationName constant, no object filter,
    // no queue (the block runs on the posting thread, AppKit's main thread), and
    // the block is retained by the center for as long as the observer lives.
    let token = unsafe {
        center.addObserverForName_object_queue_usingBlock(
            Some(NSWorkspaceDidActivateApplicationNotification),
            None,
            None,
            &block,
        )
    };
    std::mem::forget(token);
}
