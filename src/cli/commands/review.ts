/**
 * Review command - Manual and automated code review
 */

import chalk from 'chalk';
import { ConfigManager } from '../../core/config-manager.js';
import { AssignmentManager } from '../../core/assignment-manager.js';
import { ReviewWorker } from '../../core/review-worker.js';
import { GitHubAPI } from '../../github/api.js';
import { GitHubProjectsAPI } from '../../github/projects-api.js';
import { ProjectFieldMapper } from '../../github/project-field-mapper.js';
import { resolveProjectId } from '../../github/project-resolver.js';
import { getGitHubToken } from '../../utils/github-token.js';
import { basename } from 'path';

interface ReviewOptions {
  pass?: string;         // Status to set if review passes
  fail?: string;         // Status to set if review fails
  branch?: string;       // Branch to review
  verbose?: boolean;
  status?: string;       // Filter by status (default: "In Review")
  maxConcurrent?: number; // Max concurrent reviews
  persona?: string[];    // Personas to run
}

/**
 * Review assignments by status
 */
export async function reviewCommand(options: ReviewOptions = {}): Promise<void> {
  console.log(chalk.blue.bold(`\n🔍 Code Review\n`));

  try {
    const cwd = process.cwd();
    const projectName = basename(cwd);

    // Load configuration
    const configManager = new ConfigManager(cwd);
    await configManager.initialize();
    const config = configManager.getConfig();

    // Get GitHub token
    const githubToken = await getGitHubToken(config.github.token);

    // Initialize managers
    const githubAPI = new GitHubAPI(githubToken, config.github.owner, config.github.repo);
    const assignmentManager = new AssignmentManager(cwd);
    await assignmentManager.initialize(projectName, cwd);

    // Initialize GitHub Projects if configured
    let fieldMapper: ProjectFieldMapper | null = null;
    if (config.project?.enabled) {
      const projectId = await resolveProjectId(config.github.owner, config.github.repo, false);
      if (projectId) {
        const projectsAPI = new GitHubProjectsAPI(projectId, config.project);
        fieldMapper = new ProjectFieldMapper(projectsAPI, config.project);
      } else {
        console.warn(chalk.yellow('Warning: GitHub Projects enabled but project ID could not be resolved'));
      }
    }

    // Initialize review worker
    const claudePath = config.reviewWorker?.claudePath || config.llms?.claude?.cliPath || 'claude';
    const maxConcurrent = options.maxConcurrent || config.reviewWorker?.maxConcurrent || 3;
    const reviewWorker = new ReviewWorker(cwd, assignmentManager, githubAPI, claudePath, maxConcurrent, fieldMapper);

    // Determine status to filter by
    const filterStatus = options.status || 'In Review';

    console.log(chalk.blue(`Reviewing assignments with status: ${filterStatus}`));
    if (options.pass) {
      console.log(chalk.green(`  On pass: ${options.pass}`));
    }
    if (options.fail) {
      console.log(chalk.red(`  On fail: ${options.fail}`));
    }
    if (options.branch) {
      console.log(chalk.gray(`  Branch: ${options.branch}`));
    }
    console.log('');

    // Run reviews
    const results = await reviewWorker.reviewAssignmentsByStatus(filterStatus, {
      passStatus: options.pass,
      failStatus: options.fail,
      branch: options.branch,
      verbose: options.verbose,
      personas: options.persona,
    });

    if (results.length === 0) {
      console.log(chalk.yellow(`\nNo assignments found to review.\n`));
      return;
    }

    // Display results
    console.log(chalk.blue.bold(`\n📋 Review Results:\n`));

    for (const result of results) {
      const color = result.passed ? chalk.green : chalk.red;
      const statusText = result.passed ? 'PASS' : 'FAIL';

      // Single line output: PASS/FAIL .. #issue title .. link
      const titlePreview = result.issueTitle.length > 50
        ? result.issueTitle.substring(0, 50) + '...'
        : result.issueTitle;

      if (result.commentUrl) {
        console.log(color(`${statusText} .. #${result.issueNumber} ${titlePreview} .. ${result.commentUrl}`));
      } else {
        console.log(color(`${statusText} .. #${result.issueNumber} ${titlePreview}`));
      }
    }

    console.log(chalk.green.bold(`✓ Review complete!\n`));
  } catch (error: unknown) {
    console.error(chalk.red('\n✗ Error running review:'), error instanceof Error ? error.message : String(error));
    if (options.verbose && error instanceof Error) {
      console.error(error);
    }
    process.exit(1);
  }
}

/**
 * Review a specific item
 */
export async function itemReviewCommand(issueNumber: string, options: ReviewOptions = {}): Promise<void> {
  console.log(chalk.blue.bold(`\n🔍 Reviewing Issue #${issueNumber}\n`));

  try {
    const cwd = process.cwd();
    const projectName = basename(cwd);
    const issueNum = parseInt(issueNumber, 10);

    if (isNaN(issueNum)) {
      console.error(chalk.red('Error: Issue number must be a valid integer'));
      process.exit(1);
    }

    // Load configuration
    const configManager = new ConfigManager(cwd);
    await configManager.initialize();
    const config = configManager.getConfig();

    // Get GitHub token
    const githubToken = await getGitHubToken(config.github.token);

    // Initialize managers
    const githubAPI = new GitHubAPI(githubToken, config.github.owner, config.github.repo);
    const assignmentManager = new AssignmentManager(cwd);
    await assignmentManager.initialize(projectName, cwd);

    // Initialize GitHub Projects if configured
    let fieldMapper: ProjectFieldMapper | null = null;
    if (config.project?.enabled) {
      const projectId = await resolveProjectId(config.github.owner, config.github.repo, false);
      if (projectId) {
        const projectsAPI = new GitHubProjectsAPI(projectId, config.project);
        fieldMapper = new ProjectFieldMapper(projectsAPI, config.project);
      } else {
        console.warn(chalk.yellow('Warning: GitHub Projects enabled but project ID could not be resolved'));
      }
    }

    // Initialize review worker (maxConcurrent doesn't matter for single item review)
    const claudePath = config.reviewWorker?.claudePath || config.llms?.claude?.cliPath || 'claude';
    const maxConcurrent = options.maxConcurrent || config.reviewWorker?.maxConcurrent || 3;
    const reviewWorker = new ReviewWorker(cwd, assignmentManager, githubAPI, claudePath, maxConcurrent, fieldMapper);

    console.log(chalk.blue(`Issue: #${issueNum}`));
    if (options.pass) {
      console.log(chalk.green(`  On pass: ${options.pass}`));
    }
    if (options.fail) {
      console.log(chalk.red(`  On fail: ${options.fail}`));
    }
    if (options.branch) {
      console.log(chalk.gray(`  Branch: ${options.branch}`));
    } else {
      console.log(chalk.gray(`  Branch: (current working directory branch)`));
    }
    console.log('');

    // Run review
    const result = await reviewWorker.reviewByIssueNumber(issueNum, {
      passStatus: options.pass,
      failStatus: options.fail,
      branch: options.branch,
      verbose: options.verbose,
      personas: options.persona,
    });

    if (!result) {
      console.error(chalk.red(`\n✗ Could not review issue #${issueNum}\n`));
      process.exit(1);
    }

    // Display result
    console.log(chalk.blue.bold(`\n📋 Review Result:\n`));

    const icon = result.passed ? '✅' : '❌';
    const color = result.passed ? chalk.green : chalk.red;
    const statusText = result.passed ? 'PASSED' : 'FAILED';

    console.log(color.bold(`${icon} ${statusText}`));
    console.log('');

    if (result.statusUpdated) {
      console.log(chalk.gray(`✓ Status updated`));
    }
    if (result.commentPosted) {
      console.log(chalk.gray(`✓ Comment posted to GitHub`));
    }

    if (!result.passed) {
      console.log(chalk.yellow(`\nFailure Summary:`));
      const failedReviews = result.reviewResult.personaReviews.filter(r => !r.passed);
      failedReviews.forEach(review => {
        const personaName = review.persona
          .split('-')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
        console.log(chalk.red(`\n  ${personaName}:`));
        console.log(chalk.gray(`  ${review.feedback.substring(0, 200)}${review.feedback.length > 200 ? '...' : ''}`));
      });
      console.log(chalk.yellow(`\nSee full details in the GitHub issue comment.`));
    }

    console.log('');
  } catch (error: unknown) {
    console.error(chalk.red('\n✗ Error reviewing item:'), error instanceof Error ? error.message : String(error));
    if (options.verbose && error instanceof Error) {
      console.error(error);
    }
    process.exit(1);
  }
}
