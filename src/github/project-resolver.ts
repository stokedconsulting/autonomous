/**
 * Project ID Resolver
 *
 * Resolves project ID using auto-discovery with helpful error messages.
 */

import chalk from 'chalk';
import { ProjectDiscovery } from './project-discovery.js';

/**
 * Resolve project ID for a given repository
 *
 * @param owner GitHub repository owner
 * @param repo GitHub repository name
 * @param showMessages Whether to print discovery messages (default: true)
 * @returns Project ID or null if cannot be resolved
 */
export async function resolveProjectId(
  owner: string,
  repo: string,
  showMessages: boolean = true
): Promise<string | null> {
  const discovery = new ProjectDiscovery(owner, repo);
  const envProjectId = process.env.GITHUB_PROJECT_ID;

  const result = await discovery.resolveProjectId(envProjectId);

  if (showMessages && result.message) {
    if (result.source === 'auto-discovered') {
      console.log(chalk.green('✓ ' + result.message));
    } else if (result.source === 'env') {
      console.log(chalk.blue('ℹ ' + result.message));
    } else {
      console.error(chalk.yellow('⚠ ' + result.message));
    }
  }

  return result.projectId;
}

/**
 * Resolve project ID or exit with error
 *
 * @param owner GitHub repository owner
 * @param repo GitHub repository name
 * @returns Project ID (guaranteed non-null or process exits)
 */
export async function resolveProjectIdOrExit(
  owner: string,
  repo: string
): Promise<string> {
  const projectId = await resolveProjectId(owner, repo, true);

  if (!projectId) {
    console.error(chalk.red('\n✗ Cannot proceed without a project'));
    process.exit(1);
  }

  return projectId;
}
