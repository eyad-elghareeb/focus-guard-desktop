// FocusGuard Desktop - Zustand Store (identical data model to extension)
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  FocusGuardState,
  TimerState,
  Settings,
  BlockedSite,
  StudyLogEntry,
  Todo,
  QuickAccessSite,
  SessionLogEntry,
  DailyStats,
  SiteUsageMap,
  DEFAULT_SETTINGS,
  DEFAULT_BLOCKED_SITES,
  DEFAULT_QUICK_ACCESS,
} from './types';

const DEFAULT_TIMER: TimerState = {
  isRunning: false,
  isPaused: false,
  mode: 'work',
  remainingSeconds: DEFAULT_SETTINGS.workDuration,
  totalSeconds: DEFAULT_SETTINGS.workDuration,
  completedPomodoros: 0,
  currentStreak: 0,
  bestStreak: 0,
  lastTick: null,
  sessionStartTimestamp: null,
};

interface FocusGuardActions {
  // Timer actions
  startTimer: () => void;
  pauseTimer: () => void;
  resumeTimer: () => void;
  resetTimer: () => void;
  skipTimer: () => void;
  setTimerMode: (mode: TimerState['mode']) => void;
  tickTimer: () => void;

  // Settings actions
  updateSettings: (settings: Partial<Settings>) => void;
  resetSettings: () => void;

  // Blocked sites actions
  addBlockedSite: (site: BlockedSite) => void;
  removeBlockedSite: (domain: string) => void;
  toggleBlockedSite: (domain: string) => void;

  // Study log actions
  addStudyLogEntry: (entry: Omit<StudyLogEntry, 'id' | 'timestamp'>) => void;
  editStudyLogEntry: (id: string, updates: Partial<StudyLogEntry>) => void;
  deleteStudyLogEntry: (id: string) => void;

  // Todo actions
  addTodo: (text: string) => void;
  toggleTodo: (id: string) => void;
  deleteTodo: (id: string) => void;
  clearDoneTodos: () => void;

  // Quick access actions
  addQuickAccess: (domain: string) => void;
  removeQuickAccess: (domain: string) => void;

  // Data management
  exportData: () => FocusGuardState;
  importData: (data: FocusGuardState) => void;
  clearAllData: () => void;

  // Desktop app tracking
  updateDesktopAppUsage: (date: string, apps: FocusGuardState['desktopAppUsage'][string]) => void;

  // Desktop app blocking
  toggleBlockedDesktopApp: (appName: string) => void;
  setBlockedDesktopApps: (apps: string[]) => void;

  // Extension sync bridge
  setExtensionConnected: (connected: boolean) => void;
  setExtensionPort: (port: number | null) => void;
  setSyncEnabled: (enabled: boolean) => void;

  // Internal
  _addSessionLog: (entry: SessionLogEntry) => void;
  _updateDailyStats: (date: string, stats: Partial<DailyStats>) => void;
  _addStudyLogEntryFromTimer: (entry: { duration: number; subject: string; note: string; source: StudyLogEntry['source']; date: string }) => void;
}

function getTodayKey(): string {
  return new Date().toISOString().split('T')[0];
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/**
 * Normalize a list of "desktop app names" into clean, non-empty strings.
 *
 * Guards every `.toLowerCase()` call site against non-string / null / empty
 * entries that can sneak in from a migrated localStorage payload, a malformed
 * extension sync merge, or `importData`. The 1.7.2 `toLowerCase` crash
 * ("Cannot read properties of undefined") originated from these paths, so we
 * sanitize on read *and* on write.
 */
function sanitizeAppNames(apps: unknown[]): string[] {
  return apps
    .filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
    .map(a => a.trim());
}

type Store = FocusGuardState & FocusGuardActions;

export const useFocusGuardStore = create<Store>()(
  persist(
    (set, get) => ({
      // Initial state
      timer: DEFAULT_TIMER,
      settings: DEFAULT_SETTINGS,
      blockedSites: DEFAULT_BLOCKED_SITES,
      siteUsage: {},
      dailyStats: {},
      sessionLog: [],
      studyLog: [],
      todos: [],
      quickAccess: DEFAULT_QUICK_ACCESS,
      desktopAppUsage: {},
      blockedDesktopApps: [],
      extensionConnected: false,
      extensionPort: null,
      syncEnabled: true,

      // Timer actions
      startTimer: () => {
        const state = get();
        const now = Date.now();
        set({
          timer: {
            ...state.timer,
            isRunning: true,
            isPaused: false,
            lastTick: now,
            sessionStartTimestamp: state.timer.sessionStartTimestamp || now,
          },
        });
      },

      pauseTimer: () => {
        const state = get();
        if (!state.timer.isRunning || state.timer.isPaused) return;
        set({
          timer: {
            ...state.timer,
            isPaused: true,
            lastTick: null,
          },
        });
      },

      resumeTimer: () => {
        const state = get();
        if (!state.timer.isRunning || !state.timer.isPaused) return;
        set({
          timer: {
            ...state.timer,
            isPaused: false,
            lastTick: Date.now(),
          },
        });
      },

      resetTimer: () => {
        const state = get();
        const { mode } = state.timer;
        const { settings } = state;
        let totalSeconds = settings.workDuration;
        if (mode === 'short_break') totalSeconds = settings.shortBreakDuration;
        if (mode === 'long_break') totalSeconds = settings.longBreakDuration;

        // Log incomplete session if it was running
        if (state.timer.isRunning && state.timer.sessionStartTimestamp) {
          const elapsed = Math.floor((Date.now() - state.timer.sessionStartTimestamp) / 1000);
          if (elapsed > 30) {
            get()._addSessionLog({
              type: 'work_incomplete',
              duration: elapsed,
              totalDuration: state.timer.totalSeconds,
              reason: 'reset',
              timestamp: Date.now(),
              date: getTodayKey(),
            });
            get()._addStudyLogEntryFromTimer({
              duration: elapsed,
              subject: '',
              note: 'Session reset',
              source: 'reset',
              date: getTodayKey(),
            });
          }
        }

        set({
          timer: {
            ...DEFAULT_TIMER,
            mode,
            remainingSeconds: totalSeconds,
            totalSeconds,
            completedPomodoros: state.timer.completedPomodoros,
            currentStreak: state.timer.currentStreak,
            bestStreak: state.timer.bestStreak,
          },
        });
      },

      skipTimer: () => {
        const state = get();
        // Log the skipped session
        if (state.timer.isRunning && state.timer.sessionStartTimestamp) {
          const elapsed = state.timer.totalSeconds - state.timer.remainingSeconds;
          if (elapsed > 30) {
            get()._addSessionLog({
              type: state.timer.mode === 'work' ? 'work_incomplete' : state.timer.mode,
              duration: elapsed,
              totalDuration: state.timer.totalSeconds,
              reason: 'skip',
              timestamp: Date.now(),
              date: getTodayKey(),
            });
            get()._addStudyLogEntryFromTimer({
              duration: elapsed,
              subject: '',
              note: 'Session skipped',
              source: 'skip',
              date: getTodayKey(),
            });
          }
        }

        // Move to next mode
        const { mode, completedPomodoros } = state.timer;
        const { settings } = state;
        let nextMode: TimerState['mode'];
        let nextSeconds: number;

        if (mode === 'work') {
          const nextCount = completedPomodoros + 1;
          if (nextCount % settings.longBreakInterval === 0) {
            nextMode = 'long_break';
            nextSeconds = settings.longBreakDuration;
          } else {
            nextMode = 'short_break';
            nextSeconds = settings.shortBreakDuration;
          }
        } else {
          nextMode = 'work';
          nextSeconds = settings.workDuration;
        }

        const newCompleted = mode === 'work' ? completedPomodoros + 1 : completedPomodoros;
        const newStreak = mode === 'work' ? state.timer.currentStreak + 1 : state.timer.currentStreak;
        const newBestStreak = Math.max(newStreak, state.timer.bestStreak);

        set({
          timer: {
            ...DEFAULT_TIMER,
            mode: nextMode,
            remainingSeconds: nextSeconds,
            totalSeconds: nextSeconds,
            completedPomodoros: newCompleted,
            currentStreak: newStreak,
            bestStreak: newBestStreak,
          },
        });

        // Auto-start if settings say so
        if (
          (nextMode !== 'work' && settings.autoStartBreaks) ||
          (nextMode === 'work' && settings.autoStartWork)
        ) {
          setTimeout(() => get().startTimer(), 100);
        }
      },

      setTimerMode: (mode) => {
        const state = get();
        const { settings } = state;
        let totalSeconds = settings.workDuration;
        if (mode === 'short_break') totalSeconds = settings.shortBreakDuration;
        if (mode === 'long_break') totalSeconds = settings.longBreakDuration;

        set({
          timer: {
            ...DEFAULT_TIMER,
            mode,
            remainingSeconds: totalSeconds,
            totalSeconds,
            completedPomodoros: state.timer.completedPomodoros,
            currentStreak: state.timer.currentStreak,
            bestStreak: state.timer.bestStreak,
          },
        });
      },

      tickTimer: () => {
        const state = get();
        if (!state.timer.isRunning || state.timer.isPaused) return;

        const newRemaining = state.timer.remainingSeconds - 1;

        if (newRemaining <= 0) {
          // Session completed
          const { mode, completedPomodoros } = state.timer;
          const date = getTodayKey();

          // Log the completed session
          get()._addSessionLog({
            type: mode === 'work' ? 'work' : mode,
            duration: state.timer.totalSeconds,
            timestamp: Date.now(),
            date,
          });

          if (mode === 'work') {
            get()._addStudyLogEntryFromTimer({
              duration: state.timer.totalSeconds,
              subject: '',
              note: 'Pomodoro completed',
              source: 'timer',
              date,
            });

            // Update daily stats
            const currentStats = state.dailyStats[date] || { totalWork: 0, totalBreak: 0, pomodoros: 0 };
            get()._updateDailyStats(date, {
              totalWork: currentStats.totalWork + state.timer.totalSeconds,
              pomodoros: currentStats.pomodoros + 1,
            });
          } else {
            const currentStats = state.dailyStats[date] || { totalWork: 0, totalBreak: 0, pomodoros: 0 };
            get()._updateDailyStats(date, {
              totalBreak: currentStats.totalBreak + state.timer.totalSeconds,
            });
          }

          // Auto-skip to next mode
          get().skipTimer();
          return;
        }

        set({
          timer: {
            ...state.timer,
            remainingSeconds: newRemaining,
            lastTick: Date.now(),
          },
        });
      },

      // Settings actions
      updateSettings: (newSettings) => {
        const state = get();
        const updatedSettings = { ...state.settings, ...newSettings };

        // If timer is not running, update remaining seconds to match new durations
        let updatedTimer = { ...state.timer };
        if (!state.timer.isRunning) {
          const mode = state.timer.mode;
          if (mode === 'work') updatedTimer.remainingSeconds = updatedSettings.workDuration;
          if (mode === 'short_break') updatedTimer.remainingSeconds = updatedSettings.shortBreakDuration;
          if (mode === 'long_break') updatedTimer.remainingSeconds = updatedSettings.longBreakDuration;
          updatedTimer.totalSeconds = updatedTimer.remainingSeconds;
        }

        set({ settings: updatedSettings, timer: updatedTimer });
      },

      resetSettings: () => {
        set({ settings: DEFAULT_SETTINGS });
      },

      // Blocked sites actions
      addBlockedSite: (site) => {
        const state = get();
        if (state.blockedSites.some(s => s.domain === site.domain)) return;
        set({ blockedSites: [...state.blockedSites, site] });
      },

      removeBlockedSite: (domain) => {
        set({ blockedSites: get().blockedSites.filter(s => s.domain !== domain) });
      },

      toggleBlockedSite: (domain) => {
        set({
          blockedSites: get().blockedSites.map(s =>
            s.domain === domain ? { ...s, enabled: !s.enabled } : s
          ),
        });
      },

      // Study log actions
      addStudyLogEntry: (entry) => {
        const newEntry: StudyLogEntry = {
          ...entry,
          id: generateId(),
          timestamp: Date.now(),
        };
        const state = get();

        // Update daily stats
        const date = entry.date || getTodayKey();
        if (entry.source === 'timer' || entry.source === 'manual') {
          const currentStats = state.dailyStats[date] || { totalWork: 0, totalBreak: 0, pomodoros: 0 };
          get()._updateDailyStats(date, {
            totalWork: currentStats.totalWork + entry.duration,
          });
        }

        set({
          studyLog: [newEntry, ...state.studyLog].slice(0, 200),
        });
      },

      editStudyLogEntry: (id, updates) => {
        set({
          studyLog: get().studyLog.map(e =>
            e.id === id ? { ...e, ...updates } : e
          ),
        });
      },

      deleteStudyLogEntry: (id) => {
        set({ studyLog: get().studyLog.filter(e => e.id !== id) });
      },

      // Todo actions
      addTodo: (text) => {
        const newTodo: Todo = {
          id: generateId(),
          text,
          done: false,
          createdAt: Date.now(),
        };
        set({ todos: [newTodo, ...get().todos] });
      },

      toggleTodo: (id) => {
        set({
          todos: get().todos.map(t =>
            t.id === id
              ? { ...t, done: !t.done, doneAt: !t.done ? Date.now() : undefined }
              : t
          ),
        });
      },

      deleteTodo: (id) => {
        set({ todos: get().todos.filter(t => t.id !== id) });
      },

      clearDoneTodos: () => {
        set({ todos: get().todos.filter(t => !t.done) });
      },

      // Quick access actions
      addQuickAccess: (domain) => {
        const state = get();
        if (state.quickAccess.some(s => s.domain === domain)) return;
        set({ quickAccess: [...state.quickAccess, { domain }] });
      },

      removeQuickAccess: (domain) => {
        set({ quickAccess: get().quickAccess.filter(s => s.domain !== domain) });
      },

      // Data management
      exportData: () => {
        const state = get();
        // Strip sync/runtime-only fields so the export matches what the
        // extension round-trips through its import/export handlers.
        const {
          extensionConnected, extensionPort, syncEnabled,
          _addSessionLog, _updateDailyStats, _addStudyLogEntryFromTimer,
          ...data
        } = state;
        void extensionConnected; void extensionPort; void syncEnabled;
        void _addSessionLog; void _updateDailyStats; void _addStudyLogEntryFromTimer;
        return data as unknown as FocusGuardState;
      },

      importData: (data) => {
        set({
          timer: data.timer || DEFAULT_TIMER,
          settings: data.settings || DEFAULT_SETTINGS,
          blockedSites: data.blockedSites || DEFAULT_BLOCKED_SITES,
          siteUsage: data.siteUsage || {},
          dailyStats: data.dailyStats || {},
          sessionLog: data.sessionLog || [],
          studyLog: data.studyLog || [],
          todos: data.todos || [],
          quickAccess: data.quickAccess || DEFAULT_QUICK_ACCESS,
          desktopAppUsage: data.desktopAppUsage || {},
          blockedDesktopApps: sanitizeAppNames(data.blockedDesktopApps || []),
        });
      },

      clearAllData: () => {
        set({
          timer: DEFAULT_TIMER,
          settings: DEFAULT_SETTINGS,
          blockedSites: DEFAULT_BLOCKED_SITES,
          siteUsage: {},
          dailyStats: {},
          sessionLog: [],
          studyLog: [],
          todos: [],
          quickAccess: DEFAULT_QUICK_ACCESS,
          desktopAppUsage: {},
          blockedDesktopApps: [],
        });
      },

      // Desktop app tracking
      updateDesktopAppUsage: (date, apps) => {
        set({
          desktopAppUsage: { ...get().desktopAppUsage, [date]: apps },
        });
      },

      // Desktop app blocking
      toggleBlockedDesktopApp: (appName) => {
        if (typeof appName !== 'string' || !appName.trim()) return;
        const target = appName.trim();
        const targetLower = target.toLowerCase();
        const current = sanitizeAppNames(get().blockedDesktopApps);
        const exists = current.some(a => a.toLowerCase() === targetLower);
        const next = exists
          ? current.filter(a => a.toLowerCase() !== targetLower)
          : [...current, target];
        set({ blockedDesktopApps: next });
      },

      setBlockedDesktopApps: (apps) => {
        set({ blockedDesktopApps: sanitizeAppNames(apps) });
      },

      // Extension sync bridge
      setExtensionConnected: (connected) => set({ extensionConnected: connected }),
      setExtensionPort: (port) => set({ extensionPort: port }),
      setSyncEnabled: (enabled) => set({ syncEnabled: enabled }),

      // Internal helpers
      _addSessionLog: (entry) => {
        set({ sessionLog: [entry, ...get().sessionLog].slice(0, 500) });
      },

      _updateDailyStats: (date, stats) => {
        const state = get();
        const current = state.dailyStats[date] || { totalWork: 0, totalBreak: 0, pomodoros: 0 };
        set({
          dailyStats: {
            ...state.dailyStats,
            [date]: { ...current, ...stats },
          },
        });
      },

      // Internal helper for study log from timer
      _addStudyLogEntryFromTimer: (entry: { duration: number; subject: string; note: string; source: StudyLogEntry['source']; date: string }) => {
        const newEntry: StudyLogEntry = {
          ...entry,
          id: generateId(),
          timestamp: Date.now(),
        };
        set({ studyLog: [newEntry, ...get().studyLog].slice(0, 200) });
      },
    }),
    {
      name: 'focusguard_data',
      // Sanitize on hydration: stale localStorage payloads (or blobs imported
      // from an older extension build) may contain non-string entries in
      // `blockedDesktopApps`, which previously crashed the block toggle with
      // "Cannot read properties of undefined (reading 'toLowerCase')".
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<FocusGuardState>;
        return {
          ...current,
          ...p,
          blockedDesktopApps: sanitizeAppNames(
            Array.isArray(p.blockedDesktopApps) ? p.blockedDesktopApps : [],
          ),
        };
      },
      partialize: (state) => ({
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
        extensionConnected: state.extensionConnected,
        extensionPort: state.extensionPort,
        syncEnabled: state.syncEnabled,
      }),
    }
  )
);
