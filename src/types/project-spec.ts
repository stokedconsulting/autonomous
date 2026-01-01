/**
 * Type definitions for project creation and specification system
 *
 * This file contains types for:
 * 1. Two-stage project creation workflow (PM → Engineering)
 * 2. Specification file-based project creation (YAML/JSON/MD)
 */

// ============================================================================
// TWO-STAGE PROJECT CREATION WORKFLOW TYPES
// ============================================================================

/**
 * Stage 1: Product Manager creates product strategy
 */
export interface ProductStrategy {
  title: string;
  rawOutput: string;
  validated: boolean;
  validationErrors?: string[];
}

/**
 * Stage 2: Senior Engineer creates implementation plan
 */
export interface ImplementationPlan {
  title: string;
  rawOutput: string;
  validated: boolean;
  validationErrors?: string[];
  filePath?: string; // Path where plan was saved in docs/projects/
}

export type ReviewAction = 'approve' | 'reject' | 'cancel';

export interface ReviewFeedback {
  action: ReviewAction;
  comments?: string;
}

export interface ProjectCreationState {
  description: string;
  productStrategy?: ProductStrategy;
  implementationPlan?: ImplementationPlan;
  stage: 'initial' | 'pm-review' | 'eng-review' | 'creating-project' | 'complete' | 'error';
  error?: string;
}

// ============================================================================
// SPECIFICATION FILE-BASED PROJECT CREATION TYPES
// ============================================================================

/**
 * Project metadata
 */
export interface ProjectMetadata {
  title: string;
  description?: string;
  epic?: string; // Optional epic grouping
}

/**
 * Dependency types
 */
export type DependencyType = 'phase' | 'item' | 'master' | 'soft';

/**
 * Item-level dependency
 */
export interface ItemDependency {
  type?: DependencyType;
  id: string; // Target item ID or phase ID
  targetPhase?: string; // For cross-phase dependencies
  strict?: boolean; // If false, allows parallel work
  reason?: string; // Human-readable explanation
}

/**
 * Phase-level dependency
 */
export interface PhaseDependency {
  phase: string; // Phase ID
  strict: boolean; // true = all items, false = just master
  allowParallel?: boolean; // Allow some items to start early
}

/**
 * Function specification (for detailed projects)
 */
export interface FunctionSpec {
  name: string;
  inputs?: Array<{
    name: string;
    type: string;
    validation?: string;
  }>;
  outputs?: Array<{
    name: string;
    type: string;
  }>;
  dependencies?: string[];
  is_new?: boolean; // For enrichment tracking
  modifications?: string; // For enrichment tracking
}

/**
 * Modification specification (for existing features)
 */
export interface ModificationSpec {
  function: string; // Existing function being modified
  file: string;
  changes: string;
  new_dependencies?: string[];
}

/**
 * Work item specification
 */
export interface SpecWorkItem {
  id: string;
  title: string;
  type?: 'task' | 'bug' | 'feature' | 'research';
  description: string;
  functions?: FunctionSpec[];
  modifies?: ModificationSpec[];
  dependencies?: ItemDependency[];
  estimate?: number; // hours
  size?: 'XS' | 'S' | 'M' | 'L' | 'XL';
  priority?: 'Critical' | 'High' | 'Medium' | 'Low';
  // Optional fields for completeness validation
  acceptance_criteria?: string[];
  technical_details?: string;
  complexity?: 'Low' | 'Medium' | 'High';
  modified_files?: string[];
}

/**
 * Phase specification
 */
export interface PhaseSpecification {
  id: string;
  name: string;
  description?: string;
  goal?: string;
  dependencies?: PhaseDependency[];
  items: SpecWorkItem[];
}

/**
 * Project configuration
 */
export interface ProjectConfig {
  auto_create_phase_masters?: boolean;
  dependency_validation?: 'strict' | 'warn' | 'ignore';
  require_estimates?: boolean;
  default_size?: 'XS' | 'S' | 'M' | 'L' | 'XL';
  default_priority?: 'Critical' | 'High' | 'Medium' | 'Low';
}

/**
 * Complete project specification
 */
export interface ProjectSpecification {
  project: ProjectMetadata;
  phases: PhaseSpecification[];
  config?: ProjectConfig;
}

/**
 * Project input for creation
 */
export interface ProjectInput {
  specification?: ProjectSpecification;
  filePath?: string; // File path for file-based input
  format?: 'yaml' | 'json' | 'markdown' | 'text';
  type?: 'file' | 'description' | 'text'; // Input type
  path?: string; // Alternative to filePath
  content?: string; // For text/description input
}

// ============================================================================
// VALIDATION TYPES
// ============================================================================

/**
 * Validation issue
 */
export interface ValidationIssue {
  code?: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  location?: {
    phase?: string;
    item?: string;
    field?: string;
  };
  suggestion?: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  info: ValidationIssue[];
  issues?: ValidationIssue[]; // Alias for combined errors/warnings/info
}

/**
 * Completeness assessment
 */
export interface CompletenessAssessment {
  itemId: string;
  score: number; // 0-100
  missingCriteria: string[];
  suggestions: string[];
  gaps?: Array<{ field: string; reason: string; suggestion: string }>; // Detailed gap information
}

/**
 * Gap analysis result
 */
export interface GapAnalysisResult {
  hasGaps: boolean;
  incompleteItems: CompletenessAssessment[];
  items?: CompletenessAssessment[]; // Alias for incompleteItems
  overallCompleteness: number; // 0-100
}

/**
 * Gap fill change
 */
export interface GapFillChange {
  itemId: string;
  field: string;
  before: string;
  after: string;
  reason: string;
}

/**
 * Enrichment suggestion
 */
export interface EnrichmentSuggestion {
  itemId?: string;
  item_id?: string; // Alias for itemId
  type?: 'missing_criteria' | 'incomplete_description' | 'missing_estimate' | 'unclear_dependency';
  suggestion?: string;
  field?: string; // Field being suggested for
  content?: string; // Suggested content
  confidence?: number; // 0-1 confidence score
  priority?: 'high' | 'medium' | 'low';
  reasoning?: string; // Reasoning for the suggestion
}

/**
 * Enrichment changes statistics
 */
export interface EnrichmentChanges {
  fields_added: number;
  items_enriched: number;
  acceptance_criteria_added: number;
  technical_details_added: number;
}

/**
 * Enrichment result
 */
export interface EnrichmentResult {
  original: ProjectSpecification;
  enriched: ProjectSpecification; // The enriched specification
  spec?: ProjectSpecification; // Alias for backward compatibility
  changes: EnrichmentChanges;
  suggestions: EnrichmentSuggestion[];
}

// ============================================================================
// DEPENDENCY GRAPH TYPES
// ============================================================================

/**
 * Dependency node in graph
 */
export interface DependencyNode {
  id: string; // "phase-id.item-id"
  itemId: string;
  phaseId: string;
  dependencies: string[]; // Array of node IDs this depends on
  dependents: string[]; // Array of node IDs that depend on this
  blocked: boolean; // Currently blocked by dependencies
  ready: boolean; // Ready to start (all dependencies satisfied)
}

/**
 * Dependency graph
 */
export interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  cycles: string[][]; // Circular dependency chains
  topologicalOrder: string[]; // Execution order
}
export type { FunctionSpec as FunctionSignature } from './project-spec.js';
