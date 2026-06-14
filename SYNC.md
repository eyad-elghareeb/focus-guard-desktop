# FocusGuard Sync Protocol

FocusGuard Desktop and the browser extensions (Firefox / Chrome) sync state
over a local HTTP broker served by the desktop app. No cloud, no accounts —
all traffic stays on `127.0.0.1`.

## Topology

```
┌──────────────────────┐         ┌──────────────────────┐
│  Browser extension   │         │  FocusGuard Desktop  │
│  (Firefox / Chrome)  │         │  (Tauri + tiny_http) │
│                      │  HTTP   │                      │
│  background/sync.js  │ ──────► │  localhost:9472      │
│                      │ ◄────── │  (sync_server.rs)    │
└──────────────────────┘         └──────────┬───────────┘
                                            │ Tauri events
                                            ▼
                                 ┌──────────────────────┐
                                 │  Next.js frontend    │
                                 │  (sync-bridge.ts →   │
                                 │   Zustand store)     │
                                 └──────────────────────┘
```

## Endpoints

All endpoints are served on `http://localhost:9472`. Responses include
`Access-Control-Allow-Origin: *` so extension pages (running under
`moz-extension://` / `chrome-extension://` origins) can call them.

### `GET /health`
Returns `{ ok: true, version: "1.7.2", desktop: true }`. The extension
polls this every 5 seconds to detect the desktop.

### `GET /state`
Returns the latest extension payload the broker has received, plus a
timestamp:
```json
{
  "extension": { /* full focusguard_data blob */ },
  "extensionUpdatedAt": 1718400000000,
  "extensionConnected": true
}
```

### `POST /state`
Body: the extension's full `focusguard_data` state object. The broker stores
it and emits a Tauri `extension-state-push` event so the desktop frontend
merges it into its Zustand store.

### `GET /desktop-app-usage`
Returns desktop-only foreground app usage (keyed by date), which the
extension cannot observe natively. Used to render the desktop-apps card in
the extension's analytics tab.

## Conflict resolution

MVP policy is **last-write-wins per top-level section**, with timestamps
compared where they exist:

| Section | Resolution |
|---------|-----------|
| `timer` | Compare `lastTick`; the side with the newer timestamp wins. This makes whichever side last called start/pause/reset authoritative. |
| `settings` | Shallow-merge remote values onto local. |
| `blockedSites`, `todos`, `quickAccess` | Union by `domain`/`id`. |
| `studyLog`, `sessionLog` | Union by `id` / `timestamp`. |
| `dailyStats`, `siteUsage` | Shallow-merge per-date keys. |

There are no vector clocks or CRDTs in the MVP — if both sides edit the same
field simultaneously, the last writer wins. This is sufficient for a
single-user, single-machine setup.

## Throttling

- The extension pushes state to the desktop **at most once every 500ms**
  (debounced inside `background/sync.js`).
- The desktop pulls from itself every 10s to surface desktop-side changes
  back to the extension.
- The extension health-checks every 5s.

## Field compatibility

The shared `focusguard_data` blob is identical across the three apps. The
desktop adds two fields the extensions don't have:

- `desktopAppUsage` — per-date native app usage (desktop-only).
- `blockedDesktopApps` — names of desktop apps the user has chosen to block.

The extension's `exportData` / `importData` handlers explicitly ignore these
extra fields, so a round-trip through the extension is safe.

## Versioning

All three apps are version-locked at `1.7.2` (declared in each `package.json`
/ `manifest.json` / `Cargo.toml`). The `/health` endpoint returns the
desktop's version so the extension can warn about mismatches in future
releases.
