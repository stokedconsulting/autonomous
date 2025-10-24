/**
 * Push command - Auto-generate changeset, commit, and push changes
 * Based on the pnpm push workflow from v3
 */

import { $ } from 'zx';
import { promises as fs } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { ConfigManager } from '../../core/config-manager.js';

interface PushOptions {
  pr?: boolean;
}

export async function pushCommand(options: PushOptions): Promise<void> {
  console.log(chalk.blue.bold('\n🚀 Autonomous Push\n'));

  try {
    const cwd = process.cwd();
    const configManager = new ConfigManager(cwd);

    // Load config to get Claude path
    await configManager.load();
    const config = configManager.getConfig();
    const claudePath = config.llms?.claude?.cliPath || 'claude';

    // Step 1: Generate changeset (if .changeset directory exists)
    const changesetDir = join(cwd, '.changeset');
    try {
      await fs.access(changesetDir);
      console.log(chalk.blue('📝 Generating changeset...'));
      await generateChangeset(cwd, claudePath);
    } catch {
      console.log(chalk.gray('No .changeset directory found, skipping changeset generation'));
    }

    // Step 2: Commit and push
    console.log(chalk.blue('\n💾 Committing and pushing changes...'));
    await commitAndPush(claudePath, config, options.pr || false);

    console.log(chalk.green('\n✓ Push complete!'));
  } catch (error: any) {
    console.error(chalk.red('\n✗ Error during push:'), error.message);
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

  console.log(chalk.gray(`  Analyzing changes from ${baseRef}...HEAD`));

  // Determine impacted packages
  const diffResult = await $`git diff --name-only --diff-filter=ACMRT ${baseRef}...HEAD`;
  const changedFiles = diffResult.stdout.trim().split('\n').filter(Boolean);

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
- \`git diff --stat ${baseRef}...HEAD\` - See what files changed
- \`git diff ${baseRef}...HEAD -- apps/ packages/\` - See detailed changes in packages
- \`git log --oneline ${baseRef}..HEAD\` - See commit messages

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
 * Commit and push changes
 */
async function commitAndPush(
  claudePath: string,
  config: any,
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
- Optional body with more details (wrap at 100 chars)

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

Implement user-requested dark mode feature with system preference detection.`;

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
  const body = headerIndex >= 0 ? msg.substring(headerIndex + header.length).trim() : '';

  // Build final commit message
  const finalMsg = body ? `${header}\n\n${body}` : header;

  console.log(chalk.gray('  Commit message:'));
  console.log(chalk.gray('  ' + finalMsg.split('\n').join('\n  ')));
  console.log(chalk.gray('  ---'));

  // Commit
  await $`git commit -m ${finalMsg}`;

  // Get current branch
  const branchResult = await $`git rev-parse --abbrev-ref HEAD`;
  const branch = branchResult.stdout.trim();

  console.log(chalk.gray(`  Pushing branch ${branch}...`));

  // Push
  await $`git push -u origin ${branch}`;

  console.log(chalk.green(`  ✓ Pushed branch ${branch}`));

  // Handle PR if requested
  if (createPR) {
    await handlePR(claudePath, branch);
  }
}

/**
 * Create or update PR
 */
async function handlePR(claudePath: string, branch: string): Promise<void> {
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
  }
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
