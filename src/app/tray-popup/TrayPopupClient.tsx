'use client';

// FocusGuard Desktop — Tray Popup.
//
// Mirrors the browser extension's toolbar popup: compact ring timer with
// play/pause/reset/skip controls, today's stats, and an "Open Dashboard"
// button. Reads the shared Zustand store (localStorage) so changes here are
// instantly visible in the main window and synced to extensions.

import { useEffect, useState } from 'react';
import { useFocusGuardStore } from '@/lib/store';
import { getTodayKey, formatDuration } from '@/lib/helpers';
import { tauriInvoke } from '@/lib/tauri';

const MODE_LABELS: Record<string, { label: string; color: string }> = {
  work: { label: 'FOCUS', color: '#ef4444' },
  short_break: { label: 'SHORT BREAK', color: '#10b981' },
  long_break: { label: 'LONG BREAK', color: '#06b6d4' },
};

const RING_CIRCUMFERENCE = 2 * Math.PI * 52; // r=52

export default function TrayPopupClient() {
  const timer = useFocusGuardStore(s => s.timer);
  const startTimer = useFocusGuardStore(s => s.startTimer);
  const pauseTimer = useFocusGuardStore(s => s.pauseTimer);
  const resumeTimer = useFocusGuardStore(s => s.resumeTimer);
  const resetTimer = useFocusGuardStore(s => s.resetTimer);
  const skipTimer = useFocusGuardStore(s => s.skipTimer);
  const dailyStats = useFocusGuardStore(s => s.dailyStats);
  const extensionConnected = useFocusGuardStore(s => s.extensionConnected);

  const [now, setNow] = useState(Date.now());

  // Tick once a second so the popup's timer counts down even if the store
  // wasn't notified (defensive — the main window's tickTimer drives updates).
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);

    // Hide popup when it loses focus (mirrors extension popup behaviour).
    const onBlur = () => {
      // Slight delay so button clicks inside the popup don't immediately close it.
      setTimeout(() => {
        if (!document.hasFocus()) tauriInvoke('hide_tray_popup');
      }, 200);
    };
    window.addEventListener('blur', onBlur);
    return () => {
      clearInterval(i);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // Effective remaining: if running & not paused, compute from lastTick.
  const isWork = timer.mode === 'work';
  const effectiveRemaining =
    timer.isRunning && !timer.isPaused && timer.lastTick
      ? Math.max(0, timer.remainingSeconds - Math.floor((now - timer.lastTick) / 1000))
      : timer.remainingSeconds;

  const mm = Math.floor(effectiveRemaining / 60);
  const ss = effectiveRemaining % 60;
  const timeText = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;

  const progress = timer.totalSeconds > 0 ? 1 - effectiveRemaining / timer.totalSeconds : 0;
  const ringOffset = RING_CIRCUMFERENCE * (1 - progress);

  const mode = MODE_LABELS[timer.mode] || MODE_LABELS.work;

  const todayStats = dailyStats[getTodayKey()] || { totalWork: 0, totalBreak: 0, pomodoros: 0 };

  const handlePlayPause = () => {
    if (!timer.isRunning) startTimer();
    else if (timer.isPaused) resumeTimer();
    else pauseTimer();
  };

  const openDashboard = async () => {
    await tauriInvoke('show_main_window');
    await tauriInvoke('hide_tray_popup');
  };

  return (
    <div
      style={{
        width: 320,
        height: 440,
        background: '#0a0a0f',
        color: '#e5e7eb',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: 20,
        boxSizing: 'border-box',
        borderRadius: 12,
        overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      {/* Header */}
      <div
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="18" height="18" viewBox="0 0 28 28" fill="none" style={{ color: '#ef4444' }}>
            <circle cx="14" cy="14" r="12" stroke="currentColor" strokeWidth="2.5" />
            <path d="M14 7v7l4.5 3" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          <span style={{ fontSize: 14, fontWeight: 700 }}>FocusGuard</span>
        </div>
        <div
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.1em',
            color: mode.color,
            padding: '2px 8px',
            background: `${mode.color}15`,
            borderRadius: 6,
            border: `1px solid ${mode.color}30`,
          }}
        >
          {mode.label}
        </div>
      </div>

      {/* Timer ring */}
      <div style={{ position: 'relative', width: 160, height: 160, marginBottom: 16 }}>
        <svg width="160" height="160" viewBox="0 0 120 120" style={{ transform: 'rotate(-90deg)' }}>
          <defs>
            <linearGradient id="popupGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              {isWork ? (
                <>
                  <stop offset="0%" stopColor="#ef4444" />
                  <stop offset="100%" stopColor="#f97316" />
                </>
              ) : (
                <>
                  <stop offset="0%" stopColor="#10b981" />
                  <stop offset="100%" stopColor="#06b6d4" />
                </>
              )}
            </linearGradient>
          </defs>
          <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
          <circle
            cx="60"
            cy="60"
            r="52"
            fill="none"
            stroke="url(#popupGrad)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={ringOffset}
            style={{ transition: 'stroke-dashoffset 0.5s linear' }}
          />
        </svg>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span
            style={{
              fontSize: 32,
              fontWeight: 200,
              fontVariantNumeric: 'tabular-nums',
              color: '#fafafa',
            }}
          >
            {timeText}
          </span>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 18 }}>
        <button
          onClick={resetTimer}
          title="Reset"
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'transparent',
            color: '#9ca3af',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
        </button>
        <button
          onClick={handlePlayPause}
          title={timer.isRunning && !timer.isPaused ? 'Pause' : 'Start'}
          style={{
            width: 52,
            height: 52,
            borderRadius: '50%',
            border: 'none',
            background: isWork
              ? 'linear-gradient(135deg, #ef4444, #f97316)'
              : 'linear-gradient(135deg, #10b981, #06b6d4)',
            color: 'white',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 16px rgba(239, 68, 68, 0.3)',
          }}
        >
          {timer.isRunning && !timer.isPaused ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="6,3 20,12 6,21" />
            </svg>
          )}
        </button>
        <button
          onClick={skipTimer}
          title="Skip"
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'transparent',
            color: '#9ca3af',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polygon points="5,4 15,12 5,20" fill="currentColor" />
            <line x1="19" y1="5" x2="19" y2="19" />
          </svg>
        </button>
      </div>

      {/* Stats */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-around',
          width: '100%',
          padding: '12px 0',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          marginBottom: 16,
        }}
      >
        <Stat value={formatDuration(todayStats.totalWork)} label="Today" />
        <Divider />
        <Stat value={String(timer.currentStreak)} label="Streak" />
        <Divider />
        <Stat value={String(todayStats.pomodoros)} label="Done" />
      </div>

      {/* Footer */}
      <button
        onClick={openDashboard}
        style={{
          width: '100%',
          padding: '10px 16px',
          borderRadius: 8,
          border: '1px solid rgba(255,255,255,0.1)',
          background: 'rgba(255,255,255,0.03)',
          color: '#e5e7eb',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
        }}
      >
        Open Dashboard
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="9,18 15,12 9,6" />
        </svg>
      </button>

      {extensionConnected && (
        <div style={{ marginTop: 8, fontSize: 10, color: '#10b981', display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} />
          Synced with browser
        </div>
      )}
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#fafafa' }}>{value}</div>
      <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#6b7280' }}>
        {label}
      </div>
    </div>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.06)' }} />;
}
