/**
 * Push command - Auto-generate changeset, commit, and push changes
 * Based on the pnpm push workflow from v3
 */

import { $ } from 'zx';
import { promises as fs } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { ConfigManager } from '../../core/config-manager.js';
import { AutonomousConfig } from '../../types/config.js';
import { GitHubProjectsAPI } from '../../github/projects-api.js';
import { resolveProjectId } from '../../github/project-resolver.js';

interface PushOptions {
  pr?: boolean;
  skipMainConflictCheck?: boolean;
}

export async function pushCommand(options: PushOptions): Promise<void> {
  console.log(chalk.blue.bold('\n🚀 Autonomous Push\n'));

  try {
    const cwd = process.cwd();
    const configManager = new ConfigManager(cwd);

    // Initialize config (handles both old and new locations)
    await configManager.initialize();
    const config = configManager.getConfig();
    const claudePath = config.llms?.claude?.cliPath || 'claude';

    // Step 1: Check for conflicts with remote main (unless on main or skipped)
    if (!options.skipMainConflictCheck) {
      await checkAndResolveMainConflicts(claudePath);
    }

    // Step 2: Generate changeset (if .changeset directory exists)
    const changesetDir = join(cwd, '.changeset');
    try {
      await fs.access(changesetDir);
      console.log(chalk.blue('📝 Generating changeset...'));
      await generateChangeset(cwd, claudePath);
    } catch {
      console.log(chalk.gray('No .changeset directory found, skipping changeset generation'));
    }

    // Step 3: Commit and push
    console.log(chalk.blue('\n💾 Committing and pushing changes...'));
    await commitAndPush(claudePath, config, options.pr || false);

    console.log(chalk.green('\n✓ Push complete!'));
  } catch (error: unknown) {
    console.error(chalk.red('\n✗ Error during push:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Generate changeset using Claude
 */
async function generateChangeset(cwd: string, claudePath: string): Promise<void> {
  $.verbose = false;

  // Determine base ref
  let baseRef = 'origin/main';
  try {
    await $`git rev-parse --verify origin/main`;
  } catch {
    baseRef = 'main';
  }

  console.log(chalk.gray(`  Analyzing changes from ${baseRef}...working directory`));

  // Determine impacted packages from working directory (staged + unstaged + untracked)
  // Get all modified/added/renamed tracked files (staged + unstaged)
  const diffResult = await $`git diff --name-only --diff-filter=ACMRT ${baseRef}`;
  const trackedFiles = diffResult.stdout.trim().split('\n').filter(Boolean);
  
  // Get untracked files
  const untrackedResult = await $`git ls-files --others --exclude-standard`;
  const untrackedFiles = untrackedResult.stdout.trim().split('\n').filter(Boolean);
  
  // Combine all changed files
  const changedFiles = [...trackedFiles, ...untrackedFiles];

  const impactedPaths = changedFiles
    .filter((f: string) => f.match(/^(apps|packages)\//))
    .map((f: string) => f.split('/').slice(0, 2).join('/'))
    .filter((v: string, i: number, a: string[]) => a.indexOf(v) === i); // unique

  if (impactedPaths.length === 0) {
    console.log(chalk.yellow('  No impacted packages detected. Skipping changeset.'));
    return;
  }

  // Read package names
  const packageNames: string[] = [];
  for (const path of impactedPaths) {
    try {
      const pkgPath = join(cwd, path, 'package.json');
      const pkgData = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
      packageNames.push(pkgData.name);
    } catch {
      // Skip if package.json doesn't exist
    }
  }

  if (packageNames.length === 0) {
    console.log(chalk.yellow('  No valid packages found. Skipping changeset.'));
    return;
  }

  console.log(chalk.gray(`  Impacted packages: ${packageNames.join(', ')}`));

  const packageList = packageNames.map((n) => `  * ${n}`).join('\n');

  const prompt = `You are an expert release manager. Generate a Changesets entry (single Markdown file) for a pnpm monorepo.

**IMPORTANT**: Use git commands to analyze the changes yourself. Don't wait for piped input.

Commands to run:
- \`git diff --stat ${baseRef}\` - See what files changed (includes staged + unstaged)
- \`git diff ${baseRef} -- apps/ packages/\` - See detailed changes in packages
- \`git status --short\` - See staged, unstaged, and untracked files

Based on your analysis, generate ONLY the Markdown content for the .changeset file:

Format:
---
'<packageName>': <bump>
...
---

<summary of changes in imperative mood>

Rules:
- Only use 'patch', 'minor', or 'major' for <bump>
- Include ALL of these impacted packages:
${packageList}
- Choose bump based on Semantic Versioning:
  * patch: bug fixes, minor tweaks, documentation
  * minor: new features, non-breaking changes
  * major: breaking changes
- Keep the summary to 1-3 concise sentences in imperative mood
- Output ONLY the changeset markdown (no explanations, no code fences)`;

  console.log(chalk.gray('  Asking Claude to analyze changes...'));

  const result = await $`echo ${prompt} | ${claudePath} --dangerously-skip-permissions chat`;
  const content = result.stdout.trim();

  if (!content) {
    throw new Error('Claude returned no content for changeset');
  }

  // Clean content - extract only changeset portion
  let clean = content;
  if (content.includes('```')) {
    // Remove code fences
    clean = content.replace(/```[a-z]*\n/g, '').replace(/\n```/g, '');
  }

  // Extract from first --- onwards
  const match = clean.match(/^---$/m);
  if (match) {
    clean = clean.substring(clean.indexOf('---'));
  }

  // Verify format
  if (!clean.startsWith('---')) {
    console.warn(chalk.yellow('  Warning: Generated changeset may not be valid'));
  }

  // Save changeset
  const timestamp = Math.floor(Date.now() / 1000);
  const changesetPath = join(cwd, '.changeset', `ai-${timestamp}.md`);
  await fs.writeFile(changesetPath, clean, 'utf-8');

  console.log(chalk.green(`  ✓ Created ${changesetPath}`));
}

/**
 * Check for conflicts with remote main and resolve them automatically
 */
async function checkAndResolveMainConflicts(claudePath: string): Promise<void> {
  $.verbose = false;

  // Get current branch
  const branchResult = await $`git rev-parse --abbrev-ref HEAD`;
  const currentBranch = branchResult.stdout.trim();

  // Skip if already on main
  if (currentBranch === 'main' || currentBranch === 'master') {
    return;
  }

  console.log(chalk.blue('🔍 Checking for conflicts with remote main...'));

  try {
    // Fetch latest main without modifying working tree
    await $`git fetch origin main`;
    console.log(chalk.gray('  Fetched latest origin/main'));

    // Check if merge would result in conflicts
    try {
      // Try a test merge to see if there would be conflicts
      await $`git merge-tree $(git merge-base HEAD origin/main) HEAD origin/main`;
      console.log(chalk.green('  ✓ No conflicts with main'));
      return;
    } catch (mergeTestError) {
      const testOutput = mergeTestError instanceof Error ? mergeTestError.message : String(mergeTestError);

      // Check if there are actual conflicts (not just differences)
      if (!testOutput.includes('<<<<<<< ') && !testOutput.includes('=======') && !testOutput.includes('>>>>>>> ')) {
        console.log(chalk.green('  ✓ No conflicts with main'));
        return;
      }

      console.log(chalk.yellow('  ⚠️  Conflicts detected with main. Resolving automatically...'));
    }

    // Merge main into current branch
    try {
      await $`git merge origin/main --no-edit`;
      console.log(chalk.green('  ✓ Merged main without conflicts'));
      return;
    } catch (mergeError) {
      const mergeMsg = mergeError instanceof Error ? mergeError.message : String(mergeError);

      // Check if we have merge conflicts
      if (mergeMsg.includes('CONFLICT') || mergeMsg.includes('conflict')) {
        console.log(chalk.yellow('  Resolving merge conflicts with Claude...'));

        try {
          // Use existing conflict resolution function
          await resolveConflictsWithClaude(claudePath);

          // Complete the merge
          await $`git commit --no-edit`;
          console.log(chalk.green('  ✓ Resolved conflicts and completed merge with main'));
        } catch (conflictError) {
          console.error(chalk.red('\n  ✗ Could not automatically resolve conflicts with main.'));
          console.log(chalk.yellow('  Please resolve manually:'));
          console.log(chalk.yellow('    1. Run: git status'));
          console.log(chalk.yellow('    2. Resolve conflicts in the listed files'));
          console.log(chalk.yellow('    3. Run: git add <resolved-files>'));
          console.log(chalk.yellow('    4. Run: git commit'));
          console.log(chalk.yellow('    5. Run: auto push'));
          throw new Error('Conflict resolution with main failed: ' + (conflictError instanceof Error ? conflictError.message : String(conflictError)));
        }
      } else {
        // Some other merge error
        throw mergeError;
      }
    }
  } catch (error) {
    // If fetch fails or other unexpected error
    if (error instanceof Error && error.message.includes('Conflict resolution with main failed')) {
      throw error; // Re-throw conflict resolution failures
    }
    console.log(chalk.yellow('  Warning: Could not check for main conflicts'));
    console.log(chalk.gray(`  ${error instanceof Error ? error.message : String(error)}`));
  }
}

/**
 * Commit and push changes
 */
async function commitAndPush(
  claudePath: string,
  config: AutonomousConfig,
  createPR: boolean
): Promise<void> {
  $.verbose = false;

  // Stage all changes
  await $`git add -A`;

  // Check if there are changes
  try {
    await $`git diff --cached --quiet`;
    console.log(chalk.yellow('No staged changes to commit.'));
    return;
  } catch {
    // Has changes, continue
  }

  // Get staged files and determine scopes
  const filesResult = await $`git diff --cached --name-only`;
  const files = filesResult.stdout.trim().split('\n');

  // Determine scopes based on config or defaults
  const scopeMap = config.push?.scopeMap || getDefaultScopeMap();
  const scopes = new Set<string>();

  for (const file of files) {
    for (const [pattern, scope] of Object.entries(scopeMap)) {
      if (file.match(new RegExp(pattern as string))) {
        scopes.add(scope as string);
        break;
      }
    }
  }

  const scopeJoined = Array.from(scopes).join(',') || 'repo';

  // Build commit message prompt
  const allowedTypes = ['feat', 'fix', 'docs', 'chore', 'refactor', 'perf', 'test', 'build', 'ci', 'style', 'revert'];

  const commitPrompt = `You need to create a Conventional Commit message for staged changes in a git repository.

**IMPORTANT**: Analyze the changes yourself using git commands. Do NOT wait for piped input.

First, run these commands to understand the changes:
1. \`git diff --cached --stat\` - See statistics of what changed
2. \`git diff --cached --name-only\` - See which files changed
3. \`git diff --cached\` - See the actual changes
4. \`git log --oneline -10\` - See recent commits for context

Based on your analysis, generate a commit message following these rules:

**Format Requirements:**
- First line: \`<type>(<scope>): <subject>\`
  - Must be ≤ 72 characters
  - Use imperative mood (e.g., "add" not "added")
  - No period at the end
- Leave a blank line after first line
- Optional body with more details
  - **CRITICAL**: Each line in the body MUST be ≤ 100 characters
  - Break long sentences into multiple shorter lines
  - This is enforced by commitlint and will fail if violated

**Type** must be one of: ${allowedTypes.join(', ')}

**Scope** should be from: ${scopeJoined}

**Subject Rules:**
- Start with lowercase
- Use imperative mood
- Be specific but concise

**Output Requirements:**
- Output ONLY the commit message
- No code fences, no markdown formatting, no explanations
- Just the raw commit message text

Example output:
feat(site): add dark mode toggle to user settings

Implement user-requested dark mode feature with system preference
detection and automatic theme switching.`;

  console.log(chalk.gray('  Generating commit message...'));

  const msgResult = await $`echo ${commitPrompt} | ${claudePath} --dangerously-skip-permissions chat`;
  let msg = msgResult.stdout.trim();

  if (!msg) {
    throw new Error('Claude returned empty commit message');
  }

  // Clean message - remove code fences
  msg = msg.replace(/```[a-z]*\n/g, '').replace(/\n```/g, '');

  // Extract header line (conventional commit format)
  const headerMatch = msg.match(/^(feat|fix|docs|chore|refactor|perf|test|build|ci|style|revert)(\([a-z0-9,-]+\))?!?:\s.+$/m);
  let header = headerMatch ? headerMatch[0] : `chore(${scopeJoined}): update changes`;

  // Cap header at 72 chars
  if (header.length > 72) {
    header = header.substring(0, 72);
  }

  // Extract body
  const headerIndex = msg.indexOf(header);
  let body = headerIndex >= 0 ? msg.substring(headerIndex + header.length).trim() : '';

  // Wrap body lines at 100 characters to comply with commitlint
  if (body) {
    body = wrapTextAt100Chars(body);
  }

  // Build final commit message
  const finalMsg = body ? `${header}\n\n${body}` : header;

  console.log(chalk.gray('  Commit message:'));
  console.log(chalk.gray('  ' + finalMsg.split('\n').join('\n  ')));
  console.log(chalk.gray('  ---'));

  // Commit
  await $`git commit -m ${finalMsg}`;

  // Get current branch
  const branchResult = await $`git rev-parse --abbrev-ref HEAD`;
  let branch = branchResult.stdout.trim();

  // Check if we're in detached HEAD state
  if (branch === 'HEAD') {
    console.error(chalk.red('\n  ✗ Not on a branch (detached HEAD state).'));
    console.log(chalk.yellow('  Please checkout a branch first:'));
    console.log(chalk.yellow('    git checkout main'));
    throw new Error('Cannot push from detached HEAD state');
  }

  console.log(chalk.gray(`  Pushing branch ${branch}...`));

  // Try to push, and if rejected due to remote changes, pull and retry
  try {
    await $`git push --quiet -u origin ${branch}`;
    console.log(chalk.green(`  ✓ Pushed branch ${branch}`));
  } catch (pushError: unknown) {
    const errorMsg = pushError instanceof Error ? pushError.message : String(pushError);

    // Check if push failed due to pre-push hook (lint/type-check failures)
    if (errorMsg.includes('ERROR') && (errorMsg.includes('lint') || errorMsg.includes('type-check') || errorMsg.includes('turbo'))) {
      const hasLintError = errorMsg.includes('lint');
      const hasTypeError = errorMsg.includes('type-check');
      
      console.log(chalk.yellow(`  Pre-push hook failed (${hasLintError ? 'lint' : ''}${hasLintError && hasTypeError ? ' and ' : ''}${hasTypeError ? 'type-check' : ''}). Attempting to fix...`));

      try {
        let fixesApplied = false;

        // Fix lint errors if present
        if (hasLintError) {
          await fixLintErrors(claudePath);
          fixesApplied = true;
        }

        // Fix type errors if present
        if (hasTypeError) {
          await fixTypeErrors(claudePath);
          fixesApplied = true;
        }

        // If no specific error detected, try both
        if (!hasLintError && !hasTypeError) {
          try {
            await fixLintErrors(claudePath);
            fixesApplied = true;
          } catch {
            // Lint might have passed, try type-check
          }
          
          try {
            await fixTypeErrors(claudePath);
            fixesApplied = true;
          } catch {
            // Type-check might have passed
          }
        }

        if (fixesApplied) {
          // Amend the commit with fixes
          await $`git commit --amend --no-edit`;
          console.log(chalk.gray('  Amended commit with fixes'));

          // Retry push
          await $`git push --quiet -u origin ${branch}`;
          console.log(chalk.green(`  ✓ Pushed branch ${branch}`));
        } else {
          throw new Error('No fixes could be applied');
        }
      } catch (fixError: unknown) {
        console.error(chalk.red('\n  ✗ Could not automatically fix errors.'));
        console.log(chalk.yellow('  Please fix errors manually and retry push.'));
        throw fixError;
      }
    }
    // Check if push was rejected because remote has changes we don't have
    else if (errorMsg.includes('rejected') && errorMsg.includes('fetch first')) {
      console.log(chalk.yellow('  Remote has changes not present locally. Pulling with rebase...'));

      try {
        // Pull with rebase to integrate remote changes
        await $`git pull --rebase origin ${branch}`;
        console.log(chalk.gray('  Successfully rebased. Retrying push...'));

        // Retry push
        await $`git push --quiet -u origin ${branch}`;
        console.log(chalk.green(`  ✓ Pushed branch ${branch}`));
      } catch (rebaseError: unknown) {
        const rebaseMsg = rebaseError instanceof Error ? rebaseError.message : String(rebaseError);

        // Check if we have a rebase conflict
        if (rebaseMsg.includes('conflict') || rebaseMsg.includes('CONFLICT')) {
          console.log(chalk.yellow('\n  ⚠️  Rebase conflict detected. Attempting automated resolution with Claude...'));

          try {
            await resolveConflictsWithClaude(claudePath);

            // Continue the rebase
            await $`git rebase --continue`;
            console.log(chalk.gray('  Successfully continued rebase after conflict resolution'));

            // Retry push
            await $`git push --quiet -u origin ${branch}`;
            console.log(chalk.green(`  ✓ Pushed branch ${branch}`));
          } catch (conflictError: unknown) {
            console.error(chalk.red('\n  ✗ Could not automatically resolve conflicts. Please resolve manually:'));
            console.log(chalk.yellow('    1. Run: git status'));
            console.log(chalk.yellow('    2. Resolve conflicts in the listed files'));
            console.log(chalk.yellow('    3. Run: git add <resolved-files>'));
            console.log(chalk.yellow('    4. Run: git rebase --continue'));
            console.log(chalk.yellow('    5. Run: git push'));
            throw new Error('Conflict resolution failed: ' + (conflictError instanceof Error ? conflictError.message : String(conflictError)));
          }
        }

        // Some other error during rebase or push
        throw rebaseError;
      }
    } else {
      // Different push error, re-throw
      throw pushError;
    }
  }

  // Handle PR if requested
  if (createPR) {
    await handlePR(claudePath, branch, config);
  }
}

/**
 * Create or update PR
 */
async function handlePR(claudePath: string, branch: string, config: AutonomousConfig): Promise<void> {
  // Check if gh CLI is available
  try {
    await $`which gh`;
  } catch {
    console.log(chalk.yellow('\n⚠️  GitHub CLI (gh) not found. Skipping PR management.'));
    return;
  }

  $.verbose = false;

  // Check for existing PR
  const existingPRResult = await $`gh pr list --head ${branch} --json number --jq '.[0].number' || echo ""`;
  const existingPR = existingPRResult.stdout.trim();

  if (existingPR) {
    console.log(chalk.blue(`\n📋 Updating existing PR #${existingPR}...`));
    const url = (await $`gh pr view ${existingPR} --json url --jq .url`).stdout.trim();
    console.log(chalk.green(`  ✓ PR updated: ${url}`));
  } else {
    console.log(chalk.blue('\n📋 Creating pull request...'));

    // Determine base branch
    let baseBranch = 'main';
    try {
      await $`git rev-parse --verify origin/main`;
    } catch {
      baseBranch = 'master';
    }

    // Generate PR content
    const prPrompt = `You need to create a GitHub Pull Request for changes in this branch.

**IMPORTANT**: Analyze the branch changes yourself using git commands.

Run these commands:
1. \`git log ${baseBranch}..${branch} --oneline\` - See all commits
2. \`git diff ${baseBranch}...${branch} --stat\` - See statistics
3. \`git diff ${baseBranch}...${branch}\` - See actual changes

Generate a PR title and body:

**Output Format:**
- Line 1: PR title (max 72 chars, imperative mood)
- Line 2: Blank
- Line 3+: PR body in markdown

Example:
feat(site): implement user authentication

## Summary
Adds cookie-based authentication system with JWT tokens.

## Changes
- Implement login/logout endpoints
- Add auth middleware
- Update frontend auth state management`;

    const prResult = await $`echo ${prPrompt} | ${claudePath} --dangerously-skip-permissions chat`;
    const prContent = prResult.stdout.trim();

    const lines = prContent.split('\n');
    const title = lines[0].replace(/```[a-z]*/, '').trim();
    const body = lines.slice(2).join('\n').replace(/```/g, '').trim();

    const prUrlResult = await $`gh pr create --base ${baseBranch} --head ${branch} --title ${title} --body ${body}`;
    const prUrl = prUrlResult.stdout.trim();

    console.log(chalk.green(`  ✓ PR created: ${prUrl}`));

    // Update GitHub project status to "In Review" if project integration is enabled
    await updateProjectStatusToInReview(branch, config);
  }
}

/**
 * Update GitHub project status to "In Review" after PR creation
 */
async function updateProjectStatusToInReview(branch: string, config: AutonomousConfig): Promise<void> {
  // Check if project integration is enabled
  if (!config.project?.enabled) {
    return;
  }

  try {
    // Extract issue number from branch name (e.g., feature/issue-199-... -> 199)
    const issueMatch = branch.match(/issue-(\d+)/);
    if (!issueMatch) {
      console.log(chalk.gray('  ℹ️  Could not extract issue number from branch name, skipping status update'));
      return;
    }

    const issueNumber = parseInt(issueMatch[1], 10);
    console.log(chalk.blue(`\n📊 Updating project status for issue #${issueNumber}...`));

    // Get project ID
    const projectId = await resolveProjectId(config.github.owner, config.github.repo, false);
    if (!projectId) {
      console.log(chalk.yellow('  ⚠️  Could not resolve project ID, skipping status update'));
      return;
    }

    // Initialize GitHub Projects API
    const projectsAPI = new GitHubProjectsAPI(projectId, config.project);

    // Get project item ID for this issue
    const projectItemId = await projectsAPI.getProjectItemIdByIssue(issueNumber);

    if (!projectItemId) {
      console.log(chalk.yellow(`  ⚠️  Issue #${issueNumber} not found in project, skipping status update`));
      return;
    }

    // Update status to "in-review"
    await projectsAPI.updateItemStatus(projectItemId, 'in-review');
    console.log(chalk.green(`  ✓ Updated issue #${issueNumber} status to "In Review"`));
  } catch (error: unknown) {
    console.log(chalk.yellow(`  ⚠️  Could not update project status: ${error instanceof Error ? error.message : String(error)}`));
  }
}

/**
 * Fix lint errors in the codebase
 */
async function fixLintErrors(_claudePath: string): Promise<void> {
  $.verbose = false;

  const cwd = process.cwd();

  // Detect package manager and lint command
  let lintCommand = '';
  let fixCommand = '';

  // Check for package.json to determine project structure
  try {
    const pkgPath = join(cwd, 'package.json');
    const pkgContent = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(pkgContent);

    // Check if it's a turbo monorepo
    if (pkg.devDependencies?.turbo || pkg.dependencies?.turbo) {
      console.log(chalk.gray('  Detected turbo monorepo, running lint:fix...'));

      // Try to find pnpm, npm, or yarn
      try {
        await $`which pnpm`;
        lintCommand = 'pnpm run lint';
        fixCommand = 'pnpm run lint:fix';
      } catch {
        try {
          await $`which yarn`;
          lintCommand = 'yarn lint';
          fixCommand = 'yarn lint:fix';
        } catch {
          lintCommand = 'npm run lint';
          fixCommand = 'npm run lint:fix';
        }
      }
    } else if (pkg.scripts?.lint) {
      // Standard project with lint script
      console.log(chalk.gray('  Running lint:fix...'));
      fixCommand = pkg.scripts['lint:fix'] ? 'npm run lint:fix' : 'npm run lint -- --fix';
    }
  } catch {
    // No package.json, try eslint directly
    try {
      await $`which eslint`;
      fixCommand = 'npx eslint . --fix';
    } catch {
      throw new Error('Could not determine how to run linting');
    }
  }

  if (!fixCommand) {
    throw new Error('No lint fix command available');
  }

  // Run lint fix
  console.log(chalk.gray(`  Running: ${fixCommand}`));
  try {
    await $`sh -c ${fixCommand}`;
    console.log(chalk.green('  ✓ Lint errors fixed'));
  } catch (lintFixError: unknown) {
    // Lint fix might "fail" but still fix files, so check if files changed
    console.log(chalk.yellow('  Lint fix command exited with errors, checking if files were modified...'));
  }

  // Stage any files that were modified by the linter
  try {
    const diffResult = await $`git diff --name-only`;
    const modifiedFiles = diffResult.stdout.trim();

    if (modifiedFiles) {
      await $`git add -A`;
      console.log(chalk.gray('  ✓ Staged lint fixes'));
    } else {
      // No files were modified by auto-fix
      // Check if there are actual errors (not just warnings)
      console.log(chalk.gray('  Auto-fix did not modify any files'));
      console.log(chalk.gray('  Checking if errors are critical...'));

      // Run lint again to see if there are actual errors vs warnings
      try {
        await $`sh -c ${lintCommand}`;
        // If lint passes (only warnings), we're good
        console.log(chalk.green('  ✓ Lint check passed (warnings only)'));
      } catch (lintError: unknown) {
        // Lint failed - there are actual errors that auto-fix couldn't handle
        console.log(chalk.yellow('  ⚠️  Auto-fix could not resolve all errors'));
        console.log(chalk.blue('  🤖 Attempting intelligent fix with Claude...'));
        
        try {
          await fixLintErrorsWithClaude(_claudePath, lintCommand);
          console.log(chalk.green('  ✓ Lint errors fixed by Claude'));
        } catch (claudeError: unknown) {
          console.log(chalk.red('  ✗ Claude could not fix lint errors'));
          console.log(chalk.yellow('  Run `' + lintCommand + '` to see remaining errors'));
          throw new Error('Lint errors require manual fixing: ' + (claudeError instanceof Error ? claudeError.message : String(claudeError)));
        }
      }
    }
  } catch (stageError: unknown) {
    throw new Error('Failed to stage lint fixes: ' + (stageError instanceof Error ? stageError.message : String(stageError)));
  }
}

/**
 * Fix lint errors using Claude when auto-fix fails
 */
async function fixLintErrorsWithClaude(claudePath: string, lintCommand: string): Promise<void> {
  $.verbose = false;

  // Get lint errors
  console.log(chalk.gray('  Analyzing lint errors...'));
  let lintOutput = '';
  try {
    await $`sh -c ${lintCommand}`;
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'stdout' in error) {
      lintOutput = String((error as any).stdout);
    }
  }

  if (!lintOutput) {
    throw new Error('Could not capture lint errors');
  }

  // Extract actual errors (not warnings) from lint output
  const errorLines = lintOutput.split('\n').filter(line => 
    line.includes('error  ') || line.includes('✖')
  );

  if (errorLines.length === 0) {
    console.log(chalk.green('  ✓ No actual errors found (warnings only)'));
    return;
  }

  console.log(chalk.gray(`  Found ${errorLines.length} error indicator(s), analyzing...`));

  // Create prompt for Claude to fix the errors
  const fixPrompt = `You are a senior software engineer fixing TypeScript/JavaScript lint errors.

**TASK**: Analyze and fix lint errors in this codebase.

**LINT OUTPUT**:
\`\`\`
${lintOutput}
\`\`\`

**YOUR APPROACH**:
1. Run \`${lintCommand}\` to see the full error output yourself
2. For each error file:
   - Read the file to understand context
   - Identify the specific error (e.g., use-before-define, no-unused-vars)
   - Apply the minimal fix needed (don't refactor unnecessarily)
   - Preserve existing code style and patterns
3. Common fixes:
   - use-before-define: Move declarations earlier
   - no-unused-vars: Prefix with underscore (_) if intentionally unused
   - no-explicit-any: Add proper type annotations
   - missing dependencies: Add to useEffect dependency arrays

**CRITICAL RULES**:
- Only fix actual ERRORS, not warnings
- Make minimal changes - don't refactor code
- Preserve all functionality and behavior
- Don't remove code unless it's truly unused
- Test your understanding by running lint again

**OUTPUT**:
Just make the fixes directly to the files. When done, verify with:
\`${lintCommand}\`

Then respond with a brief summary of what you fixed.`;

  console.log(chalk.gray('  Asking Claude to analyze and fix errors...'));

  const result = await $`echo ${fixPrompt} | ${claudePath} --dangerously-skip-permissions chat`;
  const summary = result.stdout.trim();

  console.log(chalk.gray('  Claude response:'));
  console.log(chalk.gray('  ' + summary.split('\n').slice(0, 5).join('\n  ')));

  // Stage any files that were modified
  const diffResult = await $`git diff --name-only`;
  const modifiedFiles = diffResult.stdout.trim();

  if (modifiedFiles) {
    await $`git add -A`;
    console.log(chalk.gray('  ✓ Staged Claude fixes'));
  }

  // Verify the fixes worked
  try {
    await $`sh -c ${lintCommand}`;
    console.log(chalk.green('  ✓ All lint errors resolved'));
  } catch {
    // Check if we at least reduced the errors
    let newLintOutput = '';
    try {
      await $`sh -c ${lintCommand}`;
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'stdout' in error) {
        newLintOutput = String((error as any).stdout);
      }
    }

    const newErrorLines = newLintOutput.split('\n').filter(line => 
      line.includes('error  ')
    );

    if (newErrorLines.length < errorLines.length) {
      console.log(chalk.yellow(`  ⚠️  Reduced errors from ${errorLines.length} to ${newErrorLines.length}`));
      throw new Error(`Still have ${newErrorLines.length} lint errors`);
    } else {
      throw new Error('Lint errors not resolved');
    }
  }
}

/**
 * Fix TypeScript type-check errors using Claude
 */
async function fixTypeErrors(claudePath: string): Promise<void> {
  $.verbose = false;

  const cwd = process.cwd();

  // Detect package manager and type-check command
  let typeCheckCommand = '';

  try {
    const pkgPath = join(cwd, 'package.json');
    const pkgContent = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(pkgContent);

    // Check if it's a turbo monorepo
    if (pkg.devDependencies?.turbo || pkg.dependencies?.turbo) {
      console.log(chalk.gray('  Detected turbo monorepo, running type-check...'));

      // Try to find pnpm, npm, or yarn
      try {
        await $`which pnpm`;
        typeCheckCommand = 'pnpm run type-check';
      } catch {
        try {
          await $`which yarn`;
          typeCheckCommand = 'yarn type-check';
        } catch {
          typeCheckCommand = 'npm run type-check';
        }
      }
    } else if (pkg.scripts?.['type-check']) {
      typeCheckCommand = 'npm run type-check';
    } else if (pkg.scripts?.tsc) {
      typeCheckCommand = 'npm run tsc';
    }
  } catch {
    // No package.json, try tsc directly
    try {
      await $`which tsc`;
      typeCheckCommand = 'npx tsc --noEmit';
    } catch {
      throw new Error('Could not determine how to run type-check');
    }
  }

  if (!typeCheckCommand) {
    throw new Error('No type-check command available');
  }

  // Get type errors
  console.log(chalk.gray('  Analyzing type errors...'));
  let typeOutput = '';
  try {
    await $`sh -c ${typeCheckCommand}`;
    console.log(chalk.green('  ✓ No type errors found'));
    return;
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'stdout' in error) {
      typeOutput = String((error as any).stdout);
    }
    if (error && typeof error === 'object' && 'stderr' in error) {
      typeOutput += '\n' + String((error as any).stderr);
    }
  }

  if (!typeOutput || typeOutput.trim().length === 0) {
    throw new Error('Could not capture type errors');
  }

  console.log(chalk.gray(`  Found type errors, analyzing...`));

  // Create prompt for Claude to fix the errors
  const fixPrompt = `You are a senior TypeScript engineer fixing type errors in a codebase.

**TASK**: Analyze and fix TypeScript type-check errors.

**TYPE-CHECK OUTPUT**:
\`\`\`
${typeOutput}
\`\`\`

**YOUR APPROACH**:
1. Run \`${typeCheckCommand}\` to see the full error output yourself
2. For each error:
   - Read the file to understand context
   - Identify the root cause (missing types, incorrect types, missing exports, etc.)
   - Apply the minimal fix needed
   - Preserve existing code functionality
3. Common fixes:
   - Add missing type imports or exports
   - Fix type annotations (remove \`any\`, add proper types)
   - Add missing properties to interfaces/types
   - Fix generic type parameters
   - Add type assertions where safe
   - Update dependencies if module exports changed

**CRITICAL RULES**:
- Only fix TYPE ERRORS, not warnings
- Make minimal changes - don't refactor code
- Preserve all functionality and behavior
- Use proper TypeScript types, avoid \`any\` unless absolutely necessary
- Don't change module exports unnecessarily
- Test your understanding by running type-check again

**OUTPUT**:
Just make the fixes directly to the files. When done, verify with:
\`${typeCheckCommand}\`

Then respond with a brief summary of what you fixed.`;

  console.log(chalk.gray('  Asking Claude to analyze and fix type errors...'));

  const result = await $`echo ${fixPrompt} | ${claudePath} --dangerously-skip-permissions chat`;
  const summary = result.stdout.trim();

  console.log(chalk.gray('  Claude response:'));
  console.log(chalk.gray('  ' + summary.split('\n').slice(0, 5).join('\n  ')));

  // Stage any files that were modified
  const diffResult = await $`git diff --name-only`;
  const modifiedFiles = diffResult.stdout.trim();

  if (modifiedFiles) {
    await $`git add -A`;
    console.log(chalk.gray('  ✓ Staged Claude fixes'));
  }

  // Verify the fixes worked
  try {
    await $`sh -c ${typeCheckCommand}`;
    console.log(chalk.green('  ✓ All type errors resolved'));
  } catch {
    // Check if we at least reduced the errors
    let newTypeOutput = '';
    try {
      await $`sh -c ${typeCheckCommand}`;
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'stdout' in error) {
        newTypeOutput = String((error as any).stdout);
      }
      if (error && typeof error === 'object' && 'stderr' in error) {
        newTypeOutput += '\n' + String((error as any).stderr);
      }
    }

    const errorCount = (typeOutput.match(/error TS\d+:/g) || []).length;
    const newErrorCount = (newTypeOutput.match(/error TS\d+:/g) || []).length;

    if (newErrorCount < errorCount) {
      console.log(chalk.yellow(`  ⚠️  Reduced errors from ${errorCount} to ${newErrorCount}`));
      throw new Error(`Still have ${newErrorCount} type errors`);
    } else {
      throw new Error('Type errors not resolved');
    }
  }
}

/**
 * Resolve merge conflicts using Claude with architect persona
 */
async function resolveConflictsWithClaude(claudePath: string): Promise<void> {
  $.verbose = false;

  // Get list of conflicted files
  const statusResult = await $`git status --porcelain`;
  const conflictedFiles = statusResult.stdout
    .split('\n')
    .filter((line: string) => line.startsWith('UU ') || line.startsWith('AA ') || line.startsWith('DD '))
    .map((line: string) => line.substring(3).trim())
    .filter(Boolean);

  if (conflictedFiles.length === 0) {
    throw new Error('No conflicted files found');
  }

  console.log(chalk.gray(`  Found ${conflictedFiles.length} conflicted file(s): ${conflictedFiles.join(', ')}`));

  // Process each conflicted file
  for (const file of conflictedFiles) {
    console.log(chalk.blue(`\n  🔧 Resolving conflicts in ${file}...`));

    // Read the conflicted file content
    const conflictContent = await fs.readFile(file, 'utf-8');

    // Create architect persona prompt for conflict resolution
    const conflictPrompt = `You are a senior software architect with deep expertise in code merging and conflict resolution.

**TASK**: Resolve the merge conflict in the file: ${file}

**CONFLICTED FILE CONTENT**:
\`\`\`
${conflictContent}
\`\`\`

**CONTEXT**: Run these commands to understand the context:
1. \`git log --oneline -10\` - See recent commits
2. \`git diff --ours ${file}\` - See our version
3. \`git diff --theirs ${file}\` - See their version
4. \`git log --oneline --all --graph -10\` - See branch history

**YOUR APPROACH**:
1. Analyze BOTH versions carefully (ours vs theirs)
2. Understand the intent behind each change
3. Preserve functionality from both sides when possible
4. Ensure code quality, consistency, and best practices
5. Remove ALL conflict markers (<<<<<<, =====, >>>>>>)
6. Produce clean, working code

**OUTPUT REQUIREMENTS**:
- Output ONLY the resolved file content
- NO explanations, NO markdown code fences, NO commentary
- Just the complete, clean, resolved file content
- Ensure all conflict markers are removed
- Maintain proper formatting and indentation`;

    console.log(chalk.gray('    Asking Claude architect to analyze and resolve conflict...'));

    const resolveResult = await $`echo ${conflictPrompt} | ${claudePath} --dangerously-skip-permissions chat`;
    let resolvedContent = resolveResult.stdout.trim();

    if (!resolvedContent) {
      throw new Error(`Claude returned empty content for ${file}`);
    }

    // Clean up any potential code fences that Claude might have added despite instructions
    if (resolvedContent.includes('```')) {
      resolvedContent = resolvedContent.replace(/```[a-z]*\n/g, '').replace(/\n```/g, '');
    }

    // Verify conflict markers are removed
    if (resolvedContent.includes('<<<<<<<') || resolvedContent.includes('=======') || resolvedContent.includes('>>>>>>>')) {
      throw new Error(`Conflict markers still present in resolved content for ${file}`);
    }

    // Write resolved content back to file
    await fs.writeFile(file, resolvedContent, 'utf-8');
    console.log(chalk.green(`    ✓ Resolved ${file}`));

    // Stage the resolved file
    await $`git add ${file}`;
    console.log(chalk.gray(`    ✓ Staged ${file}`));
  }

  console.log(chalk.green(`\n  ✓ All conflicts resolved and staged`));
}

/**
 * Wrap text at 100 characters per line for commitlint compliance
 */
function wrapTextAt100Chars(text: string): string {
  const lines = text.split('\n');
  const wrappedLines: string[] = [];

  for (const line of lines) {
    // If line is already short enough, keep it as is
    if (line.length <= 100) {
      wrappedLines.push(line);
      continue;
    }

    // Otherwise, wrap it
    const words = line.split(' ');
    let currentLine = '';

    for (const word of words) {
      // If adding this word would exceed 100 chars, start a new line
      if (currentLine.length + word.length + 1 > 100) {
        if (currentLine) {
          wrappedLines.push(currentLine.trim());
        }
        currentLine = word;
      } else {
        currentLine = currentLine ? `${currentLine} ${word}` : word;
      }
    }

    // Add the last line
    if (currentLine) {
      wrappedLines.push(currentLine.trim());
    }
  }

  return wrappedLines.join('\n');
}

/**
 * Default scope mapping
 */
function getDefaultScopeMap(): Record<string, string> {
  return {
    '^apps/site/': 'site',
    '^packages/api/': 'api',
    '^packages/common/': 'common',
    '^packages/webrtc/': 'webrtc',
    '^stacks/': 'stacks',
    '^scripts/': 'scripts',
    '^tools/': 'tools',
    '^docs/|.*\\.md$': 'docs',
    '^\\.github/': 'ci',
  };
}