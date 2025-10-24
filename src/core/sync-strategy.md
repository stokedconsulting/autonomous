# Data Synchronization Strategy

## Overview

The autonomous system tracks data in two places:
1. **Local JSON files** (`autonomous-assignments.json`, `issue-evaluation-cache.json`)
2. **GitHub Projects v2** (project items with custom fields)

This document defines which system is the source of truth for each piece of data and how conflicts are resolved.

## Architecture Principles

### Single Source of Truth
Each piece of data has ONE source of truth. We read from that source and may write back updates, but never cache stale copies.

### Read-Write Patterns
- **Local-only**: Data exists only in local JSON, never in project
- **Project-only**: Data exists only in project, read fresh on every access
- **Synced**: Data exists in both, with clear write-back rules

### Conflict Resolution
When conflicts occur (local state differs from project state):
1. **User-visible fields** (Status, Priority): Project wins, local updates to match
2. **Process fields** (worktree path, LLM instance): Local wins, never synced to project
3. **Timestamps**: Compare, use most recent, log discrepancy

## Field Mapping

### Assignment Fields (`autonomous-assignments.json`)

| Field | Source of Truth | Pattern | Notes |
|-------|----------------|---------|-------|
| **Identity & Linking** |
| `id` | Local | Local-only | UUID for local tracking |
| `issueNumber` | GitHub API | Read-only | Issue number from GitHub |
| `issueTitle` | GitHub API | Read-only | Synced on fetch |
| `issueBody` | GitHub API | Read-only | Synced on fetch |
| `projectItemId` | GitHub Projects | Read-once | Link to project item, cached for performance |
| **Process State (LOCAL)** |
| `llmProvider` | Local | Local-only | Which LLM is working on this |
| `llmInstanceId` | Local | Local-only | Specific instance identifier |
| `worktreePath` | Local | Local-only | Git worktree location |
| `branchName` | Local | Local-only | Git branch name |
| `workSessions` | Local | Local-only | Detailed work session tracking |
| **Status (SYNCED)** |
| `status` | GitHub Projects | Synced | Read from project, written back on changes |
| **Timestamps (LOCAL)** |
| `assignedAt` | Local | Local-only | When auto assigned this |
| `startedAt` | Local | Local-only | When work started |
| `lastActivity` | Local | Local-only | Last autonomous activity |
| `completedAt` | Local | Local-only | When LLM marked complete |
| `mergedAt` | Local | Local-only | When PR was merged |
| **PR & CI (LOCAL)** |
| `prNumber` | Local | Local-only | PR number (could read from GitHub API) |
| `prUrl` | Local | Local-only | PR URL |
| `ciStatus` | Local | Local-only | CI build status |
| **Metadata** |
| `requiresTests` | Local | Local-only | Process configuration |
| `requiresCI` | Local | Local-only | Process configuration |
| `estimatedComplexity` | Local | Local-only | AI's complexity estimate |

### Issue Evaluation Fields (`issue-evaluation-cache.json`)

| Field | Source of Truth | Pattern | Notes |
|-------|----------------|---------|-------|
| **Evaluation Metadata** |
| `issueNumber` | GitHub API | Read-only | Issue identifier |
| `issueTitle` | GitHub API | Read-only | For display/reference |
| `lastModified` | GitHub API | Read-only | Issue's updatedAt from GitHub |
| `lastEvaluated` | Local | Local-only | When AI last evaluated |
| **AI Classification** |
| `complexity` | AI Evaluation | Local-only | AI's technical complexity (≠ project Size) |
| `impact` | AI Evaluation | Local-only | AI's business impact assessment |
| **AI Scores** |
| `clarity` | AI Evaluation | Local-only | How well-defined (1-10) |
| `importance` | AI Evaluation | Local-only | Business value (1-10) |
| `feasibility` | AI Evaluation | Local-only | Can be implemented (1-10) |
| `aiPriorityScore` | AI Evaluation | Local-only | Calculated AI score (30% weight) |
| **Other AI Outputs** |
| `hasEnoughDetail` | AI Evaluation | Local-only | AI's assessment |
| `reasoning` | AI Evaluation | Local-only | AI's explanation |
| `suggestedQuestions` | AI Evaluation | Local-only | Questions for user |
| `estimatedEffort` | AI Evaluation | Local-only | AI's effort estimate |

### Project Fields (NEVER Cached Locally)

These fields are ALWAYS read fresh from GitHub Projects v2:

| Project Field | Type | Usage |
|---------------|------|-------|
| `Status` | Single Select | Todo, Ready, In Progress, In Review, Blocked, Done |
| `Priority` | Single Select | Critical (10), High (7), Medium (4), Low (1) |
| `Size` | Single Select | XS (1-2h), S (2-4h), M (4-8h), L (1-3d), XL (3+d) |
| `Issue Type` | Single Select | Epic, Feature, Bug, Chore, Docs, Refactor |
| `Area` | Single Select | Core, CLI, GitHub API, Projects, Evaluation, Testing, Documentation |
| `Sprint` | Iteration | Current sprint assignment |
| `Blocked By` | Text | Issue numbers blocking this issue |
| `Effort Estimate` | Number | Hours estimate |

### GitHub Issue Fields (Read from GitHub API)

Never cached, always read fresh:
- `labels` - Issue labels
- `milestone` - Current milestone
- `assignees` - Current assignees
- `state` - open/closed
- `createdAt` - Creation timestamp
- `updatedAt` - Last update timestamp
- `author` - Issue creator
- `comments` - Comment count

## Synchronization Workflows

### 1. Fetching Issues for Assignment

```
1. Query GitHub Projects API for items with Status = "Ready"
2. For each item:
   a. Read projectItemId
   b. Read all project fields (Priority, Size, Type, Area, Sprint, etc.)
   c. Read issue data (number, title, body, labels)
   d. Check if already in autonomous-assignments.json:
      - If yes: Load existing assignment, update status if changed
      - If no: Create new assignment placeholder
3. Query issue-evaluation-cache.json for AI scores
4. Calculate hybrid priority:
   - Project Priority (50%)
   - AI aiPriorityScore (30%)
   - Sprint boost (10%)
   - Size preference (10%)
5. Return prioritized list
```

### 2. Assigning an Issue

```
1. Select highest priority issue from Ready list
2. Create assignment record in autonomous-assignments.json:
   - Store projectItemId (link to project)
   - Store issue metadata (number, title, body)
   - Store process state (llmProvider, worktreePath, branchName)
   - Set status: "assigned"
   - Set assignedAt timestamp
3. Update GitHub Projects:
   - Set Status = "In Progress"
   - (Optional) Set other fields as configured
4. Create git worktree
5. Start work session
```

### 3. Updating Status During Work

```
1. Autonomous detects state change (e.g., LLM completes work)
2. Update local assignment:
   - Update status field
   - Update relevant timestamps
   - Add work session entry
3. Sync to GitHub Projects:
   - Read current project Status
   - If different, update via updateProjectV2ItemFieldValue mutation
   - Log any conflicts
```

### 4. Handling Conflicts

**Scenario A: User changes Status in project while autonomous is working**

```
1. Autonomous detects discrepancy when reading project
2. Project Status = "Blocked", Local status = "in-progress"
3. Resolution:
   - Log conflict: "Status conflict detected"
   - Project wins: Update local status to "Blocked"
   - Check Blocked By field for reason
   - Pause autonomous work on this issue
   - Notify user (if configured)
```

**Scenario B: User changes Priority while autonomous is evaluating**

```
1. User sets Priority = "Critical" in project
2. Autonomous has aiPriorityScore = 6.5 (medium)
3. Resolution:
   - No conflict! These are independent scores
   - Hybrid prioritization recalculates:
     - Critical (10) × 50% = 5.0
     - AI score (6.5) × 30% = 1.95
     - Total = 6.95 + sprint/size adjustments
   - Issue moves up in priority queue
```

**Scenario C: Multiple autonomous instances**

```
1. Instance A assigns issue #5, updates Status = "In Progress"
2. Instance B queries ready issues 30s later
3. Resolution:
   - Instance B reads Status from project (sees "In Progress")
   - Issue #5 filtered out of ready list
   - No conflict, project is source of truth for status
```

## Implementation Guidelines

### AssignmentManager

```typescript
class AssignmentManager {
  // When loading assignments
  async loadAssignment(issueNumber: number): Promise<Assignment> {
    const local = await this.readFromJSON(issueNumber);
    const projectStatus = await this.projectAPI.getItemStatus(local.projectItemId);

    // Detect conflicts
    if (local.status !== projectStatus) {
      logger.warn(`Status conflict for #${issueNumber}: local=${local.status}, project=${projectStatus}`);

      // Project wins for status
      local.status = projectStatus;
      await this.saveToJSON(local);
    }

    return local;
  }

  // When updating status
  async updateStatus(issueNumber: number, newStatus: AssignmentStatus): Promise<void> {
    // Update local first
    const assignment = await this.loadAssignment(issueNumber);
    assignment.status = newStatus;
    assignment.lastActivity = new Date().toISOString();
    await this.saveToJSON(assignment);

    // Sync to project
    await this.projectAPI.updateItemStatus(assignment.projectItemId, newStatus);
  }
}
```

### IssueEvaluator

```typescript
class IssueEvaluator {
  // Never cache project fields, always read fresh
  async evaluateIssue(issueNumber: number): Promise<EvaluationContext> {
    // Read AI evaluation from cache
    const cachedEval = await this.cache.get(issueNumber);

    // Read project fields FRESH (never cached)
    const projectFields = await this.projectAPI.getItemFields(issueNumber);

    // Read GitHub issue data FRESH
    const issue = await this.githubAPI.getIssue(issueNumber);

    return {
      // AI scores (cached, only regenerate if issue.updatedAt > cachedEval.lastEvaluated)
      aiScores: cachedEval?.scores || await this.runAIEvaluation(issue),

      // Project fields (fresh)
      priority: projectFields.priority,
      size: projectFields.size,
      area: projectFields.area,
      type: projectFields.type,
      sprint: projectFields.sprint,

      // GitHub issue data (fresh)
      labels: issue.labels,
      updatedAt: issue.updatedAt,
      // ...
    };
  }
}
```

### ProjectAwarePrioritizer

```typescript
class ProjectAwarePrioritizer {
  calculatePriority(context: EvaluationContext): number {
    const weights = this.config.prioritization.weights;

    // Project Priority (source of truth, 50%)
    const projectScore = this.projectPriorityToScore(context.priority);

    // AI Priority (cached, 30%)
    const aiScore = context.aiScores.aiPriorityScore;

    // Sprint (fresh, 10%)
    const sprintBoost = context.sprint === this.currentSprint ? 10 : 0;

    // Size preference (fresh, 10%)
    const sizeScore = this.sizePenalty(context.size);

    return (
      projectScore * weights.projectPriority +
      aiScore * weights.aiEvaluation +
      sprintBoost * weights.sprintBoost +
      sizeScore * weights.sizePreference
    );
  }
}
```

## Migration Strategy

When introducing GitHub Projects integration to existing autonomous installations:

### Phase 1: Add Project Links
```bash
# For each existing assignment
for assignment in assignments:
  if not assignment.projectItemId:
    # Find corresponding project item
    projectItemId = findProjectItem(assignment.issueNumber)
    assignment.projectItemId = projectItemId
    save(assignment)
```

### Phase 2: Reconcile Status
```bash
# Check for status conflicts
for assignment in assignments:
  localStatus = assignment.status
  projectStatus = getProjectStatus(assignment.projectItemId)

  if localStatus != projectStatus:
    log("Conflict on #" + assignment.issueNumber)
    log("  Local: " + localStatus)
    log("  Project: " + projectStatus)

    # Project wins
    assignment.status = projectStatus
    save(assignment)
```

### Phase 3: Remove Cached Project Fields
```bash
# Clean evaluation cache
for evaluation in evaluations:
  # Remove fields that should be read from project
  delete evaluation.classification.area
  delete evaluation.classification.types

  # Rename AI priority score
  evaluation.scores.aiPriorityScore = evaluation.scores.priority
  delete evaluation.scores.priority

  save(evaluation)
```

## Testing Synchronization

### Unit Tests
- Test conflict detection logic
- Test project field reads
- Test status sync write-back
- Test hybrid prioritization

### Integration Tests
- Test full workflow with real project
- Test concurrent access scenarios
- Test offline/degraded mode (project API unavailable)

### Manual Testing Checklist
- [ ] Assign issue, verify project Status updates
- [ ] Change project Status, verify autonomous detects change
- [ ] Change project Priority, verify re-prioritization
- [ ] Run two autonomous instances, verify no conflicts
- [ ] Test with issue not in project (graceful degradation)
- [ ] Test with project API error (fallback to local-only mode)

## Monitoring and Debugging

### Logging
Log all sync operations:
```
[SYNC] Reading status for #5: project=In Progress, local=assigned → CONFLICT
[SYNC] Updating status for #5: local=llm-complete → project=In Review
[SYNC] Fetching project fields for #5: Priority=High, Size=M, Sprint=Sprint 1
```

### Metrics
Track:
- Sync operation count
- Conflict detection count
- API call count (optimize caching)
- Staleness (time since last project read)

### Debug Commands
```bash
# Compare local vs project state
autonomous debug compare-state <issue-number>

# Force sync from project
autonomous debug sync-from-project <issue-number>

# Show sync history
autonomous debug sync-log <issue-number>
```

## Future Enhancements

### Bidirectional Field Sync
Currently, most fields are unidirectional (project → local). Future versions could:
- Sync AI effort estimates → project Effort Estimate field
- Sync AI complexity → project custom field
- Sync work sessions → project comments

### Optimistic UI Updates
- Update local state immediately
- Queue project API call
- Rollback if API call fails
- Show sync status in UI

### Webhook Integration
- Listen for project field changes
- Push updates to autonomous in real-time
- Eliminate polling for status changes

### Offline Mode
- Detect project API unavailability
- Fall back to local-only operation
- Queue sync operations for when API returns
- Resume sync when connectivity restored
