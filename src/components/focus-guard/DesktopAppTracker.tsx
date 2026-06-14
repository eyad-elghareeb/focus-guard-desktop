'use client';

import { useFocusGuardStore } from '@/lib/store';
import { DesktopAppUsage } from '@/lib/types';
import { formatDuration, getTodayKey } from '@/lib/helpers';
import { isTauri, tauriInvoke, tauriListen } from '@/lib/tauri';
import { useEffect, useState, useMemo } from 'react';

// Demo data shown only in browser/dev mode (no Tauri backend).
const DEMO_APPS: DesktopAppUsage[] = [
  { appName: 'VS Code', windowTitle: 'main.ts - FocusGuard', totalSeconds: 5400, lastActive: Date.now(), category: 'development' },
  { appName: 'Firefox', windowTitle: 'GitHub', totalSeconds: 3200, lastActive: Date.now() - 60000, category: 'browser' },
  { appName: 'Terminal', windowTitle: 'npm run dev', totalSeconds: 2800, lastActive: Date.now() - 120000, category: 'development' },
  { appName: 'Slack', windowTitle: 'general', totalSeconds: 1200, lastActive: Date.now() - 300000, category: 'communication' },
  { appName: 'Spotify', windowTitle: 'Focus Playlist', totalSeconds: 3600, lastActive: Date.now() - 10000, category: 'entertainment' },
  { appName: 'Figma', windowTitle: 'Design System', totalSeconds: 1800, lastActive: Date.now() - 600000, category: 'design' },
];

const CATEGORY_ICONS: Record<string, string> = {
  development: '\u{1F4BB}',
  browser: '\u{1F310}',
  communication: '\u{1F4AC}',
  entertainment: '\u{1F3B5}',
  design: '\u{1F3A8}',
  productivity: '\u{1F4DD}',
  system: '\u{2699}\u{FE0F}',
  other: '\u{1F527}',
};

const CATEGORY_COLORS: Record<string, string> = {
  development: '#3b82f6',
  browser: '#8b5cf6',
  communication: '#f59e0b',
  entertainment: '#10b981',
  design: '#ec4899',
  productivity: '#06b6d4',
  system: '#6b7280',
  other: '#9ca3af',
};

/** Coerce a raw usage row (from Rust or store) into a safe DesktopAppUsage. */
function safeRow(raw: unknown): DesktopAppUsage | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const appName = typeof r.appName === 'string' ? r.appName.trim() : '';
  if (!appName) return null;
  return {
    appName,
    windowTitle: typeof r.windowTitle === 'string' ? r.windowTitle : '',
    totalSeconds: typeof r.totalSeconds === 'number' ? r.totalSeconds : 0,
    lastActive: typeof r.lastActive === 'number' ? r.lastActive : 0,
    category: typeof r.category === 'string' ? r.category : 'other',
  };
}

export function DesktopAppTracker() {
  // The polling loop (Rust) + sync bridge already push today's usage into the
  // store. Reading from there means this component re-renders exactly when
  // data changes — no 2s interval, no race with the backend.
  const storedToday = useFocusGuardStore(s => s.desktopAppUsage[getTodayKey()]);
  const blockedDesktopApps = useFocusGuardStore(s => s.blockedDesktopApps);
  const toggleBlockedDesktopApp = useFocusGuardStore(s => s.toggleBlockedDesktopApp);
  const timer = useFocusGuardStore(s => s.timer);
  const settings = useFocusGuardStore(s => s.settings);
  const extensionConnected = useFocusGuardStore(s => s.extensionConnected);
  const syncEnabled = useFocusGuardStore(s => s.syncEnabled);

  const [isTracking, setIsTracking] = useState(false);
  const [selectedApp, setSelectedApp] = useState<string | null>(null);
  // Extra apps the user has blocked but never focused today (kept in sync via
  // a lazy fetch of get_known_apps). Foreground-only tracking means we don't
  // dump every running process here anymore.
  const [extraKnownApps, setExtraKnownApps] = useState<{ name: string; category: string }[]>([]);

  // Whether blocking can be toggled right now (work-session active OR user has
  // already pinned blocks). Mirrors the extension's getBlockStatus logic.
  const blockActive = !!(
    timer.isRunning &&
    !timer.isPaused &&
    ((timer.mode === 'work' && settings.blockDuringWork) ||
      (timer.mode !== 'work' && settings.blockDuringBreaks))
  );

  // Boot: tell Rust to start tracking + what's blocked.
  useEffect(() => {
    if (!isTauri()) return;

    let cancelled = false;
    (async () => {
      await tauriInvoke('set_blocked_desktop_apps', { names: blockedDesktopApps });
      const ok = await tauriInvoke<boolean>('start_app_tracking');
      if (ok && !cancelled) setIsTracking(true);

      // One-shot seed of "known apps I've blocked but never focused today".
      const apps = await tauriInvoke<{ name: string; category: string }[]>('get_known_apps');
      if (apps && !cancelled) {
        setExtraKnownApps(
          apps
            .map(a => ({
              name: typeof a?.name === 'string' ? a.name : '',
              category: typeof a?.category === 'string' ? a.category : 'other',
            }))
            .filter(a => a.name.trim()),
        );
      }
    })();

    const unlistenP = tauriListen<{ appName: string }>('emergency-access-granted', () => {
      setSelectedApp(null);
    });

    return () => {
      cancelled = true;
      tauriInvoke('stop_app_tracking');
      unlistenP.then(fn => fn?.());
    };
  }, []);

  // Keep Rust's block list in sync whenever the user toggles a block.
  useEffect(() => {
    if (isTauri()) {
      tauriInvoke('set_blocked_desktop_apps', { names: blockedDesktopApps });
    }
  }, [blockedDesktopApps]);

  // Pull today's rows from the store (heartbeat-fed), with a defensive filter.
  const appUsage = useMemo<DesktopAppUsage[]>(() => {
    if (!isTauri()) return DEMO_APPS;
    if (!Array.isArray(storedToday)) return [];
    return storedToday.map(safeRow).filter((r): r is DesktopAppUsage => r !== null);
  }, [storedToday]);

  const totalTrackedTime = useMemo(
    () => appUsage.reduce((s, a) => s + a.totalSeconds, 0),
    [appUsage],
  );

  const sortedApps = useMemo(
    () => [...appUsage].sort((a, b) => b.totalSeconds - a.totalSeconds),
    [appUsage],
  );

  const maxTime = sortedApps.length > 0 ? sortedApps[0].totalSeconds : 1;

  const categoryBreakdown = useMemo(() => {
    const cats: Record<string, number> = {};
    appUsage.forEach(app => {
      cats[app.category] = (cats[app.category] || 0) + app.totalSeconds;
    });
    return Object.entries(cats).sort((a, b) => b[1] - a[1]);
  }, [appUsage]);

  // Merge tracked apps with extras the user has explicitly blocked (so they
  // can unblock them even without time-on-app). Dedup case-insensitively.
  const allKnownApps = useMemo(() => {
    const tracked = new Set(appUsage.map(a => a.appName.toLowerCase()));
    const extras = extraKnownApps
      .map(e => ({
        appName: e.name,
        category: e.category || 'other',
        totalSeconds: 0,
        windowTitle: '',
        lastActive: 0,
      }))
      .filter(e => !tracked.has(e.appName.toLowerCase()));
    return [...appUsage, ...extras];
  }, [appUsage, extraKnownApps]);

  const isBlocked = (name: string) => {
    if (!name || typeof name !== 'string') return false;
    const lowered = name.toLowerCase();
    return blockedDesktopApps.some(
      b => typeof b === 'string' && b.toLowerCase() === lowered,
    );
  };

  return (
    <div className="fg-glass p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
            Desktop Apps
          </h3>
          <span className="fg-pill" style={{ background: 'var(--cyan-soft)', color: 'var(--cyan)', fontSize: 11 }}>
            {formatDuration(totalTrackedTime)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isTracking && (
            <span className="fg-desktop-indicator">
              <span className="fg-pulse-dot" style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--green)' }} />
              Tracking
            </span>
          )}
          {extensionConnected && syncEnabled && (
            <span className="fg-sync-indicator fg-sync-connected" style={{ fontSize: 10 }}>
              Synced
            </span>
          )}
        </div>
      </div>

      {/* Block-mode banner */}
      <div className="mb-3" style={{
        padding: '6px 10px',
        borderRadius: 8,
        background: blockActive ? 'rgba(239, 68, 68, 0.08)' : 'var(--bg-elevated)',
        border: `1px solid ${blockActive ? 'rgba(239, 68, 68, 0.3)' : 'var(--border)'}`,
        fontSize: 11,
        color: blockActive ? 'var(--red)' : 'var(--text-muted)',
      }}>
        {blockActive
          ? '🚫 Blocking active — toggled apps will be overlaid during your session.'
          : '⏸ Blocking inactive — start a focus session to enforce blocks.'}
      </div>

      {/* App List */}
      <div className="space-y-2">
        {sortedApps.length === 0 && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', padding: '12px 0', textAlign: 'center' }}>
            {isTauri() ? 'Tracking foreground apps… switch windows to populate.' : 'No tracked apps yet.'}
          </p>
        )}
        {allKnownApps.map(app => {
          const color = CATEGORY_COLORS[app.category] || CATEGORY_COLORS.other;
          const icon = CATEGORY_ICONS[app.category] || CATEGORY_ICONS.other;
          const barWidth = maxTime > 0 ? (app.totalSeconds / maxTime) * 100 : 0;
          const blocked = isBlocked(app.appName);

          return (
            <div
              key={app.appName}
              className="p-3 rounded-xl transition-all"
              style={{
                background: selectedApp === app.appName ? 'var(--bg-card-hover)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${blocked ? 'rgba(239, 68, 68, 0.4)' : selectedApp === app.appName ? 'var(--border-hover)' : 'transparent'}`,
              }}
            >
              <div className="flex items-center gap-3">
                {/* App Icon */}
                <div
                  className="flex items-center justify-center flex-shrink-0"
                  style={{ width: 32, height: 32, borderRadius: 8, background: `${color}20`, fontSize: 14 }}
                >
                  {icon}
                </div>

                {/* App Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {app.appName}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {app.totalSeconds > 0 ? formatDuration(app.totalSeconds) : '—'}
                    </span>
                  </div>
                  {/* Progress bar */}
                  <div className="fg-progress-track mt-1">
                    <div
                      style={{
                        height: '100%',
                        borderRadius: 3,
                        width: `${barWidth}%`,
                        background: blocked ? 'var(--red)' : color,
                        opacity: 0.7,
                        transition: 'width 0.5s var(--ease)',
                      }}
                    />
                  </div>
                </div>

                {/* Block toggle */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleBlockedDesktopApp(app.appName);
                  }}
                  title={blocked ? 'Unblock app' : 'Block app during focus sessions'}
                  style={{
                    width: 32, height: 32, borderRadius: 8,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: blocked ? 'rgba(239, 68, 68, 0.15)' : 'transparent',
                    border: `1px solid ${blocked ? 'rgba(239, 68, 68, 0.5)' : 'var(--border)'}`,
                    color: blocked ? 'var(--red)' : 'var(--text-muted)',
                    cursor: 'pointer',
                    transition: 'all 0.2s var(--ease)',
                  }}
                >
                  {blocked ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <circle cx="12" cy="12" r="10" />
                    </svg>
                  )}
                </button>
              </div>

              {/* Expanded details */}
              {selectedApp === app.appName && (
                <div className="mt-2 pl-11" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {app.windowTitle && <p>{app.windowTitle}</p>}
                  {app.lastActive > 0 && (
                    <p className="mt-1">
                      Last active: {new Date(app.lastActive).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  )}
                </div>
              )}

              {/* Click target row (click anywhere on the row except the toggle to expand) */}
              <div
                style={{ cursor: 'pointer', marginTop: '-44px', height: 44, position: 'relative', zIndex: 0 }}
                onClick={() => setSelectedApp(selectedApp === app.appName ? null : app.appName)}
              />
            </div>
          );
        })}
      </div>

      {/* Category Breakdown */}
      {categoryBreakdown.length > 0 && (
        <div className="mt-4 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-3">
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
              Categories
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {categoryBreakdown.map(([cat, time]) => (
              <span key={cat} className="fg-pill" style={{
                background: `${CATEGORY_COLORS[cat] || CATEGORY_COLORS.other}20`,
                color: CATEGORY_COLORS[cat] || CATEGORY_COLORS.other,
                fontSize: 11,
              }}>
                {CATEGORY_ICONS[cat] || CATEGORY_ICONS.other} {cat} ({formatDuration(time)})
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Note */}
      <div className="mt-4 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
        <p style={{ fontSize: 10, color: 'var(--text-faint)', lineHeight: 1.5 }}>
          Foreground-only tracking: only apps you actually use appear here. OS services are excluded.{' '}
          {!isTauri() && '(Running in demo mode — launch the desktop app for real tracking.)'}
        </p>
      </div>
    </div>
  );
}
