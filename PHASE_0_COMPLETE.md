# Phase 0: Data Model Reconciliation - COMPLETE

## Overview

Phase 0 reconciles the data model between local autonomous tracking (JSON files) and GitHub Projects v2, establishing clear source of truth for all fields and implementing conflict detection infrastructure.

## Accomplishments

### 1. Type System Updates

#### `src/types/assignments.ts`
- Added `projectItemId?: string` field to link assignments to GitHub Projects items
- Removed `labels` from metadata (read from GitHub/project instead)
- Documented sync strategy with inline comments

**Sync Strategy**:
- **Local fields**: Process state, timestamps, worktree info (source of truth)
- **Synced fields**: Status (read from project, written back on changes)
- **Project fields**: Priority, labels, sprint (read from project, never cached)

#### `src/types/evaluation.ts`
- Removed `IssueType` enum (no longer used)
- Removed `types: IssueType[]` from IssueClassification
- Removed `area: string | null` from IssueClassification
- Renamed `scores.priority` to `scores.aiPriorityScore`
- Kept AI-specific fields: complexity, impact, clarity, importance, feasibility

**Before**:
```typescript
interface IssueClassification {
  types: IssueType[];
  area: string | null;
  complexity: Complexity;
  impact: Impact;
}

interface IssueScores {
  clarity: number;
  importance: number;
  feasibility: number;
  priority: number;  // ❌ Conflicts with project Priority
}
```

**After**:
```typescript
interface IssueClassification {
  // Area and Issue Type removed - read from project
  complexity: Complexity;  // AI assessment
  impact: Impact;          // AI assessment
}

interface IssueScores {
  clarity: number;
  importance: number;
  feasibility: number;
  aiPriorityScore: number;  // ✅ Clear it's AI-generated
}
```

#### `src/types/config.ts`
- Added comprehensive `ProjectConfig` interface
- Includes field mapping (status, priority, size, sprint)
- Hybrid prioritization weights configuration
- Sync conflict resolution settings

### 2. Core Logic Updates

#### `src/core/assignment-manager.ts`
**Added Infrastructure**:
- `ProjectAPI` interface (to be implemented in Phase 1)
- Logger interface for conflict detection
- Optional `projectAPI` and `logger` constructor parameters

**New Methods**:
- `loadAssignmentWithConflictDetection()`: Checks project status and resolves conflicts
- `updateStatusWithSync()`: Updates local first, then syncs to project
- `ensureProjectItemId()`: Links assignments to project items
- `reconcileAllAssignments()`: Batch reconciliation for migration

**Conflict Resolution**:
- Project status wins over local status
- Graceful degradation when project API unavailable
- Comprehensive logging of conflicts

#### `src/core/issue-evaluator.ts`
- Renamed `calculatePriority()` to `calculateAIPriorityScore()`
- Updated verbose output to show AI priority instead of types/area
- Updated sorting to use `aiPriorityScore`
- Added sync strategy documentation comments

#### Updated References:
- `src/cli/commands/assign.ts`: Display AI priority, complexity, impact
- `src/core/orchestrator.ts`: Display AI priority score in ranking
- `src/llm/prompt-builder.ts`: Removed labels from prompt

### 3. Documentation

#### `src/core/sync-strategy.md`
Comprehensive 400+ line documentation covering:
- Architecture principles (single source of truth)
- Complete field mapping tables
- Synchronization workflows (fetching, assigning, updating, conflicts)
- Implementation guidelines with code examples
- Migration strategy
- Testing checklist
- Monitoring and debugging

**Key Workflows Documented**:
1. Fetching issues for assignment (hybrid prioritization)
2. Assigning an issue (update project + local)
3. Updating status during work (sync back to project)
4. Handling conflicts (project wins scenarios)

### 4. Migration Tools

#### `scripts/migrate-phase0.ts`
Automated migration script:
- Migrates evaluation cache schema (v1.0.0 → v2.0.0)
- Removes `classification.area` and `classification.types`
- Renames `scores.priority` to `scores.aiPriorityScore`
- Removes `metadata.labels` from assignments
- Optionally links assignments to project items
- Supports dry-run mode
- Creates backups before modifying files

**Usage**:
```bash
# Dry run to preview changes
npx tsx scripts/migrate-phase0.ts --dry-run

# Migrate evaluation cache and assignments
npx tsx scripts/migrate-phase0.ts

# Migrate and link to project
npx tsx scripts/migrate-phase0.ts --link-project
```

## Build Status

✅ **TypeScript compilation successful** (0 errors)

All Phase 0 changes compile cleanly:
- Type definitions updated
- All references to removed fields corrected
- New conflict detection infrastructure compiles
- Migration script compiles

## Files Modified

### Types (3 files)
- `src/types/assignments.ts` - Assignment and CreateAssignmentInput
- `src/types/evaluation.ts` - IssueClassification and IssueScores
- `src/types/config.ts` - Added ProjectConfig

### Core Logic (3 files)
- `src/core/assignment-manager.ts` - Conflict detection infrastructure
- `src/core/issue-evaluator.ts` - AI priority score naming
- `src/core/orchestrator.ts` - Updated references

### Commands (1 file)
- `src/cli/commands/assign.ts` - Updated display and removed labels

### LLM (1 file)
- `src/llm/prompt-builder.ts` - Removed labels from prompt

### Documentation (2 files)
- `src/core/sync-strategy.md` - Comprehensive sync documentation (new)
- `PHASE_0_COMPLETE.md` - This file (new)

### Scripts (1 file)
- `scripts/migrate-phase0.ts` - Migration script (new)

**Total**: 11 files modified/created

## Breaking Changes

### For Existing Autonomous Installations

1. **Evaluation Cache Schema Change**
   - `scores.priority` → `scores.aiPriorityScore`
   - `classification.types` removed
   - `classification.area` removed
   - Run migration script to update

2. **Assignment Metadata Change**
   - `metadata.labels` removed
   - Read labels from GitHub API instead

3. **CreateAssignmentInput API Change**
   - `labels` parameter removed
   - Existing code passing labels will fail to compile

### Migration Path

```bash
# 1. Backup your data
cp autonomous-assignments.json autonomous-assignments.json.backup
cp .autonomous/issue-evaluations.json .autonomous/issue-evaluations.json.backup

# 2. Run migration (dry run first)
npx tsx scripts/migrate-phase0.ts --dry-run

# 3. Apply migration
npx tsx scripts/migrate-phase0.ts

# 4. Rebuild
npm run build

# 5. Test
npm test
```

## What's Next: Phase 1

Phase 0 establishes the **data model** and **conflict detection infrastructure**.

**Phase 1** will implement the **actual GitHub Projects API integration**:

### Phase 1 Tasks (Issues #1-8)
1. **#2**: Implement `GitHubProjectsAPI` with GraphQL client
2. **#3**: Add project field mapping and metadata reading
3. **#4**: Implement project items query with filters
4. **#5**: Add project configuration to .autonomous-config.json
5. **#6**: Create `autonomous project init` command
6. **#7**: Create `autonomous project status` command
7. **#8**: Create `autonomous project list-ready` command

### Phase 1 Will Wire Up:
- `ProjectAPI` interface → real GraphQL implementation
- `loadAssignmentWithConflictDetection()` → actually check project
- `updateStatusWithSync()` → actually update project
- Hybrid prioritization combining AI + project Priority
- Fresh reads of project fields (Priority, Area, Type, Size, Sprint)

## Verification

### Manual Testing Checklist

Before starting Phase 1, verify Phase 0 changes:

- [ ] TypeScript compiles without errors (`npm run build`)
- [ ] Migration script runs successfully (`npx tsx scripts/migrate-phase0.ts --dry-run`)
- [ ] Assignment types include `projectItemId` field
- [ ] Evaluation types use `aiPriorityScore` instead of `priority`
- [ ] Evaluation types don't include `area` or `types` in classification
- [ ] Config types include `ProjectConfig` interface
- [ ] AssignmentManager has conflict detection methods
- [ ] Sync strategy documentation is comprehensive

### Code Review Checklist

- [ ] All references to `scores.priority` changed to `scores.aiPriorityScore`
- [ ] All references to `classification.types` removed or replaced
- [ ] All references to `classification.area` removed
- [ ] All references to `metadata.labels` removed
- [ ] CreateAssignmentInput no longer accepts `labels`
- [ ] Conflict detection methods have proper error handling
- [ ] Documentation accurately reflects implementation

## Success Criteria

✅ All criteria met:

1. **Type Safety**: TypeScript compiles with 0 errors
2. **Data Model**: Clear source of truth for all fields documented
3. **Conflict Resolution**: Infrastructure in place (will integrate in Phase 1)
4. **Migration**: Automated script to upgrade existing data
5. **Documentation**: Comprehensive sync strategy guide
6. **Backwards Compatibility**: Migration path for existing installations
7. **Testing**: Build passes, ready for Phase 1 implementation

---

**Phase 0 Status**: ✅ **COMPLETE**

**Ready for Phase 1**: ✅ **YES**

**Build Status**: ✅ **PASSING**

**Next Action**: Begin Phase 1 implementation (Issue #2: Implement GitHubProjectsAPI)
