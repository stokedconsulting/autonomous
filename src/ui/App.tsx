/**
 * App - Root application component with view routing
 */

import React, { useEffect } from 'react';
import { Box, useApp, useInput } from 'ink';
import { StatusPage } from './pages/StatusPage.js';
import { OrchestratorPage } from './pages/OrchestratorPage.js';
import { ProjectPage } from './pages/ProjectPage.js';
import { QueuePage } from './pages/QueuePage.js';
import { ReviewPage } from './pages/ReviewPage.js';
import { ConfigPage } from './pages/ConfigPage.js';
import { SetupPage } from './pages/SetupPage.js';
import { useUIStore, ViewType, TabType } from './stores/ui-store.js';
import { useAssignmentStore } from './stores/assignment-store.js';
import type { SetupOptions } from './pages/SetupPage.js';

interface AppProps {
  initialView?: ViewType;
  projectId?: string;
  showHelp?: boolean;
  setupOptions?: SetupOptions;
}

export function App({ initialView, projectId, showHelp, setupOptions }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const currentView = useUIStore((s) => s.currentView);
  const navigate = useUIStore((s) => s.navigate);
  const navigateTab = useUIStore((s) => s.navigateTab);
  const setShowHelp = useUIStore((s) => s.setShowHelp);
  const isTextInputActive = useUIStore((s) => s.isTextInputActive);
  const loadAssignments = useAssignmentStore((s) => s.loadAssignments);

  // Initialize view with smart defaults
  useEffect(() => {
    if (initialView) {
      // Explicit initial view provided
      navigate(initialView);
    }
    // Otherwise stay on Projects (the default initial state from ui-store)
    // User can manually switch to Status/Orchestrator tabs as needed
  }, [initialView, navigate]);

  useEffect(() => {
    if (showHelp !== undefined) {
      setShowHelp(showHelp);
    }
  }, [setShowHelp, showHelp]);

  // Load assignments on mount (use current directory if no projectId provided)
  useEffect(() => {
    const effectiveProjectId = projectId || 'current';
    loadAssignments(effectiveProjectId);
  }, [projectId, loadAssignments]);

  // Global keyboard shortcuts
  useInput((input, key) => {
    // Always allow Ctrl+C to exit
    if (key.ctrl && input === 'c') {
      exit();
      return;
    }

    // Skip all other shortcuts if text input is active
    if (isTextInputActive) {
      return;
    }

    // Tab/Shift+Tab to cycle through main tabs
    if (key.tab) {
      const tabs: TabType[] = ['status', 'project', 'orchestrator'];
      const currentIndex = tabs.indexOf(currentView as TabType);
      const nextIndex = key.shift
        ? (currentIndex - 1 + tabs.length) % tabs.length  // Shift+Tab: backward
        : (currentIndex + 1) % tabs.length;               // Tab: forward
      navigateTab(tabs[nextIndex]);
      return;
    }

    // Tab navigation (1, 2, 3)
    if (input === '1') { navigateTab('status'); return; }
    if (input === '2') { navigateTab('project'); return; }
    if (input === '3') { navigateTab('orchestrator'); return; }

    // Utility views
    if (input === 'c' || input === 'C') { navigate('config'); return; }
  });

  // Render current view
  const renderView = (): React.ReactElement => {
    switch (currentView) {
      case 'status':
        return <StatusPage />;
      case 'orchestrator':
        return <OrchestratorPage />;
      case 'project':
        return <ProjectPage />;
      case 'queue':
        return <QueuePage />;
      case 'review':
        return <ReviewPage />;
      case 'config':
        return <ConfigPage />;
      case 'setup':
        return <SetupPage options={setupOptions} />;
      case 'help':
        // Help is shown as overlay, default to status
        return <StatusPage />;
      default:
        return <StatusPage />;
    }
  };

  // Constrain to terminal height to prevent scrolling
  const terminalHeight = process.stdout.rows || 24;

  return (
    <Box flexDirection="column" height={terminalHeight}>
      {renderView()}
    </Box>
  );
}
