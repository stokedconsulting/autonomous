/**
 * Clarify command - Autonomous clarification of "Needs More Info" issues
 */

import chalk from 'chalk';
import { ConfigManager } from '../../core/config-manager.js';
import { ClarificationWorker } from '../../core/clarification-worker.js';
import { GitHubAPI } from '../../github/api.js';
import { GitHubProjectsAPI } from '../../github/projects-api.js';
import { ProjectFieldMapper } from '../../github/project-field-mapper.js';
import { resolveProjectId } from '../../github/project-resolver.js';
import { getGitHubToken } from '../../utils/github-token.js';

interface ClarifyOptions {
  verbose?: boolean;
}

/**
 * Run clarification worker on all "Needs More Info" issues
 */
export async function clarifyCommand(options: ClarifyOptions = {}): Promise<void> {
  console.log(chalk.blue.bold(`\n🤔 Autonomous Clarification\n`));

  try {
    const cwd = process.cwd();

    // Load configuration
    const configManager = new ConfigManager(cwd);
    await configManager.initialize();
    const config = configManager.getConfig();

    // Get GitHub token
    const githubToken = await getGitHubToken(config.github.token);

    // Initialize GitHub API
    const githubAPI = new GitHubAPI(githubToken, config.github.owner, config.github.repo);

    // Initialize GitHub Projects
    if (!config.project?.enabled) {
      console.error(chalk.red('Error: GitHub Projects integration is required for clarification worker'));
      console.error(chalk.yellow('Run "auto project setup" to configure GitHub Projects\n'));
      process.exit(1);
    }

    const projectId = await resolveProjectId(config.github.owner, config.github.repo, false);
    if (!projectId) {
      console.error(chalk.red('Error: Could not resolve GitHub Project ID'));
      process.exit(1);
    }

    const projectsAPI = new GitHubProjectsAPI(projectId, config.project);
    const fieldMapper = new ProjectFieldMapper(projectsAPI, config.project);

    // Initialize clarification worker
    const claudePath = config.llms?.claude?.cliPath || 'claude';
    const clarificationWorker = new ClarificationWorker(cwd, githubAPI, claudePath, fieldMapper);

    // Process all "Needs More Info" issues
    const results = await clarificationWorker.processNeedsMoreInfoIssues({
      verbose: options.verbose,
    });

    if (results.length === 0) {
      console.log(chalk.yellow('No issues needed clarification.\n'));
      return;
    }

    // Display results
    console.log(chalk.blue.bold(`\n📋 Clarification Results:\n`));

    for (const result of results) {
      const statusIcon = result.statusUpdate === 'Todo' ? '✅' : result.statusUpdate === 'Backlog' ? '⏸️' : '⚠️';
      const statusText = result.statusUpdate || 'No Change';
      const color = result.statusUpdate === 'Todo' ? chalk.green : result.statusUpdate === 'Backlog' ? chalk.yellow : chalk.gray;

      const titlePreview = result.issueTitle.length > 50
        ? result.issueTitle.substring(0, 50) + '...'
        : result.issueTitle;

      console.log(color(`${statusIcon} #${result.issueNumber} ${titlePreview} → ${statusText}`));

      if (options.verbose) {
        console.log(chalk.gray(`   Answered: ${result.answers.length} question(s)`));
        result.answers.forEach(a => {
          console.log(chalk.gray(`   - ${a.question}: ${a.confidence}`));
        });
        console.log('');
      }
    }

    console.log(chalk.green.bold(`\n✓ Clarification complete!\n`));
  } catch (error: unknown) {
    console.error(chalk.red('\n✗ Error running clarification:'), error instanceof Error ? error.message : String(error));
    if (options.verbose && error instanceof Error) {
      console.error(error);
    }
    process.exit(1);
  }
}
