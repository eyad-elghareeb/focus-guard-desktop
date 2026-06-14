'use client';

import { useFocusGuardStore } from '@/lib/store';
import { StudyLogEntry } from '@/lib/types';
import { getTodayKey } from '@/lib/helpers';
import { useState, useEffect } from 'react';

export function StudyLogModal() {
  const [open, setOpen] = useState(false);
  const addStudyLogEntry = useFocusGuardStore(s => s.addStudyLogEntry);

  const [durationHours, setDurationHours] = useState(0);
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [subject, setSubject] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(getTodayKey());

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('openStudyLogModal', handler);
    return () => window.removeEventListener('openStudyLogModal', handler);
  }, []);

  const handleSave = () => {
    const duration = durationHours * 3600 + durationMinutes * 60;
    if (duration < 60) return;

    addStudyLogEntry({
      date,
      duration,
      subject: subject.slice(0, 60),
      note: note.slice(0, 200),
      source: 'manual',
    });

    setDurationHours(0);
    setDurationMinutes(30);
    setSubject('');
    setNote('');
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div className="fg-modal-overlay" onClick={e => e.target === e.currentTarget && setOpen(false)}>
      <div className="fg-modal" style={{ maxWidth: 400 }}>
        <div className="flex items-center justify-between mb-4">
          <h2 style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>Log Time</h2>
          <button onClick={() => setOpen(false)} style={{ color: 'var(--text-muted)', fontSize: 20 }}>&times;</button>
        </div>

        <div className="space-y-4">
          {/* Duration */}
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
              Duration
            </label>
            <div className="flex gap-3">
              <div className="fg-stepper flex-1">
                <button onClick={() => setDurationHours(Math.max(0, durationHours - 1))}>&minus;</button>
                <span className="value">{durationHours}h</span>
                <button onClick={() => setDurationHours(Math.min(24, durationHours + 1))}>+</button>
              </div>
              <div className="fg-stepper flex-1">
                <button onClick={() => setDurationMinutes(Math.max(0, durationMinutes - 5))}>&minus;</button>
                <span className="value">{durationMinutes}m</span>
                <button onClick={() => setDurationMinutes(Math.min(59, durationMinutes + 5))}>+</button>
              </div>
            </div>
          </div>

          {/* Subject */}
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
              Subject (optional)
            </label>
            <input
              className="fg-input"
              placeholder="What did you study?"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              maxLength={60}
            />
          </div>

          {/* Note */}
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
              Note (optional)
            </label>
            <textarea
              className="fg-input"
              placeholder="Add a note..."
              value={note}
              onChange={e => setNote(e.target.value)}
              maxLength={200}
              rows={2}
              style={{ resize: 'none' }}
            />
          </div>

          {/* Date */}
          <div>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
              Date
            </label>
            <input
              type="date"
              className="fg-input"
              value={date}
              onChange={e => setDate(e.target.value)}
              max={getTodayKey()}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 mt-6">
          <button className="fg-btn fg-btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button className="fg-btn fg-btn-primary" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}
