'use client';

import { useFocusGuardStore } from '@/lib/store';
import { formatDuration, getTodayKey, getWeekDates, getMonthDates, getDayName, getShortDate, generateFaviconUrl } from '@/lib/helpers';
import { useState } from 'react';

type PeriodTab = 'day' | 'week' | 'month';

export function AnalyticsCard() {
  const [period, setPeriod] = useState<PeriodTab>('week');
  const dailyStats = useFocusGuardStore(s => s.dailyStats);
  const siteUsage = useFocusGuardStore(s => s.siteUsage);
  const studyLog = useFocusGuardStore(s => s.studyLog);
  const timer = useFocusGuardStore(s => s.timer);
  const [logDate, setLogDate] = useState(getTodayKey());

  const todayKey = getTodayKey();

  // Compute chart data directly (React Compiler handles optimization)
  const chartDates = period === 'day'
    ? [todayKey]
    : period === 'week'
      ? getWeekDates()
      : getMonthDates();

  const chartData = chartDates.map(date => ({
    date,
    label: period === 'month' ? getShortDate(date) : getDayName(date),
    value: (dailyStats[date] || { totalWork: 0 }).totalWork,
  }));

  const maxValue = Math.max(...chartData.map(d => d.value), 3600);

  // Quick stats
  const dates = period === 'day' ? [todayKey] : period === 'week' ? getWeekDates() : getMonthDates();
  let totalWork = 0;
  let totalPomodoros = 0;
  dates.forEach(date => {
    const s = dailyStats[date];
    if (s) {
      totalWork += s.totalWork;
      totalPomodoros += s.pomodoros;
    }
  });
  const avgSession = totalPomodoros > 0 ? Math.round(totalWork / totalPomodoros) : 0;
  const quickStats = {
    focusTime: totalWork,
    pomodoros: totalPomodoros,
    avgSession,
    bestStreak: timer.bestStreak,
  };

  // Top sites for today
  const todayUsage = siteUsage[todayKey] || {};
  const todaySiteUsage = Object.entries(todayUsage)
    .sort((a, b) => b[1].totalSeconds - a[1].totalSeconds)
    .slice(0, 6);

  // Study log for selected date
  const dateStudyLog = studyLog.filter(e => e.date === logDate).slice(0, 50);
  const totalLogTime = dateStudyLog.reduce((sum, e) => sum + e.duration, 0);

  return (
    <div className="flex flex-col gap-4">
      {/* Analytics Card */}
      <div className="fg-glass p-5">
        {/* Period Tabs */}
        <div className="flex items-center gap-2 mb-5">
          {(['day', 'week', 'month'] as PeriodTab[]).map(p => (
            <button
              key={p}
              className={`fg-tab-btn ${period === p ? 'active' : ''}`}
              onClick={() => setPeriod(p)}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-4 gap-2 mb-5">
          <div className="fg-stat">
            <span className="value">{formatDuration(quickStats.focusTime)}</span>
            <span className="label">Focus Time</span>
          </div>
          <div className="fg-stat">
            <span className="value">{quickStats.pomodoros}</span>
            <span className="label">Pomodoros</span>
          </div>
          <div className="fg-stat">
            <span className="value">{formatDuration(quickStats.avgSession)}</span>
            <span className="label">Avg/Session</span>
          </div>
          <div className="fg-stat">
            <span className="value">{quickStats.bestStreak}</span>
            <span className="label">Best Streak</span>
          </div>
        </div>

        {/* Bar Chart */}
        <div className="flex items-end gap-1" style={{ height: 140 }}>
          {chartData.map((d) => (
            <div key={d.date} className="flex flex-col items-center flex-1 gap-1">
              <div
                className="fg-bar w-full"
                style={{
                  height: `${Math.max(4, (d.value / maxValue) * 120)}px`,
                  background: d.date === todayKey
                    ? 'linear-gradient(to top, #3b82f6, #06b6d4)'
                    : 'rgba(255,255,255,0.08)',
                }}
                title={`${d.label}: ${formatDuration(d.value)}`}
              />
              {period !== 'day' && (
                <span style={{ fontSize: 9, color: 'var(--text-faint)', fontWeight: 600 }}>
                  {d.label}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Site Usage Card */}
      <div className="fg-glass p-5">
        <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>
          Site Usage
        </h3>
        {todaySiteUsage.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-faint)', padding: '20px 0', textAlign: 'center' }}>
            No site usage data yet.
          </p>
        ) : (
          <div className="space-y-3">
            {todaySiteUsage.map(([domain, data]) => (
              <div key={domain} className="flex items-center gap-3">
                <img src={generateFaviconUrl(domain)} alt={domain} width={24} height={24} style={{ borderRadius: 6 }} />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{domain}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {formatDuration(data.totalSeconds)}
                    </span>
                  </div>
                  <div className="fg-progress-track mt-1">
                    <div
                      className="fg-progress-fill"
                      style={{
                        width: `${Math.min(100, (data.totalSeconds / (todaySiteUsage[0]?.[1].totalSeconds || 1)) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Study Log Card */}
      <div className="fg-glass p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
              Study Log
            </h3>
            <span className="fg-pill" style={{ background: 'var(--cyan-soft)', color: 'var(--cyan)', fontSize: 11 }}>
              {formatDuration(totalLogTime)}
            </span>
          </div>

          {/* Date navigator */}
          <div className="flex items-center gap-2">
            <button
              className="fg-control-btn"
              style={{ width: 28, height: 28 }}
              onClick={() => {
                const d = new Date(logDate + 'T12:00:00');
                d.setDate(d.getDate() - 1);
                setLogDate(d.toISOString().split('T')[0]);
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 80, textAlign: 'center' }}>
              {logDate === todayKey ? 'Today' : getShortDate(logDate)}
            </span>
            <button
              className="fg-control-btn"
              style={{ width: 28, height: 28 }}
              onClick={() => {
                const d = new Date(logDate + 'T12:00:00');
                d.setDate(d.getDate() + 1);
                const newKey = d.toISOString().split('T')[0];
                if (newKey <= todayKey) setLogDate(newKey);
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
            <button
              className="fg-btn fg-btn-ghost"
              style={{ padding: '4px 10px', fontSize: 12 }}
              onClick={() => {
                const event = new CustomEvent('openStudyLogModal');
                window.dispatchEvent(event);
              }}
            >
              Log Time
            </button>
          </div>
        </div>

        {/* Log Entries */}
        <div className="space-y-2 max-h-80 overflow-y-auto fg-scrollbar">
          {dateStudyLog.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--text-faint)', padding: '20px 0', textAlign: 'center' }}>
              No entries for this date.
            </p>
          )}
          {dateStudyLog.map(entry => (
            <StudyLogEntryRow key={entry.id} entry={entry} />
          ))}
        </div>
      </div>
    </div>
  );
}

function StudyLogEntryRow({ entry }: { entry: import('@/lib/types').StudyLogEntry }) {
  const deleteStudyLogEntry = useFocusGuardStore(s => s.deleteStudyLogEntry);
  const timer = useFocusGuardStore(s => s.timer);

  const sourceLabel = {
    timer: 'Completed',
    manual: 'Manual',
    reset: 'Reset',
    skip: 'Skipped',
  }[entry.source] || entry.source;

  const sourceClass = {
    timer: 'fg-source-completed',
    manual: 'fg-source-manual',
    reset: 'fg-source-reset',
    skip: 'fg-source-skip',
  }[entry.source] || 'fg-source-manual';

  const isActive = timer.isRunning && !timer.isPaused && timer.mode === 'work' && entry.source === 'timer';

  return (
    <div className="flex items-start gap-3 p-3 rounded-xl group" style={{ background: 'rgba(255,255,255,0.02)' }}>
      {/* Timeline dot */}
      <div className="flex-shrink-0 mt-1">
        {isActive ? (
          <div className="fg-pulse-dot" style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--red)' }} />
        ) : (
          <div style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--text-faint)' }} />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {entry.subject && (
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
              {entry.subject}
            </span>
          )}
          <span className={`fg-source-badge ${sourceClass}`}>
            {isActive && (
              <span className="fg-pulse-dot" style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 3, background: 'var(--red)', marginRight: 4 }} />
            )}
            {sourceLabel}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-1">
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {formatDuration(entry.duration)}
          </span>
          {entry.note && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {entry.note}
            </span>
          )}
          <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>
            {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>

      {/* Actions */}
      <button
        onClick={() => deleteStudyLogEntry(entry.id)}
        className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ color: 'var(--text-faint)' }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  );
}
