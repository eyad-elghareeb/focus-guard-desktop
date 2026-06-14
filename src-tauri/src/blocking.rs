//! Desktop app blocking overlay logic.
//!
//! Hard-killing the foreground process is OS-specific, fragile, and abusive.
//! Instead we surface a fullscreen, always-on-top overlay window that visually
//! occludes the blocked app. This is portable across Windows/macOS/Linux and
//! matches the UX of the browser extensions' site-blocking page.
//!
//! "Emergency access" lifts the overlay for 5 minutes for one app, mirroring
//! the extension's behaviour — and breaks the current pomodoro streak.

use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, LogicalSize, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::state::AppState;

/// Show the block overlay for `app_name`. The frontend renders the overlay's
/// contents (timer, quote, emergency button) using these params.
pub fn show_overlay(app: &AppHandle, app_name: &str, window_title: &str) {
    let Some(window) = app.get_webview_window("block-overlay") else {
        return;
    };

    // Size the overlay to the currently focused monitor so it fully covers it.
    if let Ok(Some(monitor)) = window.current_monitor() {
        let size = monitor.size().to_logical::<f64>(monitor.scale_factor());
        let _ = window.set_size(LogicalSize::new(size.width, size.height));
    }
    let _ = window.set_position(tauri::PhysicalPosition::new(0, 0));
    let _ = window.maximize();
    let _ = window.set_always_on_top(true);
    let _ = window.set_focus();

    // Tell the overlay page what's blocked.
    let payload = serde_json::json!({
        "appName": app_name,
        "windowTitle": window_title,
    });
    let _ = window.emit("block-overlay-show", payload);

    let _ = window.show();
    let _ = window.set_focus();

    // Best-effort desktop notification.
    let _ = app
        .notification()
        .builder()
        .title("FocusGuard — app blocked")
        .body(format!(
            "{} is blocked during your focus session.",
            app_name
        ))
        .show();
}

pub fn hide_overlay(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("block-overlay") {
        let _ = window.hide();
    }
}

/// Grant 5 minutes of emergency access to `app_name`.
pub fn grant_emergency(state: &AppState, app_name: &str) {
    if let Ok(mut guard) = state.tracking.lock() {
        let normalized = app_name.to_lowercase();
        guard
            .emergency_until
            .insert(normalized, Instant::now() + Duration::from_secs(5 * 60));
    }
}

/// Sweep expired emergency-access windows. Called by the periodic task.
pub fn reap_emergency(state: &AppState) {
    if let Ok(mut guard) = state.tracking.lock() {
        let now = Instant::now();
        guard.emergency_until.retain(|_, until| *until > now);
    }
}
