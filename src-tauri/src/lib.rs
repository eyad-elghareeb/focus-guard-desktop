//! FocusGuard Desktop — Tauri backend entry point.
//!
//! Modules:
//!   - `state`        → shared `AppState` (tracking + sync broker state)
//!   - `tracking`     → foreground app polling, categorization, exclusions
//!   - `blocking`     → overlay show/hide + emergency-access windows
//!   - `sync_server`  → tiny_http broker on localhost:9472 for extensions

mod blocking;
mod state;
mod sync_server;
mod tracking;

use state::{blocking_active, AppState, SessionFlags, TrackingState};
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, Manager, State};
use tracking::{categorize_app, list_running_apps, should_exclude_app, today_key, DesktopAppUsage};

// ─── Tracking commands ──────────────────────────────────────────

#[tauri::command]
fn start_app_tracking(state: State<AppState>) -> Result<bool, String> {
    let mut t = state.tracking.lock().map_err(|e| e.to_string())?;
    t.is_tracking = true;
    t.current_app_start = Some(std::time::Instant::now());
    Ok(true)
}

#[tauri::command]
fn stop_app_tracking(state: State<AppState>) -> Result<bool, String> {
    let mut t = state.tracking.lock().map_err(|e| e.to_string())?;
    flush_current_app(&mut t);
    t.is_tracking = false;
    t.current_app = None;
    Ok(true)
}

#[tauri::command]
fn get_tracking_status(state: State<AppState>) -> Result<bool, String> {
    let t = state.tracking.lock().map_err(|e| e.to_string())?;
    Ok(t.is_tracking)
}

#[tauri::command]
fn get_desktop_app_usage(
    state: State<AppState>,
) -> Result<HashMap<String, Vec<DesktopAppUsage>>, String> {
    let t = state.tracking.lock().map_err(|e| e.to_string())?;
    Ok(t.usage_by_date.clone())
}

/// Refresh the cached session flags the Rust side uses for blocking decisions.
/// Called by the frontend whenever the timer / settings change.
#[tauri::command]
fn update_session_flags(state: State<AppState>, flags: SessionFlags) -> Result<bool, String> {
    let mut t = state.tracking.lock().map_err(|e| e.to_string())?;
    t.session = flags;
    Ok(true)
}

// ─── Running apps + blocking commands ───────────────────────────

#[tauri::command]
fn get_running_apps() -> Result<Vec<serde_json::Value>, String> {
    Ok(list_running_apps())
}

#[tauri::command]
fn set_blocked_desktop_apps(state: State<AppState>, names: Vec<String>) -> Result<bool, String> {
    let mut t = state.tracking.lock().map_err(|e| e.to_string())?;
    t.blocked_apps = names;
    Ok(true)
}

#[tauri::command]
fn get_blocked_desktop_apps(state: State<AppState>) -> Result<Vec<String>, String> {
    let t = state.tracking.lock().map_err(|e| e.to_string())?;
    Ok(t.blocked_apps.clone())
}

#[tauri::command]
fn grant_emergency_access(
    app: AppHandle,
    state: State<AppState>,
    app_name: String,
) -> Result<bool, String> {
    blocking::grant_emergency(&state, &app_name);
    blocking::hide_overlay(&app);
    // Notify the frontend so it can break the streak (matching the extension).
    let _ = app.emit(
        "emergency-access-granted",
        serde_json::json!({ "appName": app_name }),
    );
    Ok(true)
}

#[tauri::command]
fn hide_block_overlay(app: AppHandle) -> Result<bool, String> {
    blocking::hide_overlay(&app);
    Ok(true)
}

// ─── Sync broker queries ────────────────────────────────────────

#[tauri::command]
fn get_extension_state(state: State<AppState>) -> Result<serde_json::Value, String> {
    let guard = state.sync.lock().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "extension": guard.extension_payload,
        "extensionUpdatedAt": guard.extension_updated_at,
        "extensionConnected": guard.extension_connected,
    }))
}

#[tauri::command]
fn set_extension_connected(state: State<AppState>, connected: bool) -> Result<bool, String> {
    let mut guard = state.sync.lock().map_err(|e| e.to_string())?;
    guard.extension_connected = connected;
    Ok(true)
}

// ─── Helpers ────────────────────────────────────────────────────

/// Flush the accumulated time for `current_app` into the daily bucket.
fn flush_current_app(t: &mut TrackingState) {
    if let (Some(app_name), Some(start)) = (t.current_app.clone(), t.current_app_start.take()) {
        let elapsed = start.elapsed().as_secs();
        if elapsed == 0 {
            return;
        }
        let today = today_key();
        let category = categorize_app(&app_name);
        let ts = chrono::Utc::now().timestamp_millis() as u64;

        let usage = t.usage_by_date.entry(today).or_default();
        if let Some(existing) = usage.iter_mut().find(|u| u.app_name == app_name) {
            existing.total_seconds += elapsed;
            existing.last_active = ts;
        } else {
            usage.push(DesktopAppUsage {
                app_name,
                window_title: String::new(),
                total_seconds: elapsed,
                last_active: ts,
                category,
            });
        }
    }
}

/// Decide whether the polling loop needs to flip the overlay state this tick.
fn evaluate_overlay(app: &AppHandle, state: &AppState) {
    let (active_app, active_title, blocked_list_snapshot, session_snapshot) = {
        let Ok(guard) = state.tracking.lock() else {
            return;
        };
        let app_name = match &guard.current_app {
            Some(n) => n.clone(),
            None => return,
        };
        let title = match guard
            .usage_by_date
            .get(&today_key())
            .and_then(|v| v.iter().find(|u| u.app_name == app_name))
        {
            Some(u) => u.window_title.clone(),
            None => String::new(),
        };
        (
            app_name,
            title,
            guard.blocked_apps.clone(),
            guard.session.clone(),
        )
    };

    // Overlay only ever shows when a work session is active.
    if !blocking_active(&session_snapshot) {
        blocking::hide_overlay(app);
        return;
    }

    let normalized = active_app.to_lowercase();
    let is_blocked = blocked_list_snapshot
        .iter()
        .any(|b| b.to_lowercase() == normalized);

    if !is_blocked {
        blocking::hide_overlay(app);
        return;
    }

    // Check emergency window.
    let in_emergency = {
        let Ok(guard) = state.tracking.lock() else {
            return;
        };
        guard
            .emergency_until
            .get(&normalized)
            .map(|until| *until > std::time::Instant::now())
            .unwrap_or(false)
    };

    if in_emergency {
        blocking::hide_overlay(app);
    } else {
        blocking::show_overlay(app, &active_app, &active_title);
    }
}

// ─── App entry point ────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            start_app_tracking,
            stop_app_tracking,
            get_tracking_status,
            get_desktop_app_usage,
            update_session_flags,
            get_running_apps,
            set_blocked_desktop_apps,
            get_blocked_desktop_apps,
            grant_emergency_access,
            hide_block_overlay,
            get_extension_state,
            set_extension_connected,
        ])
        .setup(|app| {
            // Start the sync HTTP broker.
            sync_server::spawn(app.handle().clone());

            // Periodic foreground-app poll. Every 2 seconds:
            //   1. flush the previous app's accumulated time,
            //   2. read the new foreground app,
            //   3. decide whether to raise/lower the block overlay.
            let poll_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_secs(2));
                loop {
                    interval.tick().await;
                    let state = poll_handle.state::<AppState>();

                    let is_tracking = {
                        let Ok(guard) = state.tracking.lock() else {
                            continue;
                        };
                        guard.is_tracking
                    };
                    if !is_tracking {
                        continue;
                    }

                    // Step 1 + 2: rotate the current app.
                    {
                        let Ok(mut guard) = state.tracking.lock() else {
                            continue;
                        };
                        flush_current_app(&mut guard);

                        if let Some((app_name, window_title)) = tracking::get_active_window() {
                            if should_exclude_app(&app_name) {
                                guard.current_app = None;
                                guard.current_app_start = None;
                            } else {
                                guard.current_app = Some(app_name.clone());
                                guard.current_app_start = Some(std::time::Instant::now());

                                // Update last-seen window title.
                                let today = today_key();
                                let usage = guard.usage_by_date.entry(today).or_default();
                                if let Some(existing) =
                                    usage.iter_mut().find(|u| u.app_name == app_name)
                                {
                                    existing.window_title = window_title;
                                    existing.last_active =
                                        chrono::Utc::now().timestamp_millis() as u64;
                                } else {
                                    let category = categorize_app(&app_name);
                                    usage.push(DesktopAppUsage {
                                        app_name,
                                        window_title,
                                        total_seconds: 0,
                                        last_active: chrono::Utc::now().timestamp_millis() as u64,
                                        category,
                                    });
                                }
                            }
                        } else {
                            guard.current_app = None;
                            guard.current_app_start = None;
                        }
                    }

                    // Step 3: overlay decision.
                    evaluate_overlay(&poll_handle, state.inner());

                    // Emit a heartbeat so the frontend can refresh its UI.
                    let snapshot = {
                        let Ok(guard) = state.tracking.lock() else {
                            continue;
                        };
                        guard.usage_by_date.clone()
                    };
                    let _ = poll_handle.emit("desktop-usage-updated", snapshot);
                }
            });

            // Hourly cleanup: drop usage data older than 30 days and expired
            // emergency-access windows.
            let cleanup_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_secs(3600));
                loop {
                    interval.tick().await;
                    let app_state = cleanup_handle.state::<AppState>();
                    let app_state_ref = app_state.inner();
                    blocking::reap_emergency(app_state_ref);
                    if let Ok(mut guard) = app_state_ref.tracking.lock() {
                        let cutoff = (chrono::Local::now() - chrono::Duration::days(30))
                            .format("%Y-%m-%d")
                            .to_string();
                        guard
                            .usage_by_date
                            .retain(|date, _| date.as_str() >= cutoff.as_str());
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running FocusGuard Desktop");
}
