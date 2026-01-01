/**
 * Dependency Graph System
 *
 * Builds and analyzes dependency graphs for project specifications
 * - Cycle detection (circular dependencies)
 * - Topological sorting (execution order)
 * - Dependency resolution for orchestrator integration
 */

import type {
  ProjectSpecification,
  DependencyGraph,
  DependencyNode,
  ItemDependency,
  // DependencyType,
} from '../types/project-spec.js';

/**
 * Build dependency graph from project specification
 */
export function buildDependencyGraph(spec: ProjectSpecification): DependencyGraph {
  const nodes = new Map<string, DependencyNode>();

  // Initialize nodes for all items
  spec.phases.forEach(phase => {
    phase.items.forEach(item => {
      const nodeId = `${phase.id}.${item.id}`;

      nodes.set(nodeId, {
        id: nodeId,
        itemId: item.id,
        phaseId: phase.id,
        dependencies: [],
        dependents: [],
        blocked: false,
        ready: false,
      });
    });
  });

  // Build dependency edges
  spec.phases.forEach(phase => {
    phase.items.forEach(item => {
      if (!item.dependencies || item.dependencies.length === 0) return;

      const itemNodeId = `${phase.id}.${item.id}`;
      const itemNode = nodes.get(itemNodeId)!;

      item.dependencies.forEach(dep => {
        // Resolve dependency node IDs
        const depNodeIds = resolveDependencyNodes(dep, spec);

        depNodeIds.forEach(depNodeId => {
          // Add to item's dependencies
          if (!itemNode.dependencies.includes(depNodeId)) {
            itemNode.dependencies.push(depNodeId);
          }

          // Add item as dependent of the dependency
          const depNode = nodes.get(depNodeId);
          if (depNode && !depNode.dependents.includes(itemNodeId)) {
            depNode.dependents.push(itemNodeId);
          }
        });
      });
    });
  });

  // Detect cycles
  const cycles = detectCycles(nodes);

  // Calculate topological order (only if no cycles)
  const topologicalOrder = cycles.length > 0 ? [] : calculateTopologicalOrder(nodes) || [];

  return {
    nodes,
    cycles,
    topologicalOrder,
  };
}

/**
 * Resolve dependency to actual node IDs
 *
 * Handles different dependency types:
 * - item: specific item in specific phase
 * - phase: all items in a phase
 * - master: specific item (blocking, must complete first)
 * - soft: optional dependency (won't block)
 */
function resolveDependencyNodes(dep: ItemDependency, spec: ProjectSpecification): string[] {
  const nodeIds: string[] = [];

  switch (dep.type) {
    case 'phase': {
      // dep.id is the phase ID - include all items in that phase
      const targetPhase = spec.phases.find(p => p.id === dep.id);
      if (targetPhase) {
        targetPhase.items.forEach(item => {
          nodeIds.push(`${dep.id}.${item.id}`);
        });
      }
      break;
    }

    case 'item':
    case 'master':
    case 'soft': {
      // dep.id is the item ID
      // dep.targetPhase is the phase ID (required for cross-phase, optional for same-phase)
      if (dep.targetPhase) {
        const targetPhase = spec.phases.find(p => p.id === dep.targetPhase);
        if (targetPhase) {
          const targetItem = targetPhase.items.find(i => i.id === dep.id);
          if (targetItem) {
            nodeIds.push(`${dep.targetPhase}.${dep.id}`);
          }
        }
      } else {
        // Same-phase dependency - need to find which phase contains this item
        for (const phase of spec.phases) {
          const targetItem = phase.items.find(i => i.id === dep.id);
          if (targetItem) {
            nodeIds.push(`${phase.id}.${dep.id}`);
            break;
          }
        }
      }
      break;
    }
  }

  return nodeIds;
}

/**
 * Detect cycles in dependency graph using DFS with recursion stack
 */
export function detectCycles(nodes: Map<string, DependencyNode>): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const currentPath: string[] = [];

  function dfs(nodeId: string): void {
    visited.add(nodeId);
    recursionStack.add(nodeId);
    currentPath.push(nodeId);

    const node = nodes.get(nodeId);
    if (!node) return;

    for (const depId of node.dependencies) {
      if (!visited.has(depId)) {
        dfs(depId);
      } else if (recursionStack.has(depId)) {
        // Cycle detected
        const cycleStart = currentPath.indexOf(depId);
        if (cycleStart !== -1) {
          // Extract the cycle path
          const cycle = [...currentPath.slice(cycleStart), depId];
          cycles.push(cycle);
        }
      }
    }

    recursionStack.delete(nodeId);
    currentPath.pop();
  }

  // Run DFS from each unvisited node
  for (const nodeId of nodes.keys()) {
    if (!visited.has(nodeId)) {
      dfs(nodeId);
    }
  }

  return cycles;
}

/**
 * Calculate topological order using Kahn's algorithm
 *
 * Returns items in dependency order (items with no dependencies first)
 */
export function calculateTopologicalOrder(nodes: Map<string, DependencyNode>): string[] | undefined {
  // Clone dependency counts to avoid modifying original graph
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();

  // Initialize in-degree and adjacency list
  for (const [nodeId, node] of nodes.entries()) {
    inDegree.set(nodeId, node.dependencies.length);
    adjList.set(nodeId, [...node.dependents]);
  }

  // Queue for nodes with no dependencies
  const queue: string[] = [];
  for (const [nodeId, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(nodeId);
    }
  }

  const topologicalOrder: string[] = [];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    topologicalOrder.push(nodeId);

    // Process dependents
    const dependents = adjList.get(nodeId) || [];
    for (const dependent of dependents) {
      const currentDegree = inDegree.get(dependent) || 0;
      const newDegree = currentDegree - 1;
      inDegree.set(dependent, newDegree);

      if (newDegree === 0) {
        queue.push(dependent);
      }
    }
  }

  // If not all nodes are in the order, there's a cycle
  if (topologicalOrder.length !== nodes.size) {
    return undefined; // Cycle detected
  }

  return topologicalOrder;
}

/**
 * Get ready items (items with all dependencies satisfied)
 *
 * Used by orchestrator to determine which items can be started
 */
export function getReadyItems(
  graph: DependencyGraph,
  completedItems: Set<string>
): string[] {
  const readyItems: string[] = [];

  for (const [nodeId, node] of graph.nodes.entries()) {
    // Skip if already completed
    if (completedItems.has(nodeId)) {
      continue;
    }

    // Check if all dependencies are satisfied
    const allDependenciesMet = node.dependencies.every(depId => completedItems.has(depId));

    if (allDependenciesMet) {
      readyItems.push(nodeId);
    }
  }

  return readyItems;
}

/**
 * Get blocking items (items that must complete before this item can start)
 *
 * Returns all transitive dependencies
 */
export function getBlockingItems(graph: DependencyGraph, itemId: string): string[] {
  const node = graph.nodes.get(itemId);
  if (!node) return [];

  const blocking = new Set<string>();
  const visited = new Set<string>();

  function traverse(currentId: string): void {
    if (visited.has(currentId)) return;
    visited.add(currentId);

    const currentNode = graph.nodes.get(currentId);
    if (!currentNode) return;

    for (const depId of currentNode.dependencies) {
      blocking.add(depId);
      traverse(depId);
    }
  }

  traverse(itemId);

  return Array.from(blocking);
}

/**
 * Get dependent items (items that depend on this item)
 *
 * Returns all transitive dependents
 */
export function getDependentItems(graph: DependencyGraph, itemId: string): string[] {
  const node = graph.nodes.get(itemId);
  if (!node) return [];

  const dependents = new Set<string>();
  const visited = new Set<string>();

  function traverse(currentId: string): void {
    if (visited.has(currentId)) return;
    visited.add(currentId);

    const currentNode = graph.nodes.get(currentId);
    if (!currentNode) return;

    for (const dependentId of currentNode.dependents) {
      dependents.add(dependentId);
      traverse(dependentId);
    }
  }

  traverse(itemId);

  return Array.from(dependents);
}

/**
 * Calculate critical path (longest path through dependency graph)
 *
 * Useful for estimating project duration
 */
export function calculateCriticalPath(
  graph: DependencyGraph,
  itemEstimates: Map<string, number>
): {
  path: string[];
  duration: number;
} {
  if (graph.cycles.length > 0) {
    throw new Error('Cannot calculate critical path: graph contains cycles');
  }

  const topOrder = graph.topologicalOrder;
  if (!topOrder || topOrder.length === 0) {
    throw new Error('Cannot calculate critical path: no topological order available');
  }

  // Calculate earliest start times
  const earliestStart = new Map<string, number>();
  const predecessors = new Map<string, string>();

  for (const nodeId of topOrder) {
    const node = graph.nodes.get(nodeId)!;
    let maxPredecessorTime = 0;
    let criticalPredecessor: string | null = null;

    for (const depId of node.dependencies) {
      const depStartTime = earliestStart.get(depId) || 0;
      const depDuration = itemEstimates.get(depId) || 0;
      const depCompletionTime = depStartTime + depDuration;

      if (depCompletionTime > maxPredecessorTime) {
        maxPredecessorTime = depCompletionTime;
        criticalPredecessor = depId;
      }
    }

    earliestStart.set(nodeId, maxPredecessorTime);
    if (criticalPredecessor) {
      predecessors.set(nodeId, criticalPredecessor);
    }
  }

  // Find the node with maximum completion time
  let maxCompletionTime = 0;
  let endNode: string | null = null;

  for (const nodeId of topOrder) {
    const startTime = earliestStart.get(nodeId) || 0;
    const duration = itemEstimates.get(nodeId) || 0;
    const completionTime = startTime + duration;

    if (completionTime > maxCompletionTime) {
      maxCompletionTime = completionTime;
      endNode = nodeId;
    }
  }

  // Backtrack to build critical path
  const criticalPath: string[] = [];
  let currentNode = endNode;

  while (currentNode) {
    criticalPath.unshift(currentNode);
    currentNode = predecessors.get(currentNode) || null;
  }

  return {
    path: criticalPath,
    duration: maxCompletionTime,
  };
}

/**
 * Visualize dependency graph as ASCII art
 *
 * Useful for debugging and documentation
 */
export function visualizeDependencyGraph(graph: DependencyGraph): string {
  const lines: string[] = [];

  lines.push('Dependency Graph:');
  lines.push('=================');
  lines.push('');

  if (graph.cycles.length > 0) {
    lines.push('⚠️  WARNING: Graph contains cycles!');
    lines.push('');
    lines.push('Cycles detected:');
    graph.cycles.forEach((cycle, idx) => {
      lines.push(`  ${idx + 1}. ${cycle.join(' → ')}`);
    });
    lines.push('');
  }

  if (graph.topologicalOrder && graph.topologicalOrder.length > 0) {
    lines.push('Execution Order (topological):');
    graph.topologicalOrder.forEach((nodeId, idx) => {
      const node = graph.nodes.get(nodeId)!;
      lines.push(`  ${idx + 1}. ${nodeId}`);
      if (node.dependencies.length > 0) {
        lines.push(`     Dependencies: ${node.dependencies.length}`);
      }
    });
    lines.push('');
  }

  lines.push('Node Details:');
  for (const [nodeId, node] of graph.nodes.entries()) {
    lines.push(`  ${nodeId}`);
    lines.push(`    Phase: ${node.phaseId}, Item: ${node.itemId}`);

    if (node.dependencies.length > 0) {
      lines.push(`    Depends on: ${node.dependencies.join(', ')}`);
    }

    if (node.dependents.length > 0) {
      lines.push(`    Blocks: ${node.dependents.join(', ')}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Export graph to DOT format for visualization with Graphviz
 */
export function exportToDot(graph: DependencyGraph): string {
  const lines: string[] = [];

  lines.push('digraph dependencies {');
  lines.push('  rankdir=LR;');
  lines.push('  node [shape=box];');
  lines.push('');

  // Add nodes
  for (const [nodeId, node] of graph.nodes.entries()) {
    const label = `${node.phaseId}.${node.itemId}`.replace(/"/g, '\\"');
    lines.push(`  "${nodeId}" [label="${label}"];`);
  }

  lines.push('');

  // Add edges
  for (const [nodeId, node] of graph.nodes.entries()) {
    for (const depId of node.dependencies) {
      lines.push(`  "${nodeId}" -> "${depId}";`);
    }
  }

  // Highlight cycles
  if (graph.cycles.length > 0) {
    lines.push('');
    lines.push('  /* Cycles */');
    graph.cycles.forEach(cycle => {
      for (let i = 0; i < cycle.length - 1; i++) {
        lines.push(`  "${cycle[i]}" -> "${cycle[i + 1]}" [color=red, penwidth=2];`);
      }
    });
  }

  lines.push('}');

  return lines.join('\n');
}
