# Autonomous

> Orchestrate multiple LLM instances to autonomously work on GitHub issues

Autonomous is a CLI tool that coordinates Claude, Gemini, and Codex to work independently on GitHub issues, managing the entire development lifecycle from issue assignment to PR merging.

## Features

- **Multi-LLM Orchestration**: Coordinate multiple LLM instances working in parallel
- **GitHub Integration**: Automatic issue assignment, PR creation, and merging
- **Isolated Development**: Each issue gets its own git worktree and branch
- **Hook System**: Track LLM work sessions and provide continuous guidance
- **CI Monitoring**: Wait for tests and CI to pass before marking complete
- **Assignment Tracking**: JSON-based state management for all active work

## Quick Start

```bash
# Install globally
npm install -g @stokedconsulting/autonomous

# Or use in a project
npm install --save-dev @stokedconsulting/autonomous

# Navigate to your project (must be a git repo with GitHub remote)
cd my-project

# Initialize configuration (auto-detects GitHub owner/repo from git remote)
autonomous config init

# Add an LLM provider
autonomous config add-llm claude --enable-hooks

# Start autonomous mode (or just run 'autonomous')
autonomous start

# Or simply:
autonomous
```

## How It Works

1. **Issue Assignment**: Autonomous fetches available GitHub issues and assigns them to configured LLM instances
2. **Worktree Creation**: Each issue gets a dedicated git worktree in a sibling directory
3. **LLM Execution**: The LLM works on the issue, guided by initial requirements and follow-up prompts
4. **Progress Tracking**: Hook system captures work sessions and summaries
5. **Continuous Iteration**: Autonomous analyzes progress and generates next-step prompts until complete
6. **PR Management**: Once tests pass and CI is green, a PR is created for review
7. **Auto-merge**: After user approval, the PR is merged and the LLM is assigned the next issue

## Architecture

```
Project Root
├── .autonomous-config.json        # LLM and project configuration
├── autonomous-assignments.json    # Current assignment tracking
└── [your project files]

Sibling Directories (Worktrees)
├── ../my-project-issue-123/       # Worktree for issue #123
├── ../my-project-issue-124/       # Worktree for issue #124
└── ...
```

## Configuration

### .autonomous-config.json

```json
{
  "llms": {
    "claude": {
      "enabled": true,
      "maxConcurrentIssues": 1,
      "cliPath": "claude"
    }
  },
  "github": {
    "owner": "your-org",
    "repo": "your-repo",
    "labels": ["autonomous-ready"]
  },
  "requirements": {
    "testingRequired": true,
    "ciMustPass": true
  }
}
```

## Commands

### `autonomous` or `autonomous start`
Start autonomous mode and begin processing issues. Running `autonomous` without any command defaults to `start`.

**Options:**
- `-d, --dry-run` - Simulate without actually starting LLMs
- `-v, --verbose` - Enable verbose logging

### `autonomous stop`
Stop all running LLM instances and save state.

**Options:**
- `-f, --force` - Force stop all instances

### `autonomous status`
View current assignments and their status.

**Options:**
- `-j, --json` - Output as JSON
- `-w, --watch` - Watch mode - continuously update status

### `autonomous config init`
Initialize configuration in the current project. Auto-detects GitHub owner/repo from git remote.

**Options:**
- `--github-owner <owner>` - Override detected GitHub owner
- `--github-repo <repo>` - Override detected GitHub repo
- `--interactive` - Interactive configuration setup

### `autonomous config add-llm <provider>`
Add and configure an LLM provider (claude, gemini, codex).

**Options:**
- `--cli-path <path>` - Path to LLM CLI executable
- `--max-concurrent <number>` - Maximum concurrent issues
- `--enable-hooks` - Enable hooks support (recommended for Claude)

### `autonomous config show`
Display current configuration.

**Options:**
- `-j, --json` - Output as JSON

### `autonomous config validate`
Validate current configuration.

## LLM Support

### Claude (Supported)
- Uses Claude Code CLI
- Hook-based session tracking
- Automatic prompt generation

### Gemini (Planned)
- Coming soon

### Codex (Planned)
- Coming soon

## Requirements

- Node.js >= 18
- Git >= 2.25 (for worktree support)
- GitHub CLI (gh) recommended
- Claude Code CLI (for Claude support)

## Development

```bash
# Clone the repository
git clone https://github.com/stokedconsulting/autonomous.git
cd autonomous

# Install dependencies
npm install

# Build
npm run build

# Run in development
npm run dev

# Run tests
npm test
```

## Assignment Lifecycle

1. **assigned** - Issue assigned to LLM, worktree created
2. **in-progress** - LLM actively working
3. **llm-complete** - Tests pass, CI green, ready for review
4. **merged** - PR approved and merged

## Examples

### Basic Usage

```bash
# In a git repository with GitHub remote
cd my-project

# Initialize (auto-detects owner/repo from git remote)
autonomous config init

# Add Claude
autonomous config add-llm claude --enable-hooks

# Start (or just run 'autonomous')
autonomous

# View what's happening
autonomous status

# Watch status in real-time
autonomous status --watch
```

### Custom Configuration

```bash
# Initialize with explicit owner/repo (overrides auto-detection)
autonomous config init --github-owner myorg --github-repo myrepo

# Add Claude with custom CLI path
autonomous config add-llm claude --cli-path /usr/local/bin/claude --enable-hooks

# Set maximum concurrent issues
autonomous config add-llm claude --max-concurrent 2

# View configuration
autonomous config show

# Validate configuration
autonomous config validate
```

### Running in Dry-Run Mode

```bash
# See what would happen without actually starting LLMs
autonomous --dry-run

# Or with verbose output
autonomous --dry-run --verbose
```

## Troubleshooting

### LLM instance not starting
- Check that the CLI path is correct in `.autonomous-config.json`
- Ensure the LLM CLI is installed and accessible
- Check logs in `.autonomous/logs/`

### Worktree creation fails
- Ensure you have uncommitted changes committed
- Check that the parent directory exists and is writable
- Verify git version supports worktrees (>= 2.25)

### CI not detected
- Ensure GitHub Actions or your CI provider is properly configured
- Check that the repository has CI enabled
- Verify GitHub token has appropriate permissions

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT © Stoked Consulting

## Roadmap

- [x] Core architecture design
- [ ] Claude integration
- [ ] Assignment tracking system
- [ ] GitHub API integration
- [ ] Worktree management
- [ ] Hook system
- [ ] CI monitoring
- [ ] PR auto-merge
- [ ] Gemini support
- [ ] Codex support
- [ ] Web UI
- [ ] Multi-repo support

## Support

- [Documentation](https://github.com/stokedconsulting/autonomous/wiki)
- [Issue Tracker](https://github.com/stokedconsulting/autonomous/issues)
- [Discussions](https://github.com/stokedconsulting/autonomous/discussions)
