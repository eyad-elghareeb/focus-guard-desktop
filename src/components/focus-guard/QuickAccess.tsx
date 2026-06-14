'use client';

import { useFocusGuardStore } from '@/lib/store';
import { generateFaviconUrl } from '@/lib/helpers';
import { useState } from 'react';

export function QuickAccess() {
  const quickAccess = useFocusGuardStore(s => s.quickAccess);
  const addQuickAccess = useFocusGuardStore(s => s.addQuickAccess);
  const removeQuickAccess = useFocusGuardStore(s => s.removeQuickAccess);
  const [showAdd, setShowAdd] = useState(false);
  const [newDomain, setNewDomain] = useState('');

  const handleAdd = () => {
    if (!newDomain.trim()) return;
    let domain = newDomain.trim().toLowerCase();
    domain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    addQuickAccess(domain);
    setNewDomain('');
    setShowAdd(false);
  };

  return (
    <div className="fg-glass p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
          Quick Access
        </h3>
        <button
          className="fg-btn-ghost fg-btn"
          style={{ padding: '4px 10px', fontSize: 12 }}
          onClick={() => setShowAdd(!showAdd)}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Add
        </button>
      </div>

      {/* Sites Grid */}
      <div className="flex flex-wrap gap-3">
        {quickAccess.map(site => (
          <div key={site.domain} className="fg-quick-site group relative">
            <img src={generateFaviconUrl(site.domain)} alt={site.domain} width={32} height={32} style={{ borderRadius: 8 }} />
            <span>{site.domain.split('.')[0]}</span>
            <button
              onClick={() => removeQuickAccess(site.domain)}
              className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: 'var(--red)', fontSize: 10, color: 'white', lineHeight: 1 }}
            >
              x
            </button>
          </div>
        ))}
      </div>

      {/* Add Site Popover */}
      {showAdd && (
        <div className="mt-4 p-3 fg-glass" style={{ background: 'var(--bg-elevated)' }}>
          <div className="flex gap-2">
            <input
              className="fg-input"
              placeholder="Enter domain (e.g. github.com)"
              value={newDomain}
              onChange={e => setNewDomain(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              autoFocus
            />
            <button className="fg-btn fg-btn-primary" onClick={handleAdd} style={{ whiteSpace: 'nowrap' }}>
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
