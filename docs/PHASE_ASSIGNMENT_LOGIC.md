# Phase Assignment Logic

## Overview

The phase assignment logic enforces **sequential phase execution** in epic mode, ensuring that:
1. Phase work items must complete before the phase master is assignable
2. The phase master must be assigned and completed before the next phase begins
3. Only one phase is active at a time

This creates a linear workflow: **Phase N work → Phase N master → Phase N+1 work → Phase N+1 master → ...**

## How It Works

### 1. Phase Detection

Issues are grouped into phases based on:
- **Primary**: The `Phase` field in GitHub Projects (e.g., "Phase 1", "Phase 2")
- **Fallback**: Title pattern matching (e.g., "Phase 1:", "[Phase 2]")

### 2. Phase Master Detection

Phase masters are identified using two methods:

**Method 1: Type Field (Primary)**
- If the GitHub Project has a `Type` field set to "Epic"
- This is the most reliable method

**Method 2: Title Pattern (Fallback)**
- Title starts with "Phase N:" or "[Phase N]"
- Title is concise (1-5 words after phase prefix)
- OR contains the word "MASTER" explicitly

Examples:
- ✅ Phase master: `"Phase 1: User Desirability"` (3 words)
- ✅ Phase master: `"[Phase 1] Data Layer & Database Schema - MASTER"` (has MASTER keyword)
- ❌ Work item: `"Phase 1: Implement user authentication with OAuth2 and JWT tokens"` (10 words)

### 3. Assignment Filtering

When in epic mode, `fetchAvailableIssues()` applies phase-based filtering:

```typescript
// orchestrator.ts:411
const phaseAssignableItems = await this.epicOrchestrator.getAssignableItemsForEpic(
  epicItems,
  this.assignmentManager
);
```

This method (`getAssignableItemsForEpic` in `epic-orchestrator.ts`):

1. **Groups items by phase** using `groupItemsByPhase()`
2. **Finds current phase** using `getCurrentPhase()` - the first incomplete phase
3. **Checks master assignment status**:
   - If phase master is currently assigned → return `[]` (blocks everything)
   - This prevents next phase from starting while master is in progress
4. **Returns assignable items** using `getAssignableItems()`:
   - If all work items complete → return `[masterItem]`
   - If work not complete → return `workItems` (excludes master)

### 4. Phase Completion Detection

A phase is considered complete when:
1. All work items have status: "Done", "Completed", or "Dev Complete"
2. All work items are merged to main branch

The `checkPhaseComplete()` method verifies both conditions.

## Code Flow

```
orchestrator.ts:fetchAvailableIssues()
  ↓
  Get project items with ready statuses
  ↓
  Filter to epic items (if epic mode)
  ↓
epic-orchestrator.ts:getAssignableItemsForEpic()
  ↓
  groupItemsByPhase() → Map<phaseName, EpicPhase>
  ↓
  getCurrentPhase() → First incomplete phase
  ↓
  Check if master assigned → Block all if yes
  ↓
  getAssignableItems() → Master OR work items
  ↓
  Return filtered items
  ↓
orchestrator.ts
  ↓
  Convert back to issue numbers
  ↓
  Check availability and assign
```

## Example Scenario

### Phase 1: User Desirability

**Initial State:**
- Work items: #253 (Ready), #254 (Ready), #255 (Ready)
- Master: #252 (Ready, but NOT assignable yet)

**Step 1: Work Items Assigned**
- System assigns #253, #254, #255
- #252 remains unassigned (blocked until work complete)

**Step 2: Work Items Complete**
- #253 → Done & Merged
- #254 → Done & Merged
- #255 → Done & Merged

**Step 3: Phase Master Assignable**
- All work complete → #252 becomes assignable
- #252 assigned
- Phase 2 items blocked (master in progress)

**Step 4: Phase Master Complete**
- #252 → Done & Merged
- Phase 1 complete
- Phase 2 work items now assignable

## Configuration

Phase assignment works automatically in epic mode. Enable it with:

```bash
auto start --epic "Epic Name" --merge-main
```

Or in code:

```typescript
const orchestrator = new Orchestrator(
  cwd,
  configManager,
  assignmentManager,
  verbose,
  { epicName: "User Desirability", autoMergeToMain: true }
);
```

## Files Involved

- **`src/core/epic-orchestrator.ts`**
  - `isPhaseMaster()` - Detects phase masters
  - `groupItemsByPhase()` - Groups items by phase
  - `getCurrentPhase()` - Finds active phase
  - `getAssignableItems()` - Returns master OR work items
  - `getAssignableItemsForEpic()` - Main filtering logic
  - `checkPhaseComplete()` - Validates phase completion

- **`src/core/orchestrator.ts`**
  - `fetchAvailableIssues()` - Calls epic filtering at line 411

- **`src/github/project-field-mapper.ts`**
  - `mapItemToMetadata()` - Extracts Type and Phase fields

## Troubleshooting

### Phase master assigned prematurely

**Cause**: Work items not marked as complete in correct statuses
**Solution**: Ensure work items have status "Done", "Completed", or "Dev Complete"

### Phase master not assignable when work is done

**Cause**: Work items not merged to main
**Solution**: Ensure all PRs are merged to main branch

### Wrong phase items assignable

**Cause**: Phase field not set or incorrect
**Solution**: Set Phase field in GitHub Projects (e.g., "Phase 1", "Phase 2")

### Phase master not detected

**Cause**: Title doesn't match pattern and Type field not set
**Solutions**:
1. Set Type field to "Epic" in GitHub Projects (preferred)
2. Use title pattern: "Phase N: Name" with 1-5 words
3. Add "MASTER" keyword to title explicitly
