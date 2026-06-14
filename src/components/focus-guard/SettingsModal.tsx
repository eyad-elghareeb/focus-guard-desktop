'use client';

import { useFocusGuardStore } from '@/lib/store';
import { Settings, DEFAULT_SETTINGS, CATEGORY_EMOJIS } from '@/lib/types';
import { useState, useRef } from 'react';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const settings = useFocusGuardStore(s => s.settings);
  const updateSettings = useFocusGuardStore(s => s.updateSettings);
  const blockedSites = useFocusGuardStore(s => s.blockedSites);
  const addBlockedSite = useFocusGuardStore(s => s.addBlockedSite);
  const removeBlockedSite = useFocusGuardStore(s => s.removeBlockedSite);
  const toggleBlockedSite = useFocusGuardStore(s => s.toggleBlockedSite);
  const clearAllData = useFocusGuardStore(s => s.clearAllData);
  const exportData = useFocusGuardStore(s => s.exportData);
  const importData = useFocusGuardStore(s => s.importData);
  const extensionConnected = useFocusGuardStore(s => s.extensionConnected);
  const syncEnabled = useFocusGuardStore(s => s.syncEnabled);
  const setSyncEnabled = useFocusGuardStore(s => s.setSyncEnabled);

  const [newSiteDomain, setNewSiteDomain] = useState('');
  const [newSiteCategory, setNewSiteCategory] = useState('custom');
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const handleExport = () => {
    const data = exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `focusguard-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        importData(data);
      } catch {
        alert('Invalid backup file');
      }
    };
    reader.readAsText(file);
  };

  const handleAddSite = () => {
    if (!newSiteDomain.trim()) return;
    let domain = newSiteDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    addBlockedSite({ domain, enabled: true, category: newSiteCategory });
    setNewSiteDomain('');
  };

  const handleReset = () => {
    clearAllData();
    setShowResetConfirm(false);
    onClose();
  };

  const blockActive = settings.blockDuringWork || settings.blockDuringBreaks;

  return (
    <div className="fg-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="fg-modal fg-scrollbar">
        <div className="flex items-center justify-between mb-4">
          <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>Settings</h2>
          <button onClick={onClose} style={{ color: 'var(--text-muted)', fontSize: 20 }}>&times;</button>
        </div>

        {/* Timer Durations */}
        <div className="fg-settings-section">
          <h4 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 12 }}>
            Timer Durations
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <SettingsStepper
              label="Focus (min)"
              value={Math.round(settings.workDuration / 60)}
              onChange={v => updateSettings({ workDuration: v * 60 })}
              min={1} max={120}
            />
            <SettingsStepper
              label="Short Break (min)"
              value={Math.round(settings.shortBreakDuration / 60)}
              onChange={v => updateSettings({ shortBreakDuration: v * 60 })}
              min={1} max={60}
            />
            <SettingsStepper
              label="Long Break (min)"
              value={Math.round(settings.longBreakDuration / 60)}
              onChange={v => updateSettings({ longBreakDuration: v * 60 })}
              min={1} max={60}
            />
            <SettingsStepper
              label="Long Break After"
              value={settings.longBreakInterval}
              onChange={v => updateSettings({ longBreakInterval: v })}
              min={2} max={10}
            />
          </div>
        </div>

        {/* Daily Goal */}
        <div className="fg-settings-section">
          <h4 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 12 }}>
            Daily Goal
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <SettingsStepper
              label="Hours"
              value={Math.floor(settings.dailyGoalMinutes / 60)}
              onChange={v => updateSettings({ dailyGoalMinutes: v * 60 + (settings.dailyGoalMinutes % 60) })}
              min={0} max={24}
            />
            <SettingsStepper
              label="Minutes"
              value={settings.dailyGoalMinutes % 60}
              onChange={v => updateSettings({ dailyGoalMinutes: Math.floor(settings.dailyGoalMinutes / 60) * 60 + v })}
              min={0} max={59}
            />
          </div>
        </div>

        {/* Automation */}
        <div className="fg-settings-section">
          <h4 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 12 }}>
            Automation
          </h4>
          <div className="space-y-3">
            <SettingsToggle
              label="Auto-start Breaks"
              description="Automatically start break timer after focus session"
              value={settings.autoStartBreaks}
              onChange={v => updateSettings({ autoStartBreaks: v })}
            />
            <SettingsToggle
              label="Auto-start Focus"
              description="Automatically start focus timer after break"
              value={settings.autoStartWork}
              onChange={v => updateSettings({ autoStartWork: v })}
            />
          </div>
        </div>

        {/* Site Blocking */}
        <div className="fg-settings-section">
          <h4 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 12 }}>
            Site Blocking
          </h4>
          <div className="space-y-3 mb-3">
            <SettingsToggle
              label="Block during Focus"
              description="Block distracting sites during focus sessions"
              value={settings.blockDuringWork}
              onChange={v => updateSettings({ blockDuringWork: v })}
            />
            <SettingsToggle
              label="Block during Breaks"
              description="Block distracting sites during break sessions"
              value={settings.blockDuringBreaks}
              onChange={v => updateSettings({ blockDuringBreaks: v })}
            />
          </div>

          {blockActive && (
            <>
              <div className="flex items-center gap-2 mb-3">
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Blocked Sites
                </span>
                <span className={`fg-pill ${blockedSites.some(s => s.enabled) ? '' : ''}`}
                  style={{
                    background: blockedSites.some(s => s.enabled) ? 'var(--green-soft)' : 'var(--amber-soft)',
                    color: blockedSites.some(s => s.enabled) ? 'var(--green)' : 'var(--amber)',
                    fontSize: 10,
                  }}
                >
                  {blockedSites.some(s => s.enabled) ? 'Active' : 'Off'}
                </span>
              </div>

              {/* Site Chips */}
              <div className="flex flex-wrap gap-2 mb-3">
                {blockedSites.map(site => (
                  <div key={site.domain} className="fg-site-chip group">
                    <span className="fg-category-emoji">{CATEGORY_EMOJIS[site.category] || '\u{1F527}'}</span>
                    <span>{site.domain}</span>
                    <button
                      onClick={() => toggleBlockedSite(site.domain)}
                      style={{
                        width: 8, height: 8, borderRadius: 4,
                        background: site.enabled ? 'var(--green)' : 'var(--text-faint)',
                        transition: 'background 0.2s var(--ease)',
                      }}
                    />
                    <button
                      onClick={() => removeBlockedSite(site.domain)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ color: 'var(--text-faint)', fontSize: 10 }}
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>

              {/* Add Site */}
              <div className="flex gap-2">
                <input
                  className="fg-input"
                  placeholder="Add site (e.g. reddit.com)"
                  value={newSiteDomain}
                  onChange={e => setNewSiteDomain(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddSite()}
                />
                <select
                  value={newSiteCategory}
                  onChange={e => setNewSiteCategory(e.target.value)}
                  className="fg-input"
                  style={{ width: 120 }}
                >
                  {Object.entries(CATEGORY_EMOJIS).map(([cat, emoji]) => (
                    <option key={cat} value={cat}>{emoji} {cat}</option>
                  ))}
                </select>
                <button className="fg-btn fg-btn-primary" onClick={handleAddSite}>Add</button>
              </div>
            </>
          )}
        </div>

        {/* Notifications */}
        <div className="fg-settings-section">
          <h4 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 12 }}>
            Notifications
          </h4>
          <div className="space-y-3">
            <SettingsToggle
              label="Desktop Notifications"
              description="Show desktop notifications on session completion"
              value={settings.notificationsEnabled}
              onChange={v => updateSettings({ notificationsEnabled: v })}
            />
            <SettingsToggle
              label="Sound Alerts"
              description="Play a sound when session completes"
              value={settings.soundEnabled}
              onChange={v => updateSettings({ soundEnabled: v })}
            />
          </div>
        </div>

        {/* Extension Sync */}
        <div className="fg-settings-section">
          <h4 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 12 }}>
            Extension Sync
          </h4>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className={`fg-sync-indicator ${extensionConnected ? 'fg-sync-connected' : 'fg-sync-disconnected'}`}>
                <span style={{ width: 6, height: 6, borderRadius: 3, background: extensionConnected ? 'var(--green)' : 'var(--amber)' }} />
                {extensionConnected ? 'Connected' : 'Not Connected'}
              </span>
            </div>
            <SettingsToggle
              label="Enable Sync"
              description="Sync data between desktop app and Firefox extension"
              value={syncEnabled}
              onChange={v => setSyncEnabled(v)}
            />
          </div>
        </div>

        {/* Data Management */}
        <div className="fg-settings-section">
          <h4 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 12 }}>
            Data Management
          </h4>
          <div className="flex gap-3 mb-3">
            <button className="fg-btn fg-btn-ghost" onClick={handleExport}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Export Data
            </button>
            <button className="fg-btn fg-btn-ghost" onClick={handleImport}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              Import Data
            </button>
            <input ref={fileInputRef} type="file" accept=".json" onChange={handleFileChange} style={{ display: 'none' }} />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4" style={{ borderTop: '1px solid var(--border)' }}>
          {!showResetConfirm ? (
            <button className="fg-btn fg-btn-danger" onClick={() => setShowResetConfirm(true)}>
              Reset Data
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 12, color: 'var(--red)' }}>Are you sure?</span>
              <button className="fg-btn fg-btn-danger" onClick={handleReset} style={{ padding: '4px 10px', fontSize: 12 }}>Yes</button>
              <button className="fg-btn fg-btn-ghost" onClick={() => setShowResetConfirm(false)} style={{ padding: '4px 10px', fontSize: 12 }}>No</button>
            </div>
          )}
          <button className="fg-btn fg-btn-primary" onClick={onClose}>
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}

// Sub-components

function SettingsStepper({ label, value, onChange, min, max }: {
  label: string; value: number; onChange: (v: number) => void; min: number; max: number;
}) {
  // The value is editable: type a number directly, or use the +/- buttons.
  // Buttons clamp at the range; invalid typed input falls back to the
  // previous value so the field never holds garbage.
  //
  // `draft` only holds in-progress typing; the displayed value is derived
  // from the prop when we're *not* editing. Deriving during render (instead
  // of syncing via an effect) avoids cascading re-renders and keeps the field
  // in sync when a sibling stepper mutates the shared parent value.
  const [draft, setDraft] = useState<string>(String(value));
  const [editing, setEditing] = useState(false);

  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  const displayValue = editing ? draft : String(value);

  const commit = () => {
    setEditing(false);
    const parsed = parseInt(draft, 10);
    if (Number.isFinite(parsed)) {
      onChange(clamp(parsed));
      setDraft(String(clamp(parsed)));
    } else {
      setDraft(String(value));
    }
  };

  return (
    <div>
      <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>
        {label}
      </label>
      <div className="fg-stepper">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          aria-label={`Decrease ${label}`}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <input
          className="value"
          type="text"
          inputMode="numeric"
          value={displayValue}
          onChange={e => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
          onFocus={() => {
            setEditing(true);
            setDraft(String(value));
          }}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setDraft(String(value));
              setEditing(false);
              (e.target as HTMLInputElement).blur();
            }
          }}
          aria-label={label}
        />
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          aria-label={`Increase ${label}`}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function SettingsToggle({ label, description, value, onChange }: {
  label: string; description: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="fg-settings-row">
      <div>
        <div className="fg-settings-label">{label}</div>
        <div className="fg-settings-sublabel">{description}</div>
      </div>
      <button className={`fg-toggle ${value ? 'active' : ''}`} onClick={() => onChange(!value)} />
    </div>
  );
}
