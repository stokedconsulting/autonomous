/**
 * GitHub Projects v2 field metadata types
 *
 * These types represent project field values that are read fresh
 * from GitHub Projects (never cached locally).
 */

export interface ProjectItemMetadata {
  projectItemId: string;
  issueNumber: number;
  issueTitle: string;

  // Project fields (read fresh from project)
  status: string | null;          // e.g., "Ready", "In Progress", "Done"
  priority: string | null;        // e.g., "Critical", "High", "Medium", "Low"
  size: string | null;            // e.g., "XS", "S", "M", "L", "XL"
  type: string | null;            // e.g., "Epic", "Feature", "Bug"
  area: string | null;            // e.g., "Core", "CLI", "GitHub API"
  sprint: SprintFieldValue | null;
  blockedBy: string | null;       // Text field with issue numbers
  effortEstimate: number | null;  // Hours estimate
}

export interface SprintFieldValue {
  id: string;         // Iteration ID
  title: string;      // e.g., "Sprint 1"
  startDate: string;  // ISO date
  duration?: number;  // Duration in days
}

export interface ProjectItemWithMetadata {
  projectItemId: string;
  issueNumber: number;
  issueTitle: string;
  issueState: string;
  issueUrl: string;
  metadata: ProjectItemMetadata;
}

/**
 * Hybrid prioritization context
 * Combines AI evaluation + project metadata for prioritization
 */
export interface PrioritizationContext {
  issueNumber: number;
  issueTitle: string;

  // AI evaluation (from cache)
  aiPriorityScore: number;  // 1-10
  complexity: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high' | 'critical';
  clarity: number;           // 1-10
  importance: number;        // 1-10
  feasibility: number;       // 1-10

  // Project metadata (fresh from project)
  projectPriority: string | null;  // e.g., "Critical", "High"
  projectSize: string | null;
  projectSprint: SprintFieldValue | null;
  projectStatus: string | null;

  // Calculated
  hybridScore: number;      // Weighted combination
}

/**
 * Priority weight configuration
 */
export interface PriorityWeights {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

/**
 * Size preference configuration
 */
export interface SizePreference {
  xs: number;
  s: number;
  m: number;
  l: number;
  xl: number;
}

/**
 * Sprint/Iteration metadata and progress tracking
 */
export interface SprintMetadata {
  id: string;
  title: string;
  startDate: string;
  duration: number;            // in days
  endDate: string;            // calculated from startDate + duration
  isCurrent: boolean;
  isUpcoming: boolean;
  isPast: boolean;
  daysRemaining?: number;     // only for current sprint
}

export interface SprintProgress {
  sprint: SprintMetadata;
  totalItems: number;
  completedItems: number;
  inProgressItems: number;
  readyItems: number;
  blockedItems: number;
  completionPercentage: number;
}

/**
 * Issue dependency tracking
 */
export interface IssueDependency {
  issueNumber: number;
  dependsOn: number[];     // This issue is blocked by these
  blocks: number[];        // This issue blocks these
  relatedTo: number[];     // Loosely related
}

export interface DependencyGraph {
  nodes: Map<number, IssueDependency>;
  roots: number[];         // Issues with no dependencies
  leaves: number[];        // Issues that don't block anything
  cycles: number[][];      // Circular dependency chains
}

export interface DependencyScore {
  issueNumber: number;
  blockingScore: number;   // How many issues this unblocks
  blockedByCount: number;  // How many issues block this
  isBlocked: boolean;      // Has unresolved dependencies
  isLeaf: boolean;         // Doesn't block anything
  depthFromRoot: number;   // Steps from a root node
}
