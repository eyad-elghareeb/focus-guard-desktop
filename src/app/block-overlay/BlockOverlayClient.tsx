'use client';

// FocusGuard Desktop — Block Overlay.
//
// Rendered inside the always-on-top "block-overlay" Tauri window. Visually
// matches the browser extension's blocked.html page: large blocked-app label,
// a random motivational quote, a live timer mirroring the work session, and an
// "Emergency access (5 min)" button that grants a 5-minute grace window and
// breaks the current pomodoro streak (same UX as the extension).

import { useEffect, useState } from 'react';
import { tauriInvoke, tauriListen } from '@/lib/tauri';
import { MOTIVATIONAL_QUOTES } from '@/lib/types';

interface ShowPayload {
  appName: string;
  windowTitle: string;
}

const QUOTE = MOTIVATIONAL_QUOTES[Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)];

export default function BlockOverlayClient() {
  const [appName, setAppName] = useState('');
  const [windowTitle, setWindowTitle] = useState('');
  const [visible, setVisible] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [emergencyActive, setEmergencyActive] = useState(false);

  // Receive show/hide commands from the Rust backend.
  useEffect(() => {
    const unlistenP = tauriListen<ShowPayload>('block-overlay-show', (payload) => {
      if (!payload) return;
      setAppName(payload.appName || '');
      setWindowTitle(payload.windowTitle || '');
      setVisible(true);
      setEmergencyActive(false);
    });

    // Hide via direct command (Rust hides the window itself, but we clear UI too).
    const unlistenHideP = tauriListen('hide-block-overlay', () => {
      setVisible(false);
      setEmergencyActive(false);
    });

    return () => {
      unlistenP.then(fn => fn?.());
      unlistenHideP.then(fn => fn?.());
    };
  }, []);

  // Mirror the work session's countdown. We pull the timer state from the
  // shared Zustand store (same localStorage the main window reads/writes).
  // For simplicity we re-read every second.
  useEffect(() => {
    let cancelled = false;
    const readTimer = () => {
      if (cancelled) return;
      try {
        const raw = localStorage.getItem('focusguard_data');
        if (!raw) return;
        const parsed = JSON.parse(raw);
        const timer = parsed?.state?.timer;
        if (timer && timer.isRunning && !timer.isPaused) {
          setRemaining(timer.remainingSeconds || 0);
        }
      } catch {
        /* ignore */
      }
    };
    readTimer();
    const i = setInterval(readTimer, 1000);
    return () => {
      cancelled = true;
      clearInterval(i);
    };
  }, [visible]);

  const handleEmergency = async () => {
    if (!confirming) {
      setConfirming(true);
      // Auto-cancel confirmation after 4 seconds.
      setTimeout(() => setConfirming(false), 4000);
      return;
    }
    // Confirmed — grant access.
    await tauriInvoke('grant_emergency_access', { appName });
    setEmergencyActive(true);
    setVisible(false);
    setConfirming(false);
  };

  const formatMMSS = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  if (!visible && !emergencyActive) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background:
          'radial-gradient(ellipse at center, rgba(127, 29, 29, 0.35) 0%, rgba(10, 10, 15, 0.98) 70%)',
        backdropFilter: 'blur(12px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#e5e7eb',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        zIndex: 9999,
      }}
    >
      {/* Background glow */}
      <div
        style={{
          position: 'absolute',
          width: 600,
          height: 600,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(239, 68, 68, 0.15) 0%, transparent 70%)',
          animation: 'fg-overlay-pulse 4s ease-in-out infinite',
        }}
      />

      <div
        style={{
          position: 'relative',
          maxWidth: 560,
          textAlign: 'center',
          padding: '48px 32px',
        }}
      >
        {/* Lock icon */}
        <div
          style={{
            width: 88,
            height: 88,
            margin: '0 auto 24px',
            borderRadius: '50%',
            background: 'rgba(239, 68, 68, 0.12)',
            border: '2px solid rgba(239, 68, 68, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>

        {/* Heading */}
        <h1 style={{ fontSize: 14, fontWeight: 600, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#fca5a5', margin: 0 }}>
          App Blocked
        </h1>

        {/* App name */}
        <p style={{ fontSize: 36, fontWeight: 800, margin: '12px 0 4px', color: '#fafafa' }}>
          {appName || 'This application'}
        </p>
        <p style={{ fontSize: 14, opacity: 0.6, margin: '0 0 8px' }}>
          is blocked during your focus session.
        </p>
        {windowTitle && (
          <p style={{ fontSize: 12, opacity: 0.4, fontStyle: 'italic', margin: '0 0 24px' }}>
            “{windowTitle}”
          </p>
        )}

        {/* Live timer */}
        {remaining > 0 && (
          <div style={{ margin: '24px 0' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.5 }}>
              Focus session remaining
            </div>
            <div
              style={{
                fontSize: 56,
                fontWeight: 200,
                fontVariantNumeric: 'tabular-nums',
                color: '#f87171',
                letterSpacing: '0.05em',
              }}
            >
              {formatMMSS(remaining)}
            </div>
          </div>
        )}

        {/* Quote */}
        <div
          style={{
            marginTop: 24,
            padding: '16px 20px',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 12,
          }}
        >
          <p style={{ fontSize: 15, fontStyle: 'italic', opacity: 0.85, margin: 0 }}>
            “{QUOTE.text}”
          </p>
          <p style={{ fontSize: 12, opacity: 0.5, margin: '8px 0 0' }}>— {QUOTE.author}</p>
        </div>

        {/* Emergency access button */}
        <div style={{ marginTop: 32 }}>
          <button
            onClick={handleEmergency}
            style={{
              padding: '12px 24px',
              borderRadius: 10,
              background: confirming ? 'rgba(239, 68, 68, 0.2)' : 'transparent',
              border: `1px solid ${confirming ? '#ef4444' : 'rgba(255,255,255,0.15)'}`,
              color: confirming ? '#ef4444' : '#9ca3af',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {confirming
              ? '⚠ This breaks your streak. Click again to confirm.'
              : 'Emergency access (5 min)'}
          </button>
          {!confirming && (
            <p style={{ fontSize: 11, opacity: 0.4, margin: '8px 0 0' }}>
              Switch back to FocusGuard to stay focused.
            </p>
          )}
        </div>
      </div>

      <style>{`
        @keyframes fg-overlay-pulse {
          0%, 100% { transform: scale(1); opacity: 0.5; }
          50% { transform: scale(1.1); opacity: 0.8; }
        }
      `}</style>
    </div>
  );
}
