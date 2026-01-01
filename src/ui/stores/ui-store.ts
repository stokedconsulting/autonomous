/**
 * UI Store - Navigation and UI state management
 */

import { create } from 'zustand';

export type TabType = 'status' | 'project' | 'orchestrator';
export type ViewType = TabType | 'review' | 'queue' | 'config' | 'setup' | 'help';

interface Notification {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  timestamp: Date;
}

// Map views to their parent tab
const VIEW_TO_TAB: Record<ViewType, TabType> = {
  status: 'status',
  review: 'status',
  project: 'project',
  queue: 'project',
  orchestrator: 'orchestrator',
  config: 'status', // Config accessible from any tab, default to status
  setup: 'status', // Setup is initial, default to status
  help: 'status', // Help is overlay, default to status
};

// Tab-level views (no nesting)
const TAB_VIEWS: ViewType[] = ['status', 'project', 'orchestrator'];

interface UIState {
  // Navigation
  currentTab: TabType;
  currentView: ViewType;
  breadcrumbs: string[];
  history: ViewType[];

  // UI State
  showHelp: boolean;
  selectedIndex: number;
  notifications: Notification[];
  isTextInputActive: boolean; // Block global shortcuts during text input

  // Actions
  navigate: (view: ViewType) => void;
  navigateTab: (tab: TabType) => void;
  goBack: () => void;
  toggleHelp: () => void;
  setShowHelp: (show: boolean) => void;
  setSelectedIndex: (index: number) => void;
  moveSelection: (delta: number, max: number) => void;
  notify: (message: string, type: Notification['type']) => void;
  dismissNotification: (id: string) => void;
  clearNotifications: () => void;
  setTextInputActive: (active: boolean) => void;
}

function viewToLabel(view: ViewType): string {
  const labels: Record<ViewType, string> = {
    status: 'Status',
    orchestrator: 'Orchestrator',
    project: 'Projects',
    queue: 'Queue',
    review: 'Review',
    config: 'Config',
    setup: 'Setup',
    help: 'Help',
  };
  return labels[view];
}

export const useUIStore = create<UIState>((set) => ({
  currentTab: 'project',
  currentView: 'project',
  breadcrumbs: [],
  history: [],
  showHelp: false,
  selectedIndex: 0,
  notifications: [],
  isTextInputActive: false,

  navigateTab: (tab) => set((state) => {
    // Switching tabs: reset breadcrumbs, start fresh
    return {
      currentTab: tab,
      currentView: tab,
      history: state.currentView !== tab ? [...state.history, state.currentView] : state.history,
      breadcrumbs: [], // Tabs don't show in breadcrumbs
      selectedIndex: 0,
    };
  }),

  navigate: (view) => set((state) => {
    const targetTab = VIEW_TO_TAB[view];
    const isTabSwitch = TAB_VIEWS.includes(view);

    if (isTabSwitch) {
      // Navigating to a tab-level view
      return {
        currentTab: view as TabType,
        currentView: view,
        history: state.currentView !== view ? [...state.history, state.currentView] : state.history,
        breadcrumbs: [], // Tabs don't show in breadcrumbs
        selectedIndex: 0,
      };
    }

    // Navigating to a nested view within current or different tab
    const newLabel = viewToLabel(view);
    const existingIndex = state.breadcrumbs.indexOf(newLabel);

    // If already in breadcrumb trail, truncate to that point (navigating back)
    const newBreadcrumbs = existingIndex >= 0
      ? state.breadcrumbs.slice(0, existingIndex + 1)
      : [...state.breadcrumbs, newLabel];

    return {
      currentTab: targetTab,
      currentView: view,
      history: [...state.history, state.currentView],
      breadcrumbs: newBreadcrumbs,
      selectedIndex: 0,
    };
  }),

  goBack: () => set((state) => {
    if (state.history.length === 0) return state;
    const newHistory = [...state.history];
    const previousView = newHistory.pop()!;
    const previousTab = VIEW_TO_TAB[previousView];
    const isTabView = TAB_VIEWS.includes(previousView);

    return {
      currentTab: previousTab,
      currentView: previousView,
      history: newHistory,
      breadcrumbs: isTabView ? [] : state.breadcrumbs.slice(0, -1),
      selectedIndex: 0,
    };
  }),

  toggleHelp: () => set((state) => ({ showHelp: !state.showHelp })),
  setShowHelp: (show) => set({ showHelp: show }),

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

  setTextInputActive: (active) => set({ isTextInputActive: active }),
}));
