// FocusGuard Desktop - Utility Functions

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function formatDurationLong(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

export function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 21) return 'Good evening';
  return 'Good night';
}

export function getTodayKey(): string {
  return new Date().toISOString().split('T')[0];
}

export function getDateKey(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function getWeekDates(): string[] {
  const dates: string[] = [];
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.push(getDateKey(d));
  }
  return dates;
}

export function getMonthDates(): string[] {
  const dates: string[] = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.push(getDateKey(d));
  }
  return dates;
}

export function getDayName(dateKey: string): string {
  const date = new Date(dateKey + 'T12:00:00');
  return date.toLocaleDateString('en-US', { weekday: 'short' });
}

export function getShortDate(dateKey: string): string {
  const date = new Date(dateKey + 'T12:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function generateFaviconUrl(domain: string): string {
  const colors = [
    '#ef4444', '#f97316', '#f59e0b', '#10b981',
    '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
    '#6366f1', '#14b8a6',
  ];
  const hash = domain.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const color = colors[hash % colors.length];
  const letter = domain.charAt(0).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <rect width="32" height="32" rx="8" fill="${color}"/>
    <text x="16" y="22" font-family="sans-serif" font-size="18" font-weight="bold" fill="white" text-anchor="middle">${letter}</text>
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function playNotificationSound(): void {
  try {
    const ctx = new AudioContext();
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0.3;
    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);
    osc1.frequency.value = 880;
    osc2.frequency.value = 660;
    osc1.start();
    osc2.start();
    setTimeout(() => {
      osc1.frequency.value = 1100;
      osc2.frequency.value = 880;
    }, 150);
    setTimeout(() => {
      osc1.stop();
      osc2.stop();
      ctx.close();
    }, 400);
  } catch {
    // Ignore audio errors
  }
}
