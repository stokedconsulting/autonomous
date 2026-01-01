/**
 * Standalone Ink App Renderers
 *
 * Each command that uses Ink has its own standalone app.
 * This module provides render functions for each app.
 */

import { render } from 'ink';
import React from 'react';
import { ProjectReviewApp, ProjectReviewAppProps } from './ProjectReviewApp.js';
import { ProjectStartApp, ProjectStartAppProps } from './ProjectStartApp.js';
import { OrchestratorMonitorApp, OrchestratorMonitorAppProps } from './OrchestratorMonitorApp.js';
import { ProjectCreationApp } from './ProjectCreationApp.js';
import { CommandUI } from '../components/CommandUI.js';

/**
 * Render the Project Review app
 */
export async function renderProjectReview(props: ProjectReviewAppProps): Promise<void> {
  const { waitUntilExit } = render(
    React.createElement(CommandUI, {
      commandName: 'Project Review',
      children: React.createElement(ProjectReviewApp, props),
    })
  );

  await waitUntilExit();
}

/**
 * Render the Project Start app with interactive UI
 */
export async function renderProjectStart(props: ProjectStartAppProps): Promise<void> {
  const { waitUntilExit } = render(
    React.createElement(CommandUI, {
      commandName: 'Project Start',
      children: React.createElement(ProjectStartApp, props),
    })
  );

  await waitUntilExit();
}

/**
 * Render the Orchestrator Monitor app with real-time monitoring UI
 */
export async function renderOrchestratorMonitor(props: OrchestratorMonitorAppProps): Promise<void> {
  const { waitUntilExit } = render(
    React.createElement(CommandUI, {
      commandName: 'Autonomous Mode',
      children: React.createElement(OrchestratorMonitorApp, props),
    })
  );

  await waitUntilExit();
}

/**
 * Render the Project Creation app with two-stage review workflow
 */
export async function renderProjectCreation(props: {
  description: string;
  claudePath: string;
  workingDirectory: string;
  onComplete?: (implementationPlanPath: string) => void;
  onCancel?: () => void;
}): Promise<void> {
  const { waitUntilExit } = render(
    React.createElement(ProjectCreationApp, props)
  );

  await waitUntilExit();
}

// Re-export types
export type { ProjectReviewAppProps } from './ProjectReviewApp.js';
export type { ProjectStartAppProps } from './ProjectStartApp.js';
export type { OrchestratorMonitorAppProps } from './OrchestratorMonitorApp.js';
