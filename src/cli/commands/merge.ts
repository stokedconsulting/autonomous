/**
 * Merge command - Manual merge from stage to main
 */

import chalk from 'chalk';
import { $ } from 'zx';
import { ConfigManager } from '../../core/config-manager.js';

interface MergeOptions {
  dryRun?: boolean;
  verbose?: boolean;
}

/**
 * Merge stage branch to main
 */
export async function mergeToMainCommand(options: MergeOptions = {}): Promise<void> {
  console.log(chalk.blue.bold(`\n🔀 Merging Stage to Main\n`));

  try {
    const cwd = process.cwd();

    // Load configuration
    const configManager = new ConfigManager(cwd);
    await configManager.initialize();
    const config = configManager.getConfig();

    const mainBranch = config.mergeWorker?.mainBranch || 'main';
    const stageBranch = config.mergeWorker?.stageBranch || 'stage';

    $.cwd = cwd;
    $.verbose = options.verbose || false;

    // Check current branch
    const currentBranch = await $`git rev-parse --abbrev-ref HEAD`;
    const current = currentBranch.stdout.trim();

    if (current !== mainBranch) {
      console.log(chalk.yellow(`⚠️  You are on branch '${current}', switching to '${mainBranch}'...`));
      await $`git checkout ${mainBranch}`;
    }

    // Update main from remote
    console.log(chalk.blue('Updating main branch...'));
    await $`git fetch origin ${mainBranch}`;
    await $`git pull origin ${mainBranch}`;

    // Update stage from remote
    console.log(chalk.blue('Fetching stage branch...'));
    await $`git fetch origin ${stageBranch}`;

    // Show diff
    console.log(chalk.blue('\nChanges to be merged:\n'));
    const diffStat = await $`git diff --stat ${mainBranch}..origin/${stageBranch}`;
    console.log(diffStat.stdout);

    // Show commits
    console.log(chalk.blue('\nCommits to be merged:\n'));
    const commits = await $`git log ${mainBranch}..origin/${stageBranch} --oneline`;
    console.log(commits.stdout);

    if (options.dryRun) {
      console.log(chalk.yellow('\n✓ Dry run complete - no changes made\n'));
      console.log(chalk.gray('To perform the actual merge, run:'));
      console.log(chalk.gray(`  auto merge-to-main\n`));
      return;
    }

    // Confirm merge
    console.log(chalk.yellow('\n⚠️  You are about to merge stage to main'));
    console.log(chalk.gray('Press Ctrl+C to cancel, or Enter to continue...'));

    // Wait for user confirmation (in Node.js)
    await new Promise<void>((resolve) => {
      process.stdin.once('data', () => {
        resolve();
      });
    });

    // Perform merge
    console.log(chalk.blue('\nMerging stage to main...'));
    try {
      await $`git merge --no-ff origin/${stageBranch} -m "Merge ${stageBranch} to ${mainBranch}"`;
      console.log(chalk.green('\n✓ Merge successful!'));

      // Push to remote
      console.log(chalk.blue('\nPushing to remote...'));
      await $`git push origin ${mainBranch}`;
      console.log(chalk.green('✓ Pushed to remote'));

      // Show final status
      console.log(chalk.blue('\nFinal status:'));
      const finalCommit = await $`git log -1 --oneline`;
      console.log(finalCommit.stdout);

      console.log(chalk.green.bold('\n✅ Stage successfully merged to main!\n'));
    } catch (error) {
      console.error(chalk.red('\n✗ Merge failed:'), error);
      console.log(chalk.yellow('\nYou may have merge conflicts. Resolve them and run:'));
      console.log(chalk.gray('  git add .'));
      console.log(chalk.gray('  git commit'));
      console.log(chalk.gray('  git push origin main\n'));
      process.exit(1);
    }
  } catch (error: unknown) {
    console.error(chalk.red('\n✗ Error merging to main:'), error instanceof Error ? error.message : String(error));
    if (options.verbose && error instanceof Error) {
      console.error(error);
    }
    process.exit(1);
  }
}

/**
 * Show diff between stage and main
 */
export async function showStageDiffCommand(options: MergeOptions = {}): Promise<void> {
  console.log(chalk.blue.bold(`\n📊 Stage vs Main Diff\n`));

  try {
    const cwd = process.cwd();

    // Load configuration
    const configManager = new ConfigManager(cwd);
    await configManager.initialize();
    const config = configManager.getConfig();

    const mainBranch = config.mergeWorker?.mainBranch || 'main';
    const stageBranch = config.mergeWorker?.stageBranch || 'stage';

    $.cwd = cwd;
    $.verbose = false;

    // Fetch latest
    await $`git fetch origin ${mainBranch}`;
    await $`git fetch origin ${stageBranch}`;

    // Show commits
    console.log(chalk.blue('Commits on stage not on main:\n'));
    const commits = await $`git log origin/${mainBranch}..origin/${stageBranch} --pretty=format:"%h %s" --abbrev-commit`;
    if (commits.stdout.trim()) {
      console.log(commits.stdout);
    } else {
      console.log(chalk.gray('  (none)'));
    }

    console.log(chalk.blue('\n\nFile changes:\n'));
    const diffStat = await $`git diff --stat origin/${mainBranch}..origin/${stageBranch}`;
    if (diffStat.stdout.trim()) {
      console.log(diffStat.stdout);
    } else {
      console.log(chalk.gray('  (no changes)'));
    }

    if (options.verbose) {
      console.log(chalk.blue('\n\nFull diff:\n'));
      const diff = await $`git diff origin/${mainBranch}..origin/${stageBranch}`;
      console.log(diff.stdout);
    }

    console.log('');
  } catch (error: unknown) {
    console.error(chalk.red('\n✗ Error showing diff:'), error instanceof Error ? error.message : String(error));
    if (options.verbose && error instanceof Error) {
      console.error(error);
    }
    process.exit(1);
  }
}
