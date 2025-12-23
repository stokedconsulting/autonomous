/**
 * App - Root application component with view routing
 */

import React, { useEffect } from 'react';
import { Box, useApp, useInput } from 'ink';
import { StatusPage } from './pages/StatusPage.js';
import { OrchestratorPage } from './pages/OrchestratorPage.js';
import { ProjectPage } from './pages/ProjectPage.js';
import { ReviewPage } from './pages/ReviewPage.js';
import { ConfigPage } from './pages/ConfigPage.js';
import { useUIStore, ViewType } from './stores/ui-store.js';
import { useAssignmentStore } from './stores/assignment-store.js';

interface AppProps {
  initialView?: ViewType;
  projectId?: string;
}

export function App({ initialView = 'status', projectId }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const currentView = useUIStore((s) => s.currentView);
  const navigate = useUIStore((s) => s.navigate);
  const loadAssignments = useAssignmentStore((s) => s.loadAssignments);

  // Initialize view on mount
  useEffect(() => {
    if (initialView !== 'status') {
      navigate(initialView);
    }
  }, [initialView, navigate]);

  // Load assignments if projectId provided
  useEffect(() => {
    if (projectId) {
      loadAssignments(projectId);
    }
  }, [projectId, loadAssignments]);

  // Global keyboard shortcuts
  useInput((input, key) => {
    // Number keys for quick navigation
    if (input === '1') { navigate('status'); return; }
    if (input === '2') { navigate('orchestrator'); return; }
    if (input === '3') { navigate('project'); return; }
    if (input === '4') { navigate('review'); return; }
    if (input === '5') { navigate('config'); return; }

    // Ctrl+C to exit
    if (key.ctrl && input === 'c') {
      exit();
      return;
    }
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
      case 'review':
        return <ReviewPage />;
      case 'config':
        return <ConfigPage />;
      case 'help':
        // Help is shown as overlay, default to status
        return <StatusPage />;
      default:
        return <StatusPage />;
    }
  };

  return (
    <Box flexDirection="column" minHeight={24}>
      {renderView()}
    </Box>
  );
}
