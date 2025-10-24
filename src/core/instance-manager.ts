/**
 * Instance Manager - Handles slot-based LLM instance naming and lifecycle
 *
 * Features:
 * - Slot-based naming: claude-1, claude-2, gemini-1, etc.
 * - Available slot detection
 * - Abandoned work detection
 * - Instance lifecycle management
 */

import { LLMProvider } from '../types/assignments.js';
import { AssignmentManager } from './assignment-manager.js';

export interface InstanceSlot {
  provider: LLMProvider;
  slotNumber: number;
  instanceId: string; // e.g., "claude-1"
  isAvailable: boolean;
  currentAssignment?: {
    assignmentId: string;
    issueNumber: number;
    isAbandoned: boolean; // true if process is not running
  };
}

export class InstanceManager {
  constructor(
    private assignmentManager: AssignmentManager,
    private maxSlotsPerProvider: Record<LLMProvider, number>
  ) {}

  /**
   * Generate slot-based instance ID
   */
  static generateInstanceId(provider: LLMProvider, slotNumber: number): string {
    return `${provider}-${slotNumber}`;
  }

  /**
   * Parse instance ID to get provider and slot number
   */
  static parseInstanceId(instanceId: string): { provider: LLMProvider; slotNumber: number } | null {
    const match = instanceId.match(/^(claude|gemini|codex)-(\d+)$/);
    if (!match) return null;

    return {
      provider: match[1] as LLMProvider,
      slotNumber: parseInt(match[2], 10),
    };
  }

  /**
   * Get all instance slots for a provider
   */
  getProviderSlots(provider: LLMProvider): InstanceSlot[] {
    const maxSlots = this.maxSlotsPerProvider[provider] || 1;
    const assignments = this.assignmentManager.getAllAssignments();

    // Get active assignments for this provider
    const activeAssignments = assignments.filter(
      (a) => a.llmProvider === provider && (a.status === 'assigned' || a.status === 'in-progress')
    );

    // Build slot map
    const slots: InstanceSlot[] = [];

    for (let slotNumber = 1; slotNumber <= maxSlots; slotNumber++) {
      const instanceId = InstanceManager.generateInstanceId(provider, slotNumber);

      // Find assignment using this slot
      const assignment = activeAssignments.find((a) => a.llmInstanceId === instanceId);

      slots.push({
        provider,
        slotNumber,
        instanceId,
        isAvailable: !assignment,
        currentAssignment: assignment
          ? {
              assignmentId: assignment.id,
              issueNumber: assignment.issueNumber,
              isAbandoned: this.isAssignmentAbandoned(assignment.id),
            }
          : undefined,
      });
    }

    return slots;
  }

  /**
   * Get next available slot for a provider
   */
  getNextAvailableSlot(provider: LLMProvider): InstanceSlot | null {
    const slots = this.getProviderSlots(provider);
    return slots.find((slot) => slot.isAvailable) || null;
  }

  /**
   * Get all abandoned assignments across all providers
   */
  getAbandonedAssignments(): Array<{
    assignmentId: string;
    issueNumber: number;
    provider: LLMProvider;
    instanceId: string;
  }> {
    const assignments = this.assignmentManager.getAllAssignments();
    const abandoned: Array<{
      assignmentId: string;
      issueNumber: number;
      provider: LLMProvider;
      instanceId: string;
    }> = [];

    for (const assignment of assignments) {
      if (
        (assignment.status === 'in-progress' || assignment.status === 'assigned') &&
        this.isAssignmentAbandoned(assignment.id)
      ) {
        abandoned.push({
          assignmentId: assignment.id,
          issueNumber: assignment.issueNumber,
          provider: assignment.llmProvider,
          instanceId: assignment.llmInstanceId,
        });
      }
    }

    return abandoned;
  }

  /**
   * Check if an assignment is abandoned (no running process)
   * TODO: Implement actual process detection (e.g., check if Claude CLI is running)
   */
  private isAssignmentAbandoned(_assignmentId: string): boolean {
    // For now, we'll rely on the orchestrator to track running instances
    // In a future enhancement, we could check:
    // - Process list for Claude CLI with this instance ID
    // - Last activity timestamp
    // - Lock files
    return false;
  }

  /**
   * Migrate an old random instance ID to a slot-based ID
   */
  migrateToSlotBasedId(assignmentId: string, newInstanceId: string): void {
    const assignment = this.assignmentManager
      .getAllAssignments()
      .find((a) => a.id === assignmentId);

    if (!assignment) {
      throw new Error(`Assignment ${assignmentId} not found`);
    }

    this.assignmentManager.updateAssignment(assignmentId, {
      llmInstanceId: newInstanceId,
    });
  }

  /**
   * Get utilization stats for all providers
   */
  getUtilizationStats(): Record<
    LLMProvider,
    {
      maxSlots: number;
      usedSlots: number;
      availableSlots: number;
      abandonedSlots: number;
    }
  > {
    const stats: Record<string, any> = {};

    for (const provider of ['claude', 'gemini', 'codex'] as LLMProvider[]) {
      const slots = this.getProviderSlots(provider);
      const abandoned = slots.filter(
        (s) => s.currentAssignment && s.currentAssignment.isAbandoned
      ).length;

      stats[provider] = {
        maxSlots: this.maxSlotsPerProvider[provider] || 1,
        usedSlots: slots.filter((s) => !s.isAvailable).length,
        availableSlots: slots.filter((s) => s.isAvailable).length,
        abandonedSlots: abandoned,
      };
    }

    return stats;
  }
}
