// FocusGuard Desktop — Extension Sync Bridge (frontend side).
//
// Two-way realtime sync between the desktop app and the browser extensions:
//
//   ┌─ extensions ─→ POST /state           ─→ Rust broker ─→ Tauri event
//   │      ▲                                              │
//   │      │                                              ▼
//   │   GET /state  ←─── merged view ←── desktop state (this module pushes)
//   │                                                     │
//   └── extension UI                              Zustand store (desktop UI)
//
// The Rust backend (src-tauri/src/sync_server.rs) runs an HTTP broker on
// localhost:9472. Browser extensions POST their full state blob to it; the
// broker stores the latest blob and emits a `extension-state-push` Tauri
// event. This module subscribes to that event and merges the payload into
// the Zustand store using a last-write-wins policy per top-level section.
//
// In the opposite direction, this module subscribes to store changes and
// pushes the desktop's state blob back to the broker via the
// `set_desktop_state` command. The broker's `GET /state` therefore returns
// both sides, so a session started in the desktop app shows up in the
// browser extension within one poll (≈5s).

import { isTauri, tauriInvoke, tauriListen } from './tauri';
import { useFocusGuardStore } from './store';
import type {
  TimerState,
  Settings,
  BlockedSite,
  StudyLogEntry,
  Todo,
  QuickAccessSite,
  DailyStats,
  SessionLogEntry,
} from './types';

/** Shape of the payload an extension pushes (a subset of focusguard_data). */
interface ExtensionPayload {
  timer?: Partial<TimerState>;
  settings?: Partial<Settings>;
  blockedSites?: BlockedSite[];
  siteUsage?: Record<string, unknown>;
  dailyStats?: Record<string, DailyStats>;
  sessionLog?: SessionLogEntry[];
  studyLog?: StudyLogEntry[];
  todos?: Todo[];
  quickAccess?: QuickAccessSite[];
}

let started = false;

/**
 * Minimum gap between desktop → broker pushes (ms).
 *
 * The store's `tickTimer` mutates `remainingSeconds` + `lastTick` every
 * second during a running session. Consumers reconstruct the live countdown
 * from `lastTick` themselves, so we don't need to push on every tick.
 * 1000ms coalesces consecutive ticks into a single push while still feeling
 * instant to a human watching the browser extension catch up.
 */
const PUSH_DEBOUNCE_MS = 1000;

/** Start the sync bridge. Safe to call multiple times — no-ops after first. */
export function startSyncBridge(): void {
  if (started || !isTauri()) return;
  started = true;

  // ── Inbound: extension → desktop ───────────────────────────────
  tauriListen<ExtensionPayload>('extension-state-push', (payload) => {
    if (!payload) return;
    mergeExtensionState(payload);
  });

  // ── Inbound: desktop usage heartbeat from the polling loop ─────
  // The backend polls every 2s and emits today's usage slice (a flat array,
  // not a date-keyed map — saves cloning the full 30-day history each tick).
  tauriListen<unknown[]>('desktop-usage-updated', (rows) => {
    if (!Array.isArray(rows)) return;
    try {
      const today = new Date().toISOString().split('T')[0];
      useFocusGuardStore.getState().updateDesktopAppUsage(
        today,
        rows.map(r => {
          const a = (r ?? {}) as Record<string, unknown>;
          return {
            appName: String(a.appName ?? ''),
            windowTitle: String(a.windowTitle ?? ''),
            totalSeconds: Number(a.totalSeconds ?? 0),
            lastActive: Number(a.lastActive ?? 0),
            category: String(a.category ?? 'other'),
          };
        }),
      );
    } catch {
      /* swallow — never let sync break the UI */
    }
  });

  // ── Outbound: desktop → broker (debounced store subscription) ──
  let pushTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPushedJson = '';

  useFocusGuardStore.subscribe(() => {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushTimer = null;
      const state = useFocusGuardStore.getState();
      // Build the shareable blob (mirror exportData's shape — strip
      // runtime-only sync flags to avoid feedback loops).
      const blob = {
        timer: state.timer,
        settings: state.settings,
        blockedSites: state.blockedSites,
        siteUsage: state.siteUsage,
        dailyStats: state.dailyStats,
        sessionLog: state.sessionLog,
        studyLog: state.studyLog,
        todos: state.todos,
        quickAccess: state.quickAccess,
        desktopAppUsage: state.desktopAppUsage,
        blockedDesktopApps: state.blockedDesktopApps,
      };
      const json = JSON.stringify(blob);
      if (json === lastPushedJson) return; // nothing changed
      lastPushedJson = json;
      tauriInvoke('set_desktop_state', { payload: blob });
    }, PUSH_DEBOUNCE_MS);
  });

  // ── Connection status poll ─────────────────────────────────────
  // Extensions push to us; we just need to surface the connected flag. The
  // flag only flips when an extension connects/disconnects (rare), so 10s
  // is plenty and keeps the broker idle most of the time.
  const poll = setInterval(async () => {
    const status = await tauriInvoke<{
      extensionConnected: boolean;
      extensionUpdatedAt: number;
    }>('get_extension_state');
    if (!status) return;
    const store = useFocusGuardStore.getState();
    if (store.extensionConnected !== status.extensionConnected) {
      store.setExtensionConnected(status.extensionConnected);
    }
  }, 10000);

  // Best-effort cleanup on page unload.
  window.addEventListener('beforeunload', () => clearInterval(poll));
}

/**
 * Merge an extension-pushed payload into the local store.
 *
 * Strategy per field:
 *  - timer: take whichever side has the more recent `lastTick` (or
 *    sessionStartTimestamp). If extension's is newer, accept it wholesale.
 *  - settings: shallow-merge extension values on top of local.
 *  - arrays (blockedSites, todos, quickAccess, studyLog, sessionLog):
 *    union by id/domain (extension entries added if missing locally).
 *  - maps (siteUsage, dailyStats): shallow-merge keys.
 */
function mergeExtensionState(payload: ExtensionPayload): void {
  const store = useFocusGuardStore.getState();

  // Timer — last writer wins by lastTick.
  if (payload.timer) {
    const local = store.timer;
    const remoteTick = payload.timer.lastTick ?? 0;
    const localTick = local.lastTick ?? 0;
    if (remoteTick >= localTick) {
      useFocusGuardStore.setState({
        timer: { ...local, ...payload.timer } as TimerState,
      });
    }
  }

  // Settings — shallow merge.
  if (payload.settings) {
    store.updateSettings(payload.settings);
  }

  // Blocked sites — union by domain.
  if (payload.blockedSites) {
    const local = store.blockedSites;
    const localDomains = new Set(local.map(s => s.domain));
    const additions = payload.blockedSites.filter(s => !localDomains.has(s.domain));
    if (additions.length > 0) {
      useFocusGuardStore.setState({ blockedSites: [...local, ...additions] });
    }
  }

  // Todos — union by id.
  if (payload.todos) {
    const local = store.todos;
    const localIds = new Set(local.map(t => t.id));
    const additions = payload.todos.filter(t => !localIds.has(t.id));
    if (additions.length > 0) {
      useFocusGuardStore.setState({ todos: [...local, ...additions] });
    }
  }

  // Quick access — union by domain.
  if (payload.quickAccess) {
    const local = store.quickAccess;
    const localDomains = new Set(local.map(s => s.domain));
    const additions = payload.quickAccess.filter(s => !localDomains.has(s.domain));
    if (additions.length > 0) {
      useFocusGuardStore.setState({ quickAccess: [...local, ...additions] });
    }
  }

  // Study log — union by id (most recent first).
  if (payload.studyLog) {
    const local = store.studyLog;
    const localIds = new Set(local.map(e => e.id));
    const additions = payload.studyLog.filter(e => !localIds.has(e.id));
    if (additions.length > 0) {
      useFocusGuardStore.setState({
        studyLog: [...additions, ...local].slice(0, 200),
      });
    }
  }

  // Session log — union by timestamp.
  if (payload.sessionLog) {
    const local = store.sessionLog;
    const localTs = new Set(local.map(e => e.timestamp));
    const additions = payload.sessionLog.filter(e => !localTs.has(e.timestamp));
    if (additions.length > 0) {
      useFocusGuardStore.setState({
        sessionLog: [...additions, ...local].slice(0, 500),
      });
    }
  }

  // Daily stats — shallow merge keys.
  if (payload.dailyStats) {
    useFocusGuardStore.setState({
      dailyStats: { ...store.dailyStats, ...payload.dailyStats },
    });
  }

  // Site usage — shallow merge keys.
  if (payload.siteUsage) {
    useFocusGuardStore.setState({
      // siteUsage is keyed by date; merge per-date maps.
      siteUsage: { ...store.siteUsage, ...(payload.siteUsage as typeof store.siteUsage) },
    });
  }
}
