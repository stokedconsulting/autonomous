# Phase Dependency Queue System

## Overview

The system separates **assignment/queueing** from **work execution**:

1. **Assignment**: Can happen at any time, even if dependencies aren't met
2. **Execution**: Only starts when phase dependencies are satisfied

## Architecture

### UI Layer (Assignment)

**Location**: `src/ui/components/ItemActionMenu.tsx`, `src/ui/pages/ProjectPage.tsx`

**Behavior**:
- Users can queue items even if blocked by phase dependencies
- Clear visual indicators show dependency status
- "Add to Queue" action is always available
- "Start Work Now" is blocked if dependencies not met
- Shows warning: "⏸️ Dependencies: Phase 1: 2 work item(s) incomplete"

**Code Example**:
```typescript
// User clicks "Add to Queue" on Phase 2 item
handleItemAction('queue') {
  // Allowed even if Phase 1 not complete
  queueAssignment(item);
  // Item goes to queue with dependency metadata
}
```

### Orchestrator Layer (Execution)

**Location**: `src/core/orchestrator.ts` (integration point)

**Behavior**:
- Checks queue for items ready to start
- Validates phase dependencies before starting work
- Skips items with unmet dependencies
- Re-checks on every orchestrator loop iteration

**Integration Code**:
```typescript
// In orchestrator.ts - when processing queue
import { canStartWork } from '../utils/phase-dependencies.js';

async startQueuedWork() {
  const queuedItems = await this.getQueuedAssignments();
  const projectItems = await this.projectsAPI.getAllItems();

  for (const queued of queuedItems) {
    // Get the project item for dependency checking
    const projectItem = projectItems.find(
      i => i.content.number === queued.issueNumber
    );

    if (!projectItem) continue;

    // CHECK DEPENDENCIES BEFORE STARTING WORK
    const { canStart, reason } = canStartWork(projectItem, projectItems);

    if (!canStart) {
      console.log(
        `⏸️  Item #${queued.issueNumber} queued but waiting: ${reason}`
      );
      continue; // Skip this item, check next iteration
    }

    // Dependencies met - start work
    await this.startWork(queued);
  }
}
```

## Phase Master Auto-Assignment

### UI Behavior

When a phase master is queued:
1. All work items in the same phase are automatically queued together
2. Visual indicator shows: "📋 Phase Master: Will auto-assign 5 work item(s)"
3. Dependency checking still applies to the master and all work items

**Code Example**:
```typescript
// ProjectPage.tsx:handleItemAction
const isItemMaster = isPhaseMaster(selectedItem.content.title);

if (isItemMaster) {
  // Get all work items in this phase
  const phaseItems = getPhaseItems(selectedItem, projectItems);

  // Queue master + all work items
  queueItems([selectedItem, ...phaseItems]);
}
```

### Orchestrator Behavior

When starting a queued phase master:
1. Checks dependencies for the master
2. If master can start, all work items were already queued
3. Each work item's dependencies are checked individually
4. Work items start as their dependencies are met

## Dependency Rules

### Rule 1: Phase Work Dependencies

**Work items** can start if:
- All previous phases are complete (all work + master done)
- Previous phase master is not currently in-progress

**Example**:
```
Phase 1: Complete (all work done, master done)
Phase 2: Work items CAN START ✅
```

### Rule 2: Phase Master Dependencies

**Phase masters** can start ONLY if:
- All work items in the SAME phase are complete
- All previous phases are complete

**Example**:
```
Phase 2:
  - Work items: #10 (Done), #11 (Done), #12 (In Progress)
  - Master: #9 CANNOT START ❌ (work item #12 still in progress)
```

### Rule 3: Sequential Phase Execution

**Next phase** cannot start if:
- Previous phase master is currently assigned/in-progress
- Previous phase master has not completed

**Example**:
```
Phase 1 Master: In Progress
Phase 2 Items: CANNOT START ❌ (even if queued)
```

## Queue States

### Queued - Waiting on Dependencies

```
Status: Assigned (queued)
Reason: "Phase 1: 2 work item(s) incomplete"
Action: Remains in queue, checked every orchestrator iteration
```

### Queued - Ready to Start

```
Status: Assigned (queued)
Dependencies: Met ✅
Action: Orchestrator starts work process
```

### Active

```
Status: In Progress
Process: Worker running, PID assigned
```

## User Experience

### Queueing Items

**Scenario**: User queues Phase 2 items while Phase 1 is incomplete

```
User Action:
1. Select Phase 2 item
2. See warning: "⏸️ Dependencies: Phase 1: master In Progress"
3. Choose "Add to Queue"
4. Item queued successfully

System Response:
- Item added to queue
- Shows in Queue view as "Waiting on dependencies"
- Will auto-start when Phase 1 master completes
```

### Queue View Display

**Location**: `src/ui/pages/QueuePage.tsx`

**Sections**:
```
┌─ Work Queue ─────────────────────┐
│                                   │
│ ⚡ Ready (2)                      │
│   ● #15 Implement API endpoints   │
│   ● #16 Add validation            │
│                                   │
│ ⏸️  Waiting on Dependencies (3)   │
│   ○ #20 Setup database            │
│      → Phase 1: master In Progress│
│   ○ #21 Create schema             │
│      → Phase 1: master In Progress│
│   ○ #22 (Phase 2 Master)          │
│      → Phase 2: 1 work item(s)    │
│         incomplete                │
└───────────────────────────────────┘
```

## Implementation Checklist

- [x] Phase dependency validation utilities
- [x] UI indicators for blocked items
- [x] Phase master auto-assignment detection
- [x] Allow queueing with dependency warnings
- [x] Queue data structure with metadata (uses 'assigned' status)
- [x] Orchestrator integration with `canStartWork()`
- [ ] Queue view with dependency status
- [x] Periodic dependency re-checking in orchestrator loop

## Testing Scenarios

### Scenario 1: Linear Phase Progression

```
Initial State:
  Phase 1: #1, #2, #3 (work), #0 (master)
  Phase 2: #5, #6 (work), #4 (master)

Actions:
1. Queue all Phase 2 items → Allowed ✅
2. Start Phase 1 work → Starts ✅
3. Check Phase 2 → Still queued, waiting ⏸️
4. Complete Phase 1 work → #1, #2, #3 done
5. Phase 1 master becomes ready → Auto-starts ✅
6. Complete Phase 1 master → #0 done
7. Phase 2 work auto-starts → #5, #6 start ✅
```

### Scenario 2: Phase Master Queueing

```
Initial State:
  Phase 3: #10, #11 (work in progress), #9 (master)

Actions:
1. Queue Phase 3 master → Allowed ✅
2. Check #9 dependencies → Blocked by #11 ⏸️
3. Complete #11 → Done
4. Check #9 dependencies → Ready ✅
5. Auto-start #9 → Starts ✅
```

### Scenario 3: Multi-Phase Queue

```
Initial State:
  Phase 1: In Progress
  Phase 2: #5, #6 (work), #4 (master)
  Phase 3: #9, #10 (work), #8 (master)

Actions:
1. Queue all Phase 2 and 3 items → Allowed ✅
2. All show "waiting on Phase 1 master" → ⏸️
3. Phase 1 completes → ✅
4. Phase 2 items auto-start → ✅
5. Phase 3 still waiting → ⏸️
6. Phase 2 completes → ✅
7. Phase 3 items auto-start → ✅
```

## Integration Points

### 1. Queue Management (Implemented)

Queue management uses the existing `Assignment` system with status='assigned' to represent queued items.

**Location**: `src/core/orchestrator.ts`

```typescript
// In createAssignment() - Check dependencies before starting work
if (this.projectsAPI) {
  try {
    const allItems = await this.projectsAPI.getAllItems();
    const projectItem = allItems.find(item => item.content.number === issue.number);

    if (projectItem) {
      const { canStart, reason } = canStartWork(projectItem, allItems);

      if (!canStart) {
        // Dependencies not met - leave in 'assigned' status (queued)
        console.log(chalk.yellow(`⏸️  Item #${issue.number} queued - dependencies not met`));
        console.log(chalk.gray(`   Reason: ${reason}`));
        console.log(chalk.blue(`   Will auto-start when dependencies are satisfied\n`));

        await this.assignmentManager.updateStatusWithSync(assignment.id, 'assigned');
        await this.assignmentManager.updateAssignedInstanceWithSync(
          assignment.id,
          `queued:${assignment.llmInstanceId}`
        );

        return; // Exit early - don't start the LLM process
      }
    }
  } catch (error) {
    console.warn(chalk.yellow(`⚠️  Could not check phase dependencies: ${error}`));
    console.log(chalk.gray('   Proceeding with assignment anyway...'));
  }
}

// Dependencies met - proceed to start work
console.log(chalk.green(`✓ Dependencies satisfied - starting work on #${issue.number}`));
```

### 2. Orchestrator Loop (Implemented)

**Location**: `src/core/orchestrator.ts:startQueuedAssignments()`

The monitoring loop now checks queued assignments every 60 seconds and starts work when dependencies are satisfied.

```typescript
/**
 * Check queued assignments and start work when dependencies are met
 * Called periodically from monitoring loop
 */
private async startQueuedAssignments(): Promise<void> {
  if (!this.projectsAPI) {
    return;
  }

  // Get all assignments in 'assigned' status (queued)
  const queuedAssignments = this.assignmentManager
    .getAllAssignments()
    .filter(a => a.status === 'assigned');

  if (queuedAssignments.length === 0) {
    return;
  }

  // Get all project items for dependency checking
  const allItems = await this.projectsAPI.getAllItems();

  for (const assignment of queuedAssignments) {
    const projectItem = allItems.find(item => item.content.number === assignment.issueNumber);

    if (!projectItem) continue;

    // Check if dependencies are now met
    const { canStart, reason } = canStartWork(projectItem, allItems);

    if (canStart) {
      // Dependencies met - start the work!
      console.log(chalk.green(`\n✅ Dependencies satisfied for queued item #${assignment.issueNumber}`));
      console.log(chalk.blue(`   Starting work now...\n`));

      // Generate prompt and start LLM instance
      const prompt = PromptBuilder.buildInitialPrompt({
        assignment,
        worktreePath: assignment.worktreePath,
      });

      const adapter = this.adapters.get(assignment.llmProvider);
      await adapter.start({ assignment, prompt, workingDirectory: assignment.worktreePath });

      // Update assignment with PID and status to in-progress
      const status = await adapter.getStatus(assignment.llmInstanceId);
      await this.assignmentManager.updateAssignment(assignment.id, { processId: status?.processId });
      await this.assignmentManager.updateStatusWithSync(assignment.id, 'in-progress');
      await this.assignmentManager.updateAssignedInstanceWithSync(assignment.id, assignment.llmInstanceId);

      console.log(chalk.green(`✓ Started work on previously queued item #${assignment.issueNumber}\n`));
    } else if (this.verbose) {
      console.log(chalk.gray(`  ⏸️  #${assignment.issueNumber} still waiting: ${reason}`));
    }
  }
}

// In monitoring loop
while (this.isRunning) {
  await this.checkAssignments();
  await this.startQueuedAssignments(); // Check queued items every 60s
  // ... rest of monitoring loop
  await this.sleep(60000);
}
```

### 3. UI Integration (Completed)

```typescript
// ItemActionMenu.tsx - Allows queueing with warnings
handleSelect('queue') {
  // Always allowed, even if blocked
  onAction('queue');
}

handleSelect('start') {
  if (isBlocked) {
    return; // Prevent immediate start if dependencies not met
  }
  onAction('start');
}
```
