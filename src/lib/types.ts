// FocusGuard Desktop - Data Types (identical to extension)

export type TimerMode = 'work' | 'short_break' | 'long_break';

export interface TimerState {
  isRunning: boolean;
  isPaused: boolean;
  mode: TimerMode;
  remainingSeconds: number;
  totalSeconds: number;
  completedPomodoros: number;
  currentStreak: number;
  bestStreak: number;
  lastTick: number | null;
  sessionStartTimestamp: number | null;
}

export interface Settings {
  workDuration: number;         // seconds, default 1500 (25min)
  shortBreakDuration: number;   // seconds, default 300 (5min)
  longBreakDuration: number;    // seconds, default 900 (15min)
  longBreakInterval: number;    // pomodoros before long break, default 4
  autoStartBreaks: boolean;     // default true
  autoStartWork: boolean;       // default false
  notificationsEnabled: boolean;// default true
  soundEnabled: boolean;        // default true
  blockDuringWork: boolean;     // default true
  blockDuringBreaks: boolean;   // default false
  customDurations: boolean;     // default false
  dailyGoalMinutes: number;     // default 480 (8h)
}

export interface BlockedSite {
  domain: string;
  enabled: boolean;
  category: string;
}

export interface SiteUsageEntry {
  visits: number;
  totalSeconds: number;
  lastVisit: number;
}

export type SiteUsageMap = Record<string, SiteUsageEntry>;

export interface DailyStats {
  totalWork: number;
  totalBreak: number;
  pomodoros: number;
}

export interface SessionLogEntry {
  type: 'work' | 'short_break' | 'long_break' | 'work_incomplete';
  duration: number;
  totalDuration?: number;
  reason?: string;
  timestamp: number;
  date: string;
}

export interface StudyLogEntry {
  id: string;
  date: string;
  duration: number;    // seconds
  subject: string;     // max 60 chars
  note: string;        // max 200 chars
  timestamp: number;
  source: 'timer' | 'manual' | 'reset' | 'skip';
}

export interface Todo {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
  doneAt?: number;
}

export interface QuickAccessSite {
  domain: string;
}

// Desktop-specific: tracked application usage
export interface DesktopAppUsage {
  appName: string;
  windowTitle: string;
  totalSeconds: number;
  lastActive: number;
  category: string;
}

// The full state object (identical to extension's focusguard_data)
export interface FocusGuardState {
  timer: TimerState;
  settings: Settings;
  blockedSites: BlockedSite[];
  siteUsage: Record<string, SiteUsageMap>;
  dailyStats: Record<string, DailyStats>;
  sessionLog: SessionLogEntry[];
  studyLog: StudyLogEntry[];
  todos: Todo[];
  quickAccess: QuickAccessSite[];
  // Desktop-specific
  desktopAppUsage: Record<string, DesktopAppUsage[]>;
  /** App names the user has marked as blocked during focus sessions. */
  blockedDesktopApps: string[];
  // Sync bridge
  extensionConnected: boolean;
  extensionPort: number | null;
  syncEnabled: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  workDuration: 1500,
  shortBreakDuration: 300,
  longBreakDuration: 900,
  longBreakInterval: 4,
  autoStartBreaks: true,
  autoStartWork: false,
  notificationsEnabled: true,
  soundEnabled: true,
  blockDuringWork: true,
  blockDuringBreaks: false,
  customDurations: false,
  dailyGoalMinutes: 480,
};

export const DEFAULT_BLOCKED_SITES: BlockedSite[] = [
  { domain: 'facebook.com', enabled: true, category: 'social' },
  { domain: 'twitter.com', enabled: true, category: 'social' },
  { domain: 'x.com', enabled: true, category: 'social' },
  { domain: 'instagram.com', enabled: true, category: 'social' },
  { domain: 'reddit.com', enabled: true, category: 'social' },
  { domain: 'tiktok.com', enabled: true, category: 'social' },
  { domain: 'youtube.com', enabled: true, category: 'entertainment' },
  { domain: 'twitch.tv', enabled: true, category: 'entertainment' },
  { domain: 'netflix.com', enabled: true, category: 'entertainment' },
];

export const DEFAULT_QUICK_ACCESS: QuickAccessSite[] = [
  { domain: 'github.com' },
  { domain: 'stackoverflow.com' },
  { domain: 'developer.mozilla.org' },
];

export const CATEGORY_EMOJIS: Record<string, string> = {
  social: '\u{1F4AC}',
  entertainment: '\u{1F3AC}',
  news: '\u{1F4F0}',
  shopping: '\u{1F6D2}',
  gaming: '\u{1F3AE}',
  custom: '\u{1F527}',
};

export const FOCUS_MESSAGES = {
  idle: [
    'Ready to focus? Hit play to start.',
    'Your next pomodoro is waiting.',
    'Deep work starts with a single click.',
  ],
  work: [
    'Stay focused. You\'re in the zone.',
    'One task at a time. You\'ve got this.',
    'Distractions can wait. Focus can\'t.',
    'Deep work in progress...',
    'Every minute counts right now.',
  ],
  break: [
    'Take a breather. You earned it.',
    'Stretch, hydrate, relax.',
    'Rest is part of the process.',
    'Look away from the screen for a moment.',
  ],
  paused: [
    'Timer paused. Hit play to resume.',
    'Taking a quick pause? Don\'t forget to come back.',
  ],
};

export const MOTIVATIONAL_QUOTES = [
  { text: 'The secret of getting ahead is getting started.', author: 'Mark Twain' },
  { text: 'It is not enough to be busy. The question is: what are we busy about?', author: 'Henry David Thoreau' },
  { text: 'Focus is about saying no to a lot of good ideas.', author: 'Steve Jobs' },
  { text: 'The successful warrior is the average man, with laser-like focus.', author: 'Bruce Lee' },
  { text: 'Concentrate all your thoughts upon the work at hand.', author: 'Alexander Graham Bell' },
  { text: 'You can always find a distraction if you\'re looking for one.', author: 'Tom Kite' },
  { text: 'Starve your distractions, feed your focus.', author: 'Daniel Goleman' },
  { text: 'The main thing is to keep the main thing the main thing.', author: 'Stephen Covey' },
  { text: 'Where focus goes, energy flows.', author: 'Tony Robbins' },
  { text: 'Do what you can, with what you have, where you are.', author: 'Theodore Roosevelt' },
  { text: 'Action is the foundational key to all success.', author: 'Pablo Picasso' },
  { text: 'The only way to do great work is to love what you do.', author: 'Steve Jobs' },
];
