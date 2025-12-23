/**
 * UI Store - Navigation and UI state management
 */

import { create } from 'zustand';

export type ViewType = 'status' | 'orchestrator' | 'project' | 'review' | 'config' | 'help';

interface Notification {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  timestamp: Date;
}

interface UIState {
  // Navigation
  currentView: ViewType;
  breadcrumbs: string[];
  history: ViewType[];

  // UI State
  showHelp: boolean;
  selectedIndex: number;
  notifications: Notification[];

  // Actions
  navigate: (view: ViewType) => void;
  goBack: () => void;
  toggleHelp: () => void;
  setSelectedIndex: (index: number) => void;
  moveSelection: (delta: number, max: number) => void;
  notify: (message: string, type: Notification['type']) => void;
  dismissNotification: (id: string) => void;
  clearNotifications: () => void;
}

function viewToLabel(view: ViewType): string {
  const labels: Record<ViewType, string> = {
    status: 'Status',
    orchestrator: 'Orchestrator',
    project: 'Projects',
    review: 'Review',
    config: 'Config',
    help: 'Help',
  };
  return labels[view];
}

export const useUIStore = create<UIState>((set) => ({
  currentView: 'status',
  breadcrumbs: ['Status'],
  history: [],
  showHelp: false,
  selectedIndex: 0,
  notifications: [],

  navigate: (view) => set((state) => ({
    currentView: view,
    history: [...state.history, state.currentView],
    breadcrumbs: [...state.breadcrumbs, viewToLabel(view)],
    selectedIndex: 0,
  })),

  goBack: () => set((state) => {
    if (state.history.length === 0) return state;
    const newHistory = [...state.history];
    const previousView = newHistory.pop()!;
    return {
      currentView: previousView,
      history: newHistory,
      breadcrumbs: state.breadcrumbs.slice(0, -1),
      selectedIndex: 0,
    };
  }),

  toggleHelp: () => set((state) => ({ showHelp: !state.showHelp })),

  setSelectedIndex: (index) => set({ selectedIndex: index }),

  moveSelection: (delta, max) => set((state) => ({
    selectedIndex: Math.max(0, Math.min(max - 1, state.selectedIndex + delta)),
  })),

  notify: (message, type) => set((state) => ({
    notifications: [
      ...state.notifications,
      {
        id: Date.now().toString(),
        message,
        type,
        timestamp: new Date(),
      },
    ],
  })),

  dismissNotification: (id) => set((state) => ({
    notifications: state.notifications.filter(n => n.id !== id),
  })),

  clearNotifications: () => set({ notifications: [] }),
}));
