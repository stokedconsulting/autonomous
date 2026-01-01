# Project Creation System Design
## Comprehensive System for GitHub Projects from Text & Specification Files

**Date:** 2025-12-25
**Status:** Architecture Design
**Scope:** Enhanced project creation with specification file support, dependency management, and validation

---

## 1. System Architecture

### 1.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      PROJECT CREATION SYSTEM                     │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
                  ┌────────────────────────┐
                  │   Input Mode Router    │
                  │  (CLI/TUI Entry Point)  │
                  └────────────────────────┘
                     │                  │
        ┌────────────┘                  └────────────┐
        │                                            │
        ▼                                            ▼
┌──────────────────┐                    ┌──────────────────────┐
│  TEXT MODE       │                    │  SPECIFICATION MODE  │
│  (Current Flow)  │                    │  (New Flow)          │
└──────────────────┘                    └──────────────────────┘
        │                                            │
        ▼                                            ▼
┌──────────────────┐                    ┌──────────────────────┐
│  LLM Generation  │                    │  File Validation     │
│  via Claude CLI  │                    │  & Parsing Engine    │
└──────────────────┘                    └──────────────────────┘
        │                                            │
        │                                            ▼
        │                               ┌──────────────────────┐
        │                               │  Completeness Check  │
        │                               │  & Gap Analysis      │
        │                               └──────────────────────┘
        │                                            │
        │                                            ▼
        │                               ┌──────────────────────┐
        │                               │  LLM Gap Filling     │
        │                               │  (Optional)          │
        │                               └──────────────────────┘
        │                                            │
        │                                            ▼
        │                               ┌──────────────────────┐
        │                               │  Review Workflow     │
        │                               │  (Show User Changes) │
        │                               └──────────────────────┘
        │                                            │
        └────────────────┬───────────────────────────┘
                         │
                         ▼
            ┌────────────────────────┐
            │  Dependency Resolver   │
            │  (Validation & Graph)  │
            └────────────────────────┘
                         │
                         ▼
            ┌────────────────────────┐
            │  GitHub Project        │
            │  Creation Engine       │
            └────────────────────────┘
                         │
                         ▼
            ┌────────────────────────┐
            │  Issue Creation        │
            │  with Dependencies     │
            └────────────────────────┘
```

### 1.2 Component Architecture

```
src/services/
├── project-creation.ts          # ✓ Existing - text mode generation
├── project-specification.ts     # ✓ NEW - spec file handling
├── project-validation.ts        # ✓ NEW - validation engine
├── project-gap-analysis.ts      # ✓ NEW - completeness checking
└── project-dependency.ts        # ✓ NEW - dependency management

src/types/
└── project-spec.ts              # ✓ NEW - specification types

src/cli/commands/
└── project.ts                   # ✓ MODIFY - add spec file mode

src/ui/apps/
├── ProjectCreationApp.tsx       # ✓ NEW - TUI for spec file review
└── index.ts                     # ✓ MODIFY - export new app
```

---

## 2. Specification File Format

### 2.1 YAML Specification Format

**File Extension:** `.project.yaml` or `.project.yml`

```yaml
# Project metadata
project:
  title: "Feature Name"
  description: "High-level project description"
  epic: "Epic Name" # Optional - epic grouping

# Phases define sequential execution blocks
phases:
  - id: "phase-1"
    name: "Foundation Setup"
    goal: "Establish project infrastructure and core architecture"

    # Work items within this phase
    items:
      - id: "1.1"
        title: "Database Schema Design"
        type: "task" # task | bug | feature | research
        description: |
          Design and implement the core database schema for user authentication.

          **Acceptance Criteria:**
          - User table with email, password_hash, created_at
          - Session table with token, user_id, expires_at
          - Migration scripts in db/migrations/

          **Technical Details:**
          - Use PostgreSQL 14+
          - Implement indexing on email (unique) and token
          - Add foreign key constraints

        # OPTIONAL: Function-level specifications for large projects
        functions:
          - name: "createUser"
            inputs:
              - name: "email"
                type: "string"
                validation: "email format"
              - name: "password"
                type: "string"
                validation: "min 8 chars, 1 number, 1 special"
            outputs:
              - name: "userId"
                type: "uuid"
              - name: "createdAt"
                type: "timestamp"
            dependencies:
              - "hashPassword"
              - "validateEmail"

          - name: "hashPassword"
            inputs:
              - name: "password"
                type: "string"
            outputs:
              - name: "hash"
                type: "string"

        # OPTIONAL: Modification notes for existing features
        modifies:
          - function: "getUserById" # Existing function being modified
            file: "src/users/repository.ts"
            changes: "Add session validation check before returning user"
            new_dependencies:
              - "validateSession"

        # Item-level dependencies (blocks this item from starting)
        dependencies:
          - id: "1.0" # References another item ID
            reason: "Requires infrastructure setup to be complete"

        # Estimated effort
        estimate: 4 # hours

        # Size classification
        size: "M" # XS | S | M | L | XL

        # Priority override
        priority: "High" # Critical | High | Medium | Low

      - id: "1.2"
        title: "Authentication Middleware"
        description: |
          Implement JWT-based authentication middleware for Express.js

          **Acceptance Criteria:**
          - Middleware validates JWT tokens
          - Returns 401 for invalid/expired tokens
          - Attaches user object to request

        dependencies:
          - id: "1.1"
            reason: "Requires database schema to validate users"

        estimate: 3
        size: "S"
        priority: "High"

  - id: "phase-2"
    name: "API Development"
    goal: "Build core API endpoints"

    # Phase-level dependencies (entire phase blocked until these complete)
    dependencies:
      - phase: "phase-1" # All items in phase-1 must complete first
        strict: true # If true, ALL items must be done. If false, just master item.

    items:
      - id: "2.1"
        title: "User Registration Endpoint"
        description: |
          POST /api/auth/register endpoint

          **Acceptance Criteria:**
          - Validates email format and password strength
          - Creates user in database
          - Returns JWT token
          - Handles duplicate email errors

        # Cross-phase dependency (depends on specific item from different phase)
        dependencies:
          - id: "1.1" # Database schema from phase 1
            reason: "Requires user table"
          - id: "1.2" # Auth middleware from phase 1
            reason: "Uses JWT generation from middleware"

        estimate: 5
        size: "M"
        priority: "Critical"

# Global project configuration
config:
  auto_create_phase_masters: true # Auto-create "Phase X - MASTER" tickets
  dependency_validation: "strict" # strict | warn | ignore
  require_estimates: false # Require all items to have estimates
  default_size: "M" # Default size if not specified
  default_priority: "Medium" # Default priority if not specified
```

### 2.2 Alternative JSON Format

For teams preferring JSON:

```json
{
  "project": {
    "title": "Feature Name",
    "description": "High-level description",
    "epic": "Epic Name"
  },
  "phases": [
    {
      "id": "phase-1",
      "name": "Foundation Setup",
      "goal": "Establish infrastructure",
      "items": [
        {
          "id": "1.1",
          "title": "Database Schema Design",
          "type": "task",
          "description": "Design and implement core database schema...",
          "dependencies": [],
          "estimate": 4,
          "size": "M",
          "priority": "High"
        }
      ]
    }
  ],
  "config": {
    "auto_create_phase_masters": true,
    "dependency_validation": "strict"
  }
}
```

### 2.3 Simplified Markdown Format

For quick projects without complex dependencies:

```markdown
# Project: Feature Name

Epic: Epic Name

## Phase 1: Foundation Setup

**Goal:** Establish project infrastructure

### 1.1) Database Schema Design

**Type:** task
**Size:** M
**Priority:** High
**Estimate:** 4h
**Dependencies:** None

Design and implement the core database schema for user authentication.

**Acceptance Criteria:**
- User table with email, password_hash, created_at
- Session table with token, user_id, expires_at
- Migration scripts in db/migrations/

### 1.2) Authentication Middleware

**Type:** task
**Size:** S
**Priority:** High
**Estimate:** 3h
**Dependencies:** 1.1

Implement JWT-based authentication middleware for Express.js

**Acceptance Criteria:**
- Middleware validates JWT tokens
- Returns 401 for invalid/expired tokens
- Attaches user object to request

## Phase 2: API Development

**Goal:** Build core API endpoints
**Dependencies:** Phase 1 (strict)

### 2.1) User Registration Endpoint

**Type:** task
**Size:** M
**Priority:** Critical
**Estimate:** 5h
**Dependencies:** 1.1, 1.2

POST /api/auth/register endpoint

**Acceptance Criteria:**
- Validates email format and password strength
- Creates user in database
- Returns JWT token
```

---

## 3. Enhanced Dependency System

### 3.1 Dependency Types

```typescript
type DependencyType =
  | 'phase'       // Entire phase must complete
  | 'item'        // Specific work item must complete
  | 'master'      // Phase master must complete
  | 'soft';       // Recommended but not blocking

interface ItemDependency {
  type: DependencyType;
  targetId: string;        // "phase-1", "1.1", "phase-1-master"
  targetPhase?: string;    // For cross-phase dependencies
  strict?: boolean;        // If false, allows parallel work
  reason?: string;         // Human-readable explanation
}

interface PhaseDependency {
  phase: string;           // "phase-1"
  strict: boolean;         // true = all items, false = just master
  allowParallel?: boolean; // Allow some items to start early
}
```

### 3.2 Dependency Resolution Algorithm

```
Algorithm: ResolveDependencies(item)
Input: WorkItem with dependencies
Output: Boolean (can start work)

1. FOR EACH dependency IN item.dependencies:

   2. IF dependency.type == 'phase':
      - Get phase status from GitHub Project
      - IF dependency.strict == true:
        - Check ALL phase work items are "Done"
      - ELSE:
        - Check phase master item is "Done"
      - IF not complete:
        - RETURN false (blocked)

   3. IF dependency.type == 'item':
      - Get item status from GitHub Project
      - IF status != "Done":
        - RETURN false (blocked)

   4. IF dependency.type == 'master':
      - Get phase master status
      - IF status != "Done":
        - RETURN false (blocked)

   5. IF dependency.type == 'soft':
      - Log warning if not complete
      - CONTINUE (non-blocking)

6. RETURN true (all dependencies satisfied)
```

### 3.3 Dependency Graph Visualization

```
Phase 1: Foundation
├─ [1.1] Database Schema ────────┐
│                                 │
├─ [1.2] Auth Middleware ─────┐  │
│                              │  │
└─ [MASTER] Phase 1 Complete   │  │
                               │  │
Phase 2: API Development       │  │
├─ [2.1] Register Endpoint <───┴──┘ (depends on 1.1, 1.2)
│                              │
├─ [2.2] Login Endpoint <──────┘ (depends on 1.2)
│
└─ [MASTER] Phase 2 Complete

Phase 3: Testing
├─ [3.1] Unit Tests <─────────── (depends on Phase 2 master)
│
└─ [MASTER] Phase 3 Complete
```

### 3.4 Dependency Storage

Dependencies stored in GitHub Project custom fields:

```yaml
GitHub Project Fields:
  - Blocked By (text): "1.1, 1.2, phase-1"
  - Dependency Type (select): "Hard | Soft"
  - Blocking (text): "2.1, 2.3" # What this item blocks
```

Orchestrator checks dependencies before assignment:

```typescript
// In orchestrator.ts - before assigning work
async function canStartWork(item: ProjectItem): Promise<boolean> {
  const dependencies = parseDependencies(item.blockedBy);

  for (const dep of dependencies) {
    const depItem = await getItemStatus(dep);
    if (depItem.status !== 'Done') {
      return false; // Blocked
    }
  }

  return true; // Ready to start
}
```

---

## 4. Validation Engine

### 4.1 Validation Phases

```
┌─────────────────────────────────────────┐
│  Phase 1: Syntax Validation             │
│  - YAML/JSON format correctness         │
│  - Required field presence              │
│  - Type checking                        │
└─────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  Phase 2: Structure Validation          │
│  - Phase sequencing                     │
│  - Item ID uniqueness                   │
│  - Dependency reference validation      │
│  - Circular dependency detection        │
└─────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  Phase 3: Completeness Check            │
│  - Sufficient detail for implementation │
│  - Acceptance criteria present          │
│  - Technical specs adequate             │
│  - Function signatures (if applicable)  │
└─────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  Phase 4: Gap Analysis                  │
│  - Identify missing information         │
│  - Flag incomplete specifications       │
│  - Suggest improvements                 │
└─────────────────────────────────────────┘
```

### 4.2 Validation Rules

```typescript
interface ValidationRule {
  name: string;
  severity: 'error' | 'warning' | 'info';
  check: (spec: ProjectSpec) => ValidationResult;
}

const VALIDATION_RULES: ValidationRule[] = [
  // Syntax Rules (errors)
  {
    name: 'required-project-title',
    severity: 'error',
    check: (spec) => ({
      valid: !!spec.project?.title,
      message: 'Project title is required'
    })
  },

  {
    name: 'unique-item-ids',
    severity: 'error',
    check: (spec) => {
      const ids = new Set();
      for (const phase of spec.phases) {
        for (const item of phase.items) {
          if (ids.has(item.id)) {
            return {
              valid: false,
              message: `Duplicate item ID: ${item.id}`
            };
          }
          ids.add(item.id);
        }
      }
      return { valid: true };
    }
  },

  // Structure Rules (errors)
  {
    name: 'valid-dependencies',
    severity: 'error',
    check: (spec) => {
      const allIds = collectAllIds(spec);
      for (const phase of spec.phases) {
        for (const item of phase.items) {
          for (const dep of item.dependencies || []) {
            if (!allIds.has(dep.id) && !dep.id.startsWith('phase-')) {
              return {
                valid: false,
                message: `Invalid dependency ${dep.id} in item ${item.id}`
              };
            }
          }
        }
      }
      return { valid: true };
    }
  },

  {
    name: 'no-circular-dependencies',
    severity: 'error',
    check: (spec) => detectCircularDependencies(spec)
  },

  // Completeness Rules (warnings)
  {
    name: 'has-acceptance-criteria',
    severity: 'warning',
    check: (spec) => {
      const missing = [];
      for (const phase of spec.phases) {
        for (const item of phase.items) {
          if (!item.description?.includes('Acceptance Criteria')) {
            missing.push(item.id);
          }
        }
      }
      return {
        valid: missing.length === 0,
        message: `Items missing acceptance criteria: ${missing.join(', ')}`
      };
    }
  },

  {
    name: 'has-estimates',
    severity: 'info',
    check: (spec) => {
      const missing = [];
      for (const phase of spec.phases) {
        for (const item of phase.items) {
          if (!item.estimate) {
            missing.push(item.id);
          }
        }
      }
      return {
        valid: missing.length === 0,
        message: `Items missing estimates: ${missing.join(', ')}`
      };
    }
  }
];
```

### 4.3 Circular Dependency Detection

```typescript
function detectCircularDependencies(spec: ProjectSpec): ValidationResult {
  const graph = buildDependencyGraph(spec);
  const visited = new Set<string>();
  const recStack = new Set<string>();

  function hasCycle(nodeId: string): string[] | null {
    visited.add(nodeId);
    recStack.add(nodeId);

    const dependencies = graph.get(nodeId) || [];
    for (const depId of dependencies) {
      if (!visited.has(depId)) {
        const cycle = hasCycle(depId);
        if (cycle) {
          return [nodeId, ...cycle];
        }
      } else if (recStack.has(depId)) {
        return [nodeId, depId]; // Cycle found
      }
    }

    recStack.delete(nodeId);
    return null;
  }

  // Check all nodes
  for (const nodeId of graph.keys()) {
    if (!visited.has(nodeId)) {
      const cycle = hasCycle(nodeId);
      if (cycle) {
        return {
          valid: false,
          message: `Circular dependency detected: ${cycle.join(' → ')}`
        };
      }
    }
  }

  return { valid: true };
}
```

---

## 5. Gap Analysis & Auto-Fill System

### 5.1 Completeness Criteria

For each work item, check:

```typescript
interface CompletenessCheck {
  criterion: string;
  required: boolean;
  score: number; // 0-100
  details: string;
}

const COMPLETENESS_CRITERIA: CompletenessCheck[] = [
  {
    criterion: 'Clear Title',
    required: true,
    score: item.title && item.title.length > 10 ? 100 : 0,
    details: 'Title should be descriptive and action-oriented'
  },

  {
    criterion: 'Description',
    required: true,
    score: item.description && item.description.length > 50 ? 100 : 0,
    details: 'Description should explain what needs to be done'
  },

  {
    criterion: 'Acceptance Criteria',
    required: true,
    score: hasAcceptanceCriteria(item.description) ? 100 : 0,
    details: 'Clear, testable conditions for completion'
  },

  {
    criterion: 'Technical Details',
    required: false,
    score: hasTechnicalDetails(item.description) ? 100 : 50,
    details: 'Implementation guidance for developers'
  },

  {
    criterion: 'Function Signatures',
    required: false, // Only for large complex projects
    score: item.functions && item.functions.length > 0 ? 100 : 0,
    details: 'Detailed function specs for complex changes'
  },

  {
    criterion: 'Modification Impact',
    required: false,
    score: item.modifies && item.modifies.length > 0 ? 100 : 0,
    details: 'Document changes to existing functions'
  }
];

function calculateCompleteness(item: WorkItem): number {
  const requiredCriteria = COMPLETENESS_CRITERIA.filter(c => c.required);
  const totalScore = requiredCriteria.reduce((sum, c) => sum + c.score, 0);
  const maxScore = requiredCriteria.length * 100;
  return (totalScore / maxScore) * 100;
}
```

### 5.2 Gap Filling Strategy

```typescript
async function fillGaps(spec: ProjectSpec): Promise<{
  enrichedSpec: ProjectSpec;
  changes: GapFillChange[];
}> {
  const changes: GapFillChange[] = [];

  for (const phase of spec.phases) {
    for (const item of phase.items) {
      const completeness = calculateCompleteness(item);

      if (completeness < 80) { // Below threshold
        // Generate missing details using Claude
        const enriched = await enrichItemWithClaude(item, spec.project);

        // Track what was changed
        const change: GapFillChange = {
          itemId: item.id,
          field: 'description',
          before: item.description,
          after: enriched.description,
          reason: 'Added missing acceptance criteria'
        };

        changes.push(change);

        // Update item
        Object.assign(item, enriched);
      }
    }
  }

  return { enrichedSpec: spec, changes };
}

async function enrichItemWithClaude(
  item: WorkItem,
  projectContext: ProjectMetadata
): Promise<Partial<WorkItem>> {
  const prompt = `
You are a technical project manager. Enhance this work item specification
to include missing details needed for a mid-level developer to implement.

PROJECT CONTEXT:
${JSON.stringify(projectContext, null, 2)}

WORK ITEM:
Title: ${item.title}
Current Description:
${item.description || 'No description provided'}

REQUIREMENTS:
1. Add specific, testable acceptance criteria if missing
2. Include technical implementation details
3. Specify inputs, outputs, and data transformations
4. Note any dependencies or integration points
5. Maintain focus on WHAT needs to be done, not HOW

Return ONLY the enhanced description in markdown format.
`;

  const enhanced = await callClaude(prompt);

  return {
    description: enhanced
  };
}
```

### 5.3 Review Workflow UI

```typescript
// In TUI/CLI - show user what was auto-filled

interface GapFillReviewUI {
  showChanges(changes: GapFillChange[]): void;
  getUserApproval(): Promise<'approve' | 'reject' | 'edit'>;
}

async function reviewGapFills(
  changes: GapFillChange[]
): Promise<ProjectSpec> {
  console.log(chalk.blue('\n📝 Gap Analysis Results\n'));

  console.log(chalk.yellow(`Auto-filled ${changes.length} incomplete items:\n`));

  for (const change of changes) {
    console.log(chalk.cyan(`Item ${change.itemId}:`));
    console.log(chalk.gray('  Reason: ' + change.reason));
    console.log(chalk.red('\n  Before:'));
    console.log(chalk.gray('  ' + change.before));
    console.log(chalk.green('\n  After:'));
    console.log(chalk.gray('  ' + change.after));
    console.log('');
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question(
      chalk.yellow('Approve changes? [y/n/e (edit)] '),
      resolve
    );
  });

  rl.close();

  if (answer.toLowerCase() === 'y') {
    return enrichedSpec; // Use auto-filled version
  } else if (answer.toLowerCase() === 'e') {
    // Open editor to modify spec file
    await openEditor(specFilePath);
    return reloadSpec(specFilePath);
  } else {
    throw new Error('User rejected gap fills');
  }
}
```

---

## 6. Implementation Plan

### 6.1 Phase 1: Type System & Parsing (Week 1)

**Files to Create:**

1. `/Users/stoked/work/autonomous/src/types/project-spec.ts`
   - Define TypeScript interfaces for specification format
   - Type guards and validation helpers

2. `/Users/stoked/work/autonomous/src/services/project-specification.ts`
   - File format detection (YAML/JSON/Markdown)
   - Parser implementations
   - Conversion to internal format

**Files to Modify:**

1. `/Users/stoked/work/autonomous/src/types/project.ts`
   - Add dependency-related types
   - Extend `ProjectItemMetadata` with dependency fields

**Implementation Steps:**

```typescript
// 1. Create type definitions
export interface ProjectSpecification {
  project: ProjectMetadata;
  phases: PhaseSpecification[];
  config: ProjectConfig;
}

// 2. Implement parsers
export class SpecificationParser {
  static async parse(filePath: string): Promise<ProjectSpecification>;
  static detectFormat(filePath: string): 'yaml' | 'json' | 'markdown';
  static validateSyntax(content: string, format: string): ValidationResult;
}

// 3. Write tests
describe('SpecificationParser', () => {
  it('should parse valid YAML specification', async () => {
    const spec = await SpecificationParser.parse('test.project.yaml');
    expect(spec.project.title).toBe('Test Project');
  });

  it('should reject invalid syntax', () => {
    expect(() => SpecificationParser.validateSyntax('invalid', 'yaml'))
      .toThrow();
  });
});
```

### 6.2 Phase 2: Validation Engine (Week 1-2)

**Files to Create:**

1. `/Users/stoked/work/autonomous/src/services/project-validation.ts`
   - Validation rule engine
   - Circular dependency detection
   - Completeness scoring

2. `/Users/stoked/work/autonomous/src/services/project-gap-analysis.ts`
   - Gap detection algorithms
   - Completeness criteria checking
   - Auto-fill change tracking

**Implementation Steps:**

```typescript
// 1. Validation engine
export class ProjectValidator {
  validate(spec: ProjectSpecification): ValidationReport;
  private checkSyntax(): ValidationIssue[];
  private checkStructure(): ValidationIssue[];
  private checkDependencies(): ValidationIssue[];
  private checkCircularDeps(): ValidationIssue[];
}

// 2. Gap analysis
export class GapAnalyzer {
  analyze(spec: ProjectSpecification): GapAnalysisReport;
  calculateCompleteness(item: WorkItem): number;
  identifyGaps(item: WorkItem): Gap[];
}

// 3. Write comprehensive tests
describe('ProjectValidator', () => {
  it('should detect circular dependencies', () => {
    const spec = createSpecWithCircularDeps();
    const report = validator.validate(spec);
    expect(report.errors).toContainEqual(
      expect.objectContaining({ code: 'CIRCULAR_DEPENDENCY' })
    );
  });
});
```

### 6.3 Phase 3: LLM Gap Filling (Week 2)

**Files to Create:**

1. `/Users/stoked/work/autonomous/src/services/project-enrichment.ts`
   - Claude integration for gap filling
   - Prompt templates for enhancement
   - Change tracking and diff generation

**Implementation Steps:**

```typescript
export class ProjectEnrichment {
  async fillGaps(
    spec: ProjectSpecification,
    options: EnrichmentOptions
  ): Promise<EnrichedResult>;

  private async enrichItem(
    item: WorkItem,
    context: ProjectContext
  ): Promise<WorkItem>;

  private generateEnrichmentPrompt(
    item: WorkItem,
    gaps: Gap[]
  ): string;
}

// Integration with existing Claude adapter
const enricher = new ProjectEnrichment(
  config.llms.claude.cliPath,
  projectPath
);

const result = await enricher.fillGaps(specification, {
  autoApprove: false,
  enrichmentLevel: 'detailed'
});
```

### 6.4 Phase 4: Dependency System Enhancement (Week 2-3)

**Files to Create:**

1. `/Users/stoked/work/autonomous/src/services/project-dependency.ts`
   - Dependency graph construction
   - Resolution algorithm
   - Topological sorting for execution order

2. `/Users/stoked/work/autonomous/src/utils/dependency-resolver.ts`
   - Helper functions for dependency checking
   - Integration with orchestrator

**Files to Modify:**

1. `/Users/stoked/work/autonomous/src/core/orchestrator.ts`
   - Add dependency checking before assignment
   - Integrate with `canStartWork` function
   - Update item selection logic

2. `/Users/stoked/work/autonomous/src/core/epic-orchestrator.ts`
   - Add inter-phase dependency support
   - Update `getAssignableItems` to check dependencies

**Implementation Steps:**

```typescript
// 1. Dependency graph
export class DependencyGraph {
  constructor(spec: ProjectSpecification);

  canStart(itemId: string): boolean;
  getBlockedItems(): string[];
  getReadyItems(): string[];
  getTopologicalOrder(): string[];
}

// 2. Orchestrator integration
class Orchestrator {
  private dependencyGraph: DependencyGraph | null = null;

  async selectNextWorkItem(): Promise<ProjectItem | null> {
    const readyItems = await this.projectsAPI.getAllItems({
      status: ['Todo', 'Ready']
    });

    // Filter by dependency readiness
    const assignableItems = readyItems.filter(item => {
      if (!this.dependencyGraph) return true;
      return this.dependencyGraph.canStart(item.content.number.toString());
    });

    return assignableItems[0] || null;
  }
}

// 3. GitHub Project field updates
await projectsAPI.updateItemTextField(
  projectItemId,
  'Blocked By',
  dependencies.map(d => d.id).join(', ')
);
```

### 6.5 Phase 5: CLI & TUI Integration (Week 3)

**Files to Modify:**

1. `/Users/stoked/work/autonomous/src/cli/commands/project.ts`
   - Add `--spec-file <path>` option to `project create`
   - Add `project validate <spec-file>` command
   - Update help text

2. `/Users/stoked/work/autonomous/src/ui/apps/index.ts`
   - Export new TUI app for spec review

**Files to Create:**

1. `/Users/stoked/work/autonomous/src/ui/apps/ProjectSpecReviewApp.tsx`
   - Interactive spec file review UI
   - Change approval/rejection
   - Live validation feedback

**Implementation Steps:**

```typescript
// 1. CLI command additions
export async function projectCreateCommand(
  descriptionOrPath: string,
  options: ProjectCreateOptions
): Promise<void> {
  // Detect if input is file path or description
  const isFilePath = descriptionOrPath.endsWith('.yaml') ||
                     descriptionOrPath.endsWith('.yml') ||
                     descriptionOrPath.endsWith('.json') ||
                     existsSync(descriptionOrPath);

  if (isFilePath) {
    await createFromSpecFile(descriptionOrPath, options);
  } else {
    await createFromDescription(descriptionOrPath, options);
  }
}

async function createFromSpecFile(
  filePath: string,
  options: ProjectCreateOptions
): Promise<void> {
  // 1. Parse specification
  const spec = await SpecificationParser.parse(filePath);

  // 2. Validate
  const validation = new ProjectValidator().validate(spec);
  if (!validation.isValid) {
    console.error(chalk.red('Validation failed:'));
    validation.errors.forEach(e => console.error(`  - ${e.message}`));
    process.exit(1);
  }

  // 3. Gap analysis
  const gaps = new GapAnalyzer().analyze(spec);

  // 4. Auto-fill (if enabled)
  if (gaps.hasGaps && options.autoFill) {
    const enriched = await new ProjectEnrichment().fillGaps(spec);

    // 5. Review workflow
    const approved = await reviewChanges(enriched.changes);
    if (!approved) {
      console.log(chalk.yellow('Cancelled'));
      return;
    }

    spec = enriched.spec;
  }

  // 6. Create project
  await createGitHubProject(spec, options);
}

// 2. New validate command
export async function projectValidateCommand(
  specFilePath: string
): Promise<void> {
  const spec = await SpecificationParser.parse(specFilePath);
  const validation = new ProjectValidator().validate(spec);

  console.log(chalk.blue('\n📋 Validation Report\n'));

  if (validation.isValid) {
    console.log(chalk.green('✓ Specification is valid'));
  } else {
    console.log(chalk.red(`✗ Found ${validation.errors.length} errors`));
    validation.errors.forEach(e => {
      console.log(chalk.red(`  • ${e.message}`));
    });
  }

  if (validation.warnings.length > 0) {
    console.log(chalk.yellow(`\n⚠ ${validation.warnings.length} warnings`));
    validation.warnings.forEach(w => {
      console.log(chalk.yellow(`  • ${w.message}`));
    });
  }
}

// 3. TUI App for review
export function ProjectSpecReviewApp({
  spec,
  changes,
  onApprove,
  onReject
}: ProjectSpecReviewProps) {
  return (
    <Box flexDirection="column">
      <Text bold color="blue">Gap Fill Review</Text>
      <Box marginY={1}>
        <Text>{changes.length} items were auto-enhanced</Text>
      </Box>

      {changes.map((change, i) => (
        <Box key={i} flexDirection="column" marginY={1}>
          <Text color="cyan">Item {change.itemId}</Text>
          <Text color="gray">Reason: {change.reason}</Text>

          <Box marginTop={1}>
            <Text color="red">- {change.before}</Text>
            <Text color="green">+ {change.after}</Text>
          </Box>
        </Box>
      ))}

      <Box marginTop={2}>
        <Text>[y] Approve   [n] Reject   [e] Edit</Text>
      </Box>
    </Box>
  );
}
```

### 6.6 Phase 6: Testing & Documentation (Week 3-4)

**Testing Strategy:**

```typescript
// Unit tests for each component
describe('End-to-End Specification Workflow', () => {
  it('should create project from valid spec file', async () => {
    const specPath = path.join(__dirname, 'fixtures', 'valid-project.yaml');
    const project = await createFromSpecFile(specPath, {
      review: false,
      autoFill: true
    });

    expect(project.title).toBe('Test Project');
    expect(project.issues).toHaveLength(6); // 2 phases x 3 items
  });

  it('should detect and fill gaps', async () => {
    const spec = createIncompleteSpec();
    const enriched = await enricher.fillGaps(spec);

    expect(enriched.changes).toHaveLength(2);
    expect(enriched.spec.phases[0].items[0].description)
      .toContain('Acceptance Criteria');
  });

  it('should validate dependencies correctly', () => {
    const spec = createSpecWithDependencies();
    const graph = new DependencyGraph(spec);

    expect(graph.canStart('1.1')).toBe(true);
    expect(graph.canStart('2.1')).toBe(false); // Depends on 1.1
  });
});
```

**Documentation Updates:**

1. Create `/Users/stoked/work/autonomous/docs/specification-format.md`
   - Complete specification format reference
   - Examples for common scenarios
   - Best practices guide

2. Update `/Users/stoked/work/autonomous/README.md`
   - Add section on specification files
   - Update CLI usage examples

3. Create `/Users/stoked/work/autonomous/docs/dependency-system.md`
   - Dependency type explanations
   - Resolution algorithm details
   - Troubleshooting guide

---

## 7. Migration Path from Current Implementation

### 7.1 Backward Compatibility

**Current Flow (Text Mode):**
```
auto project create "description" --review
→ LLM generates plan
→ User reviews
→ Creates GitHub project
```

**New Flow (Maintains Compatibility):**
```
auto project create "description" --review
→ LLM generates plan (same as before)
→ User reviews (same as before)
→ Creates GitHub project (same as before)
```

**New Spec File Flow:**
```
auto project create spec.project.yaml --review
→ Parse specification file
→ Validate structure
→ Gap analysis & auto-fill
→ User reviews changes
→ Creates GitHub project with dependencies
```

### 7.2 Migration Steps

**For Users:**

1. **No Breaking Changes**
   - Existing text-based workflow continues to work
   - Specification files are opt-in enhancement

2. **Gradual Adoption**
   ```bash
   # Phase 1: Use text mode (current)
   auto project create "Build auth system"

   # Phase 2: Export to spec file for editing
   auto project export auth-project.yaml

   # Phase 3: Use spec file for complex projects
   auto project create auth-v2.project.yaml
   ```

3. **Template Library**
   ```bash
   # Create from template
   auto project template list
   auto project template use microservice > my-service.yaml
   auto project create my-service.yaml
   ```

**For Developers:**

1. **Code Organization**
   - Keep existing `project-creation.ts` for text mode
   - New files are additive, not replacements
   - Shared utilities extracted to common modules

2. **Testing Strategy**
   - Maintain existing test suites
   - Add new tests for spec file features
   - Integration tests for both workflows

3. **Rollout Plan**
   ```
   Week 1-2: Core types & parsing (no user impact)
   Week 2-3: Validation & gap analysis (internal testing)
   Week 3-4: CLI integration (feature flag controlled)
   Week 4+:  Public release with documentation
   ```

---

## 8. Usage Examples

### 8.1 Simple Project (Text Mode - Current)

```bash
auto project create "Add user authentication with JWT"
```

### 8.2 Complex Project (Spec File - New)

```bash
# 1. Create specification file
cat > auth-system.project.yaml <<EOF
project:
  title: "User Authentication System"
  epic: "Auth V2"

phases:
  - id: "phase-1"
    name: "Backend Infrastructure"
    items:
      - id: "1.1"
        title: "Database Schema"
        description: "Create user and session tables"
        estimate: 4
        size: "M"
EOF

# 2. Validate specification
auto project validate auth-system.project.yaml

# 3. Create project with review
auto project create auth-system.project.yaml --review

# 4. Auto-fill gaps and approve
auto project create auth-system.project.yaml --auto-fill --review
```

### 8.3 Large Project with Dependencies

```yaml
# complex-feature.project.yaml
project:
  title: "Multi-tenant SaaS Platform"
  epic: "Platform V1"

phases:
  - id: "phase-1"
    name: "Foundation"
    items:
      - id: "1.1"
        title: "Multi-tenant Database Schema"
        description: |
          Create tenant-aware database schema with row-level security

          **Acceptance Criteria:**
          - Tenant table with subdomain, settings
          - RLS policies for all tables
          - Migration scripts with rollback
        estimate: 8
        size: "L"
        priority: "Critical"

      - id: "1.2"
        title: "Tenant Middleware"
        description: "Extract tenant from subdomain and attach to request"
        dependencies:
          - id: "1.1"
            reason: "Requires tenant table"
        estimate: 3
        size: "S"
        priority: "High"

  - id: "phase-2"
    name: "User Management"
    dependencies:
      - phase: "phase-1"
        strict: true
    items:
      - id: "2.1"
        title: "Tenant-scoped User Registration"
        description: "Users belong to specific tenants"
        dependencies:
          - id: "1.1"
          - id: "1.2"
        estimate: 6
        size: "M"
        priority: "Critical"
```

---

## 9. Benefits & Trade-offs

### 9.1 Benefits

**For Users:**
- **Precision**: Specify exact requirements upfront
- **Reusability**: Save and version project templates
- **Clarity**: Explicit dependencies prevent confusion
- **Speed**: Skip LLM generation for well-defined projects
- **Control**: Review and approve auto-fill changes

**For System:**
- **Determinism**: Consistent project structure
- **Validation**: Catch errors before creation
- **Optimization**: Better dependency-based scheduling
- **Scalability**: Handle large, complex projects
- **Auditability**: Specification files are version-controlled

### 9.2 Trade-offs

**Complexity:**
- More files and code to maintain
- Additional validation logic
- Steeper learning curve for advanced features

**Mitigation:**
- Keep text mode simple and default
- Provide templates and examples
- Progressive disclosure of advanced features
- Comprehensive documentation

**Performance:**
- Specification parsing adds latency
- Gap analysis may be slow for large projects
- Additional GitHub API calls for dependency checking

**Mitigation:**
- Cache parsed specifications
- Parallel gap analysis
- Batch dependency validation
- Use GraphQL for efficient queries

---

## 10. Future Enhancements

### 10.1 Short-term (3-6 months)

1. **Template Library**
   - Common project patterns (microservice, CRUD, auth)
   - Industry-specific templates
   - Template marketplace

2. **Visual Editor**
   - Web-based spec file editor
   - Drag-and-drop dependency visualization
   - Real-time validation feedback

3. **Import/Export**
   - Import from Jira, Linear, Asana
   - Export to other formats
   - Bidirectional sync

### 10.2 Long-term (6-12 months)

1. **AI-Powered Templates**
   - Generate spec files from requirements docs
   - Learn from successful project patterns
   - Suggest dependencies based on similar projects

2. **Advanced Dependency Types**
   - Time-based dependencies (start after date)
   - Resource dependencies (requires specific team member)
   - External dependencies (third-party APIs)

3. **Analytics Dashboard**
   - Project velocity tracking
   - Dependency bottleneck detection
   - Estimation accuracy analysis

---

## Conclusion

This design provides a comprehensive system for creating GitHub Projects from both natural language descriptions and detailed specification files. The architecture maintains backward compatibility while enabling powerful new features like:

- **Explicit dependency management** with inter-phase support
- **Automated gap analysis** and LLM-powered enrichment
- **Multi-format specification** support (YAML, JSON, Markdown)
- **Comprehensive validation** with circular dependency detection
- **Interactive review workflow** for user approval

The implementation plan breaks down the work into manageable phases with clear deliverables, minimal disruption to existing functionality, and a smooth migration path for users.
