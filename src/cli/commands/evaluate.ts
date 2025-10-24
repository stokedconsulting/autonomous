/**
 * Evaluate command - Evaluate issues without starting autonomous mode
 */

import chalk from 'chalk';
import { ConfigManager } from '../../core/config-manager.js';
import { IssueEvaluator } from '../../core/issue-evaluator.js';
import { GitHubAPI } from '../../github/api.js';
import { getGitHubToken } from '../../utils/github-token.js';
import { resolveProjectIdOrExit } from '../../github/project-resolver.js';

interface EvaluateOptions {
  force?: boolean;
  verbose?: boolean;
  issues?: string;
}

export async function evaluateCommand(options: EvaluateOptions): Promise<void> {
  console.log(chalk.blue.bold('\n📊 Evaluating Issues\n'));

  try {
    const cwd = process.cwd();

    // Load configuration
    console.log('Loading configuration...');
    const configManager = new ConfigManager(cwd);
    await configManager.load();
    const config = configManager.getConfig();
    console.log(chalk.green('✓ Configuration loaded'));

    // Get GitHub token
    const githubToken = await getGitHubToken(config.github.token);
    const githubAPI = new GitHubAPI(githubToken, config.github.owner, config.github.repo);

    // Initialize issue evaluator
    const claudePath = config.llms?.claude?.cliPath || 'claude';
    const issueEvaluator = new IssueEvaluator(cwd, claudePath, githubAPI);

    // Fetch issues
    console.log('\nFetching issues from GitHub...');

    let issues;
    if (options.issues) {
      // Evaluate specific issues
      const issueNumbers = options.issues.split(',').map(n => parseInt(n.trim(), 10));
      issues = await Promise.all(
        issueNumbers.map(async (num) => {
          const issue = await githubAPI.getIssue(num);
          return issue;
        })
      );
      console.log(chalk.green(`✓ Found ${issues.length} issue(s) to evaluate`));
    } else if (config.project?.enabled) {
      // Use project status instead of labels when project integration is enabled
      const { GitHubProjectsAPI } = await import('../../github/projects-api.js');
      const projectId = await resolveProjectIdOrExit(config.github.owner, config.github.repo);
      const projectsAPI = new GitHubProjectsAPI(projectId, config.project);

      // Ensure autonomous view exists with all required fields
      await projectsAPI.ensureAutonomousView();

      const readyItems = await projectsAPI.getReadyItems();
      const issueNumbers = readyItems.map(item => item.content.number).filter(Boolean) as number[];

      issues = await Promise.all(
        issueNumbers.map(async (num) => {
          const issue = await githubAPI.getIssue(num);
          return issue;
        })
      );

      const readyValues = config.project.fields.status.readyValues.join(', ');
      console.log(chalk.green(`✓ Found ${issues.length} issue(s) in project with status: ${readyValues}`));
    } else {
      // Fall back to labels when project integration is not enabled
      const labels = config.github.labels || ['autonomous-ready'];
      const excludeLabels = config.github.excludeLabels || [];

      issues = await githubAPI.getIssues({
        labels,
        state: 'open',
      });

      // Filter out excluded labels
      if (excludeLabels.length > 0) {
        issues = issues.filter((issue) => {
          const issueLabels = issue.labels.map((l) => l.name);
          return !excludeLabels.some((label) => issueLabels.includes(label));
        });
      }

      console.log(chalk.green(`✓ Found ${issues.length} issue(s) with label(s): ${labels.join(', ')}`));
    }

    if (issues.length === 0) {
      console.log(chalk.yellow('\nNo issues to evaluate.'));
      if (!options.issues) {
        console.log(chalk.dim('Make sure issues have the correct labels configured in .autonomous-config.json'));
      }
      return;
    }

    // Evaluate issues
    console.log(chalk.dim('This may take a few minutes depending on issue count and complexity.\n'));

    const result = await issueEvaluator.evaluateIssues(issues, {
      forceReeval: options.force,
      verbose: options.verbose,
      postClarificationComments: config.github.postClarificationComments ?? true, // Default to true
    });

    // Summary
    console.log('\n' + chalk.blue('Evaluation Summary:'));
    console.log(`  ${chalk.green('✓')} Evaluated: ${result.evaluated.length}`);
    if (result.skipped.length > 0) {
      console.log(`  ${chalk.yellow('⊘')} Skipped (cached): ${result.skipped.length}`);
    }

    if (options.verbose && result.evaluated.length > 0) {
      console.log('\n' + chalk.blue('Top Issues by AI Priority:'));
      const sorted = result.evaluated
        .sort((a, b) => b.scores.aiPriorityScore - a.scores.aiPriorityScore)
        .slice(0, 5);

      sorted.forEach((evaluation, idx) => {
        console.log(
          `  ${idx + 1}. #${evaluation.issueNumber} - ${chalk.dim('Score:')} ${evaluation.scores.aiPriorityScore.toFixed(2)} ${chalk.dim('| Complexity:')} ${evaluation.classification.complexity} ${chalk.dim('| Impact:')} ${evaluation.classification.impact}`
        );
      });
    }

    console.log('\n' + chalk.green('✓ Evaluation complete!'));
    console.log(chalk.dim('\nRun "autonomous project list-ready" to see prioritized issues'));
    console.log(chalk.dim('Or run "autonomous start" to begin autonomous processing'));

  } catch (error) {
    console.error(chalk.red('\n✗ Evaluation failed:'));
    console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
    process.exit(1);
  }
}
