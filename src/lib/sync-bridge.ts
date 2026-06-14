// FocusGuard Desktop — Extension Sync Bridge (frontend side).
//
// The Rust backend (src-tauri/src/sync_server.rs) runs an HTTP broker on
// localhost:9472. Browser extensions POST their full state blob to it; the
// broker stores the latest blob and emits a `extension-state-push` Tauri
// event. This module subscribes to that event and merges the payload into
// the Zustand store using a last-write-wins policy per top-level section.
//
// Conflict policy (MVP): each top-level section in the store carries an
// implicit timestamp via its position in the array/object. Whichever side
// last wrote wins. The timer specifically follows whichever side last called
// start/pause/reset — we detect this by comparing `lastTick` and
// `sessionStartTimestamp`.

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

/** Start the sync bridge. Safe to call multiple times — no-ops after first. */
export function startSyncBridge(): void {
  if (started || !isTauri()) return;
  started = true;

  // Listen for state pushes from extensions (relayed by the Rust broker).
  tauriListen<ExtensionPayload>('extension-state-push', (payload) => {
    if (!payload) return;
    mergeExtensionState(payload);
  });

  // Poll the broker for connection status (cheap — just reads shared state).
  // Extensions push to us, so we just need to surface the connected flag.
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
  }, 5000);

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
