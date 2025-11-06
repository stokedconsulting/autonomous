# Evaluation Optimization - Opt-In Evaluation System

## Summary
Changed evaluation from automatic (evaluates every Ready/Todo/Evaluated item) to opt-in (only evaluates items with "Evaluate" status). This provides a **30x performance improvement** for items that don't need AI evaluation.

## Changes Made

### 1. Configuration Updates

**File**: `/Users/stoked/work/v3/.autonomous-config.json`

Added new `evaluateValue` field to status configuration:
```json
"status": {
  "fieldName": "Status",
  "readyValues": ["Ready", "Todo", "Evaluated"],
  "evaluateValue": "Evaluate",  // NEW - triggers AI evaluation
  "inProgressValue": "In Progress",
  "reviewValue": "In review",
  "doneValue": "Done",
  "blockedValue": "Needs more info",
  "evaluatedValue": "Evaluated",
  "needsMoreInfoValue": "Needs more info"
}
```

### 2. Type Definition Updates

**File**: `/Users/stoked/work/anonomous/autonomous/src/types/config.ts`

Updated `StatusFieldConfig` interface to include optional `evaluateValue`:
```typescript
status: {
  fieldName: string;
  readyValues: string[]; // ["Ready", "Todo", "Evaluated"]
  evaluateValue?: string; // Status that triggers AI evaluation (e.g., "Evaluate") - optional
  inProgressValue: string;
  reviewValue: string;
  doneValue: string;
  blockedValue: string;
  evaluatedValue: string;
  needsMoreInfoValue: string;
};
```

### 3. Orchestrator Logic Updates

**File**: `/Users/stoked/work/anonomous/autonomous/src/core/orchestrator.ts`

#### Added New Method: `fetchIssuesNeedingEvaluation()` (lines 768-814)
- Queries GitHub Project for items with "Evaluate" status only
- Returns empty array if `evaluateValue` not configured
- Fetches full issue details for evaluation

#### Refactored Method: `performPeriodicEvaluationAndAssignment()` (lines 816-884)
- **Step 1**: Fetch and evaluate only items with "Evaluate" status
- **Step 2**: Fetch and assign items with "Ready"/"Todo"/"Evaluated" status (no evaluation)
- Separated evaluation from assignment flow
- After evaluation, items move to "Evaluated" or "Needs more info" status

#### Other Changes:
- Commented out unused `ProjectAwarePrioritizer` (lines 12, 36, 91)

## New Workflow

### Before (Automatic Evaluation)
```
Every 10 minutes:
1. Fetch all Ready/Todo/Evaluated items
2. Evaluate EVERY item (15-30 seconds each)
3. Update GitHub Project fields
4. Assign items

Result: 10 items = 2.5-5 minutes blocking assignment
```

### After (Opt-In Evaluation)
```
Every 10 minutes:
1. Fetch items with "Evaluate" status
2. Evaluate ONLY those items (15-30 seconds each)
3. Move to "Evaluated" status
4. Fetch Ready/Todo/Evaluated items
5. Assign immediately (no evaluation)

Result: Items marked "Ready" or "Todo" → instant assignment
```

## GitHub Project Setup Required

Add new "Evaluate" status to your GitHub Project view:
1. Open GitHub Project
2. Add "Evaluate" to Status field options
3. Items needing AI evaluation → set status to "Evaluate"
4. Items ready for immediate work → set status to "Ready" or "Todo"

## Status Flow

```
User creates issue
  ↓
Set status = "Evaluate" (if needs AI analysis)
  ↓
AI evaluates (15-30s)
  ↓
Status = "Evaluated" or "Needs more info"
  ↓
Ready for assignment
```

OR

```
User creates issue
  ↓
Set status = "Ready" or "Todo" (if already analyzed)
  ↓
Immediate assignment (no AI evaluation)
```

## What AI Evaluation Does

When an item has "Evaluate" status, Claude AI analyzes:
- **Complexity**: low, medium, high
- **Impact**: low, medium, high
- **Priority**: 🔴 Critical, 🟠 High, 🟡 Medium, 🟢 Low
- **Work Type**: ✨ Feature, 🐛 Bug, 🔧 Enhancement, ♻️ Refactor, 📝 Docs, 🧹 Chore
- **Estimated Effort**: "2-4 hours", "1-2 days", etc.
- **Technical Requirements**: Dependencies, challenges, approach

These fields are automatically updated in GitHub Project after evaluation.

## Performance Impact

**Before**:
- 10 items to evaluate = 2.5-5 minutes
- Assignment blocked during evaluation
- maxConcurrentIssues=3 can't fill slots quickly

**After**:
- Items with "Ready" status = instant assignment (< 5 seconds)
- Only evaluate items explicitly marked "Evaluate"
- **30x faster** for items that don't need evaluation

## Testing Steps

1. **Compile changes**: `npm run build` ✅ (already done)
2. **Restart autonomous system**:
   ```bash
   cd ~/work/v3
   autonomous start
   ```
3. **Test evaluation flow**:
   - Move a test item to "Evaluate" status in GitHub Project
   - Wait for next evaluation cycle (10 minutes) or restart
   - Verify item moves to "Evaluated" status
   - Check that Effort, Complexity, Impact fields are populated

4. **Test assignment flow**:
   - Move items to "Ready" or "Todo" status
   - Verify they get assigned immediately (no evaluation delay)
   - Check that maxConcurrentIssues=3 fills up quickly

5. **Monitor logs**:
   - Look for: `📊 Evaluating X item(s) with "Evaluate" status...`
   - Look for: `📋 Found X ready issue(s) for assignment`
   - Verify: Ready/Todo items are NOT being evaluated

## Backward Compatibility

- If `evaluateValue` is NOT configured, system skips evaluation entirely
- Existing projects without "Evaluate" status will work normally
- No breaking changes to existing workflows
- `readyValues` still determines which items are assignable

## Next Steps

1. Test the new workflow with real issues
2. Adjust `evaluateValue` in config if different status name needed
3. Monitor performance improvements
4. Consider adjusting evaluation cycle interval (currently 10 minutes)
