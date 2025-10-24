/**
 * Dependency Graph Analyzer
 *
 * Analyzes issue dependencies to:
 * - Build dependency graphs
 * - Detect circular dependencies
 * - Calculate blocking scores
 * - Find unblocked leaf nodes
 */

import { IssueDependency, DependencyGraph, DependencyScore } from '../types/project.js';
import { IssueRelationshipParser, ParsedRelationships } from '../utils/issue-relationship-parser.js';
import { Issue } from '../types/index.js';

export class DependencyGraphAnalyzer {
  private dependencies: Map<number, IssueDependency> = new Map();

  /**
   * Build dependency graph from issues
   */
  buildGraph(issues: Issue[]): DependencyGraph {
    this.dependencies.clear();

    // Parse all dependencies
    issues.forEach(issue => {
      const parsed = IssueRelationshipParser.parse(issue.body, issue.number);
      const dependency = this.parseToDependency(issue.number, parsed);
      this.dependencies.set(issue.number, dependency);
    });

    // Find roots (no dependencies)
    const roots: number[] = [];
    for (const [issueNum, dep] of this.dependencies.entries()) {
      if (dep.dependsOn.length === 0) {
        roots.push(issueNum);
      }
    }

    // Find leaves (doesn't block anything)
    const leaves: number[] = [];
    for (const [issueNum, dep] of this.dependencies.entries()) {
      if (dep.blocks.length === 0) {
        leaves.push(issueNum);
      }
    }

    // Detect cycles
    const cycles = this.detectCycles();

    return {
      nodes: this.dependencies,
      roots,
      leaves,
      cycles,
    };
  }

  /**
   * Parse relationships to dependency structure
   */
  private parseToDependency(issueNumber: number, parsed: ParsedRelationships): IssueDependency {
    const dependsOn: number[] = [];
    const blocks: number[] = [];
    const relatedTo: number[] = [];

    parsed.relationships.forEach(rel => {
      switch (rel.type) {
        case 'blocked-by':
          dependsOn.push(rel.issueNumber);
          break;
        case 'blocks':
          blocks.push(rel.issueNumber);
          break;
        case 'related':
          relatedTo.push(rel.issueNumber);
          break;
      }
    });

    return {
      issueNumber,
      dependsOn,
      blocks,
      relatedTo,
    };
  }

  /**
   * Detect circular dependencies using DFS
   */
  private detectCycles(): number[][] {
    const cycles: number[][] = [];
    const visited = new Set<number>();
    const recursionStack = new Set<number>();

    const dfs = (node: number, path: number[]) => {
      if (recursionStack.has(node)) {
        // Found a cycle
        const cycleStartIndex = path.indexOf(node);
        if (cycleStartIndex !== -1) {
          cycles.push(path.slice(cycleStartIndex));
        }
        return;
      }

      if (visited.has(node)) {
        return; // Already explored this path
      }

      visited.add(node);
      recursionStack.add(node);
      path.push(node);

      const dep = this.dependencies.get(node);
      if (dep) {
        // Follow "depends on" edges (reverse dependencies)
        dep.dependsOn.forEach(dependencyNode => {
          dfs(dependencyNode, [...path]);
        });
      }

      recursionStack.delete(node);
    };

    // Run DFS from each node
    for (const node of this.dependencies.keys()) {
      if (!visited.has(node)) {
        dfs(node, []);
      }
    }

    return cycles;
  }

  /**
   * Calculate dependency score for an issue
   */
  calculateDependencyScore(issueNumber: number, graph: DependencyGraph): DependencyScore {
    const dep = graph.nodes.get(issueNumber);

    if (!dep) {
      return {
        issueNumber,
        blockingScore: 0,
        blockedByCount: 0,
        isBlocked: false,
        isLeaf: true,
        depthFromRoot: 0,
      };
    }

    // Calculate blocking score (how many issues this unblocks)
    const blockingScore = this.calculateBlockingScore(issueNumber, graph);

    // Count how many issues block this
    const blockedByCount = dep.dependsOn.length;

    // Check if blocked (has unresolved dependencies)
    const isBlocked = blockedByCount > 0;

    // Check if leaf (doesn't block anything)
    const isLeaf = dep.blocks.length === 0;

    // Calculate depth from root
    const depthFromRoot = this.calculateDepthFromRoot(issueNumber, graph);

    return {
      issueNumber,
      blockingScore,
      blockedByCount,
      isBlocked,
      isLeaf,
      depthFromRoot,
    };
  }

  /**
   * Calculate how many issues this issue unblocks (recursively)
   */
  private calculateBlockingScore(issueNumber: number, graph: DependencyGraph): number {
    const dep = graph.nodes.get(issueNumber);
    if (!dep) return 0;

    const visited = new Set<number>();
    const countBlockedIssues = (num: number): number => {
      if (visited.has(num)) return 0;
      visited.add(num);

      const dependency = graph.nodes.get(num);
      if (!dependency) return 0;

      let count = dependency.blocks.length;

      // Recursively count issues blocked by the ones this blocks
      dependency.blocks.forEach(blockedNum => {
        count += countBlockedIssues(blockedNum);
      });

      return count;
    };

    return countBlockedIssues(issueNumber);
  }

  /**
   * Calculate distance from nearest root node
   */
  private calculateDepthFromRoot(issueNumber: number, graph: DependencyGraph): number {
    if (graph.roots.includes(issueNumber)) {
      return 0; // This is a root
    }

    const visited = new Set<number>();
    const queue: Array<{node: number, depth: number}> = [];

    // Start from all roots
    graph.roots.forEach(root => {
      queue.push({node: root, depth: 0});
    });

    while (queue.length > 0) {
      const {node, depth} = queue.shift()!;

      if (visited.has(node)) continue;
      visited.add(node);

      if (node === issueNumber) {
        return depth;
      }

      // Add all issues this node blocks
      const dep = graph.nodes.get(node);
      if (dep) {
        dep.blocks.forEach(blockedNode => {
          queue.push({node: blockedNode, depth: depth + 1});
        });
      }
    }

    // Not reachable from any root
    return Infinity;
  }

  /**
   * Get all unblocked issues (ready to work on)
   */
  getUnblockedIssues(graph: DependencyGraph, issueStatuses: Map<number, 'open' | 'closed'>): number[] {
    const unblocked: number[] = [];

    for (const [issueNum, dep] of graph.nodes.entries()) {
      // Check if all dependencies are closed
      const allDependenciesResolved = dep.dependsOn.every(depNum => {
        const status = issueStatuses.get(depNum);
        return status === 'closed';
      });

      // If issue is open and all dependencies resolved, it's unblocked
      const issueStatus = issueStatuses.get(issueNum);
      if (issueStatus === 'open' && allDependenciesResolved) {
        unblocked.push(issueNum);
      }
    }

    return unblocked;
  }

  /**
   * Validate graph for issues
   */
  validateGraph(graph: DependencyGraph): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for cycles
    if (graph.cycles.length > 0) {
      errors.push(`Found ${graph.cycles.length} circular dependency cycle(s)`);
      graph.cycles.forEach((cycle, idx) => {
        errors.push(`  Cycle ${idx + 1}: ${cycle.join(' → ')}`);
      });
    }

    // Check for orphaned dependencies (reference non-existent issues)
    for (const [issueNum, dep] of graph.nodes.entries()) {
      dep.dependsOn.forEach(depNum => {
        if (!graph.nodes.has(depNum)) {
          warnings.push(`Issue #${issueNum} depends on #${depNum} which is not in the graph`);
        }
      });

      dep.blocks.forEach(blockedNum => {
        if (!graph.nodes.has(blockedNum)) {
          warnings.push(`Issue #${issueNum} blocks #${blockedNum} which is not in the graph`);
        }
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Get dependency path between two issues
   */
  getDependencyPath(from: number, to: number, graph: DependencyGraph): number[] | null {
    const visited = new Set<number>();
    const queue: Array<{node: number, path: number[]}> = [];

    queue.push({node: from, path: [from]});

    while (queue.length > 0) {
      const {node, path} = queue.shift()!;

      if (visited.has(node)) continue;
      visited.add(node);

      if (node === to) {
        return path;
      }

      const dep = graph.nodes.get(node);
      if (dep) {
        // Follow "blocks" edges
        dep.blocks.forEach(blockedNode => {
          queue.push({node: blockedNode, path: [...path, blockedNode]});
        });
      }
    }

    return null; // No path found
  }
}
