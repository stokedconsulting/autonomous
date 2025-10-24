# Phase 4-5 Implementation Plan

## Phase 4: Sprint/Iteration Management (Planning)

### 🎯 Goals
- Enable sprint/iteration awareness in prioritization
- Filter and query issues by sprint
- Boost priority for current sprint items
- Track sprint progress and capacity

### 📋 Implementation Tasks

#### 1. Sprint Field Integration
- [x] Basic sprint field configuration already in `.autonomous-config.json`
- [ ] Enhance `ProjectFieldMapper` to extract sprint/iteration data
- [ ] Add sprint date parsing (start/end dates)
- [ ] Cache sprint metadata (current sprint, upcoming sprints)

#### 2. Sprint-Aware Prioritization
- [x] Sprint boost already in `ProjectAwarePrioritizer` (10% weight)
- [ ] Add sprint timeline awareness (items due sooner score higher)
- [ ] Implement sprint capacity tracking
- [ ] Add "sprint overflow" warnings when too many items

#### 3. Sprint Queries and Filters
- [ ] Add `getItemsBySprint(sprintId)` to `ProjectsAPI`
- [ ] Add `getCurrentSprintItems()` helper
- [ ] Add `getSprintProgress()` to show completion stats
- [ ] Filter ready items to only show current sprint (optional)

#### 4. CLI Commands
- [ ] `autonomous sprint status` - Show current sprint progress
- [ ] `autonomous sprint list` - List all sprints
- [ ] `autonomous sprint items <name>` - Show items in a sprint
- [ ] Add `--sprint <name>` filter to `list-ready` command

### 📊 Sprint Data Model

```typescript
interface SprintMetadata {
  id: string;
  title: string;
  startDate?: string;
  endDate?: string | null; // null = ongoing
  duration?: number; // in days
  isCurrent: boolean;
}

interface SprintProgress {
  sprint: SprintMetadata;
  totalItems: number;
  completedItems: number;
  inProgressItems: number;
  readyItems: number;
  completionPercentage: number;
  daysRemaining?: number;
}
```

---

## Phase 5: Dependency Tracking (Advanced)

### 🎯 Goals
- Parse and track issue dependencies (blocks/blocked-by)
- Validate dependency chains for cycles
- Prioritize unblocked issues
- Show dependency graph visualization

### 📋 Implementation Tasks

#### 1. Dependency Parsing
- [x] Basic relationship parsing already exists in `IssueRelationshipParser`
- [ ] Enhance to extract "blocks #X" and "blocked by #X" patterns
- [ ] Parse GitHub's native "blocking" field from Projects v2
- [ ] Support multiple dependency types (blocks, depends-on, related-to)

#### 2. Dependency Graph Analysis
- [ ] Build dependency graph data structure
- [ ] Implement cycle detection algorithm
- [ ] Calculate "blocking score" (how many issues depend on this)
- [ ] Find "leaf nodes" (unblocked, ready-to-work issues)

#### 3. Dependency-Aware Prioritization
- [ ] Boost priority for unblocked leaf nodes
- [ ] Reduce priority for blocked issues
- [ ] Boost priority for high "blocking score" (unblocks many others)
- [ ] Add dependency readiness check before assignment

#### 4. Dependency Validation
- [ ] Validate no circular dependencies
- [ ] Warn when blocking issue is not in "Ready" status
- [ ] Check if dependencies are completed before allowing progress
- [ ] Auto-update blocked issues when blocker completes

#### 5. CLI Commands
- [ ] `autonomous deps graph [issue]` - Show dependency tree
- [ ] `autonomous deps validate` - Check for circular dependencies
- [ ] `autonomous deps blocked` - List all blocked issues
- [ ] `autonomous deps blockers` - List issues blocking the most others

### 📊 Dependency Data Model

```typescript
interface IssueDependency {
  issueNumber: number;
  dependsOn: number[];     // This issue is blocked by these
  blocks: number[];        // This issue blocks these
  relatedTo: number[];     // Loosely related
}

interface DependencyGraph {
  nodes: Map<number, IssueDependency>;
  roots: number[];         // Issues with no dependencies
  leaves: number[];        // Issues that don't block anything
  cycles: number[][];      // Circular dependency chains
}

interface DependencyScore {
  issueNumber: number;
  blockingScore: number;   // How many issues this unblocks
  blockedByCount: number;  // How many issues block this
  isBlocked: boolean;      // Has unresolved dependencies
  isLeaf: boolean;         // Doesn't block anything
  depthFromRoot: number;   // Steps from a root node
}
```

---

## 🔄 Integration Points

### Updated Prioritization Formula

Current (Phase 0-3):
```
finalScore = (projectPriority * 0.5) + (aiEvaluation * 0.3) + (sprintBoost * 0.1) + (sizePreference * 0.1)
```

After Phase 4-5:
```
finalScore =
  (projectPriority * 0.4) +
  (aiEvaluation * 0.25) +
  (sprintBoost * 0.15) +
  (dependencyScore * 0.15) +
  (sizePreference * 0.05)
```

Where `dependencyScore` considers:
- **+1.0**: Unblocked leaf node (ready to work)
- **+0.5**: High blocking score (unblocks many others)
- **-0.5**: Blocked by 1-2 issues
- **-1.0**: Blocked by 3+ issues

### Workflow Changes

**Before Assignment:**
1. Check if issue has unresolved dependencies
2. If blocked, warn and suggest alternatives
3. Only assign if dependencies are met OR user forces with `--ignore-deps`

**After Completion:**
1. Find all issues blocked by this one
2. Check if blockers are now fully resolved
3. If yes, auto-update their status to "Ready"
4. Notify about newly unblocked issues

---

## 🧪 Testing Strategy

### Phase 4 Tests
- Sprint metadata extraction from Projects v2
- Sprint boost calculation accuracy
- Current sprint detection
- Sprint progress calculations

### Phase 5 Tests
- Dependency parsing from various formats
- Cycle detection with complex graphs
- Blocking score calculations
- Leaf node identification
- Auto-status updates when dependencies resolve

---

## 📅 Implementation Order

1. **Phase 4.1**: Sprint field extraction and metadata
2. **Phase 4.2**: Sprint-aware prioritization enhancements
3. **Phase 4.3**: Sprint CLI commands
4. **Phase 5.1**: Dependency parsing and graph construction
5. **Phase 5.2**: Dependency validation and cycle detection
6. **Phase 5.3**: Dependency-aware prioritization
7. **Phase 5.4**: Auto-status updates and notifications
8. **Phase 5.5**: Dependency CLI commands

---

## ⚙️ Configuration Updates

Add to `.autonomous-config.json`:

```json
{
  "project": {
    "sprint": {
      "autoFilterToCurrentSprint": false,
      "sprintBoostMultiplier": 1.5,
      "warnOnSprintOverflow": true,
      "maxItemsPerSprint": 10
    },
    "dependencies": {
      "validateBeforeAssignment": true,
      "autoUnblockOnComplete": true,
      "allowCycles": false,
      "dependencyTypes": ["blocks", "depends-on", "related-to"]
    }
  }
}
```

---

## 🚀 Expected Outcomes

### Phase 4
- Issues in current sprint automatically prioritized higher
- Sprint progress visibility via CLI
- Better capacity planning

### Phase 5
- Only unblocked issues assigned automatically
- High-impact issues (that unblock others) prioritized
- No circular dependency deadlocks
- Automatic workflow progression as dependencies resolve

---

## 📝 Next Steps

Execute tasks in order, test thoroughly, and commit each phase separately for clean git history.
