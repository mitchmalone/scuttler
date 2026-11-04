//! Arm (a) of the lighter-shell spike: the launcher's built bundle
//! (`apps/desktop/dist/index.html`) in a WKWebView inside a non-activating,
//! floating NSPanel, from Rust with objc2 and nothing else. The process runs as
//! an accessory app (no Dock icon), sizes the panel like the launcher and keeps
//! it on screen so WebKit does the same work it does for the real one. Measure
//! with `footprint <pid>` and `scripts/mem.sh --webkit`-style attribution.
//!
//! Usage: `cargo run --release -- <http://127.0.0.1:PORT/ | /path/to/dist> [hidden]`
//! The built bundle references `/assets/...` and loads ES modules, which a
//! `file:` origin refuses, so the honest run serves `apps/desktop/dist` over a
//! loopback HTTP server (`python3 -m http.server`) and passes the URL; Tauri's
//! own `tauri://localhost` scheme is the equivalent in the real app.

use objc2::rc::Retained;
use objc2::{MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSApplication, NSApplicationActivationPolicy, NSBackingStoreType, NSPanel, NSScreen,
    NSWindowCollectionBehavior, NSWindowStyleMask,
};
use objc2_foundation::{NSPoint, NSRect, NSSize, NSString, NSURL, NSURLRequest};
use objc2_web_kit::{WKWebView, WKWebViewConfiguration};

const WIDTH: f64 = 720.0;
const HEIGHT: f64 = 420.0;

fn main() {
    let target = std::env::args().nth(1).unwrap_or_else(|| "apps/desktop/dist".into());
    let hidden = std::env::args().nth(2).as_deref() == Some("hidden");
    let http = target.starts_with("http://");
    let (dist, index) = if http {
        (std::path::PathBuf::new(), std::path::PathBuf::from(&target))
    } else {
        let dist = std::fs::canonicalize(&target).expect("dist dir");
        let index = dist.join("index.html");
        assert!(index.exists(), "no index.html in {}", dist.display());
        (dist, index)
    };

    let mtm = MainThreadMarker::new().expect("main thread");
    let app = NSApplication::sharedApplication(mtm);
    app.setActivationPolicy(NSApplicationActivationPolicy::Accessory);

    let screen = NSScreen::mainScreen(mtm).expect("a screen");
    let sf = screen.frame();
    let origin = NSPoint::new(
        sf.origin.x + (sf.size.width - WIDTH) / 2.0,
        sf.origin.y + sf.size.height * 0.6 - HEIGHT / 2.0,
    );
    let frame = NSRect::new(origin, NSSize::new(WIDTH, HEIGHT));

    // SAFETY: plain AppKit construction on the main thread; every object is
    // retained by the panel for the life of the process.
    let (panel, webview): (Retained<NSPanel>, Retained<WKWebView>) = unsafe {
        let panel = NSPanel::initWithContentRect_styleMask_backing_defer(
            NSPanel::alloc(mtm),
            frame,
            NSWindowStyleMask::Borderless | NSWindowStyleMask::NonactivatingPanel,
            NSBackingStoreType::Buffered,
            false,
        );
        panel.setFloatingPanel(true);
        panel.setBecomesKeyOnlyIfNeeded(true);
        panel.setHasShadow(true);
        panel.setOpaque(false);
        panel.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary,
        );
        let config = WKWebViewConfiguration::new(mtm);
        let bounds = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(WIDTH, HEIGHT));
        let webview = WKWebView::initWithFrame_configuration(WKWebView::alloc(mtm), bounds, &config);
        panel.setContentView(Some(&webview));
        if http {
            let url = NSURL::URLWithString(&NSString::from_str(&target)).expect("url");
            webview.loadRequest(&NSURLRequest::requestWithURL(&url));
        } else {
            let url = NSURL::fileURLWithPath(&NSString::from_str(&index.to_string_lossy()));
            let root = NSURL::fileURLWithPath(&NSString::from_str(&dist.to_string_lossy()));
            webview.loadFileURL_allowingReadAccessToURL(&url, &root);
        }
        if !hidden {
            panel.orderFrontRegardless();
        }
        (panel, webview)
    };
    eprintln!(
        "[shell-wkwebview] pid {} panel {} loading {}",
        std::process::id(),
        if hidden { "hidden" } else { "shown" },
        index.display()
    );
    let _keep = (panel, webview);
    app.run();
}
