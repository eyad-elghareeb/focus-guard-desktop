'use client';

import { useFocusGuardStore } from '@/lib/store';
import { getGreeting, getTodayKey } from '@/lib/helpers';
import { isTauri, tauriInvoke } from '@/lib/tauri';
import { startSyncBridge } from '@/lib/sync-bridge';
import { TimerRing } from '@/components/focus-guard/TimerRing';
import { QuickAccess } from '@/components/focus-guard/QuickAccess';
import { TaskList } from '@/components/focus-guard/TaskList';
import { AnalyticsCard } from '@/components/focus-guard/AnalyticsCard';
import { SettingsModal } from '@/components/focus-guard/SettingsModal';
import { StudyLogModal } from '@/components/focus-guard/StudyLogModal';
import { DesktopAppTracker } from '@/components/focus-guard/DesktopAppTracker';
import { useState, useEffect } from 'react';

type TabId = 'focus' | 'tasks' | 'analytics';

export default function FocusGuardDesktop() {
  const [activeTab, setActiveTab] = useState<TabId>('focus');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [greeting, setGreeting] = useState('');
  const [currentTime, setCurrentTime] = useState('');
  const [currentDate, setCurrentDate] = useState('');

  const timer = useFocusGuardStore(s => s.timer);
  const settings = useFocusGuardStore(s => s.settings);
  const dailyStats = useFocusGuardStore(s => s.dailyStats);
  const extensionConnected = useFocusGuardStore(s => s.extensionConnected);
  const syncEnabled = useFocusGuardStore(s => s.syncEnabled);

  const todayStats = dailyStats[getTodayKey()];
  const dailyGoalSeconds = settings.dailyGoalMinutes * 60;
  const dailyProgress = todayStats ? Math.min(1, todayStats.totalWork / dailyGoalSeconds) : 0;

  // Update time display
  useEffect(() => {
    // Boot the extension sync bridge (no-op outside Tauri).
    startSyncBridge();

    const update = () => {
      setGreeting(getGreeting());
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      setCurrentDate(now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }));
    };
    update();
    const interval = setInterval(update, 30000);
    return () => clearInterval(interval);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (settingsOpen) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.code === 'Space') {
        e.preventDefault();
        const state = useFocusGuardStore.getState();
        if (!state.timer.isRunning) state.startTimer();
        else if (state.timer.isPaused) state.resumeTimer();
        else state.pauseTimer();
      }
      if (e.code === 'KeyR' && !e.metaKey && !e.ctrlKey) {
        useFocusGuardStore.getState().resetTimer();
      }
      if (e.code === 'KeyS' && !e.metaKey && !e.ctrlKey) {
        useFocusGuardStore.getState().skipTimer();
      }
      if (e.code === 'Escape') {
        setSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [settingsOpen]);

  // Badge text for title
  useEffect(() => {
    if (timer.isRunning && !timer.isPaused) {
      const mins = Math.ceil(timer.remainingSeconds / 60);
      document.title = `${mins}m - FocusGuard`;
    } else {
      document.title = 'FocusGuard';
    }
  }, [timer.isRunning, timer.isPaused, timer.remainingSeconds]);

  // Push session flags to Rust whenever the timer/settings change, so the
  // native overlay loop can decide whether to raise the block overlay.
  useEffect(() => {
    if (!isTauri()) return;
    tauriInvoke('update_session_flags', {
      flags: {
        timer_running: timer.isRunning,
        timer_paused: timer.isPaused,
        timer_mode: timer.mode,
        block_during_work: settings.blockDuringWork,
        block_during_breaks: settings.blockDuringBreaks,
        remaining_seconds: timer.remainingSeconds,
      },
    });
  }, [
    timer.isRunning,
    timer.isPaused,
    timer.mode,
    timer.remainingSeconds,
    settings.blockDuringWork,
    settings.blockDuringBreaks,
  ]);

  // Also handle the emergency-access event: break the streak (mirrors extension).
  useEffect(() => {
    if (!isTauri()) return;
    let unlistenFn: (() => void) | null = null;
    import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen('emergency-access-granted', () => {
          // Break the current streak — same UX as the extension's emergency access.
          useFocusGuardStore.setState(state => ({
            timer: { ...state.timer, currentStreak: 0 },
          }));
        }),
      )
      .then(fn => {
        unlistenFn = fn;
      })
      .catch(() => {});
    return () => {
      unlistenFn?.();
    };
  }, []);

  const isBreakMode = timer.mode !== 'work';

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col" style={{ background: 'var(--bg-deep)' }}>
      {/* Background Effects */}
      <div className="fg-grid-overlay" />
      <div className="fg-orb fg-orb-red" />
      <div className="fg-orb fg-orb-purple" />
      <div className="fg-orb fg-orb-cyan" />

      {/* Top Bar */}
      <header className="relative z-10 flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          {/* Logo */}
          <div className="fg-logo-pulse" style={{ color: 'var(--red)' }}>
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <circle cx="14" cy="14" r="12" stroke="currentColor" strokeWidth="2.5"/>
              <path d="M14 7v7l4.5 3" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
          </div>
          <span
            className="font-extrabold"
            style={{
              fontSize: 16,
              background: 'linear-gradient(135deg, var(--text-primary), var(--text-secondary))',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            FocusGuard
          </span>
          <span
            className="fg-pill"
            style={{
              background: 'var(--bg-elevated)',
              color: 'var(--text-muted)',
              fontSize: 10,
              border: '1px solid var(--border)',
            }}
          >
            Desktop
          </span>
        </div>

        {/* Greeting */}
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{greeting}</span>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {/* Extension sync indicator */}
          {extensionConnected && syncEnabled && (
            <span className="fg-sync-indicator fg-sync-connected" style={{ fontSize: 10 }}>
              <span style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--green)' }} />
              Synced
            </span>
          )}

          {/* Date pill */}
          <span
            className="fg-pill"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', fontSize: 12, border: '1px solid var(--border)' }}
          >
            {currentDate}
          </span>

          {/* Mini daily progress */}
          <div className="flex items-center gap-2">
            <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--bg-elevated)' }}>
              <div
                style={{
                  width: `${dailyProgress * 100}%`,
                  height: '100%',
                  borderRadius: 2,
                  background: isBreakMode
                    ? 'linear-gradient(90deg, var(--green), var(--cyan))'
                    : 'linear-gradient(90deg, var(--red), var(--orange))',
                  transition: 'width 0.5s var(--ease)',
                }}
              />
            </div>
          </div>

          {/* Settings gear */}
          <button
            onClick={() => setSettingsOpen(true)}
            className="fg-control-btn"
            style={{ width: 36, height: 36 }}
            title="Settings"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
        </div>
      </header>

      {/* Tab Bar */}
      <nav className="relative z-10 flex items-center justify-center gap-2 pb-2">
        <button
          className={`fg-tab-btn ${activeTab === 'focus' ? 'active' : ''}`}
          onClick={() => setActiveTab('focus')}
        >
          <svg width="16" height="16" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="14" cy="14" r="12"/>
            <path d="M14 7v7l4.5 3" strokeLinecap="round"/>
          </svg>
          Focus
        </button>
        <button
          className={`fg-tab-btn ${activeTab === 'tasks' ? 'active' : ''}`}
          onClick={() => setActiveTab('tasks')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          Tasks
        </button>
        <button
          className={`fg-tab-btn ${activeTab === 'analytics' ? 'active' : ''}`}
          onClick={() => setActiveTab('analytics')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="20" x2="18" y2="10"/>
            <line x1="12" y1="20" x2="12" y2="4"/>
            <line x1="6" y1="20" x2="6" y2="14"/>
          </svg>
          Analytics
        </button>
      </nav>

      {/* Main Content */}
      <main className="relative z-10 flex-1 overflow-y-auto fg-scrollbar px-6 pb-6">
        {activeTab === 'focus' && (
          <div className="max-w-3xl mx-auto space-y-6 py-4">
            <div className="flex justify-center">
              <TimerRing />
            </div>
            <div className="max-w-md mx-auto">
              <QuickAccess />
            </div>
          </div>
        )}

        {activeTab === 'tasks' && (
          <div className="max-w-2xl mx-auto py-4">
            <TaskList />
          </div>
        )}

        {activeTab === 'analytics' && (
          <div className="max-w-3xl mx-auto py-4 space-y-6">
            <AnalyticsCard />
            <DesktopAppTracker />
          </div>
        )}
      </main>

      {/* Modals */}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <StudyLogModal />
    </div>
  );
}
