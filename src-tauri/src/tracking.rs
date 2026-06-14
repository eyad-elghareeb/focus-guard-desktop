//! Desktop application usage tracking.
//!
//! Periodically polls the foreground window, accumulates per-app seconds,
//! categorizes apps, and filters out OS-internal processes.
//!
//! Design goals (v1.7.3):
//!   - **Foreground only.** We never enumerate running processes — that flooded
//!     the UI with hundreds of background services the user never focused. The
//!     only source of truth is `get_active_window()`.
//!   - **Continuous duration.** Each app accumulates time *as long as it stays*
//!     in the foreground. A brief alt-tab no longer creates a brand-new entry.
//!   - **Minimum dwell.** An app must be focused for at least
//!     `MIN_DWELL_SECONDS` before it enters the list, so 200ms flicker between
//!     windows doesn't pollute today's stats.

use serde::{Deserialize, Serialize};

/// One bucket of accumulated usage for a single app on a single day.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DesktopAppUsage {
    pub app_name: String,
    pub window_title: String,
    pub total_seconds: u64,
    pub last_active: u64,
    pub category: String,
    /// Absolute path to the app's executable when known (Windows/macOS/Linux).
    /// Empty string when unknown. Used for robust blocking: matching on the
    /// exe file stem survives localized display names and process-title drift.
    #[serde(default)]
    pub process_path: String,
    /// OS process id of the foreground window when last seen. Best-effort;
    /// may be stale between polls. Used by the Windows blocker to minimize.
    #[serde(default)]
    pub process_id: u64,
}

/// An app must hold the foreground for at least this long before it appears in
/// the usage list. Filters out sub-second window-switching noise.
pub const MIN_DWELL_SECONDS: u64 = 5;

/// Categorize an application based on its name. Matches the categories used
/// by the frontend's `DesktopAppTracker` component (development, browser, …).
pub fn categorize_app(app_name: &str) -> String {
    let name = app_name.to_lowercase();

    if contains_any(
        &name,
        &[
            "code",
            "vscode",
            "vim",
            "neovim",
            "emacs",
            "intellij",
            "idea",
            "webstorm",
            "pycharm",
            "xcode",
            "android studio",
            "eclipse",
            "terminal",
            "iterm",
            "alacritty",
            "kitty",
            "hyper",
            "warp",
            "powershell",
            "cmd",
            "windows terminal",
            "gnome-terminal",
        ],
    ) {
        return "development".into();
    }

    if contains_any(
        &name,
        &[
            "firefox", "chrome", "chromium", "safari", "edge", "brave", "arc", "opera", "vivaldi",
        ],
    ) {
        return "browser".into();
    }

    if contains_any(
        &name,
        &[
            "slack",
            "discord",
            "teams",
            "zoom",
            "telegram",
            "whatsapp",
            "signal",
            "skype",
            "messages",
            "mail",
            "outlook",
            "thunderbird",
        ],
    ) {
        return "communication".into();
    }

    if contains_any(
        &name,
        &[
            "figma",
            "sketch",
            "adobe",
            "illustrator",
            "photoshop",
            "blender",
            "canva",
            "invision",
            "indesign",
            "premiere",
        ],
    ) {
        return "design".into();
    }

    if contains_any(
        &name,
        &[
            "spotify",
            "vlc",
            "itunes",
            "apple music",
            "steam",
            "epic",
            "twitch",
            "netflix",
            "youtube",
            "discord",
            "game",
        ],
    ) {
        return "entertainment".into();
    }

    if contains_any(
        &name,
        &[
            "notion",
            "obsidian",
            "todoist",
            "evernote",
            "onenote",
            "calendar",
            "notes",
            "bear",
            "word",
            "excel",
            "powerpoint",
        ],
    ) {
        return "productivity".into();
    }

    if contains_any(
        &name,
        &[
            "explorer",
            "finder",
            "settings",
            "system preferences",
            "control center",
            "task manager",
            "activity monitor",
            "nautilus",
            "dolphin",
            "thunar",
            "files",
        ],
    ) {
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
    if contains_any(
        &name,
        &[
            "windows security",
            "windows defender",
            "windows update",
            "windows explorer",
            "taskmgr",
            "task manager",
            "registry editor",
            "event viewer",
            "device manager",
            "disk management",
            "services.msc",
            "control panel",
            "ms-settings",
            "start menu",
            "searchui",
            "shellexperiencehost",
            "application frame host",
            "runtime broker",
            "sihost",
            "taskhostw",
            "wininit",
            "winlogon",
            "csrss",
            "lsass",
            "services.exe",
            "svchost",
            "dwm",
            "fontdrvhost",
            "ctfmon",
            "systemsettings",
            "sihost.dll",
            "lockapp",
            "startmenuexperiencehost",
            "textinputhost",
        ],
    ) {
        return true;
    }

    // macOS menu bar / system processes.
    if contains_any(
        &name,
        &[
            "controlcenter",
            "systemuiserver",
            "loginwindow",
            "dock",
            "finder",
            "spotlight",
            "coreservicesd",
        ],
    ) {
        return true;
    }

    // Linux compositors / shells.
    if contains_any(
        &name,
        &[
            "gnome-shell",
            "kwin",
            "mutter",
            "wayland",
            "x11",
            "plasmashell",
        ],
    ) {
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
/// Returns `(app_name, window_title, process_path, process_id)` or `None`.
///
/// `process_path` is the absolute path to the executable when known (empty
/// otherwise); `process_id` is `0` when unknown. The path lets the blocker
/// match robustly on the exe file stem instead of a localized display name.
pub fn get_active_window() -> Option<(String, String, String, u64)> {
    match active_win_pos_rs::get_active_window() {
        Ok(window) => {
            let name = window.app_name.trim();
            if name.is_empty() {
                return None;
            }
            let path = window
                .process_path
                .to_str()
                .map(|s| s.to_string())
                .unwrap_or_default();
            Some((name.to_string(), window.title, path, window.process_id))
        }
        Err(_) => None,
    }
}

/// Lowercased file stem of an exe path (e.g. `C:\...\Code.exe` → `code`).
/// Returns the empty string when the path has no file stem.
pub fn exe_stem(path: &str) -> String {
    std::path::Path::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default()
}

/// Whether a foreground app should be treated as "blocked".
///
/// This is intentionally fuzzy because the user picks apps by display name in
/// the UI, but the OS may report a different name on a different locale or
/// version. We therefore consider it a match when **any** of these hold:
///   - the display name equals the blocked entry (case-insensitive), or
///   - the blocked entry equals the foreground app's exe stem (case-insensitive),
///   - one contains the other (handles "Code" vs "Visual Studio Code").
///
/// `process_path` may be empty when unknown; in that case only name matching
/// applies.
pub fn matches_blocked(display_name: &str, process_path: &str, blocked: &str) -> bool {
    let dn = display_name.to_lowercase();
    let b = blocked.trim().to_lowercase();
    if b.is_empty() {
        return false;
    }
    if dn == b {
        return true;
    }
    let stem = exe_stem(process_path);
    if !stem.is_empty() && stem == b {
        return true;
    }
    dn.contains(&b) || b.contains(&dn)
}

/// True when the given blocked entry matches either the display name or the
/// exe stem of the row, scanning the whole block list.
pub fn is_app_blocked(display_name: &str, process_path: &str, blocked_apps: &[String]) -> bool {
    blocked_apps
        .iter()
        .any(|b| matches_blocked(display_name, process_path, b))
}

/// Returns the list of apps the user has *actually focused* today, plus any
/// they have previously chosen to block. This replaces the old sysinfo-based
/// running-process dump, which flooded the UI with hundreds of OS services
/// the user would never care about.
///
/// Sources:
///   - `today_usage` — apps the polling loop has seen in the foreground today.
///   - `blocked_apps` — apps the user has explicitly blocked (may include
///     apps not seen yet today, e.g. set in a prior session).
///
/// A minimum dwell-time filter is applied: apps seen for less than
/// `MIN_DWELL_SECONDS` of *real* foreground time don't surface in the list,
/// so a sub-second alt-tab no longer adds noise. Blocked apps bypass the
/// filter (the user explicitly chose them).
pub fn list_known_apps(
    today_usage: &[DesktopAppUsage],
    blocked_apps: &[String],
) -> Vec<serde_json::Value> {
    let mut seen = std::collections::HashSet::new();
    let mut apps: Vec<serde_json::Value> = Vec::new();

    // Pre-seed the "seen" set with lowercased blocked-app names so the dwell
    // filter below doesn't drop apps the user cares about.
    let blocked_lower: std::collections::HashSet<String> =
        blocked_apps.iter().map(|s| s.to_lowercase()).collect();

    // 1. Apps we've actually seen focused today (sorted by most-recently-used).
    let mut sorted: Vec<&DesktopAppUsage> = today_usage.iter().collect();
    sorted.sort_by(|a, b| b.last_active.cmp(&a.last_active));

    for usage in sorted {
        let name = usage.app_name.trim();
        if name.is_empty() {
            continue;
        }
        let lower = name.to_lowercase();
        if !seen.insert(lower.clone()) {
            continue;
        }
        // Dwell filter: skip apps that barely held focus, unless blocked.
        let blocked_by_name = blocked_lower.contains(&lower);
        let blocked_by_path = !usage.process_path.is_empty()
            && blocked_lower.contains(&exe_stem(&usage.process_path));
        if usage.total_seconds < MIN_DWELL_SECONDS && !(blocked_by_name || blocked_by_path) {
            continue;
        }
        apps.push(serde_json::json!({
            "name": name,
            "category": usage.category.clone(),
            "processPath": usage.process_path.clone(),
        }));
    }

    // 2. Blocked apps not yet seen today (e.g. set in a prior session).
    for name in blocked_apps {
        let trimmed = name.trim();
        if trimmed.is_empty() || !seen.insert(trimmed.to_lowercase()) {
            continue;
        }
        apps.push(serde_json::json!({
            "name": trimmed,
            "category": categorize_app(trimmed),
        }));
    }

    apps
}
