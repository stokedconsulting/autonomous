/**
 * UI Entry Point - Ink application renderer
 */

import { render } from 'ink';
import { App } from './App.js';
import type { ViewType } from './stores/ui-store.js';

export interface RenderOptions {
  initialView?: ViewType;
  projectId?: string;
}

/**
 * Render the Ink UI application
 */
export function renderUI(options: RenderOptions = {}): void {
  const { initialView = 'status', projectId } = options;

  const { waitUntilExit } = render(
    <App initialView={initialView} projectId={projectId} />
  );

  // Handle cleanup on exit
  waitUntilExit().then(() => {
    // Cleanup logic if needed
  });
}

/**
 * Create an Ink instance for testing or custom control
 */
export function createInkInstance(options: RenderOptions = {}) {
  const { initialView = 'status', projectId } = options;

  return render(
    <App initialView={initialView} projectId={projectId} />
  );
}

// Re-export types and components for external use
export type { ViewType } from './stores/ui-store.js';
export { useUIStore } from './stores/ui-store.js';
export { useAssignmentStore } from './stores/assignment-store.js';
export { useOrchestratorStore } from './stores/orchestrator-store.js';
