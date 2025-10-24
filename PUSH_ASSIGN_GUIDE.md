# Push & Assign Commands Guide

This guide covers the new `push` and `assign` commands and their customization requirements.

## `auto push` Command

Automatically generates changesets, creates conventional commit messages, commits, and pushes changes using Claude AI.

### Usage

```bash
# Basic push (changeset + commit + push)
auto push

# Push and create/update pull request
auto push --pr
```

### What It Does

1. **Changeset Generation** (if `.changeset/` directory exists):
   - Analyzes changed files in `apps/` and `packages/`
   - Determines impacted packages
   - Uses Claude to generate appropriate semver bumps (patch/minor/major)
   - Creates `.changeset/ai-{timestamp}.md` file

2. **Conventional Commit**:
   - Stages all changes with `git add -A`
   - Analyzes file changes to determine scopes
   - Uses Claude to generate a conventional commit message
   - Commits with the generated message

3. **Push**:
   - Pushes current branch to origin
   - Sets upstream if needed

4. **Pull Request** (with `--pr` flag):
   - Creates PR if none exists for the branch
   - Updates PR title and body if PR already exists
   - Uses `gh` CLI (GitHub CLI)

### Per-Repository Customization

Add this section to your `.autonomous-config.json`:

```json
{
  "push": {
    "scopeMap": {
      "^apps/site/": "site",
      "^apps/mobile/": "mobile",
      "^packages/api/": "api",
      "^packages/common/": "common",
      "^packages/ui/": "ui",
      "^stacks/": "infra",
      "^scripts/": "scripts",
      "^tools/": "tools",
      "^docs/|.*\\.md$": "docs",
      "^\\.github/": "ci"
    },
    "enableChangeset": true,
    "conventionalCommits": true
  }
}
```

#### scopeMap (Required for custom scopes)

Maps file patterns (regex) to conventional commit scopes. Default mappings:

```javascript
{
  '^apps/site/': 'site',
  '^packages/api/': 'api',
  '^packages/common/': 'common',
  '^packages/webrtc/': 'webrtc',
  '^stacks/': 'stacks',
  '^scripts/': 'scripts',
  '^tools/': 'tools',
  '^docs/|.*\\.md$': 'docs',
  '^\\.github/': 'ci'
}
```

**Customize these patterns to match your monorepo structure!**

Example for a different structure:

```json
{
  "push": {
    "scopeMap": {
      "^frontend/": "frontend",
      "^backend/services/auth/": "auth",
      "^backend/services/payment/": "payment",
      "^backend/database/": "db",
      "^infrastructure/": "infra",
      "^.github/workflows/": "ci",
      "README\\.md|docs/": "docs"
    }
  }
}
```

#### enableChangeset (Optional, default: true)

Set to `false` if your project doesn't use changesets:

```json
{
  "push": {
    "enableChangeset": false
  }
}
```

#### conventionalCommits (Optional, default: true)

Controls whether to use conventional commit format:

```json
{
  "push": {
    "conventionalCommits": false
  }
}
```

### Requirements

- **Claude CLI**: Must have `claude` or `cld` available in PATH
- **Git repository**: Must be run from within a git repo
- **GitHub CLI** (for `--pr` flag): Install with `brew install gh`
- **Changesets** (optional): If using changesets, must have `.changeset/` directory

### Example Workflow

```bash
# Make some changes to your code
# ...

# Push everything with a PR
auto push --pr

# Output:
# 🚀 Autonomous Push
#
# 📝 Generating changeset...
#   Analyzing changes from origin/main...HEAD
#   Impacted packages: @myapp/site, @myapp/api
#   ✓ Created .changeset/ai-1735678901.md
#
# 💾 Committing and pushing changes...
#   Generating commit message...
#   Commit message:
#   feat(site,api): implement user authentication system
#
#   Add cookie-based auth with JWT tokens and session management
#   ---
#   Pushing branch feature/auth-system...
#   ✓ Pushed branch feature/auth-system
#
# 📋 Creating pull request...
#   ✓ PR created: https://github.com/owner/repo/pull/123
#
# ✓ Push complete!
```

---

## `auto assign` Command

Manually assign a specific GitHub issue to autonomous processing.

### Usage

```bash
# Assign issue #42
auto assign 42

# Assign without evaluation (faster, but risky)
auto assign 42 --skip-eval

# Assign with verbose output
auto assign 42 --verbose
```

### What It Does

1. **Fetches Issue**: Retrieves issue details from GitHub
2. **Evaluates Issue** (unless `--skip-eval`):
   - Runs Claude-based evaluation
   - Checks if issue has enough detail
   - Provides suggestions if lacking clarity
   - Uses cached evaluation if issue hasn't changed
3. **Creates Worktree**:
   - Creates a new git worktree (separate working directory)
   - Creates feature branch following your naming pattern
   - Checks out from default branch (main/master)
4. **Starts Claude Instance**:
   - Generates initial work prompt
   - Starts Claude in the worktree
   - Sets up activity logging
5. **Tracks Assignment**:
   - Records assignment in autonomous system
   - Sets status to "in-progress"
   - Provides monitoring commands

### When to Use

- Manually assign a specific high-priority issue
- Override automatic issue selection
- Re-assign an issue that was previously skipped
- Test the system with a specific issue

### Configuration

Uses the same `.autonomous-config.json` settings:

```json
{
  "worktree": {
    "baseDir": "..",
    "namingPattern": "{projectName}-issue-{number}",
    "branchPrefix": "feature/issue-"
  }
}
```

### Example Output

```bash
$ auto assign 30

🎯 Assigning Issue #30

Fetching issue from GitHub...
✓ Found: Enable chat attachment uploads

📋 Evaluating issue...

✓ Issue evaluation:
  Priority: 8.2/10
  Types: ui, api
  Complexity: medium
  Estimated: 4-8 hours

🌿 Setting up worktree...
✓ Worktree created: /Users/you/work/myproject-issue-30

📝 Creating assignment...

🤖 Starting Claude instance...

✓ Assignment created successfully!

Worktree: /Users/you/work/myproject-issue-30
Branch: feature/issue-30-enable-chat-attachment-uploads
Instance ID: claude-abc123

📊 Monitor progress:
  tail -f .autonomous/output-claude-abc123.log
  auto status
```

### Monitoring Assigned Work

```bash
# Check all assignments
auto status

# Watch logs in real-time
tail -f .autonomous/output-claude-{instanceId}.log

# Check worktree directory
cd ../myproject-issue-30
git status
```

---

## Integration with Autonomous Workflow

Both commands integrate seamlessly with the autonomous system:

### Push Integration

When Claude completes work on an issue, the autonomous system can automatically call the push logic to:
- Generate changeset
- Create commit
- Push changes
- Create/update PR

### Assign Integration

The main `auto start` command uses the same assignment logic internally when automatically processing issues.

---

## Troubleshooting

### Push Command

**Issue**: "Claude CLI not found"
```bash
# Solution: Ensure Claude is in PATH or configure explicitly
auto config add-llm claude --cli-path /full/path/to/claude
```

**Issue**: "No impacted packages detected"
```bash
# Solution: Make sure changes are in apps/ or packages/ directories
# Or customize changeset detection in your push implementation
```

**Issue**: "GitHub CLI not found" (with --pr)
```bash
# Solution: Install GitHub CLI
brew install gh
gh auth login
```

### Assign Command

**Issue**: "GitHub token not found"
```bash
# Solution: Set GitHub token
export GITHUB_TOKEN=ghp_your_token_here
# Or add to .autonomous-config.json
```

**Issue**: "Issue #X is already assigned"
```bash
# Solution: Check status and stop if needed
auto status
autonomous stop  # If you want to reassign
```

**Issue**: "Worktree already exists"
- This is actually fine! The command will use the existing worktree
- If you want to start fresh, manually delete the worktree first

---

## Configuration Reference

Complete `.autonomous-config.json` example with push settings:

```json
{
  "version": "1.0.0",
  "llms": {
    "claude": {
      "enabled": true,
      "maxConcurrentIssues": 1,
      "cliPath": "/Users/you/.claude/local/claude",
      "cliArgs": ["--dangerously-skip-permissions"],
      "hooksEnabled": true
    }
  },
  "github": {
    "owner": "your-org",
    "repo": "your-repo",
    "labels": [],
    "excludeLabels": ["wontfix", "duplicate", "needs-details"]
  },
  "worktree": {
    "baseDir": "..",
    "namingPattern": "{projectName}-issue-{number}",
    "branchPrefix": "feature/issue-",
    "cleanup": {
      "onComplete": false,
      "onError": false
    }
  },
  "requirements": {
    "testingRequired": true,
    "ciMustPass": true,
    "prTemplateRequired": false
  },
  "push": {
    "scopeMap": {
      "^apps/site/": "site",
      "^packages/api/": "api",
      "^packages/common/": "common",
      "^docs/|.*\\.md$": "docs",
      "^\\.github/": "ci"
    },
    "enableChangeset": true,
    "conventionalCommits": true
  },
  "logging": {
    "level": "info"
  }
}
```
