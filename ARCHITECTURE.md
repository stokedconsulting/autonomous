# Autonomous - Architecture Design

## Overview
Autonomous is a CLI tool that orchestrates multiple LLM instances (Claude, Gemini, Codex) to autonomously work on GitHub issues in a coordinated manner.

## Core Concepts

### Assignment Tracking
- Each project has an `autonomous-assignments.json` at its root
- Tracks which LLM is working on which issue
- Stores worktree paths, branch names, and status
- Lifecycle states: `assigned` → `in-progress` → `llm-complete` → `merged`

### Worktree Management
- Each issue gets a dedicated git worktree in a sibling directory
- Pattern: `../<project-name>-issue-<number>/`
- Branch naming: `feature/issue-<number>-<slug>`
- Isolated development environment per issue

### Hook System
- LLMs report start/stop of work sessions
- Stop hook triggers autonomous to generate next prompt
- Continuous iteration until issue is complete

## Architecture Components

```
autonomous/
├── src/
│   ├── cli/
│   │   ├── commands/
│   │   │   ├── start.ts        # Start autonomous mode
│   │   │   ├── stop.ts         # Stop autonomous mode
│   │   │   ├── status.ts       # Show current assignments
│   │   │   └── config.ts       # Configure LLMs
│   │   └── index.ts            # CLI entry point
│   ├── core/
│   │   ├── assignment-manager.ts    # Manages assignments.json
│   │   ├── orchestrator.ts          # Main coordination logic
│   │   └── config-manager.ts        # Configuration handling
│   ├── github/
│   │   ├── api.ts                   # GitHub API client
│   │   ├── issue-manager.ts         # Issue operations
│   │   ├── pr-manager.ts            # PR creation/merging
│   │   └── ci-monitor.ts            # CI status tracking
│   ├── git/
│   │   ├── worktree-manager.ts      # Worktree operations
│   │   └── branch-manager.ts        # Branch operations
│   ├── llm/
│   │   ├── adapter.ts               # Base LLM adapter interface
│   │   ├── claude-adapter.ts        # Claude implementation
│   │   ├── gemini-adapter.ts        # Gemini implementation (future)
│   │   ├── codex-adapter.ts         # Codex implementation (future)
│   │   └── prompt-builder.ts        # Prompt generation
│   ├── hooks/
│   │   ├── hook-manager.ts          # Hook registration/execution
│   │   └── claude-hooks.ts          # Claude-specific hooks
│   └── types/
│       ├── assignments.ts           # Assignment schema types
│       ├── config.ts                # Configuration types
│       └── github.ts                # GitHub types
└── templates/
    └── prompts/
        ├── initial-issue.md         # Initial issue assignment prompt
        └── next-steps.md            # Follow-up prompt template
```

## Data Schemas

### autonomous-assignments.json
```json
{
  "version": "1.0.0",
  "projectName": "my-project",
  "assignments": [
    {
      "id": "assignment-uuid",
      "issueNumber": 123,
      "issueTitle": "Add dark mode support",
      "llmProvider": "claude",
      "llmInstanceId": "claude-instance-1",
      "status": "in-progress",
      "worktreePath": "../my-project-issue-123",
      "branchName": "feature/issue-123-add-dark-mode",
      "assignedAt": "2025-10-23T10:00:00Z",
      "startedAt": "2025-10-23T10:05:00Z",
      "lastActivity": "2025-10-23T10:30:00Z",
      "prNumber": null,
      "prUrl": null,
      "ciStatus": null,
      "completedAt": null,
      "mergedAt": null,
      "workSessions": [
        {
          "startedAt": "2025-10-23T10:05:00Z",
          "endedAt": "2025-10-23T10:30:00Z",
          "summary": "Created initial component structure"
        }
      ]
    }
  ]
}
```

### .autonomous-config.json (in project root)
```json
{
  "llms": {
    "claude": {
      "enabled": true,
      "maxConcurrentIssues": 1,
      "cliPath": "claude",
      "hooksEnabled": true
    },
    "gemini": {
      "enabled": false,
      "maxConcurrentIssues": 1
    },
    "codex": {
      "enabled": false,
      "maxConcurrentIssues": 1
    }
  },
  "github": {
    "owner": "stokedconsulting",
    "repo": "autonomous",
    "labels": ["autonomous-ready"]
  },
  "worktree": {
    "baseDir": "..",
    "namingPattern": "{projectName}-issue-{number}"
  },
  "requirements": {
    "testingRequired": true,
    "ciMustPass": true,
    "prTemplateRequired": true
  }
}
```

## Workflows

### Startup Flow
1. User runs `autonomous` in project directory
2. Load/create `.autonomous-config.json`
3. Load/create `autonomous-assignments.json`
4. Initialize enabled LLM adapters
5. Fetch available GitHub issues (with configured labels)
6. Assign issues to available LLM instances
7. For each assignment:
   - Create worktree and branch
   - Generate initial prompt
   - Launch LLM instance with hooks
8. Enter monitoring loop

### LLM Work Session
1. LLM starts work (start hook fires)
2. LLM works on issue, makes changes
3. LLM completes a task (stop hook fires)
4. Autonomous captures work summary
5. Autonomous analyzes current state:
   - Are tests written and passing?
   - Is code pushed?
   - Is CI passing?
6. If incomplete:
   - Generate next-steps prompt
   - Resume LLM with new prompt
7. If complete:
   - Mark as `llm-complete`
   - Create PR if not exists
   - Wait for user approval

### Issue Completion Flow
1. LLM marks issue as complete (tests pass, CI green)
2. Status changes to `llm-complete`
3. PR is created/updated
4. Autonomous waits for user review
5. User approves (external trigger or manual command)
6. Autonomous merges PR
7. Updates assignment status to `merged`
8. Assigns next available issue to LLM instance

## Claude Implementation (Phase 1)

### Hook Integration
Claude Code supports hooks in `.claude/hooks/`:
- `on-prompt-submit.sh` - Fires when user submits prompt
- `on-tool-use.sh` - Fires when Claude uses a tool
- `on-response.sh` - Fires when Claude completes response

We'll use custom hooks:
- `autonomous-session-start.sh` - Called by autonomous to start session
- `autonomous-session-end.sh` - Called by Claude when stopping
  - Captures conversation summary
  - Calls autonomous API to report completion

### Process Management
- Autonomous runs as daemon process
- Spawns Claude CLI instances as child processes
- Uses IPC or HTTP API for communication
- Each Claude instance runs in its worktree directory

### Prompt Templates

**Initial Issue Prompt:**
```
You are working autonomously on GitHub issue #<number>: <title>

Issue Details:
<issue body>

Requirements:
1. Create a feature branch (already done: <branch>)
2. Implement the requested functionality
3. Write comprehensive tests
4. Ensure all tests pass
5. Push your changes
6. Report completion

Your working directory is: <worktree-path>

When you complete a significant task or need guidance, stop and summarize your work.
The autonomous system will analyze your progress and provide next steps.

Begin by analyzing the issue and planning your implementation approach.
```

**Next Steps Prompt:**
```
You previously completed: <previous summary>

Current state:
- Tests written: <yes/no>
- Tests passing: <yes/no>
- Code pushed: <yes/no>
- CI status: <status>

Next steps:
<generated based on current state>

Continue working on issue #<number>: <title>
```

## Technical Decisions

### Language & Runtime
- TypeScript for type safety
- Node.js runtime
- Zx for shell commands (simpler than child_process)

### Key Dependencies
- `@octokit/rest` - GitHub API
- `commander` - CLI framework
- `zx` - Shell command execution
- `chokidar` - File watching (for hooks)
- `winston` - Logging

### LLM Adapters
Each adapter implements:
```typescript
interface LLMAdapter {
  start(assignment: Assignment, prompt: string): Promise<void>
  stop(instanceId: string): Promise<void>
  getStatus(instanceId: string): Promise<LLMStatus>
  supportsHooks(): boolean
  installHooks?(worktreePath: string): Promise<void>
}
```

### Communication
- File-based communication via JSON
- Hook scripts write to `.autonomous/session-data/<instance-id>.json`
- Main process polls for updates
- Future: WebSocket or HTTP API for real-time updates

## Security Considerations
- GitHub token stored securely (env var or keychain)
- LLM API keys stored securely
- Sandbox LLM instances to their worktree
- Review PR diffs before auto-merge
- Rate limiting for API calls

## Future Enhancements
- Web UI for monitoring
- Slack/Discord notifications
- Multi-repo support
- LLM collaboration (multiple LLMs on one issue)
- Learning from past issues
- Cost tracking per LLM
- Performance metrics
