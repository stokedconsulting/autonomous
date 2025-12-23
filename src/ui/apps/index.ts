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

/**
 * Render the Project Review app
 */
export async function renderProjectReview(props: ProjectReviewAppProps): Promise<void> {
  const { waitUntilExit } = render(
    React.createElement(ProjectReviewApp, props)
  );

  await waitUntilExit();
}

/**
 * Render the Project Start app with interactive UI
 */
export async function renderProjectStart(props: ProjectStartAppProps): Promise<void> {
  const { waitUntilExit } = render(
    React.createElement(ProjectStartApp, props)
  );

  await waitUntilExit();
}

// Re-export types
export type { ProjectReviewAppProps } from './ProjectReviewApp.js';
export type { ProjectStartAppProps } from './ProjectStartApp.js';
