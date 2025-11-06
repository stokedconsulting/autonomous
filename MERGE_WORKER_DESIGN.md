# Merge Worker Design Document

## Overview

The Merge Worker is a single-instance autonomous process that handles the integration and review of completed development work. It acts as a gatekeeper between individual feature branches and the `stage` branch, ensuring quality through automated persona-based reviews before changes reach staging.

## New Status Flow

```
Todo → In Progress → Dev Complete → Merge Review → Stage Ready → Done
                                   ↓ (if review fails)
                                  Todo (with documented issues)
```

### Status Definitions

| Status | Description | GitHub Project Status |
|--------|-------------|----------------------|
| `assigned` | Issue assigned to LLM | Todo |
| `in-progress` | LLM actively working | In Progress |
| `dev-complete` | Dev work done, awaiting merge worker | Dev Complete |
| `merge-review` | Merge worker reviewing changes | Merge Review |
| `stage-ready` | Merged to stage, ready for main | Stage Ready |
| `merged` | Merged to main, fully complete | Done |

## Architecture

### Branch Strategy

```
main (protected)
  ├─ stage (integration branch, force-pushed from merge_stage)
  └─ merge_stage (temporary, created from main)
       └─ feature/issue-X (individual branches, merged here one at a time)
```

**Branch Purposes:**

1. **`main`** - Production branch, only updated by humans
2. **`stage`** - Integration/staging branch, force-pushed from `merge_stage` after review passes
3. **`merge_stage`** - Temporary working branch for merge worker
   - Created fresh from `main` for each batch
   - Individual feature branches merged here
   - Conflicts resolved here
   - Deleted and recreated as needed
4. **`feature/issue-X`** - Individual LLM worktree branches

### Merge Worker Process

#### 1. Monitor for Dev Complete Items

```typescript
// Monitoring loop (runs every 60 seconds)
const devCompleteItems = getAssignmentsByStatus('dev-complete');
if (devCompleteItems.length > 0 && !mergeWorkerRunning) {
  startMergeWorker(devCompleteItems);
}
```

#### 2. Create/Reset merge_stage Branch

```bash
# Delete existing merge_stage if it exists
git branch -D merge_stage 2>/dev/null || true

# Create fresh from main
git checkout main
git pull origin main
git checkout -b merge_stage
```

#### 3. Process Items FIFO (or by priority)

For each `dev-complete` item:

**a. Update status to `merge-review`:**
```typescript
await assignmentManager.updateStatusWithSync(assignment.id, 'merge-review');
```

**b. Attempt to merge feature branch:**
```bash
git merge --no-ff feature/issue-X
```

**c. Handle merge conflicts (if any):**
- If conflicts: Use Claude Code with special prompt to resolve
- Commit resolved changes
- Document conflict resolution in review results

**d. Run automated tests (if configured):**
```bash
npm test  # or configured test command
```

#### 4. Automated Review with Personas

For each successfully merged item, run persona-based review:

**Review Process:**
```typescript
interface ReviewProcess {
  assignment: Assignment;
  personas: string[];  // From config or default set
  reviews: PersonaReview[];
}

interface PersonaReview {
  persona: string;
  passed: boolean;
  feedback: string;
  reviewedAt: string;
}
```

**Persona Evaluation:**

Each persona evaluates:
1. **Requirements Coverage** - Does it solve the original issue?
2. **Code Quality** - Is it well-written and maintainable?
3. **Completeness** - Are all acceptance criteria met?
4. **Edge Cases** - Are edge cases handled?
5. **Testing** - Are tests adequate?

**Example Personas:**
- **Product Manager** - Requirements & acceptance criteria
- **Senior Engineer** - Code quality & architecture
- **QA Engineer** - Test coverage & edge cases
- **Security Engineer** - Security concerns
- **DevOps Engineer** - Deployment & ops concerns

#### 5. Decision Making

```typescript
const overallPassed = reviews.every(r => r.passed);

if (overallPassed) {
  // PASS: Force push to stage
  await forcePushToStage(assignment);
  await updateStatus(assignment, 'stage-ready');
} else {
  // FAIL: Send back to Todo with feedback
  await rejectToTodo(assignment, reviews);
}
```

#### 6. Force Push to Stage (if passed)

```bash
# Force push merge_stage to stage
git push origin merge_stage:stage --force

# Tag the commit for tracking
git tag "stage-$(date +%Y%m%d-%H%M%S)"
git push origin --tags
```

#### 7. Cleanup

```bash
# After successful stage push, can delete feature branch
git branch -D feature/issue-X
# Optionally delete worktree (or keep for debugging)
```

## Data Structures

### Updated Assignment Interface

```typescript
interface Assignment {
  // ... existing fields ...

  // Merge & Review fields
  mergeStageCommit?: string; // SHA of commit on merge_stage
  reviewResults?: {
    startedAt: string;
    completedAt?: string;
    personaReviews: Array<{
      persona: string;
      passed: boolean;
      feedback: string;
      reviewedAt: string;
    }>;
    overallPassed: boolean;
    failureReasons?: string[]; // If failed, documented issues
  };
}
```

## Configuration

### New Config Section

```json
{
  "mergeWorker": {
    "enabled": true,
    "personas": [
      "product-manager",
      "senior-engineer",
      "qa-engineer"
    ],
    "requireAllPersonasPass": true,
    "conflictResolution": "auto", // or "manual"
    "stageBranch": "stage",
    "mainBranch": "main",
    "autoDeleteWorktrees": false
  }
}
```

## Implementation Plan

### Phase 1: Core Infrastructure ✅ DONE
- [x] Add new status types
- [x] Update status mappings
- [x] Update orchestrator logic
- [x] Update CLI commands (status, item log)

### Phase 2: Branch Management (TODO)
- [ ] Create merge_stage branch manager
- [ ] Implement branch creation/deletion logic
- [ ] Add merge conflict detection
- [ ] Build automated conflict resolution with Claude

### Phase 3: Merge Worker Core (TODO)
- [ ] Create MergeWorker class
- [ ] Implement monitoring loop
- [ ] Add FIFO/priority queue processing
- [ ] Integrate with assignment manager

### Phase 4: Automated Review (TODO)
- [ ] Design persona review prompts
- [ ] Implement multi-persona evaluation
- [ ] Add review result storage
- [ ] Create feedback formatting for failed reviews

### Phase 5: Stage Integration (TODO)
- [ ] Implement force-push logic to stage
- [ ] Add tagging and tracking
- [ ] Create rollback mechanism
- [ ] Add notification on stage updates

### Phase 6: Human Approval Flow (TODO)
- [ ] CLI command to review stage changes
- [ ] Manual approval to merge stage → main
- [ ] Audit log of approvals
- [ ] Optional webhook notifications

## Usage Examples

### Developer Workflow

```bash
# 1. Start autonomous system
auto start

# 2. LLM picks up issue and starts working
# Status: Todo → In Progress

# 3. LLM completes work
# Status: In Progress → Dev Complete
# PR is created but NOT merged yet

# 4. Merge worker picks it up automatically
# Status: Dev Complete → Merge Review

# 5a. Review passes
# Status: Merge Review → Stage Ready
# Changes are now on 'stage' branch

# 5b. Review fails
# Status: Merge Review → Todo
# Issue is updated with detailed feedback
```

### Manual Merge to Main

```bash
# Review what's on stage
git diff main..stage

# If satisfied, merge to main (human-controlled)
git checkout main
git merge stage --no-ff -m "Release: merge stage to main"
git push origin main
```

## Benefits

1. **Quality Gate** - Automated review before staging
2. **Conflict Resolution** - Handled automatically in isolation
3. **Clean History** - Controlled integration points
4. **Safe Experimentation** - Stage can be reset without affecting main
5. **Audit Trail** - Full review results stored per assignment
6. **Human Control** - Final merge to main requires approval

## Next Steps

1. **Create MergeWorker class** - Core worker implementation
2. **Build branch management** - merge_stage automation
3. **Design persona prompts** - Review evaluation logic
4. **Integrate with orchestrator** - Add to monitoring loop
5. **Testing** - End-to-end workflow validation
