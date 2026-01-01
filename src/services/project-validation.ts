/**
 * Project Specification Validation Engine
 *
 * Performs comprehensive validation of project specifications:
 * 1. Structure validation (ID uniqueness, reference validity)
 * 2. Completeness checking (required fields, detail sufficiency)
 * 3. Dependency validation (circular dependencies, valid references)
 */

import type {
  ProjectSpecification,
  // SpecPhase,
  SpecWorkItem,
  ValidationResult,
  ValidationIssue,
  // ValidationSeverity,
  CompletenessAssessment,
  GapAnalysisResult,
  // ItemDependency,
  DependencyType,
} from '../types/project-spec.js';

/**
 * Validation configuration
 */
interface ValidationConfig {
  /** Minimum description length for work items */
  minDescriptionLength: number;

  /** Minimum number of acceptance criteria recommended */
  minAcceptanceCriteria: number;

  /** Whether to require technical details for complex items */
  requireTechnicalDetails: boolean;

  /** Whether to require function specs for large modifications */
  requireFunctionSpecs: boolean;

  /** Maximum allowed dependency depth */
  maxDependencyDepth: number;
}

const DEFAULT_CONFIG: ValidationConfig = {
  minDescriptionLength: 50,
  minAcceptanceCriteria: 2,
  requireTechnicalDetails: true,
  requireFunctionSpecs: false,
  maxDependencyDepth: 10,
};

/**
 * Phase 2: Structure Validation
 *
 * Validates:
 * - ID uniqueness across phases and items
 * - Valid cross-references in dependencies
 * - Proper phase/item ID formats
 */
export function validateStructure(spec: ProjectSpecification): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Track all IDs for uniqueness check
  const phaseIds = new Set<string>();
  const itemIds = new Set<string>();
  const allItemsByPhase = new Map<string, Set<string>>();

  // Validate phase IDs
  spec.phases.forEach((phase, idx) => {
    // Check ID format
    if (!phase.id.match(/^[a-zA-Z0-9_-]+$/)) {
      issues.push({
        severity: 'error',
        message: `Phase ${idx + 1} has invalid ID format: "${phase.id}"`,
        location: { phase: phase.id },
        suggestion: 'Use only letters, numbers, underscores, and hyphens',
      });
    }

    // Check ID uniqueness
    if (phaseIds.has(phase.id)) {
      issues.push({
        severity: 'error',
        message: `Duplicate phase ID: "${phase.id}"`,
        location: { phase: phase.id },
        suggestion: 'Ensure all phase IDs are unique',
      });
    } else {
      phaseIds.add(phase.id);
      allItemsByPhase.set(phase.id, new Set());
    }

    // Validate item IDs within phase
    phase.items.forEach((item, itemIdx) => {
      // Check ID format
      if (!item.id.match(/^[a-zA-Z0-9_-]+$/)) {
        issues.push({
          severity: 'error',
          message: `Item ${itemIdx + 1} in phase ${phase.id} has invalid ID format: "${item.id}"`,
          location: { phase: phase.id, item: item.id },
          suggestion: 'Use only letters, numbers, underscores, and hyphens',
        });
      }

      // Check item ID uniqueness globally
      if (itemIds.has(item.id)) {
        issues.push({
          severity: 'error',
          message: `Duplicate item ID: "${item.id}"`,
          location: { phase: phase.id, item: item.id },
          suggestion: 'Ensure all item IDs are unique across all phases',
        });
      } else {
        itemIds.add(item.id);
        allItemsByPhase.get(phase.id)?.add(item.id);
      }
    });
  });

  // Validate dependency references
  spec.phases.forEach(phase => {
    phase.items.forEach(item => {
      if (!item.dependencies) return;

      item.dependencies.forEach((dep, depIdx) => {
        // Validate dependency based on type
        if (dep.type === 'phase') {
          // dep.id should be a phase ID
          if (!phaseIds.has(dep.id)) {
            issues.push({
              severity: 'error',
              message: `Dependency ${depIdx + 1} references non-existent phase: "${dep.id}"`,
              location: { phase: phase.id, item: item.id },
              suggestion: `Valid phase IDs: ${Array.from(phaseIds).join(', ')}`,
            });
          }
        } else {
          // dep.id should be an item ID
          if (!itemIds.has(dep.id)) {
            issues.push({
              severity: 'error',
              message: `Dependency ${depIdx + 1} references non-existent item: "${dep.id}"`,
              location: { phase: phase.id, item: item.id },
              suggestion: 'Verify item ID exists',
            });
          }

          // If targetPhase is specified, validate it
          if (dep.targetPhase) {
            if (!phaseIds.has(dep.targetPhase)) {
              issues.push({
                severity: 'error',
                message: `Dependency ${depIdx + 1} references non-existent phase: "${dep.targetPhase}"`,
                location: { phase: phase.id, item: item.id },
                suggestion: `Valid phase IDs: ${Array.from(phaseIds).join(', ')}`,
              });
            }

            // Check item belongs to specified phase
            const phaseItems = allItemsByPhase.get(dep.targetPhase);
            if (phaseItems && !phaseItems.has(dep.id)) {
              issues.push({
                severity: 'error',
                message: `Item "${dep.id}" does not belong to phase "${dep.targetPhase}"`,
                location: { phase: phase.id, item: item.id },
                suggestion: 'Verify the targetPhase and id combination',
              });
            }
          }

          // Check for self-dependencies
          if (dep.targetPhase === phase.id && dep.id === item.id) {
            issues.push({
              severity: 'error',
              message: 'Item cannot depend on itself',
              location: { phase: phase.id, item: item.id },
              suggestion: 'Remove self-referencing dependency',
            });
          } else if (!dep.targetPhase && dep.id === item.id) {
            // Same-phase self-dependency
            issues.push({
              severity: 'error',
              message: 'Item cannot depend on itself',
              location: { phase: phase.id, item: item.id },
              suggestion: 'Remove self-referencing dependency',
            });
          }
        }

        // Validate dependency type
        const validTypes: DependencyType[] = ['phase', 'item', 'master', 'soft'];
        if (dep.type && !validTypes.includes(dep.type)) {
          issues.push({
            severity: 'error',
            message: `Invalid dependency type: "${dep.type}"`,
            location: { phase: phase.id, item: item.id },
            suggestion: `Valid types: ${validTypes.join(', ')}`,
          });
        }
      });
    });
  });

  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');
  const info = issues.filter(i => i.severity === 'info');

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    info,
  };
}

/**
 * Phase 3: Completeness Validation
 *
 * Assesses whether work items have sufficient detail for implementation
 */
export function validateCompleteness(
  spec: ProjectSpecification,
  config: ValidationConfig = DEFAULT_CONFIG
): GapAnalysisResult {
  const itemAssessments: CompletenessAssessment[] = [];
  let totalScore = 0;

  spec.phases.forEach(phase => {
    phase.items.forEach(item => {
      const assessment = assessItemCompleteness(item, phase.id, config);
      itemAssessments.push(assessment);
      totalScore += assessment.score;
    });
  });

  const totalItems = itemAssessments.length;
  const overallScore = totalItems > 0 ? Math.round(totalScore / totalItems) : 0;

  // Find incomplete items (threshold: 70%)
  const incompleteItems = itemAssessments.filter(a => a.score < 70);

  // Recommend enrichment if overall score is low or many items are incomplete
  const hasGaps = overallScore < 70 || incompleteItems.length > totalItems * 0.3;

  return {
    hasGaps,
    incompleteItems,
    overallCompleteness: overallScore,
  };
}

/**
 * Assess completeness of a single work item
 */
function assessItemCompleteness(
  item: SpecWorkItem,
  _phaseId: string,
  config: ValidationConfig
): CompletenessAssessment {
  const missingRequired: string[] = [];
  const missingRecommended: string[] = [];
  const gaps: Array<{ field: string; reason: string; suggestion?: string }> = [];

  let score = 100; // Start with perfect score, deduct for gaps

  // Required: Description
  if (!item.description || item.description.trim().length === 0) {
    missingRequired.push('description');
    gaps.push({
      field: 'description',
      reason: 'Missing work item description',
      suggestion: 'Add detailed description of what needs to be implemented',
    });
    score -= 30;
  } else if (item.description.length < config.minDescriptionLength) {
    gaps.push({
      field: 'description',
      reason: `Description too brief (${item.description.length} chars)`,
      suggestion: `Expand to at least ${config.minDescriptionLength} characters for clarity`,
    });
    score -= 15;
  }

  // Recommended: Acceptance Criteria
  if (!item.acceptance_criteria || item.acceptance_criteria.length === 0) {
    missingRecommended.push('acceptance_criteria');
    gaps.push({
      field: 'acceptance_criteria',
      reason: 'No acceptance criteria defined',
      suggestion: 'Add measurable criteria to determine when work is complete',
    });
    score -= 20;
  } else if (item.acceptance_criteria.length < config.minAcceptanceCriteria) {
    gaps.push({
      field: 'acceptance_criteria',
      reason: `Only ${item.acceptance_criteria.length} acceptance criteria`,
      suggestion: `Consider adding at least ${config.minAcceptanceCriteria} criteria`,
    });
    score -= 10;
  }

  // Recommended: Technical Details (for complex items)
  if (item.complexity === 'High' || item.size === 'L' || item.size === 'XL') {
    if (!item.technical_details || item.technical_details.trim().length === 0) {
      missingRecommended.push('technical_details');
      gaps.push({
        field: 'technical_details',
        reason: 'Complex item missing technical implementation details',
        suggestion: 'Add technical approach, architecture notes, or implementation guidance',
      });
      score -= 15;
    }
  }

  // Recommended: Function Specs (for items modifying existing functions)
  if (item.modified_files && item.modified_files.length > 0) {
    if (!item.functions || item.functions.length === 0) {
      missingRecommended.push('functions');
      gaps.push({
        field: 'functions',
        reason: 'Modifies existing files but no function specs provided',
        suggestion: 'Add function signatures for new/modified functions with inputs/outputs',
      });
      score -= 15;
    }
  }

  // Recommended: Estimate or Size
  if (!item.estimate && !item.size) {
    missingRecommended.push('estimate/size');
    gaps.push({
      field: 'estimate',
      reason: 'No effort estimate or size indicator',
      suggestion: 'Add estimate (hours) or size (S/M/L/XL) for planning',
    });
    score -= 10;
  }

  // Bonus points for comprehensive information
  if (item.functions && item.functions.length > 0) {
    // Check function spec quality
    const incompleteFunctions = item.functions.filter(
      fn => !fn.inputs || fn.inputs.length === 0 || !fn.outputs
    );

    if (incompleteFunctions.length > 0) {
      gaps.push({
        field: 'functions',
        reason: `${incompleteFunctions.length} function(s) missing inputs/outputs`,
        suggestion: 'Complete function signatures with detailed inputs and outputs',
      });
      score -= 5 * incompleteFunctions.length;
    }
  }

  // Ensure score stays in valid range
  score = Math.max(0, Math.min(100, score));

  return {
    itemId: item.id,
    score,
    missingCriteria: [...missingRequired, ...missingRecommended],
    suggestions: gaps.map(g => `${g.field}: ${g.reason} - ${g.suggestion}`),
  };
}

/**
 * Phase 4: Dependency Validation
 *
 * Validates dependency graph for circular dependencies
 * (Full cycle detection implemented in dependency-graph.ts)
 */
export function validateDependencies(
  spec: ProjectSpecification,
  config: ValidationConfig = DEFAULT_CONFIG
): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Build dependency graph for cycle detection
  const graph = new Map<string, Set<string>>();
  const itemPhaseMap = new Map<string, string>();

  // Initialize graph
  spec.phases.forEach(phase => {
    phase.items.forEach(item => {
      const itemKey = `${phase.id}.${item.id}`;
      graph.set(itemKey, new Set());
      itemPhaseMap.set(itemKey, phase.id);
    });
  });

  // Add edges (dependencies)
  spec.phases.forEach(phase => {
    phase.items.forEach(item => {
      const itemKey = `${phase.id}.${item.id}`;

      if (!item.dependencies) return;

      item.dependencies.forEach(dep => {
        // Handle phase-level dependencies (all items in that phase)
        if (dep.type === 'phase') {
          const targetPhase = spec.phases.find(p => p.id === dep.id);
          targetPhase?.items.forEach(depItem => {
            graph.get(itemKey)?.add(`${dep.id}.${depItem.id}`);
          });
        } else {
          // Item-level dependency
          const targetPhaseId = dep.targetPhase || phase.id; // Same phase if not specified
          const depKey = `${targetPhaseId}.${dep.id}`;
          graph.get(itemKey)?.add(depKey);
        }
      });
    });
  });

  // Detect cycles using DFS
  const cycles = detectCycles(graph);

  if (cycles.length > 0) {
    cycles.forEach((cycle, _idx) => {
      const cycleDisplay = cycle.map(key => key.replace('.', ' → ')).join(' → ');

      issues.push({
        severity: 'error',
        message: `Circular dependency detected: ${cycleDisplay}`,
        suggestion: 'Remove or convert to soft dependency to break the cycle',
      });
    });
  }

  // Check dependency depth
  const maxDepth = calculateMaxDependencyDepth(graph);

  if (maxDepth > config.maxDependencyDepth) {
    issues.push({
      severity: 'warning',
      message: `Dependency depth (${maxDepth}) exceeds recommended maximum (${config.maxDependencyDepth})`,
      suggestion: 'Consider flattening dependency structure or breaking into smaller phases',
    });
  }

  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');
  const info = issues.filter(i => i.severity === 'info');

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    info,
  };
}

/**
 * Detect cycles in dependency graph using DFS
 */
function detectCycles(graph: Map<string, Set<string>>): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const currentPath: string[] = [];

  function dfs(node: string): void {
    visited.add(node);
    recursionStack.add(node);
    currentPath.push(node);

    const neighbors = graph.get(node) || new Set();

    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        dfs(neighbor);
      } else if (recursionStack.has(neighbor)) {
        // Cycle detected
        const cycleStart = currentPath.indexOf(neighbor);
        if (cycleStart !== -1) {
          cycles.push([...currentPath.slice(cycleStart), neighbor]);
        }
      }
    }

    recursionStack.delete(node);
    currentPath.pop();
  }

  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      dfs(node);
    }
  }

  return cycles;
}

/**
 * Calculate maximum dependency depth
 */
function calculateMaxDependencyDepth(graph: Map<string, Set<string>>): number {
  let maxDepth = 0;

  function dfs(node: string, depth: number, visited: Set<string>): number {
    if (visited.has(node)) return depth;

    visited.add(node);

    const neighbors = graph.get(node) || new Set();
    let currentMax = depth;

    for (const neighbor of neighbors) {
      const neighborDepth = dfs(neighbor, depth + 1, new Set(visited));
      currentMax = Math.max(currentMax, neighborDepth);
    }

    return currentMax;
  }

  for (const node of graph.keys()) {
    const depth = dfs(node, 0, new Set());
    maxDepth = Math.max(maxDepth, depth);
  }

  return maxDepth;
}

/**
 * Comprehensive validation combining all phases
 */
export function validateProjectSpecification(
  spec: ProjectSpecification,
  config: ValidationConfig = DEFAULT_CONFIG
): {
  syntaxResult: ValidationResult;
  structureResult: ValidationResult;
  gapAnalysis: GapAnalysisResult;
  dependencyResult: ValidationResult;
  overallValid: boolean;
} {
  // Import syntax validation from parser
  const { validateSyntax } = require('./project-specification.js');

  const syntaxResult = validateSyntax(spec);
  const structureResult = validateStructure(spec);
  const gapAnalysis = validateCompleteness(spec, config);
  const dependencyResult = validateDependencies(spec, config);

  const overallValid =
    syntaxResult.valid &&
    structureResult.valid &&
    dependencyResult.valid &&
    gapAnalysis.overallCompleteness >= 60; // Minimum 60% completeness

  return {
    syntaxResult,
    structureResult,
    gapAnalysis,
    dependencyResult,
    overallValid,
  };
}
