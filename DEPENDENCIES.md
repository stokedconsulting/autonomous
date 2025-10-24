# Dependencies Guide

This guide covers all dependencies required by the autonomous system and how to install them.

## Quick Start

For a new repository, simply run:

```bash
# Initialize configuration
autonomous config init

# Check and install dependencies
autonomous setup
```

The `setup` command will:
- ✅ Check all required and optional dependencies
- ✅ Auto-install `@changesets/cli` if your repo uses changesets
- ✅ Provide installation commands for other dependencies
- ✅ Detect your package manager (pnpm/yarn/npm)

---

## Required Dependencies

These must be installed manually (cannot be auto-installed):

### 1. **Git**

- **Required for**: All commands (version control, worktrees)
- **Check**: `git --version`
- **Install**:
  ```bash
  # macOS
  brew install git

  # Ubuntu/Debian
  sudo apt install git
  ```

### 2. **Claude CLI**

- **Required for**: All commands (AI evaluation, commit messages, issue analysis)
- **Check**: `claude --version` or `cld --version`
- **Install**: Visit https://claude.ai/download
- **Configure**:
  ```bash
  autonomous config add-llm claude --cli-path /path/to/claude
  ```

### 3. **Node.js & Package Manager**

- **Required for**: All commands
- **Version**: Node.js >= 18.0.0
- **Check**: `node --version` and `pnpm --version`
- **Install**:
  ```bash
  # Node.js
  brew install node

  # pnpm (recommended for monorepos)
  brew install pnpm

  # Or npm (comes with Node.js)
  # Or yarn
  brew install yarn
  ```

---

## Optional Dependencies

These can be auto-installed or are only needed for specific commands:

### 1. **@changesets/cli** (Optional, Auto-installable)

- **Required for**: `autonomous push` command (changeset generation)
- **When needed**: Only if your repo uses changesets for versioning
- **Auto-install**: Run `autonomous setup` - it will prompt you
- **Manual install**:
  ```bash
  # Using pnpm
  pnpm add -D @changesets/cli
  pnpm changeset init

  # Using npm
  npm install --save-dev @changesets/cli
  npx changeset init

  # Using yarn
  yarn add -D @changesets/cli
  yarn changeset init
  ```

**Note**: If you don't use changesets, the push command will skip changeset generation automatically.

### 2. **GitHub CLI (gh)** (Optional, Manual install)

- **Required for**: `autonomous push --pr` (PR creation/management)
- **Check**: `gh --version`
- **Install**:
  ```bash
  # macOS
  brew install gh

  # Ubuntu/Debian
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
  sudo apt install gh
  ```
- **Authenticate**:
  ```bash
  gh auth login
  ```

**Note**: If gh is not installed, `autonomous push --pr` will warn you but push will still work.

---

## Dependency Check Command

Check the status of all dependencies:

```bash
autonomous setup
```

**Output example:**

```
🔧 Autonomous Setup

📦 Dependency Status

Required:
  ✓ Git (2.42.0)
    Version control and worktree management
  ✓ Claude CLI (0.5.2)
    AI-powered issue evaluation and commit message generation
  ✓ pnpm (8.12.1)
    Package management (preferred for monorepos)

Optional:
  ✓ @changesets/cli (^2.27.1)
    Automatic versioning and changelog generation (for push command)
  - GitHub CLI (gh) - Not installed
    Install: brew install gh
    Pull request creation and management (for push --pr)

✓ All required dependencies installed!
```

---

## Per-Command Dependencies

### `autonomous start`
- ✅ Git
- ✅ Claude CLI
- ✅ GITHUB_TOKEN environment variable

### `autonomous assign <issue>`
- ✅ Git
- ✅ Claude CLI
- ✅ GITHUB_TOKEN environment variable

### `autonomous push`
- ✅ Git
- ✅ Claude CLI
- ⚠️ @changesets/cli (if using changesets)

### `autonomous push --pr`
- ✅ Git
- ✅ Claude CLI
- ⚠️ @changesets/cli (if using changesets)
- ⚠️ GitHub CLI (gh)
- ✅ GITHUB_TOKEN environment variable (for gh auth)

### `autonomous status`
- ✅ Git
- (No other dependencies)

---

## Environment Variables

### GITHUB_TOKEN (Required)

The GitHub Personal Access Token is required for API access:

**Setting the token:**

```bash
# Option 1: Export in shell
export GITHUB_TOKEN=ghp_your_token_here

# Option 2: Add to shell profile (~/.zshrc or ~/.bashrc)
echo 'export GITHUB_TOKEN=ghp_your_token_here' >> ~/.zshrc
source ~/.zshrc

# Option 3: Add to .autonomous-config.json
{
  "github": {
    "token": "ghp_your_token_here"
  }
}
```

**Creating a token:**

1. Visit: https://github.com/settings/tokens/new
2. Select scopes:
   - `repo` (full repository access)
   - `workflow` (for GitHub Actions)
3. Generate token
4. Copy and set as shown above

**Note**: Store the token securely. Never commit it to git!

---

## Installation Workflows

### Workflow 1: New Repository (Recommended)

```bash
# 1. Navigate to your repository
cd /path/to/your/repo

# 2. Initialize autonomous (auto-detects GitHub repo)
autonomous config init

# 3. Check and install dependencies
autonomous setup

# 4. Start using autonomous
autonomous start --verbose
```

### Workflow 2: Existing Repository

```bash
# 1. Navigate to repository
cd /path/to/your/repo

# 2. Check dependencies
autonomous setup

# 3. Install any missing dependencies manually
# (follow the instructions from setup output)

# 4. Start using autonomous
autonomous start
```

### Workflow 3: Manual Setup

```bash
# 1. Install required dependencies
brew install git gh pnpm

# 2. Install Claude CLI
# Visit https://claude.ai/download

# 3. Install changesets (if needed)
cd /path/to/your/repo
pnpm add -D @changesets/cli
pnpm changeset init

# 4. Initialize autonomous
autonomous config init

# 5. Configure Claude
autonomous config add-llm claude --cli-path $(which claude)

# 6. Set GitHub token
export GITHUB_TOKEN=ghp_your_token_here

# 7. Start
autonomous start
```

---

## Troubleshooting

### "Claude CLI not found"

**Problem**: Claude not in PATH or using alias

**Solutions**:
```bash
# Find Claude path
which claude

# Configure explicitly
autonomous config add-llm claude --cli-path /full/path/to/claude

# Or if using alias, find actual path
type claude  # Shows if it's aliased
```

### "GITHUB_TOKEN not found"

**Problem**: Token not set or expired

**Solutions**:
```bash
# Check if set
echo $GITHUB_TOKEN

# Test token
curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/user

# If expired, create new token at:
# https://github.com/settings/tokens/new
```

### "@changesets/cli not found" (during push)

**Problem**: Changeset package not installed but repo uses changesets

**Solutions**:
```bash
# Run setup to auto-install
autonomous setup

# Or manually install
pnpm add -D @changesets/cli
pnpm changeset init
```

### "gh not found" (during push --pr)

**Problem**: GitHub CLI not installed

**Solutions**:
```bash
# Install
brew install gh

# Authenticate
gh auth login

# Or use push without --pr flag
autonomous push  # Without PR creation
```

---

## Dependency Matrix

| Dependency | Required? | Auto-Install? | Used By |
|------------|-----------|---------------|---------|
| Git | ✅ Yes | ❌ No | All commands |
| Claude CLI | ✅ Yes | ❌ No | All commands |
| Node.js | ✅ Yes | ❌ No | All commands |
| Package Manager | ✅ Yes | ❌ No | All commands |
| @changesets/cli | ⚠️ Optional | ✅ Yes | push command |
| GitHub CLI (gh) | ⚠️ Optional | ❌ No | push --pr flag |
| GITHUB_TOKEN | ✅ Yes | ❌ No | start, assign, push --pr |

---

## First-Time Setup Checklist

Use this checklist when setting up autonomous in a new repository:

- [ ] Git installed and repository initialized
- [ ] Node.js >= 18.0.0 installed
- [ ] Package manager (pnpm/npm/yarn) installed
- [ ] Claude CLI installed and in PATH
- [ ] GitHub token created and set
- [ ] Run `autonomous config init`
- [ ] Run `autonomous setup`
- [ ] Install any missing optional dependencies
- [ ] Customize `.autonomous-config.json` scope map
- [ ] Test with `autonomous start --verbose`

---

## Updating Dependencies

Keep dependencies up to date:

```bash
# Update @changesets/cli
pnpm update @changesets/cli

# Update GitHub CLI
brew upgrade gh

# Update Claude CLI
# Visit https://claude.ai/download for latest version

# Check current versions
autonomous setup
```

---

## Docker/CI Environment

If using in Docker or CI:

```dockerfile
# Example Dockerfile
FROM node:18-alpine

# Install Git
RUN apk add --no-cache git

# Install GitHub CLI
RUN apk add --no-cache github-cli

# Install Claude CLI (adjust URL to actual download)
# RUN wget https://claude.ai/download/linux && \
#     chmod +x claude && \
#     mv claude /usr/local/bin/

# Install autonomous
RUN npm install -g @stokedconsulting/autonomous

# Set GitHub token via environment
ENV GITHUB_TOKEN=${GITHUB_TOKEN}
```

For CI environments, ensure:
- Git is available
- GitHub token is set via secrets
- Claude CLI is accessible (may need custom installation)

---

## Summary

**Minimum to get started:**
1. ✅ Git
2. ✅ Claude CLI
3. ✅ GitHub token
4. ✅ Run `autonomous config init`
5. ✅ Run `autonomous setup`

**For full functionality:**
- Add `@changesets/cli` (via `autonomous setup`)
- Install `gh` CLI (for PR management)
- Customize scope maps in config

**All set!** 🎉 You're ready to use autonomous!
