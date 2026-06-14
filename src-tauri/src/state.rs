//! Shared application state for FocusGuard Desktop.
//!
//! All cross-task state lives behind `Mutex<TrackingState>` (for desktop app
//! tracking + blocking) and `Mutex<SyncState>` (for the extension sync broker).

use std::collections::HashMap;
use std::sync::Mutex;

use crate::tracking::DesktopAppUsage;

/// Internal tracking state. Mutated by the polling loop and by Tauri commands.
#[derive(Debug, Default)]
pub struct TrackingState {
    /// Whether the desktop is currently tracking foreground app usage.
    pub is_tracking: bool,
    /// App name that is currently in the foreground (accumulating time).
    pub current_app: Option<String>,
    /// When `current_app` last became active.
    pub current_app_start: Option<std::time::Instant>,
    /// Per-date usage buckets, keyed YYYY-MM-DD.
    pub usage_by_date: HashMap<String, Vec<DesktopAppUsage>>,
    /// Apps the user has marked as blocked during work sessions.
    pub blocked_apps: Vec<String>,
    /// Apps currently in an emergency-access grace window.
    pub emergency_until: HashMap<String, std::time::Instant>,
    /// Cached snapshot of the timer/session flags pushed by the frontend so
    /// the Rust side knows whether blocking should be active.
    pub session: SessionFlags,
}

/// Mirror of the frontend timer/session flags relevant to blocking decisions.
///
/// `remaining_seconds` is accepted from the frontend so future versions can
/// surface it in native notifications, but is not currently read by the Rust
/// side — hence `#[allow(dead_code)]`.
#[derive(Debug, Default, Clone, serde::Deserialize)]
pub struct SessionFlags {
    #[serde(default)]
    pub timer_running: bool,
    #[serde(default)]
    pub timer_paused: bool,
    /// "work" | "short_break" | "long_break"
    #[serde(default)]
    pub timer_mode: String,
    #[serde(default)]
    pub block_during_work: bool,
    #[serde(default)]
    pub block_during_breaks: bool,
    #[serde(default)]
    #[allow(dead_code)]
    pub remaining_seconds: u64,
}

/// Latest known full state blob received from the extension(s) via the sync
/// broker, plus a timestamp for last-write-wins merges.
#[derive(Debug, Default)]
pub struct SyncState {
    /// The most recent `focusguard_data` payload received from any extension.
    pub extension_payload: Option<serde_json::Value>,
    /// When `extension_payload` was last updated (millis since epoch).
    pub extension_updated_at: u64,
    /// Whether at least one extension responded to a health check recently.
    pub extension_connected: bool,
}

/// Top-level managed state.
pub struct AppState {
    pub tracking: Mutex<TrackingState>,
    pub sync: Mutex<SyncState>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            tracking: Mutex::new(TrackingState::default()),
            sync: Mutex::new(SyncState::default()),
        }
    }
}

/// Convenience: returns true if blocking should currently be active given the
/// session flags. Used by both the polling loop and command handlers.
pub fn blocking_active(session: &SessionFlags) -> bool {
    if !session.timer_running || session.timer_paused {
        return false;
    }
    if session.timer_mode == "work" {
        return session.block_during_work;
    }
    session.block_during_breaks
}
