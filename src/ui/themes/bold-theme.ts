/**
 * Bold Theme - "Think Big, Be Bold" color palette
 */

export const BoldTheme = {
  // Primary Brand
  primary: 'cyan',
  secondary: 'magenta',
  accent: 'yellow',

  // Status Colors
  status: {
    assigned: 'gray',
    inProgress: 'cyan',
    inReview: 'yellow',
    devComplete: 'greenBright',
    mergeReview: 'magenta',
    stageReady: 'blue',
    merged: 'green',
    failed: 'red',
  },

  // Semantic
  success: 'green',
  warning: 'yellow',
  error: 'red',
  info: 'blue',
} as const;

export const Icons = {
  // Status
  pending: '\u25CB',      // ○
  inProgress: '\u25D0',   // ◐
  complete: '\u25CF',     // ●
  failed: '\u2715',       // ✕

  // Actions
  start: '\u25B6',        // ▶
  stop: '\u25A0',         // ■
  pause: '\u23F8',        // ⏸

  // Navigation
  expand: '\u25B8',       // ▸
  collapse: '\u25BE',     // ▾
  breadcrumb: '\u203A',   // ›

  // Semantic
  success: '\u2713',      // ✓
  warning: '\u26A0',      // ⚠
  error: '\u2717',        // ✗
  info: '\u2139',         // ℹ

  // Entities
  issue: '#',
  branch: '\u2387',       // ⎇
  pr: '\u2394',           // ⎔
  llm: '\uD83E\uDD16',    // 🤖

  // Pipeline stages
  pipeline: ['\u25CB', '\u25D4', '\u25D1', '\u25D5', '\u25CF'],
} as const;

export type ThemeColor = keyof typeof BoldTheme.status | 'primary' | 'secondary' | 'accent' | 'success' | 'warning' | 'error' | 'info';
