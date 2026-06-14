# FocusGuard Desktop

A self-contained Tauri desktop application that tracks user desktop application usage (excluding Windows system apps/parts) and provides an identical UI to the [FocusGuard Firefox Extension](https://github.com/eyad-elghareeb/focus-guard-firefox).

## Features

### Extension-Identical UI
- **Pomodoro Timer** — 25min focus / 5min short break / 15min long break (customizable)
- **Site Blocking** — Block distracting sites during focus sessions
- **Task Management** — Add, check, delete, and clear completed tasks
- **Analytics Dashboard** — Daily/Weekly/Monthly stats with bar charts
- **Study Log** — Timeline of all sessions with edit/delete
- **Quick Access** — Bookmarks grid for frequently used sites
- **Settings** — Timer durations, daily goals, automation, notifications, data management

### Desktop-Specific Features
- **Desktop App Tracking** — Tracks active application usage time (excluding Windows system apps)
- **Category-based Classification** — Automatically categorizes apps (development, browser, communication, etc.)
- **System Tray Integration** — Minimize to tray with timer badge

### Extension Sync Bridge (Prepared)
- **Local HTTP Sync** — HTTP bridge for future Firefox extension communication
- **Data Push/Pull** — Send and receive state from the extension
- **Connection Detection** — Auto-detect when extension native host is running

## Tech Stack

- **Frontend**: Next.js 16 + React 19 + TypeScript + Tailwind CSS 4
- **State Management**: Zustand with persist middleware
- **Desktop Runtime**: Tauri v2
- **Backend (Rust)**:
  - `active-win-pos-rs` — Cross-platform active window detection
  - `sysinfo` — Process listing and system information
  - `tokio` — Async runtime for periodic tracking
  - `chrono` — Date/time handling

## Project Structure

```
focusguard-desktop/
├── src/                          # Next.js frontend
│   ├── app/
│   │   ├── page.tsx              # Main dashboard page
│   │   ├── layout.tsx            # Root layout
│   │   └── globals.css           # FocusGuard theme (identical to extension)
│   ├── components/focus-guard/
│   │   ├── TimerRing.tsx         # Pomodoro timer with SVG ring
│   │   ├── QuickAccess.tsx       # Quick access sites grid
│   │   ├── TaskList.tsx          # Todo list management
│   │   ├── AnalyticsCard.tsx     # Stats, charts, study log
│   │   ├── SettingsModal.tsx     # Full settings panel
│   │   ├── StudyLogModal.tsx     # Log time entry modal
│   │   └── DesktopAppTracker.tsx # Desktop app usage panel
│   └── lib/
│       ├── store.ts              # Zustand store (identical data model to extension)
│       ├── types.ts              # TypeScript types matching extension schema
│       ├── helpers.ts            # Utility functions (formatTime, etc.)
│       └── sync-bridge.ts        # Extension sync bridge (prepared for future)
├── src-tauri/                    # Tauri Rust backend
│   ├── src/
│   │   ├── main.rs               # Entry point
│   │   └── lib.rs                # App tracking commands & Tauri setup
│   ├── Cargo.toml                # Rust dependencies
│   └── tauri.conf.json           # Tauri configuration
└── package.json
```

## Development

### Web-only (for preview)
```bash
bun install
bun run dev
```

### With Tauri (requires Rust toolchain)
```bash
# Install Tauri CLI
cargo install tauri-cli

# Development
cargo tauri dev

# Build
cargo tauri build
```

## Extension Sync (Future)

The sync bridge is prepared but not yet connected. When the Firefox extension implements a native messaging host or local HTTP server, the desktop app can:

1. **Push state** — Send timer, settings, and usage data to the extension
2. **Pull state** — Receive data updates from the extension
3. **Bi-directional sync** — Keep both sides in sync via periodic polling

The Rust backend includes `push_to_extension`, `pull_from_extension`, and `check_extension_connection` commands ready for integration.

## App Tracking Exclusions

Windows system apps and internal parts are excluded from tracking:
- Windows Security, Defender, Update
- Task Manager, Registry Editor
- Device Manager, Disk Management
- Control Panel, Settings
- Start Menu, Search UI
- Shell Experience Host
- Desktop Window Manager (DWM)
- Runtime Broker, Service Host (svchost)
- And other system processes

## License

Same as the FocusGuard Firefox extension.
