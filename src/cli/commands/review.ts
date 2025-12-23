/**
 * Review command - Manual and automated code review
 */

import chalk from 'chalk';
import { ConfigManager } from '../../core/config-manager.js';
import { ProjectConfig } from '../../types/config.js';
import { AssignmentManager } from '../../core/assignment-manager.js';
import { ReviewWorker } from '../../core/review-worker.js';
import { GitHubAPI } from '../../github/api.js';
import { GitHubProjectsAPI } from '../../github/projects-api.js';
import { ProjectFieldMapper } from '../../github/project-field-mapper.js';
import { resolveProjectId } from '../../github/project-resolver.js';
import { ProjectDiscovery, DiscoveredProject } from '../../github/project-discovery.js';
import { getGitHubToken } from '../../utils/github-token.js';
import { WorktreeManager } from '../../git/worktree-manager.js';
import { basename } from 'path';

/**
 * Resolve a project identifier (number or partial name) to a DiscoveredProject
 */
async function resolveProjectByIdentifier(
  owner: string,
  repo: string,
  projectIdentifier: string
): Promise<DiscoveredProject | null> {
  const discovery = new ProjectDiscovery(owner, repo);
  const projects = await discovery.getLinkedProjects();

  if (projects.length === 0) {
    return null;
  }

  const searchTerm = projectIdentifier.toLowerCase();

  // Try exact number match first
  const projectNumber = parseInt(projectIdentifier);
  if (!isNaN(projectNumber)) {
    const matched = projects.find(p => p.number === projectNumber);
    if (matched) return matched;
  }

  // Try title match (exact then partial)
  return projects.find(p =>
    p.title.toLowerCase() === searchTerm ||
    p.title.toLowerCase().includes(searchTerm)
  ) || null;
}

/**
 * Parse issue number input that can be:
 * - Single number: "270"
 * - Comma-separated: "270,273,275"
 * - Range: "270-274"
 * - Mixed: "270,273-276,280"
 */
function parseIssueNumbers(input: string): number[] {
  const numbers = new Set<number>();

  // Split by comma for multiple groups
  const parts = input.split(',').map(p => p.trim());

  for (const part of parts) {
    // Check if it's a range (contains hyphen)
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(s => parseInt(s.trim(), 10));

      if (isNaN(start) || isNaN(end)) {
        throw new Error(`Invalid range: ${part}`);
      }

      if (start > end) {
        throw new Error(`Invalid range: ${part} (start must be <= end)`);
      }

      // Add all numbers in the range
      for (let i = start; i <= end; i++) {
        numbers.add(i);
      }
    } else {
      // Single number
      const num = parseInt(part, 10);

      if (isNaN(num)) {
        throw new Error(`Invalid issue number: ${part}`);
      }

      numbers.add(num);
    }
  }

  // Return sorted array
  return Array.from(numbers).sort((a, b) => a - b);
}

interface ReviewOptions {
  pass?: string;         // Status to set if review passes
  fail?: string;         // Status to set if review fails
  branch?: string;       // Branch to review
  verbose?: boolean;
  status?: string;       // Filter by status (default: "In Review")
  maxConcurrent?: number; // Max concurrent reviews
  persona?: string[];    // Personas to run
  project?: string;      // Project number or partial name
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

    // Initialize GitHub Projects - use --project flag if provided, otherwise use config
    let fieldMapper: ProjectFieldMapper | null = null;
    if (options.project) {
      // Resolve project by number or partial name
      const matchedProject = await resolveProjectByIdentifier(
        config.github.owner,
        config.github.repo,
        options.project
      );

      if (!matchedProject) {
        console.error(chalk.red(`Error: No project found matching "${options.project}"`));
        console.log(chalk.yellow('\nRun `auto project list` to see available projects.'));
        process.exit(1);
      }

      console.log(chalk.green(`✓ Using project: ${matchedProject.title} (#${matchedProject.number})`));
      const projectsAPI = new GitHubProjectsAPI(matchedProject.id, config.project as ProjectConfig);
      fieldMapper = new ProjectFieldMapper(projectsAPI, config.project as ProjectConfig);
    } else if (config.project?.enabled) {
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
 * Review a specific item (or multiple items)
 */
export async function itemReviewCommand(issueNumberInput: string, options: ReviewOptions = {}): Promise<void> {
  try {
    // Parse issue numbers (supports single, comma-separated, ranges)
    const issueNumbers = parseIssueNumbers(issueNumberInput);

    if (issueNumbers.length === 0) {
      console.error(chalk.red('Error: No valid issue numbers provided'));
      process.exit(1);
    }

    // Show what we're reviewing
    if (issueNumbers.length === 1) {
      console.log(chalk.blue.bold(`\n🔍 Reviewing Issue #${issueNumbers[0]}\n`));
    } else {
      console.log(chalk.blue.bold(`\n🔍 Reviewing ${issueNumbers.length} Issues: ${issueNumbers.join(', ')}\n`));
    }

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

    // Initialize GitHub Projects - use --project flag if provided, otherwise use config
    let fieldMapper: ProjectFieldMapper | null = null;
    if (options.project) {
      // Resolve project by number or partial name
      const matchedProject = await resolveProjectByIdentifier(
        config.github.owner,
        config.github.repo,
        options.project
      );

      if (!matchedProject) {
        console.error(chalk.red(`Error: No project found matching "${options.project}"`));
        console.log(chalk.yellow('\nRun `auto project list` to see available projects.'));
        process.exit(1);
      }

      console.log(chalk.green(`✓ Using project: ${matchedProject.title} (#${matchedProject.number})`));
      const projectsAPI = new GitHubProjectsAPI(matchedProject.id, config.project as ProjectConfig);
      fieldMapper = new ProjectFieldMapper(projectsAPI, config.project as ProjectConfig);
    } else if (config.project?.enabled) {
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

    // Use defaults from config if pass/fail not specified
    const passStatus = options.pass || 'Dev Complete';
    const failStatus = options.fail || 'Failed Review';

    // Check if using special "worktree" mode
    const useWorktreeMode = options.branch?.toLowerCase() === 'worktree';

    // Show review options
    if (passStatus) {
      const source = options.pass ? '(from --pass)' : '(default)';
      console.log(chalk.green(`  On pass: ${passStatus} ${chalk.gray(source)}`));
    }
    if (failStatus) {
      const source = options.fail ? '(from --fail)' : '(default)';
      console.log(chalk.red(`  On fail: ${failStatus} ${chalk.gray(source)}`));
    }
    if (useWorktreeMode) {
      console.log(chalk.gray(`  Branch: (using each item's worktree branch)`));
    } else if (options.branch) {
      console.log(chalk.gray(`  Branch: ${options.branch}`));
    } else {
      console.log(chalk.gray(`  Branch: (current working directory branch)`));
    }
    console.log('');

    // Process each issue sequentially
    const results: Array<{ issueNum: number; result: any; error?: string }> = [];

    for (let i = 0; i < issueNumbers.length; i++) {
      const issueNum = issueNumbers[i];

      if (issueNumbers.length > 1) {
        console.log(chalk.blue(`\n━━━ Reviewing Issue #${issueNum} (${i + 1}/${issueNumbers.length}) ━━━\n`));
      }

      try {
        // Determine branch to use for this specific issue
        let branchForIssue = options.branch;

        if (useWorktreeMode) {
          // Use git worktree list to find the worktree for this issue
          const worktreeManager = new WorktreeManager(cwd);
          const worktrees = await worktreeManager.listWorktrees();

          // Find worktree whose branch matches the issue pattern
          // Common patterns: issue-283, feature/issue-283, etc.
          const worktree = worktrees.find(w => {
            const branch = w.branch || '';
            // Match: issue-283, feature/issue-283, issue/283, etc.
            return branch.includes(`issue-${issueNum}`) ||
                   branch.includes(`issue/${issueNum}`) ||
                   branch === `${issueNum}`;
          });

          if (!worktree) {
            console.error(chalk.red(`✗ No worktree found for issue #${issueNum}`));
            console.error(chalk.gray(`  Available worktrees: ${worktrees.map(w => w.branch).join(', ')}`));
            results.push({ issueNum, result: null, error: 'No worktree found' });
            continue;
          }

          branchForIssue = worktree.branch;
          console.log(chalk.gray(`  Using worktree branch: ${branchForIssue} (${worktree.path})`));
        }

        // Run review
        const result = await reviewWorker.reviewByIssueNumber(issueNum, {
          passStatus: passStatus,
          failStatus: failStatus,
          branch: branchForIssue,
          verbose: options.verbose,
          personas: options.persona,
        });

        if (!result) {
          console.error(chalk.red(`✗ Could not review issue #${issueNum}`));
          results.push({ issueNum, result: null, error: 'Review failed' });
          continue;
        }

        results.push({ issueNum, result });

        // Display result for this issue
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
          const failedReviews = result.reviewResult.personaReviews.filter((r: any) => !r.passed);
          failedReviews.forEach((review: any) => {
            const personaName = review.persona
              .split('-')
              .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
              .join(' ');
            console.log(chalk.red(`\n  ${personaName}:`));
            console.log(chalk.gray(`  ${review.feedback.substring(0, 200)}${review.feedback.length > 200 ? '...' : ''}`));
          });
          console.log(chalk.yellow(`\nSee full details in the GitHub issue comment.`));
        }

        console.log('');
      } catch (error: unknown) {
        console.error(chalk.red(`✗ Error reviewing issue #${issueNum}:`), error instanceof Error ? error.message : String(error));
        results.push({ issueNum, result: null, error: error instanceof Error ? error.message : String(error) });
      }
    }

    // Display summary if multiple issues
    if (issueNumbers.length > 1) {
      console.log(chalk.blue.bold(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`));
      console.log(chalk.blue.bold(`📋 Review Summary (${issueNumbers.length} issues)\n`));

      const passed = results.filter(r => r.result?.passed).length;
      const failed = results.filter(r => r.result && !r.result.passed).length;
      const errors = results.filter(r => r.error).length;

      console.log(chalk.green(`✅ Passed: ${passed}`));
      console.log(chalk.red(`❌ Failed: ${failed}`));
      if (errors > 0) {
        console.log(chalk.yellow(`⚠️  Errors: ${errors}`));
      }
      console.log('');

      // Show individual results
      results.forEach(({ issueNum, result, error }) => {
        if (error) {
          console.log(chalk.yellow(`#${issueNum}: ERROR - ${error}`));
        } else if (result?.passed) {
          console.log(chalk.green(`#${issueNum}: PASSED`));
        } else {
          console.log(chalk.red(`#${issueNum}: FAILED`));
        }
      });

      console.log(chalk.blue.bold(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`));
    }
  } catch (error: unknown) {
    console.error(chalk.red('\n✗ Error reviewing item:'), error instanceof Error ? error.message : String(error));
    if (options.verbose && error instanceof Error) {
      console.error(error);
    }
    process.exit(1);
  }
}