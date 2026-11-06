//! The system approval sheet, before a root upgrade runs in the panel
//! (DECISIONS 2026-11-06): one `LAContext.evaluatePolicy` with
//! `deviceOwnerAuthentication`, the policy whose sheet offers Touch ID, Apple
//! Watch and the account password. It proves the person at the keyboard wants
//! the run; root itself comes from the sudoers rule (`scuttler sudoers on`).
//! Needs no permission grant, entitlement or usage string on macOS.
//!
//! LocalAuthentication-only module (the AGENTS rule): the `unsafe` is the two
//! message sends and the reply block, nothing else. Blocking by design: the
//! caller is already a worker thread (`updates::upgrade` spawns one), and the
//! reply arrives on a LocalAuthentication queue.

use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use objc2_foundation::{NSError, NSString};
use objc2_local_authentication::{LAContext, LAError, LAPolicy};

/// How long the sheet may wait for a finger, a watch or a password before we
/// give up: the runner must not hang on an unattended Mac, which is exactly
/// what this replaces.
const APPROVAL_WINDOW: Duration = Duration::from_secs(120);

/// Why an approval did not happen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Declined {
    /// Cancel on the sheet, or the system dismissed it.
    Cancelled,
    /// Nobody answered within `APPROVAL_WINDOW`.
    TimedOut,
    /// LocalAuthentication refused to evaluate (no password set, policy
    /// unavailable) or returned an error we do not name.
    Unavailable(String),
}

impl std::fmt::Display for Declined {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Declined::Cancelled => f.write_str("not approved"),
            Declined::TimedOut => f.write_str("no approval within 2 min"),
            Declined::Unavailable(why) => write!(f, "approval unavailable: {why}"),
        }
    }
}

/// Show the sheet with `reason` ("scuttler wants to …", Apple's phrasing) and
/// wait for the answer. Ok(()) is an approval.
pub fn approve(reason: &str) -> Result<(), Declined> {
    let (tx, rx) = mpsc::channel::<Result<(), Declined>>();
    // SAFETY: plain allocation and init of an NSObject subclass; LAContext has
    // no thread affinity.
    let context = unsafe { LAContext::new() };
    // SAFETY: a query with no side effects; the NSError, when returned, is
    // owned (Retained) by us.
    if let Err(e) = unsafe { context.canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthentication) }
    {
        return Err(Declined::Unavailable(e.localizedDescription().to_string()));
    }
    let block = RcBlock::new(move |ok: objc2::runtime::Bool, error: *mut NSError| {
        let verdict = if ok.as_bool() {
            Ok(())
        } else if error.is_null() {
            Err(Declined::Cancelled)
        } else {
            // SAFETY: LocalAuthentication hands a live NSError for the duration of
            // the callback; it is read here and never kept.
            let error = unsafe { &*error };
            match LAError(error.code()) {
                LAError::UserCancel | LAError::SystemCancel | LAError::AppCancel => {
                    Err(Declined::Cancelled)
                }
                _ => Err(Declined::Unavailable(
                    error.localizedDescription().to_string(),
                )),
            }
        };
        // The receiver may be gone after a timeout; nothing to do then.
        let _ = tx.send(verdict);
    });
    // SAFETY: the block is Fn + Send (it owns only the channel sender) as the
    // method requires; LocalAuthentication retains it until it replies, and
    // `context` lives until this function returns, which is after the reply or
    // the timeout — after a timeout `invalidate` below ends the evaluation so
    // the block is released and never fires into a dropped receiver.
    unsafe {
        context.evaluatePolicy_localizedReason_reply(
            LAPolicy::DeviceOwnerAuthentication,
            &NSString::from_str(reason),
            &block,
        );
    }
    match rx.recv_timeout(APPROVAL_WINDOW) {
        Ok(verdict) => verdict,
        Err(_) => {
            // SAFETY: invalidating a context we own; the sheet closes and the
            // pending reply fires with AppCancel into a receiver that is still
            // alive until we return.
            unsafe { context.invalidate() };
            Err(Declined::TimedOut)
        }
    }
}
