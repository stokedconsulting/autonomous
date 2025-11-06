#!/usr/bin/env node
/**
 * Clear review comments from GitHub issues
 *
 * Deletes all automated review comments from Review Worker
 * that contain "Code Review: PASSED" or "Code Review: FAILED"
 */

import { GitHubAPI } from '../dist/github/api.js';
import { getGitHubToken } from '../dist/utils/github-token.js';
import { ConfigManager } from '../dist/core/config-manager.js';
import chalk from 'chalk';

async function main() {
  const projectPath = process.argv[2] || process.cwd();
  const issueNumbers = process.argv.slice(3).filter(arg => !arg.startsWith('--'));
  const dryRun = process.argv.includes('--dry-run');

  console.log(chalk.blue('🧹 Clearing review comments\n'));
  console.log(chalk.dim(`Project: ${projectPath}`));
  if (dryRun) {
    console.log(chalk.yellow('🔍 DRY RUN MODE - No comments will be deleted\n'));
  }
  console.log('');

  // Load configuration
  const configManager = new ConfigManager(projectPath);
  await configManager.load();
  const config = configManager.getConfig();

  // Initialize GitHub API
  const githubToken = await getGitHubToken(config.github.token);
  const githubAPI = new GitHubAPI(githubToken, config.github.owner, config.github.repo);

  // Get issue numbers to process
  let issuesToProcess = [];

  if (issueNumbers.length > 0) {
    // Process specific issues
    issuesToProcess = issueNumbers.map(num => parseInt(num, 10)).filter(num => !isNaN(num));
    console.log(chalk.blue(`Processing ${issuesToProcess.length} specific issue(s): ${issuesToProcess.join(', ')}\n`));
  } else {
    // Get all open issues
    console.log(chalk.blue('Fetching all open issues...\n'));
    const issues = await githubAPI.getIssues({ state: 'open' });
    issuesToProcess = issues.map(issue => issue.number);
    console.log(chalk.blue(`Found ${issuesToProcess.length} open issues to check\n`));
  }

  if (issuesToProcess.length === 0) {
    console.log(chalk.yellow('⚠️  No issues to process'));
    return;
  }

  // Process each issue
  let totalDeleted = 0;
  let totalChecked = 0;
  let errors = 0;

  for (const issueNumber of issuesToProcess) {
    try {
      // Get all comments for this issue
      const comments = await githubAPI.getComments(issueNumber);

      // Filter for review comments
      const reviewComments = comments.filter(comment => {
        const body = comment.body || '';
        return (
          (body.includes('## ✅ Code Review: PASSED') ||
           body.includes('## ❌ Code Review: FAILED')) &&
          body.includes('*Automated by Review Worker*')
        );
      });

      totalChecked++;

      if (reviewComments.length === 0) {
        // console.log(chalk.gray(`  #${issueNumber}: No review comments found`));
        continue;
      }

      // Delete each review comment
      for (const comment of reviewComments) {
        if (dryRun) {
          console.log(chalk.yellow(`  #${issueNumber}: Would delete comment ${comment.id} (${reviewComments.length} total)`));
        } else {
          await githubAPI.deleteComment(comment.id);
          console.log(chalk.green(`  ✓ #${issueNumber}: Deleted review comment ${comment.id}`));
        }
        totalDeleted++;
      }
    } catch (error) {
      console.error(chalk.red(`  ✗ #${issueNumber}: Error - ${error.message}`));
      errors++;
    }
  }

  // Summary
  console.log(chalk.blue.bold(`\n📊 Summary:`));
  console.log(chalk.gray(`  Issues checked: ${totalChecked}`));
  console.log(chalk.green(`  Comments deleted: ${totalDeleted}`));
  if (errors > 0) {
    console.log(chalk.red(`  Errors: ${errors}`));
  }
  if (dryRun) {
    console.log(chalk.yellow(`\n💡 Run without --dry-run to actually delete comments`));
  }
  console.log('');
}

main().catch(error => {
  console.error(chalk.red('\n✗ Error:'), error.message);
  if (error.stack) {
    console.error(chalk.gray(error.stack));
  }
  process.exit(1);
});
