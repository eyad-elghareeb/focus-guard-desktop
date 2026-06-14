'use client';

import { useFocusGuardStore } from '@/lib/store';
import { formatTime, getGreeting, getTodayKey, generateFaviconUrl } from '@/lib/helpers';
import { FOCUS_MESSAGES } from '@/lib/types';
import { useMemo, useEffect, useState, useCallback } from 'react';

export function TimerRing() {
  const timer = useFocusGuardStore(s => s.timer);
  const settings = useFocusGuardStore(s => s.settings);
  const [tick, setTick] = useState(0);

  // Tick the timer every second
  useEffect(() => {
    const interval = setInterval(() => {
      const state = useFocusGuardStore.getState();
      if (state.timer.isRunning && !state.timer.isPaused) {
        state.tickTimer();
      }
      setTick(t => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const progress = timer.totalSeconds > 0
    ? (timer.totalSeconds - timer.remainingSeconds) / timer.totalSeconds
    : 0;

  const circumference = 2 * Math.PI * 115;
  const offset = circumference - progress * circumference;

  const gradientId = useMemo(() => {
    if (timer.mode === 'work') return 'workGradient';
    if (timer.mode === 'short_break') return 'breakGradient';
    return 'longBreakGradient';
  }, [timer.mode]);

  const modeLabel = useMemo(() => {
    if (timer.mode === 'work') return 'FOCUS TIME';
    if (timer.mode === 'short_break') return 'SHORT BREAK';
    return 'LONG BREAK';
  }, [timer.mode]);

  const focusMessage = useMemo(() => {
    const messages = !timer.isRunning
      ? FOCUS_MESSAGES.idle
      : timer.isPaused
        ? FOCUS_MESSAGES.paused
        : timer.mode === 'work'
          ? FOCUS_MESSAGES.work
          : FOCUS_MESSAGES.break;
    return messages[Math.floor(Date.now() / 30000) % messages.length];
  }, [timer.isRunning, timer.isPaused, timer.mode, tick]);

  const todayStats = useFocusGuardStore(s => s.dailyStats[getTodayKey()]);
  const dailyGoalSeconds = settings.dailyGoalMinutes * 60;
  const dailyProgress = todayStats
    ? Math.min(1, todayStats.totalWork / dailyGoalSeconds)
    : 0;

  const isBreakMode = timer.mode !== 'work';

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Mode Buttons */}
      <div className="flex items-center gap-2">
        <button
          className={`fg-mode-btn ${timer.mode === 'work' ? 'active focus-mode' : ''}`}
          onClick={() => useFocusGuardStore.getState().setTimerMode('work')}
        >
          <svg width="14" height="14" viewBox="0 0 28 28" fill="none">
            <circle cx="14" cy="14" r="12" stroke="currentColor" strokeWidth="2.5"/>
            <path d="M14 7v7l4.5 3" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
          </svg>
          Focus
        </button>
        <button
          className={`fg-mode-btn ${timer.mode === 'short_break' ? 'active short-break-mode' : ''}`}
          onClick={() => useFocusGuardStore.getState().setTimerMode('short_break')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          Short Break
        </button>
        <button
          className={`fg-mode-btn ${timer.mode === 'long_break' ? 'active long-break-mode' : ''}`}
          onClick={() => useFocusGuardStore.getState().setTimerMode('long_break')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M17 18a5 5 0 0 0-10 0"/>
            <line x1="12" y1="9" x2="12" y2="2"/>
            <line x1="4.22" y1="10.22" x2="5.64" y2="11.64"/>
            <line x1="1" y1="18" x2="3" y2="18"/>
            <line x1="21" y1="18" x2="23" y2="18"/>
            <line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/>
            <line x1="23" y1="22" x2="1" y2="22"/>
          </svg>
          Long Break
        </button>
      </div>

      {/* Timer Ring */}
      <div className="relative flex items-center justify-center" style={{ width: 260, height: 260 }}>
        <svg width="260" height="260" viewBox="0 0 260 260" className="absolute">
          <defs>
            <linearGradient id="workGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ef4444"/>
              <stop offset="100%" stopColor="#f97316"/>
            </linearGradient>
            <linearGradient id="breakGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#10b981"/>
              <stop offset="100%" stopColor="#06b6d4"/>
            </linearGradient>
            <linearGradient id="longBreakGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#06b6d4"/>
              <stop offset="100%" stopColor="#8b5cf6"/>
            </linearGradient>
          </defs>
          <circle cx="130" cy="130" r="115" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="8"/>
          <circle
            cx="130" cy="130" r="115"
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform="rotate(-90 130 130)"
            className="fg-timer-ring"
          />
        </svg>
        <div className="flex flex-col items-center gap-1 z-10">
          <span className="font-extrabold tracking-tighter" style={{ fontSize: 52, letterSpacing: -2, fontVariantNumeric: 'tabular-nums' }}>
            {formatTime(timer.remainingSeconds)}
          </span>
          <span className="font-bold uppercase tracking-widest" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {modeLabel}
          </span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4">
        <button className="fg-control-btn" onClick={() => useFocusGuardStore.getState().resetTimer()} title="Reset">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="1 4 1 10 7 10"/>
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
          </svg>
        </button>
        <button
          className={`fg-control-btn play-btn ${isBreakMode ? 'break-mode' : ''}`}
          onClick={() => {
            const state = useFocusGuardStore.getState();
            if (!state.timer.isRunning) state.startTimer();
            else if (state.timer.isPaused) state.resumeTimer();
            else state.pauseTimer();
          }}
          title={timer.isRunning && !timer.isPaused ? 'Pause' : 'Play'}
        >
          {timer.isRunning && !timer.isPaused ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1"/>
              <rect x="14" y="4" width="4" height="16" rx="1"/>
            </svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
          )}
        </button>
        <button className="fg-control-btn" onClick={() => useFocusGuardStore.getState().skipTimer()} title="Skip">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polygon points="5 4 15 12 5 20 5 4"/>
            <line x1="19" y1="5" x2="19" y2="19"/>
          </svg>
        </button>
      </div>

      {/* Pomodoro Dots */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          {Array.from({ length: settings.longBreakInterval }).map((_, i) => (
            <div
              key={i}
              className="rounded-full"
              style={{
                width: 10, height: 10,
                background: i < (timer.completedPomodoros % settings.longBreakInterval)
                  ? isBreakMode ? 'var(--green)' : 'var(--red)'
                  : 'var(--text-faint)',
                transition: 'background 0.3s var(--ease)',
              }}
            />
          ))}
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {timer.completedPomodoros % settings.longBreakInterval} / {settings.longBreakInterval}
        </span>
      </div>

      {/* Focus Message */}
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', maxWidth: 300 }}>
        {focusMessage}
      </p>

      {/* Daily Goal Progress */}
      <div className="flex flex-col items-center gap-2 w-full max-w-xs">
        <div className="flex items-center justify-between w-full">
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Daily Goal
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            {Math.round(dailyProgress * 100)}%
          </span>
        </div>
        <div className="fg-progress-track w-full">
          <div className={`fg-progress-fill ${isBreakMode ? 'break-mode' : ''}`} style={{ width: `${dailyProgress * 100}%` }} />
        </div>
      </div>
    </div>
  );
}
