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
use tauri::{
    menu::{Menu, MenuItem},
    AppHandle, Emitter, Manager, PhysicalPosition, State,
};
use tracking::{
    categorize_app, is_app_blocked, list_known_apps, should_exclude_app, today_key, DesktopAppUsage,
};

// ─── Tracking commands ──────────────────────────────────────────

#[tauri::command]
fn start_app_tracking(state: State<AppState>) -> Result<bool, String> {
    let mut t = state.tracking.lock().map_err(|e| e.to_string())?;
    t.is_tracking = true;
    // Seed `current_app_start` only if we're genuinely mid-focus on an app.
    if t.current_app.is_some() && t.current_app_start.is_none() {
        t.current_app_start = Some(std::time::Instant::now());
    }
    Ok(true)
}

#[tauri::command]
fn stop_app_tracking(state: State<AppState>) -> Result<bool, String> {
    let mut t = state.tracking.lock().map_err(|e| e.to_string())?;
    flush_current_app(&mut t);
    t.is_tracking = false;
    t.current_app = None;
    t.current_app_start = None;
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

// ─── Known apps + blocking commands ─────────────────────────────

/// Returns the list of apps the user has actually focused today plus any they
/// have explicitly blocked. Replaces the old sysinfo-based running-apps dump.
#[tauri::command]
fn get_known_apps(state: State<AppState>) -> Result<Vec<serde_json::Value>, String> {
    let t = state.tracking.lock().map_err(|e| e.to_string())?;
    let today = today_key();
    let today_usage = t.usage_by_date.get(&today).cloned().unwrap_or_default();
    Ok(list_known_apps(&today_usage, &t.blocked_apps))
}

#[tauri::command]
fn set_blocked_desktop_apps(state: State<AppState>, names: Vec<String>) -> Result<bool, String> {
    let mut t = state.tracking.lock().map_err(|e| e.to_string())?;
    // Sanitize: drop empties and non-strings that may have slipped in from a
    // stale persisted store. Prevents the `toLowerCase` crashes seen in 1.7.2.
    t.blocked_apps = names.into_iter().filter(|n| !n.trim().is_empty()).collect();
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

// ─── Window management ──────────────────────────────────────────

/// Show the small popup window near the tray icon / cursor. Mirrors the
/// extension's toolbar popup: a compact timer + quick controls.
///
/// The popup is anchored near the cursor but **clamped inside the monitor**
/// that contains the cursor, with a small margin. This fixes the
/// truncated/off-screen positioning seen when the tray icon sits near a
/// screen edge: previously we dropped the popup's top-left exactly on the
/// cursor, so it extended down-right and ran past the right/bottom edge.
#[tauri::command]
fn show_tray_popup(app: AppHandle) -> Result<bool, String> {
    let Some(window) = app.get_webview_window("tray-popup") else {
        return Err("tray-popup window not found".into());
    };

    const POPUP_W: i32 = 320;
    const POPUP_H: i32 = 440;
    const MARGIN: i32 = 8;

    // Pick the monitor the cursor is on so multi-monitor setups work and the
    // popup never lands half-on / half-off a display.
    let (cursor_x, cursor_y) = window
        .cursor_position()
        .map(|p| (p.x as i32, p.y as i32))
        .unwrap_or((0, 0));

    let monitor = window
        .available_monitors()
        .unwrap_or_default()
        .into_iter()
        .min_by_key(|m| {
            let pos = m.position();
            let cx = pos.x + (m.size().width as i32) / 2;
            let cy = pos.y + (m.size().height as i32) / 2;
            // Manhattan distance from the cursor to the monitor center.
            (cx - cursor_x).abs() + (cy - cursor_y).abs()
        })
        .or_else(|| window.primary_monitor().ok().flatten());

    let (mon_x, mon_y, mon_w, mon_h) = match monitor {
        Some(m) => (
            m.position().x,
            m.position().y,
            m.size().width as i32,
            m.size().height as i32,
        ),
        // Final fallback: assume a 1920×1080 primary at the origin.
        None => (0, 0, 1920, 1080),
    };

    // Anchor the popup's top-left just up-left of the cursor so the body opens
    // toward the cursor, then clamp within the work area + margin.
    let mut x = cursor_x - POPUP_W + MARGIN;
    let mut y = cursor_y + MARGIN;

    let max_x = mon_x + mon_w - POPUP_W - MARGIN;
    let max_y = mon_y + mon_h - POPUP_H - MARGIN;
    let min_x = mon_x + MARGIN;
    let min_y = mon_y + MARGIN;

    if x > max_x {
        x = max_x;
    }
    if x < min_x {
        x = min_x;
    }
    if y > max_y {
        // If the popup would overflow the bottom, open it above the cursor
        // (like a tray popup anchored to the taskbar at the bottom of screen).
        y = cursor_y - POPUP_H - MARGIN;
    }
    if y < min_y {
        y = min_y;
    }
    if y > max_y {
        y = max_y;
    }

    let _ = window.set_position(PhysicalPosition::new(x, y));
    let _ = window.show();
    let _ = window.set_focus();
    let _ = app.emit("tray-popup-shown", ());
    Ok(true)
}

#[tauri::command]
fn hide_tray_popup(app: AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window("tray-popup") {
        let _ = window.hide();
    }
    Ok(true)
}

/// Show or focus the main window (used from the tray menu).
#[tauri::command]
fn show_main_window(app: AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    Ok(true)
}

/// Quit the app entirely (used from the tray menu).
#[tauri::command]
fn quit_app(app: AppHandle) -> Result<bool, String> {
    app.exit(0);
    Ok(true)
}

// ─── Sync broker queries ────────────────────────────────────────

#[tauri::command]
fn get_extension_state(state: State<AppState>) -> Result<serde_json::Value, String> {
    // Hand back the full merged view (extension + desktop) so the frontend's
    // sync bridge can stay consistent with what the browser sees.
    let guard = state.sync.lock().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "extension": guard.extension_payload,
        "extensionUpdatedAt": guard.extension_updated_at,
        "extensionConnected": guard.extension_connected,
        "desktop": guard.desktop_payload,
        "desktopUpdatedAt": guard.desktop_updated_at,
    }))
}

#[tauri::command]
fn set_extension_connected(state: State<AppState>, connected: bool) -> Result<bool, String> {
    let mut guard = state.sync.lock().map_err(|e| e.to_string())?;
    guard.extension_connected = connected;
    Ok(true)
}

/// The desktop frontend pushes its full `focusguard_data` blob here so the
/// sync broker can serve it back to browser extensions in realtime (via
/// `GET /state`'s `desktop` field). This closes the loop: starting a session
/// in the desktop app is now visible in the browser within one poll.
#[tauri::command]
fn set_desktop_state(state: State<AppState>, payload: serde_json::Value) -> Result<bool, String> {
    let mut guard = state.sync.lock().map_err(|e| e.to_string())?;
    guard.desktop_payload = Some(payload);
    guard.desktop_updated_at = chrono::Utc::now().timestamp_millis() as u64;
    Ok(true)
}

// ─── Helpers ────────────────────────────────────────────────────

/// Flush the accumulated time for `current_app` into the daily bucket.
///
/// This is called on every poll tick. Because we only reset
/// `current_app_start` when the foreground app *changes*, consecutive ticks
/// for the same app correctly add up its continuous focus time.
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
                process_path: String::new(),
                process_id: 0,
            });
        }
    }
}

/// Snapshot of everything the overlay decision needs, taken under a single
/// lock acquisition by the poll loop and then handed to `evaluate_overlay`
/// lock-free. Avoids the old code's two separate lock/unlock cycles.
struct OverlaySnapshot {
    active_app: Option<String>,
    active_title: String,
    /// Absolute exe path of the foreground window when known.
    active_path: String,
    blocked_apps: Vec<String>,
    session: SessionFlags,
    in_emergency: bool,
}

/// Build an `OverlaySnapshot` from the current tracking state. Caller holds
/// the lock; no further locking happens here.
fn build_overlay_snapshot(guard: &TrackingState) -> OverlaySnapshot {
    let active_app = guard.current_app.clone();
    let active_row = match &active_app {
        Some(name) => guard
            .usage_by_date
            .get(&today_key())
            .and_then(|v| v.iter().find(|u| u.app_name == *name)),
        None => None,
    };
    let active_title = active_row
        .map(|u| u.window_title.clone())
        .unwrap_or_default();
    let active_path = active_row
        .map(|u| u.process_path.clone())
        .unwrap_or_default();

    // Emergency-access windows are keyed by display name OR exe stem, so a
    // grace period granted for "Discord" also covers discord.exe.
    let in_emergency = match &active_app {
        Some(name) => {
            let stem = tracking::exe_stem(&active_path);
            guard.emergency_until.iter().any(|(key, until)| {
                *until > std::time::Instant::now()
                    && (key == &name.to_lowercase() || (!stem.is_empty() && key == &stem))
            })
        }
        None => false,
    };
    OverlaySnapshot {
        active_app,
        active_title,
        active_path,
        blocked_apps: guard.blocked_apps.clone(),
        session: guard.session.clone(),
        in_emergency,
    }
}

/// Decide whether the polling loop needs to flip the overlay state this tick.
/// Takes a pre-captured snapshot (no locking here) so the poll loop only
/// acquires the mutex once per tick.
fn evaluate_overlay(app: &AppHandle, snap: &OverlaySnapshot) {
    let Some(active_app) = &snap.active_app else {
        blocking::hide_overlay(app);
        return;
    };

    // Overlay only ever shows when a work session is active.
    if !blocking_active(&snap.session) {
        blocking::hide_overlay(app);
        return;
    }

    // Path-aware matching: a localized or versioned display name no longer
    // escapes a block set on the exe stem (e.g. "Code" vs "Visual Studio Code").
    let is_blocked = is_app_blocked(active_app, &snap.active_path, &snap.blocked_apps);

    if !is_blocked || snap.in_emergency {
        blocking::hide_overlay(app);
    } else {
        // Actively remove the distraction (Windows-only, non-destructive: the
        // app is minimized, not killed, and FocusGuard re-minimizes on the
        // next tick if the user restores it).
        blocking::minimize_blocked_window();
        blocking::show_overlay(app, active_app, &snap.active_title);
    }
}

// ─── App entry point ────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcut("Ctrl+Shift+F")
                .expect("valid shortcut")
                .with_handler(move |app, _shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        let _ = show_tray_popup(app.clone());
                    }
                })
                .build(),
        )
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            start_app_tracking,
            stop_app_tracking,
            get_tracking_status,
            get_desktop_app_usage,
            update_session_flags,
            get_known_apps,
            set_blocked_desktop_apps,
            get_blocked_desktop_apps,
            grant_emergency_access,
            hide_block_overlay,
            show_tray_popup,
            hide_tray_popup,
            show_main_window,
            quit_app,
            get_extension_state,
            set_extension_connected,
            set_desktop_state,
        ])
        .setup(|app| {
            // Start the sync HTTP broker.
            sync_server::spawn(app.handle().clone());

            // ─── Tray icon ──────────────────────────────────────────
            // Left-click → show popup window near the cursor.
            // Right-click → built-in Tauri menu (Open / Quit).
            let tray_handle = app.tray_by_id("main").expect("tray icon not found");

            // Build the context menu in Rust (the JSON `menu` field was removed
            // from tauri-build 2.6+).
            let open_item =
                MenuItem::with_id(app, "show_main", "Open FocusGuard", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &quit_item])?;
            tray_handle.set_menu(Some(menu))?;

            let popup_app = app.handle().clone();
            tray_handle.on_tray_icon_event(move |_, event| {
                if let tauri::tray::TrayIconEvent::Click {
                    button: tauri::tray::MouseButton::Left,
                    button_state: tauri::tray::MouseButtonState::Up,
                    ..
                } = event
                {
                    let _ = show_tray_popup(popup_app.clone());
                }
            });

            // Tray menu actions.
            let menu_app = app.handle().clone();
            app.on_menu_event(move |_app_handle, event| match event.id().as_ref() {
                "show_main" => {
                    let _ = show_main_window(menu_app.clone());
                }
                "quit" => {
                    menu_app.exit(0);
                }
                _ => {}
            });

            // Periodic foreground-app poll. Every 2 seconds, under a single
            // mutex acquisition, we:
            //   1. probe the foreground app,
            //   2. flush the previous app's accumulated time (only when the app
            //      changed — same-app ticks accumulate into the same bucket),
            //   3. refresh the active app's window title,
            //   4. capture an `OverlaySnapshot` + today's usage slice.
            // The overlay decision and the heartbeat emit then run lock-free,
            // and the emit carries only today's rows instead of cloning the
            // full 30-day history (which the frontend never reads anyway).
            let poll_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_secs(2));
                loop {
                    interval.tick().await;
                    let state = poll_handle.state::<AppState>();

                    // Capture everything we need in one lock hold.
                    let (maybe_snapshot, maybe_today) = {
                        let Ok(mut guard) = state.tracking.lock() else {
                            continue;
                        };
                        if !guard.is_tracking {
                            continue;
                        }

                        // Probe the foreground window.
                        let probe = tracking::get_active_window();
                        let prev_app = guard.current_app.clone();
                        let next_app = probe.as_ref().and_then(|(name, _, _, _)| {
                            if should_exclude_app(name) {
                                None
                            } else {
                                Some(name.clone())
                            }
                        });

                        // Rotate only on actual change so time accumulates.
                        if next_app.as_deref() != prev_app.as_deref() {
                            flush_current_app(&mut guard);
                            guard.current_app = next_app.clone();
                            guard.current_app_start =
                                next_app.as_ref().map(|_| std::time::Instant::now());
                        }

                        // Refresh the active app's window title / create first row.
                        if let Some((app_name, window_title, proc_path, proc_id)) = &probe {
                            if !should_exclude_app(app_name) {
                                let today = today_key();
                                let ts = chrono::Utc::now().timestamp_millis() as u64;
                                let usage = guard.usage_by_date.entry(today).or_default();
                                if let Some(existing) =
                                    usage.iter_mut().find(|u| u.app_name == *app_name)
                                {
                                    if !window_title.is_empty() {
                                        existing.window_title = window_title.clone();
                                    }
                                    // Keep the path/pid fresh in case the app
                                    // updated and its install path changed.
                                    if !proc_path.is_empty() {
                                        existing.process_path = proc_path.clone();
                                    }
                                    if *proc_id != 0 {
                                        existing.process_id = *proc_id;
                                    }
                                    existing.last_active = ts;
                                } else {
                                    let category = categorize_app(app_name);
                                    usage.push(DesktopAppUsage {
                                        app_name: app_name.clone(),
                                        window_title: window_title.clone(),
                                        total_seconds: 0,
                                        last_active: ts,
                                        category,
                                        process_path: proc_path.clone(),
                                        process_id: *proc_id,
                                    });
                                }
                            }
                        }

                        // Build the overlay snapshot + today's slice under the
                        // same lock, then release before doing UI / IO work.
                        let snap = build_overlay_snapshot(&guard);
                        let today_slice = guard
                            .usage_by_date
                            .get(&today_key())
                            .cloned()
                            .unwrap_or_default();
                        (Some(snap), Some(today_slice))
                    };

                    let (Some(snap), Some(today_slice)) = (maybe_snapshot, maybe_today) else {
                        continue;
                    };

                    // Overlay decision (lock-free).
                    evaluate_overlay(&poll_handle, &snap);

                    // Heartbeat: today's usage only. The frontend rehydrates
                    // `desktopAppUsage[today]` from this — no need to ship 30
                    // days of history over the IPC bridge every tick.
                    let _ = poll_handle.emit("desktop-usage-updated", today_slice);
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
