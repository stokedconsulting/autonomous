# Assigned Instance Field Lifecycle Analysis

## Overview
The "Assigned Instance" field in GitHub Project tracks which LLM instance (claude-1, claude-2, claude-3) is actively working on an item. This document analyzes when it gets set, unset, and whether workers update it.

## Current Status: INCOMPLETE IMPLEMENTATION ⚠️

### What Works ✅
- **Initial Assignment**: Field is set when item is first assigned (orchestrator.ts:686)
- **Dead Process Cleanup**: Field is cleared when process dies (orchestrator.ts:335, 346)
- **Manual Assignment**: Field is set via CLI `assign` command (assign.ts:211)

### What's Missing ❌
- **Merge Worker**: Does NOT set assigned instance when reviewing items
- **Review Worker**: Does NOT set assigned instance when reviewing items
- **Completion**: Field is NOT cleared when work completes (moves to "Done")
- **Stage Transition**: Field is NOT cleared when item moves to "Stage Ready"

---

## Complete Lifecycle Map

### 1. Initial Assignment (orchestrator.ts)
**When**: Item moves from Ready/Todo/Evaluated → In Progress
**Location**: `/Users/stoked/work/anonomous/autonomous/src/core/orchestrator.ts:684-686`

```typescript
await this.assignmentManager.updateStatusWithSync(assignment.id, 'in-progress');
// Update "Assigned Instance" field in GitHub Project
await this.assignmentManager.updateAssignedInstanceWithSync(assignment.id, assignment.llmInstanceId);
```

**Result**:
- Status: "In Progress"
- Assigned Instance: "claude-1" (or "claude-2", "claude-3")

---

### 2. Dead Process Cleanup (orchestrator.ts)
**When**: fetchAvailableIssues() detects dead process during assignment check
**Location**: `/Users/stoked/work/anonomous/autonomous/src/core/orchestrator.ts:332-349`

```typescript
if (!processRunning) {
  // Process is dead - clear the assignment
  console.log(chalk.yellow(`    ⚠️  DEAD PROCESS - clearing assignment`));
  await this.projectsAPI.updateItemTextField(item.id, assignedInstanceField.fieldName, null);
  availableIssueNumbers.add(issueNumber);
  clearedDeadAssignments++;
}
```

**Also clears** unknown/stale instance IDs:
```typescript
else {
  // Instance ID doesn't match any known assignment - clear it
  console.log(chalk.yellow(`    ⚠️  Unknown instance or no PID - clearing assignment`));
  await this.projectsAPI.updateItemTextField(item.id, assignedInstanceField.fieldName, null);
}
```

**Result**:
- Assigned Instance: null (cleared)
- Item becomes available for reassignment

---

### 3. Manual CLI Assignment
**When**: User runs `autonomous assign <issue-number>`
**Location**: `/Users/stoked/work/anonomous/autonomous/src/cli/commands/assign.ts:208-214`

```typescript
// Link to project
await assignmentManager.ensureProjectItemId(assignment.id);
console.log(chalk.gray('✓ Linked to project'));

// Update assigned instance field in project
await assignmentManager.updateAssignedInstanceWithSync(
  assignment.id,
  availableSlot.instanceId
);
```

**Result**:
- Status: "In Progress"
- Assigned Instance: "claude-X" (next available slot)

---

### 4. Dev Completion (orchestrator.ts)
**When**: LLM finishes work, creates PR, exits normally
**Location**: `/Users/stoked/work/anonomous/autonomous/src/core/orchestrator.ts:965-982`

```typescript
// Update assignment to dev-complete (awaiting merge worker)
const updates: UpdateAssignmentInput = {
  completedAt: new Date().toISOString(),
};

if (this.projectsAPI) {
  await this.assignmentManager.updateStatusWithSync(assignment.id, 'dev-complete');
  await this.assignmentManager.updateAssignment(assignment.id, updates);
}
```

**Status Mapping** (projects-api.ts:53):
- Local status: `dev-complete`
- Project status: "Dev Complete"

**Problem**: ❌ **Assigned Instance is NOT cleared here**

**Expected Behavior**:
- LLM has finished work and exited
- Process no longer running
- Should clear "Assigned Instance" to free up the slot
- Should remain cleared through merge worker stages

**Recommendation**: Add this after line 982:
```typescript
// Clear assigned instance since LLM work is complete
await this.assignmentManager.updateAssignedInstanceWithSync(assignment.id, null);
```

---

### 5. Merge Worker Processing (merge-worker.ts)

#### Stage 5a: Merge Review Start
**When**: Merge worker picks up dev-complete item
**Location**: `/Users/stoked/work/anonomous/autonomous/src/core/merge-worker.ts:105`

```typescript
// Update status to merge-review
await this.assignmentManager.updateStatusWithSync(assignment.id, 'merge-review');
```

**Status Mapping** (projects-api.ts:54):
- Local status: `merge-review`
- Project status: "Merge Review"

**Current Behavior**: ❌ Does NOT set "Assigned Instance" to "merge-worker"

**Recommendation**: Add this after line 105:
```typescript
// Set assigned instance to merge worker
await this.assignmentManager.updateAssignedInstanceWithSync(assignment.id, 'merge-worker');
```

#### Stage 5b: Merge Approved → Stage Ready
**When**: All persona reviews pass, pushed to stage branch
**Location**: `/Users/stoked/work/anonomous/autonomous/src/core/merge-worker.ts:190`

```typescript
await this.assignmentManager.updateStatusWithSync(assignment.id, 'stage-ready');
```

**Status Mapping** (projects-api.ts:55):
- Local status: `stage-ready`
- Project status: "Stage Ready"

**Current Behavior**: ❌ Does NOT clear "Assigned Instance"

**Recommendation**: Add this after line 190:
```typescript
// Clear assigned instance - work is complete and on stage
await this.assignmentManager.updateAssignedInstanceWithSync(assignment.id, null);
```

#### Stage 5c: Merge Rejected → Back to Todo
**When**: Persona reviews fail, send back for fixes
**Location**: `/Users/stoked/work/anonomous/autonomous/src/core/merge-worker.ts:214, 271`

```typescript
// Update status back to Todo
await this.assignmentManager.updateStatusWithSync(assignment.id, 'assigned');
```

**Status Mapping** (projects-api.ts:51):
- Local status: `assigned`
- Project status: "Todo"

**Current Behavior**: ❌ Does NOT clear "Assigned Instance"

**Expected Behavior**:
- Item goes back to "Todo" status
- Should be available for reassignment
- Assigned Instance should be cleared

**Recommendation**: Add this after line 214 AND line 271:
```typescript
// Clear assigned instance - item needs to be reassigned
await this.assignmentManager.updateAssignedInstanceWithSync(assignment.id, null);
```

---

### 6. Final Completion (Currently Missing)
**When**: Item moves to "Done" status (merged to main)
**Status Mapping** (projects-api.ts:56):
- Local status: `merged`
- Project status: "Done"

**Current Behavior**: ❌ NO code path sets status to 'merged' or 'Done'

**Expected Behavior**:
- After manual merge to main, item should move to "Done"
- Assigned Instance should be cleared (work is complete)

**Missing Implementation**: Need to add workflow for manual merge to main detection

---

## Status Transition Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     ASSIGNED INSTANCE LIFECYCLE                  │
└─────────────────────────────────────────────────────────────────┘

Ready/Todo/Evaluated
(Assigned Instance: empty)
        │
        │ orchestrator assigns
        ↓
In Progress
(Assigned Instance: "claude-1") ← ✅ SET
        │
        │ LLM completes work
        ↓
Dev Complete
(Assigned Instance: "claude-1") ← ❌ SHOULD CLEAR (not implemented)
        │
        │ merge worker picks up
        ↓
Merge Review
(Assigned Instance: "claude-1" or empty) ← ❌ SHOULD SET to "merge-worker"
        │
        ├─ Reviews Pass ──→ Stage Ready
        │                  (Assigned Instance: ?) ← ❌ SHOULD CLEAR
        │                          │
        │                          │ manual push to main
        │                          ↓
        │                        Done
        │                  (Assigned Instance: ?) ← ❌ SHOULD CLEAR
        │
        └─ Reviews Fail ──→ Todo (retry)
                           (Assigned Instance: "claude-1") ← ❌ SHOULD CLEAR
```

---

## Worker Status Summary

### Orchestrator (Main LLM Worker)
- **Sets Instance**: ✅ YES (orchestrator.ts:686)
- **Clears on Death**: ✅ YES (orchestrator.ts:335, 346)
- **Clears on Complete**: ❌ NO (should clear at dev-complete)

### Merge Worker
- **Sets Instance**: ❌ NO (should set to "merge-worker")
- **Clears on Success**: ❌ NO (should clear at stage-ready)
- **Clears on Failure**: ❌ NO (should clear when rejected)

### Review Worker (review-worker.ts)
- **Sets Instance**: ❌ NO (currently not integrated)
- **Usage**: Manual review via `autonomous review` command
- **Should it set?**: Depends on design - if it blocks assignment, yes

---

## Recommendations

### Immediate Fixes Needed

#### 1. Clear Instance on Dev Complete
**File**: `/Users/stoked/work/anonomous/autonomous/src/core/orchestrator.ts`
**After line 982** (after updateStatusWithSync):

```typescript
// Clear assigned instance since LLM work is complete
if (this.projectsAPI) {
  await this.assignmentManager.updateAssignedInstanceWithSync(assignment.id, null);
}
```

#### 2. Set Merge Worker Instance
**File**: `/Users/stoked/work/anonomous/autonomous/src/core/merge-worker.ts`
**After line 105** (after updateStatusWithSync to merge-review):

```typescript
// Set assigned instance to merge worker
await this.assignmentManager.updateAssignedInstanceWithSync(assignment.id, 'merge-worker');
```

#### 3. Clear Instance on Stage Ready
**File**: `/Users/stoked/work/anonomous/autonomous/src/core/merge-worker.ts`
**After line 190** (after updateStatusWithSync to stage-ready):

```typescript
// Clear assigned instance - work is complete and on stage
await this.assignmentManager.updateAssignedInstanceWithSync(assignment.id, null);
```

#### 4. Clear Instance on Rejection (2 places)
**File**: `/Users/stoked/work/anonomous/autonomous/src/core/merge-worker.ts`
**After line 214 AND line 271** (after updateStatusWithSync to assigned):

```typescript
// Clear assigned instance - item needs to be reassigned
await this.assignmentManager.updateAssignedInstanceWithSync(assignment.id, null);
```

---

## Expected Behavior After Fixes

### Scenario 1: Successful Flow
```
1. Ready → In Progress (claude-1) ✅
2. Dev Complete (empty) ✅
3. Merge Review (merge-worker) ✅
4. Stage Ready (empty) ✅
5. Done (empty) ✅
```

### Scenario 2: Rejection Flow
```
1. Ready → In Progress (claude-2) ✅
2. Dev Complete (empty) ✅
3. Merge Review (merge-worker) ✅
4. Rejected → Todo (empty) ✅
5. Ready for reassignment
```

### Scenario 3: Dead Process
```
1. Ready → In Progress (claude-3) ✅
2. Process dies
3. Resurrection detects dead process
4. In Progress (empty) ✅
5. Ready for reassignment
```

---

## Benefits of Complete Implementation

1. **Accurate Capacity Tracking**: Know exactly which slots are in use
2. **Worker Visibility**: See which worker (claude-1, merge-worker) is handling each item
3. **Proper Cleanup**: Slots are freed immediately when work completes
4. **Debugging**: Easy to identify stuck items by checking assigned instance
5. **Concurrent Limits**: Correctly enforce maxConcurrentIssues limit

---

## Testing Plan

After implementing fixes:

1. **Test Initial Assignment**:
   - Assign 3 items
   - Verify "Assigned Instance" shows "claude-1", "claude-2", "claude-3"

2. **Test Dev Completion**:
   - Let one item complete
   - Verify "Assigned Instance" is cleared
   - Verify status is "Dev Complete"

3. **Test Merge Worker**:
   - Wait for merge worker to pick up completed item
   - Verify "Assigned Instance" changes to "merge-worker"
   - Verify status is "Merge Review"

4. **Test Merge Success**:
   - Let merge worker complete successfully
   - Verify "Assigned Instance" is cleared
   - Verify status is "Stage Ready"

5. **Test Merge Rejection**:
   - Force a merge worker rejection
   - Verify "Assigned Instance" is cleared
   - Verify status returns to "Todo"
   - Verify item can be reassigned

6. **Test Dead Process**:
   - Kill a running process
   - Wait for resurrection cycle (3 minutes)
   - Verify "Assigned Instance" is cleared
   - Verify item becomes available for reassignment
