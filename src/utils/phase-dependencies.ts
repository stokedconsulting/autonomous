/**
 * Phase Dependency Utilities
 *
 * Handles phase-based dependency checking and validation for epic workflows.
 * Ensures sequential phase execution: Phase N work → Phase N master → Phase N+1 work
 */

import { ProjectItem } from '../github/projects-api.js';

export interface PhaseInfo {
  phaseName: string;
  phaseNumber: number;
  isMaster: boolean;
  allItems: ProjectItem[];
  workItems: ProjectItem[];
  masterItem: ProjectItem | null;
}

export interface PhaseDependencyResult {
  canStart: boolean;
  blockedBy: string[];
  reason?: string;
  incompleteItems?: ProjectItem[];
}

/**
 * Detect if an item is a phase master
 *
 * Phase master detection:
 * - MUST have "MASTER" keyword in title
 * - MUST have "Phase N" where N is an integer (NOT decimal like Phase 7.2)
 *
 * Examples:
 * - ✅ "[Epic] Phase 1: Name - MASTER"
 * - ✅ "Phase 2: Technical Feasibility - MASTER"
 * - ❌ "Phase 1.1: Work item" (decimal = work item)
 * - ❌ "Phase 2: Task" (no MASTER keyword)
 */
export function isPhaseMaster(title: string): boolean {
  // MUST have MASTER keyword
  const hasMaster = /MASTER/i.test(title);
  if (!hasMaster) {
    return false;
  }

  // Check for decimal phase pattern (Phase N.M) - these are work items, NOT masters
  const hasDecimalPhase = /Phase\s+\d+\.\d+/i.test(title);
  if (hasDecimalPhase) {
    return false; // Decimal phase = work item, even with MASTER keyword
  }

  // Has MASTER and doesn't have decimal phase = master item
  return true;
}

/**
 * Extract phase name and number from item
 *
 * Priority:
 * 1. Phase or Epic field from metadata
 * 2. Title pattern matching (Phase N:, [Phase N], etc.)
 */
export function extractPhaseInfo(item: ProjectItem): { name: string; number: number } | null {
  // Try Phase field first
  const phaseField = item.fieldValues['Phase'] || item.fieldValues['Epic'];
  if (phaseField) {
    const match = phaseField.match(/Phase\s+(\d+)/i);
    if (match) {
      return {
        name: phaseField,
        number: parseInt(match[1], 10),
      };
    }
  }

  // Fallback: Title pattern matching
  const titleMatch = item.content.title.match(/\bPhase\s+(\d+)/i);
  if (titleMatch) {
    return {
      name: `Phase ${titleMatch[1]}`,
      number: parseInt(titleMatch[1], 10),
    };
  }

  return null;
}

/**
 * Group all items by phase
 */
export function groupItemsByPhase(items: ProjectItem[]): Map<string, PhaseInfo> {
  const phaseMap = new Map<string, PhaseInfo>();

  for (const item of items) {
    const phaseInfo = extractPhaseInfo(item);
    if (!phaseInfo) continue;

    const { name, number } = phaseInfo;

    if (!phaseMap.has(name)) {
      phaseMap.set(name, {
        phaseName: name,
        phaseNumber: number,
        isMaster: false,
        allItems: [],
        workItems: [],
        masterItem: null,
      });
    }

    const phase = phaseMap.get(name)!;
    phase.allItems.push(item);

    if (isPhaseMaster(item.content.title)) {
      phase.masterItem = item;
      phase.isMaster = true;
    } else {
      phase.workItems.push(item);
    }
  }

  return phaseMap;
}

/**
 * Check if a phase is complete
 * All work items must have status: Done, Dev Complete, Completed
 */
export function isPhaseComplete(phase: PhaseInfo): boolean {
  const completeStatuses = ['Done', 'Dev Complete', 'Completed'];

  // All work items must be complete
  const allWorkComplete = phase.workItems.every(item => {
    const status = item.fieldValues['Status'];
    return status && completeStatuses.includes(status);
  });

  // Master must also be complete (if it exists)
  const masterComplete = phase.masterItem
    ? completeStatuses.includes(phase.masterItem.fieldValues['Status'] || '')
    : true;

  return allWorkComplete && masterComplete;
}

/**
 * Get all items in the same phase as the given item
 */
export function getPhaseItems(targetItem: ProjectItem, allItems: ProjectItem[]): ProjectItem[] {
  const phaseInfo = extractPhaseInfo(targetItem);
  if (!phaseInfo) return [];

  return allItems.filter(item => {
    const itemPhase = extractPhaseInfo(item);
    return itemPhase && itemPhase.number === phaseInfo.number;
  });
}

/**
 * Check if an item can start based on phase dependencies
 *
 * Rules:
 * 1. Phase work items can start if all previous phases are complete
 * 2. Phase master can start ONLY if all work items in the same phase are complete
 * 3. If a phase master is currently assigned/in-progress, next phase is blocked
 */
export function checkPhaseDependencies(
  item: ProjectItem,
  allItems: ProjectItem[]
): PhaseDependencyResult {
  const itemPhaseInfo = extractPhaseInfo(item);
  if (!itemPhaseInfo) {
    return { canStart: true, blockedBy: [] }; // No phase info = not part of epic workflow
  }

  const phases = groupItemsByPhase(allItems);
  const currentPhase = phases.get(itemPhaseInfo.name);

  if (!currentPhase) {
    return { canStart: true, blockedBy: [] };
  }

  const isItemMaster = isPhaseMaster(item.content.title);

  // Rule 1: If this is a phase master, check that all work items in the phase are complete
  if (isItemMaster) {
    const incompleteWorkItems = currentPhase.workItems.filter(workItem => {
      const status = workItem.fieldValues['Status'];
      return !status || !['Done', 'Dev Complete', 'Completed'].includes(status);
    });

    if (incompleteWorkItems.length > 0) {
      return {
        canStart: false,
        blockedBy: [`${currentPhase.phaseName} has ${incompleteWorkItems.length} incomplete work item(s)`],
        reason: 'Phase master cannot start until all work items are complete',
        incompleteItems: incompleteWorkItems,
      };
    }
  }

  // Rule 2: Check if all previous phases are complete
  const previousPhases: PhaseInfo[] = [];
  for (const phase of phases.values()) {
    if (phase.phaseNumber < currentPhase.phaseNumber) {
      previousPhases.push(phase);
    }
  }

  const incompletePreviousPhases = previousPhases.filter(phase => !isPhaseComplete(phase));

  if (incompletePreviousPhases.length > 0) {
    const blockedBy = incompletePreviousPhases.map(phase => {
      const incompleteWork = phase.workItems.filter(item => {
        const status = item.fieldValues['Status'];
        return !status || !['Done', 'Dev Complete', 'Completed'].includes(status);
      });

      const masterIncomplete = phase.masterItem &&
        !['Done', 'Dev Complete', 'Completed'].includes(phase.masterItem.fieldValues['Status'] || '');

      const parts: string[] = [];
      if (incompleteWork.length > 0) {
        parts.push(`${incompleteWork.length} work item(s)`);
      }
      if (masterIncomplete) {
        parts.push('master');
      }

      return `${phase.phaseName}: ${parts.join(', ')} incomplete`;
    });

    return {
      canStart: false,
      blockedBy,
      reason: 'Previous phases must complete before this phase can start',
    };
  }

  // Rule 3: Check if previous phase master is currently assigned/in-progress
  const previousPhase = previousPhases.length > 0
    ? previousPhases[previousPhases.length - 1]
    : null;

  if (previousPhase && previousPhase.masterItem) {
    const masterStatus = previousPhase.masterItem.fieldValues['Status'];
    const inProgressStatuses = ['In Progress', 'In Review', 'Assigned'];

    if (masterStatus && inProgressStatuses.includes(masterStatus)) {
      return {
        canStart: false,
        blockedBy: [`${previousPhase.phaseName} master is ${masterStatus}`],
        reason: 'Cannot start next phase while previous phase master is in progress',
      };
    }
  }

  return { canStart: true, blockedBy: [] };
}

/**
 * Get human-readable blocking reason for display in UI
 */
export function getBlockingReason(result: PhaseDependencyResult): string | null {
  if (result.canStart) return null;

  if (result.blockedBy.length === 0) return result.reason || 'Blocked by dependencies';

  return result.blockedBy.join(' • ');
}

/**
 * Check if work can actually be started on an item (enforcement point)
 *
 * This is used by the orchestrator to determine if a queued item
 * is ready to have a worker process started.
 *
 * Items can be queued at any time, but work only starts when dependencies are met.
 */
export function canStartWork(item: ProjectItem, allItems: ProjectItem[]): {
  canStart: boolean;
  reason?: string;
} {
  const dependencyResult = checkPhaseDependencies(item, allItems);

  if (!dependencyResult.canStart) {
    return {
      canStart: false,
      reason: getBlockingReason(dependencyResult) || 'Dependencies not met',
    };
  }

  return { canStart: true };
}
