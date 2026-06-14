# FocusGuard Desktop

A cross-platform desktop companion for the [FocusGuard][ff] browser extensions.
Tracks foreground application usage, overlays blocked apps during focus
sessions, and syncs your timer / todos / blocked sites / stats with the
Firefox and Chrome extensions over a local HTTP broker.

Built with **Next.js 16 + React 19 + Tauri 2 + Zustand + Tailwind v4**.

## Features

- **Pomodoro timer** — 25/5/15 default sessions, customizable, with streaks and
  daily-goal tracking. Keyboard shortcuts: `Space` (start/pause), `R` (reset),
  `S` (skip).
- **Quick access** — pinned sites with auto-generated favicons.
- **Task list** — add / toggle / clear-done.
- **Analytics** — day/week/month focus-time chart, study log, top sites, and
  **desktop app usage breakdown** by category.
- **Desktop app blocking** — toggle any tracked app to overlay it during work
  sessions. The overlay is fullscreen + always-on-top (portable across
  Windows/macOS/Linux) and offers a 5-minute **Emergency access** button that
  breaks your streak, matching the extension's site-blocking UX.
- **Extension sync** — bidirectional sync with the Firefox/Chrome extensions
  via a localhost HTTP broker. Timer, settings, blocked sites, todos, study
  log, and stats stay in sync. See [`SYNC.md`](./SYNC.md).

## Requirements

- **Node.js 20+** and **npm 10+**
- **Rust 1.94+** (a `rust-toolchain.toml` pins the project to 1.94)
- **Tauri 2 prerequisites** for your OS:
  - **Windows**: Microsoft Visual Studio C++ Build Tools + WebView2
  - **macOS**: Xcode command-line tools
  - **Linux**: `webkit2gtk`, `libayatana-appindicator3-dev`, `librsvg2-dev`, etc.
    (see the [Tauri 2 prerequisites][tauri-prereq])

## Development

```bash
npm install
npm run tauri:dev
```

This launches the Next.js dev server (`http://localhost:3000`) and opens the
Tauri window pointed at it. Hot reload works for both frontend and Rust
(Rust changes trigger a recompile).

To run the web frontend only (no native tracking / overlay):

```bash
npm run dev
```

## Production build (per-OS binaries)

```bash
npm run tauri:build
```

Produces installers under `src-tauri/target/release/bundle/`:

| OS | Output |
|----|--------|
| Windows | `.msi` (WiX) and `.exe` (NSIS) |
| macOS | `.dmg` and `.app` |
| Linux | `.deb` and `.AppImage` |

You must run this command **on** the target OS — Tauri does not cross-compile
binaries. For multi-OS CI, see a [Tauri GitHub Action][tauri-action].

## How blocking works

Hard-killing the foreground process is OS-specific, fragile, and abusive, so
FocusGuard takes a different approach: when a blocked app gains focus during
an active work session, a fullscreen, always-on-top, frameless overlay window
visually occludes it. The overlay shows:

- The blocked app's name and current window title
- The live focus-session countdown
- A motivational quote
- An **Emergency access (5 min)** button that temporarily lifts the overlay
  for that app and breaks the current pomodoro streak

The overlay works identically on Windows, macOS, and Linux because it relies
only on Tauri's cross-platform window APIs.

## Project structure

```
src/
  app/
    layout.tsx              # Root layout (minimal metadata)
    page.tsx                # Server shell → dynamic client import
    FocusGuardClient.tsx    # Main app: tabs, header, keyboard shortcuts
    globals.css             # Theme tokens + all fg-* classes
    block-overlay/
      page.tsx              # Overlay route shell
      BlockOverlayClient.tsx # Overlay UI (timer, quote, emergency btn)
    not-found.tsx, error.tsx # Custom 404 / error boundaries
  components/focus-guard/
    TimerRing.tsx           # Pomodoro timer with SVG progress ring
    QuickAccess.tsx         # Pinned site grid
    TaskList.tsx            # Todos
    AnalyticsCard.tsx       # Day/week/month stats + study log
    DesktopAppTracker.tsx   # App usage + block toggles
    SettingsModal.tsx       # Settings, blocked sites, sync, export/import
    StudyLogModal.tsx       # Manual time logging
  lib/
    store.ts                # Zustand + persist (localStorage key: focusguard_data)
    types.ts                # Shared types + defaults
    helpers.ts              # Format/date/sound utilities
    tauri.ts                # Tauri invoke/event wrappers
    sync-bridge.ts          # Extension sync (subscribes to broker events)
src-tauri/
  Cargo.toml                # Rust deps (tauri, tiny_http, reqwest, sysinfo…)
  tauri.conf.json           # Windows, bundle, tray, capabilities
  capabilities/default.json # Tauri 2 access control
  icons/                    # Generated via `tauri icon`
  src/
    lib.rs                  # Entry point + commands + polling loop
    state.rs                # AppState, TrackingState, SessionFlags
    tracking.rs             # Foreground polling, categorize, exclude
    blocking.rs             # Overlay show/hide + emergency windows
    sync_server.rs          # tiny_http broker on :9472
```

[ff]: https://github.com/eyad-elghareeb/focus-guard-firefox
[tauri-prereq]: https://v2.tauri.app/start/prerequisites/
[tauri-action]: https://v2.tauri.app/distribute/sign/
