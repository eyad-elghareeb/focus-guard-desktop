//! Desktop application usage tracking.
//!
//! Periodically polls the foreground window, accumulates per-app seconds,
//! categorizes apps, and filters out OS-internal processes.

use serde::{Deserialize, Serialize};

/// One bucket of accumulated usage for a single app on a single day.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DesktopAppUsage {
    pub app_name: String,
    pub window_title: String,
    pub total_seconds: u64,
    pub last_active: u64,
    pub category: String,
}

/// Categorize an application based on its name. Matches the categories used
/// by the frontend's `DesktopAppTracker` component (development, browser, …).
pub fn categorize_app(app_name: &str) -> String {
    let name = app_name.to_lowercase();

    if contains_any(&name, &[
        "code", "vscode", "vim", "neovim", "emacs", "intellij", "idea",
        "webstorm", "pycharm", "xcode", "android studio", "eclipse",
        "terminal", "iterm", "alacritty", "kitty", "hyper", "warp",
        "powershell", "cmd", "windows terminal", "gnome-terminal",
    ]) {
        return "development".into();
    }

    if contains_any(&name, &[
        "firefox", "chrome", "chromium", "safari", "edge", "brave",
        "arc", "opera", "vivaldi",
    ]) {
        return "browser".into();
    }

    if contains_any(&name, &[
        "slack", "discord", "teams", "zoom", "telegram", "whatsapp",
        "signal", "skype", "messages", "mail", "outlook", "thunderbird",
    ]) {
        return "communication".into();
    }

    if contains_any(&name, &[
        "figma", "sketch", "adobe", "illustrator", "photoshop",
        "blender", "canva", "invision", "indesign", "premiere",
    ]) {
        return "design".into();
    }

    if contains_any(&name, &[
        "spotify", "vlc", "itunes", "apple music", "steam", "epic",
        "twitch", "netflix", "youtube", "discord", "game",
    ]) {
        return "entertainment".into();
    }

    if contains_any(&name, &[
        "notion", "obsidian", "todoist", "evernote", "onenote",
        "calendar", "notes", "bear", "word", "excel", "powerpoint",
    ]) {
        return "productivity".into();
    }

    if contains_any(&name, &[
        "explorer", "finder", "settings", "system preferences",
        "control center", "task manager", "activity monitor", "nautilus",
        "dolphin", "thunar", "files",
    ]) {
        return "system".into();
    }

    "other".into()
}

/// Whether the foreground process should be ignored entirely (never tracked,
/// never blocked). Focuses on OS shells and FocusGuard itself.
pub fn should_exclude_app(app_name: &str) -> bool {
    let name = app_name.to_lowercase();

    // FocusGuard itself — never track, never block (avoid recursion).
    if name.contains("focusguard") {
        return true;
    }

    // Windows OS shells / system services.
    if contains_any(&name, &[
        "windows security", "windows defender", "windows update",
        "windows explorer", "taskmgr", "task manager", "registry editor",
        "event viewer", "device manager", "disk management", "services.msc",
        "control panel", "ms-settings", "start menu", "searchui",
        "shellexperiencehost", "application frame host", "runtime broker",
        "sihost", "taskhostw", "wininit", "winlogon", "csrss", "lsass",
        "services.exe", "svchost", "dwm", "fontdrvhost", "ctfmon",
        "systemsettings", "sihost.dll", "lockapp",
    ]) {
        return true;
    }

    // macOS menu bar / system processes.
    if contains_any(&name, &[
        "controlcenter", "systemuiserver", "loginwindow", "dock",
        "finder", "spotlight", "coreservicesd",
    ]) {
        return true;
    }

    // Linux compositors / shells.
    if contains_any(&name, &[
        "gnome-shell", "kwin", "mutter", "wayland", "x11", "plasmashell",
    ]) {
        return true;
    }

    false
}

fn contains_any(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().any(|n| haystack.contains(n))
}

/// Today's date key in YYYY-MM-DD format (local time).
pub fn today_key() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

/// Fetch the currently active window cross-platform.
/// Returns (app_name, window_title) or None.
pub fn get_active_window() -> Option<(String, String)> {
    match active_win_pos_rs::get_active_window() {
        Ok(window) => {
            if window.app_name.is_empty() {
                return None;
            }
            Some((window.app_name, window.title))
        }
        Err(_) => None,
    }
}

/// Get a list of currently running apps (for the UI's blocking list).
pub fn list_running_apps() -> Vec<serde_json::Value> {
    let mut system = sysinfo::System::new();
    system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    let mut seen = std::collections::HashSet::new();
    let mut apps: Vec<serde_json::Value> = Vec::new();

    for process in system.processes().values() {
        let name = process.name().to_string_lossy().to_string();
        if name.is_empty() || should_exclude_app(&name) {
            continue;
        }
        // Deduplicate by lowercased name — sysinfo lists multiple PIDs per app.
        let key = name.to_lowercase();
        if !seen.insert(key) {
            continue;
        }
        apps.push(serde_json::json!({
            "name": name,
            "category": categorize_app(&name),
        }));
    }

    apps
}
