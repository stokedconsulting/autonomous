/**
 * UI Command - Launch the interactive Ink-based UI
 *
 * Note: Uses dynamic import because ink v5 is ESM-only
 */

import chalk from 'chalk';

type ViewType = 'status' | 'orchestrator' | 'project' | 'review' | 'config' | 'help';

interface UICommandOptions {
  view?: ViewType;
  projectId?: string;
}

const VALID_VIEWS: ViewType[] = ['status', 'orchestrator', 'project', 'review', 'config'];

export async function uiCommand(options: UICommandOptions): Promise<void> {
  const { view = 'status', projectId } = options;

  // Validate view
  if (!VALID_VIEWS.includes(view)) {
    console.error(chalk.red(`Invalid view: ${view}`));
    console.error(chalk.gray(`Valid views: ${VALID_VIEWS.join(', ')}`));
    process.exit(1);
  }

  // Launch the UI using dynamic import (ink v5 is ESM-only)
  try {
    console.log(chalk.cyan('◆ Launching Autonomous UI...'));
    console.log(chalk.gray('Press ? for help, q to quit\n'));

    // Dynamic import for ESM-only ink
    const { renderUI } = await import('../../ui/index.js');

    renderUI({
      initialView: view,
      projectId,
    });
  } catch (error) {
    console.error(chalk.red('Failed to launch UI:'), error);
    process.exit(1);
  }
}
