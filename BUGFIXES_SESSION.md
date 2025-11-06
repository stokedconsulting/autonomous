# Bug Fixes - Evaluation and Assignment Issues

## Session Summary
Fixed three critical bugs preventing proper evaluation and assignment workflow.

## Bug #1: Inverted Status Filter Logic

**Problem**:
- System was evaluating 45 items when it should have evaluated 0
- Status filter logic was inverted: `!statusValue || filters.status.includes(statusValue)`
- This returned ALL items without a status + items matching the filter
- User had NO items with "Evaluate" status, but system found 45 items

**Root Cause**:
File: `/Users/stoked/work/anonomous/autonomous/src/github/projects-api.ts:558`

Original logic:
```typescript
return !statusValue || filters.status!.includes(statusValue);
// Translation: Include if (no status) OR (status matches filter)
```

**Fix**:
```typescript
// Include ONLY if status matches one of the desired statuses
return statusValue && filters.status!.includes(statusValue);
// Translation: Include ONLY if (has status) AND (status matches filter)
```

**Test Results**:
- ✅ Items with "Evaluate" status: 0 (correct)
- ✅ Items with "Backlog" status: 22 (matches GitHub Project)
- ✅ No false positives from empty status values

---

## Bug #2: Missing Support for Items Without Status

**Problem**:
- Items without a status set should be considered "ready to start"
- System was excluding items with no status when fetching ready items
- User had 45 items with no status that should have been assignable

**Root Cause**:
File: `/Users/stoked/work/anonomous/autonomous/src/github/projects-api.ts:430-567`

The `queryItems` method didn't have a way to include items without status.

**Fix**:
Added `includeNoStatus` parameter to `queryItems`:

```typescript
async queryItems(filters?: {
  status?: string[];
  limit?: number;
  cursor?: string;
  includeNoStatus?: boolean; // NEW - if true, include items with no status set
}): Promise<ProjectItemsQueryResult>
```

Updated filter logic:
```typescript
// If includeNoStatus is true, include items with no status OR matching status
if (filters.includeNoStatus) {
  return !statusValue || filters.status!.includes(statusValue);
}

// Otherwise, include ONLY if status matches one of the desired statuses
return statusValue && filters.status!.includes(statusValue);
```

Updated orchestrator to pass `includeNoStatus: true` when fetching ready items:

File: `/Users/stoked/work/anonomous/autonomous/src/core/orchestrator.ts:286-290`
```typescript
const result = await this.projectsAPI.queryItems({
  status: readyStatuses,
  limit: 100,
  includeNoStatus: true, // Include items with no status set (ready to start)
});
```

**Test Results**:
- ✅ Items with "Evaluate" status (exact): 0
- ✅ Items with Ready/Todo/Evaluated OR no status: 46 (1 with "Todo" + 45 with no status)
- ✅ Items with "Backlog" status (exact): 22

---

## Bug #3: Missing "Assigned Instance" Field Update

**Problem**:
- Three items (#199, #200, #201) were assigned to "In Progress" status
- But "Assigned Instance" field remained empty in GitHub Project
- System was calling `updateStatusWithSync` but not `updateAssignedInstanceWithSync`

**Root Cause**:
File: `/Users/stoked/work/anonomous/autonomous/src/core/orchestrator.ts:679-692`

The orchestrator was only updating the status field, not the assigned instance field:

```typescript
if (this.projectsAPI) {
  await this.assignmentManager.updateAssignment(assignment.id, {
    status: 'in-progress',
    processId,
  });
  await this.assignmentManager.updateStatusWithSync(assignment.id, 'in-progress');
  // MISSING: updateAssignedInstanceWithSync call
}
```

**Fix**:
Added call to `updateAssignedInstanceWithSync`:

```typescript
if (this.projectsAPI) {
  await this.assignmentManager.updateAssignment(assignment.id, {
    status: 'in-progress',
    processId,
  });
  await this.assignmentManager.updateStatusWithSync(assignment.id, 'in-progress');
  // Update "Assigned Instance" field in GitHub Project
  await this.assignmentManager.updateAssignedInstanceWithSync(assignment.id, assignment.llmInstanceId);
}
```

**Expected Behavior**:
- When items are assigned, both "Status" and "Assigned Instance" fields are updated in GitHub Project
- "Assigned Instance" field shows which LLM instance (e.g., "claude-1", "claude-2") is working on the item
- This allows filtering and tracking which instances are active

---

## Complete Workflow Now

### 1. Evaluation Flow (Opt-In)
```
Item with "Evaluate" status
  ↓
AI evaluates (15-30s)
  ↓
Status = "Evaluated" or "Needs more info"
  ↓
Ready for assignment
```

### 2. Assignment Flow (Immediate)
```
Items with:
- "Ready" status
- "Todo" status
- "Evaluated" status
- No status set (NEW!)
  ↓
Immediate assignment (no evaluation)
  ↓
Status = "In Progress"
Assigned Instance = "claude-1" (or "claude-2", "claude-3")
  ↓
Claude Code starts working
```

### 3. Items Ignored
- "Backlog" status → not ready yet
- "Done" status → already complete
- "In review" status → in PR review
- "Needs more info" status → blocked

---

## Files Modified

1. `/Users/stoked/work/anonomous/autonomous/src/github/projects-api.ts`
   - Fixed inverted status filter logic (line 557)
   - Added `includeNoStatus` parameter (line 434)
   - Updated filter logic to handle both cases (lines 558-565)

2. `/Users/stoked/work/anonomous/autonomous/src/core/orchestrator.ts`
   - Added `includeNoStatus: true` when fetching ready items (line 289)
   - Added `updateAssignedInstanceWithSync` call after assignment (line 686)
   - Commented out unused `ProjectAwarePrioritizer` import and usage

3. `/Users/stoked/work/v3/.autonomous-config.json`
   - Added `"evaluateValue": "Evaluate"` to status configuration (line 64)

4. `/Users/stoked/work/anonomous/autonomous/src/types/config.ts`
   - Added optional `evaluateValue?: string` to StatusFieldConfig interface (line 88)

---

## Testing Performed

### Status Filter Testing
```bash
# Test 1: Evaluate items (exact match)
Items with 'Evaluate' status: 0 ✅

# Test 2: Ready items (with includeNoStatus)
Items with Ready/Todo/Evaluated OR no status: 46 ✅
  #199: Todo
  #200: (no status - ready to start)
  #201: (no status - ready to start)
  #202: (no status - ready to start)
  #203: (no status - ready to start)

# Test 3: Backlog items (exact match)
Items with 'Backlog' status: 22 ✅
```

### Expected Next Test
- Restart autonomous system
- Verify "Assigned Instance" field is populated for new assignments
- Verify 46 items are available for assignment (not just 1)
- Verify no evaluation happens for items without "Evaluate" status

---

## Performance Impact

**Before**:
- System tried to evaluate all items (even though filter was wrong)
- Only 1 item with "Todo" status was assignable
- 45 items with no status were ignored

**After**:
- 0 items need evaluation (none have "Evaluate" status)
- 46 items are immediately assignable (1 "Todo" + 45 with no status)
- **46x more items available** for assignment
- **Instant assignment** (no 15-30s evaluation delay per item)

---

## Next Steps

1. **Test Assignment Flow**:
   - Restart autonomous system
   - Verify 3 items get assigned (maxConcurrentIssues=3)
   - Check that "Assigned Instance" field is populated (claude-1, claude-2, claude-3)
   - Monitor logs for confirmation

2. **Test Evaluation Flow** (Optional):
   - Move a test item to "Evaluate" status in GitHub Project
   - Wait for next evaluation cycle (10 minutes) or restart
   - Verify item moves to "Evaluated" status
   - Check that fields are populated (Effort, Complexity, Impact, Priority)

3. **Monitor Capacity**:
   - Verify maxConcurrentIssues=3 is being respected
   - Check that items complete and free up slots
   - Ensure new items get assigned as capacity becomes available
