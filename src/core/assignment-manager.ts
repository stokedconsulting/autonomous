/**
 * Assignment Manager - In-Memory Assignment Management
 *
 * ARCHITECTURE CHANGE:
 * - Assignments are stored in-memory only (no JSON file persistence)
 * - GitHub Projects is the source of truth
 * - Assignment data is derived from GitHub Projects on startup
 * - Process state (PIDs, worktrees) is ephemeral and tracked in-memory
 */

import { v4 as uuidv4 } from 'uuid';
import {
  Assignment,
  CreateAssignmentInput,
  UpdateAssignmentInput,
  AddWorkSessionInput,
  AssignmentStatus,
  LLMProvider,
} from '../types/index.js';
import { REVERSE_STATUS_MAPPING } from '../github/projects-api.js';

// Logger interface for conflict detection
interface Logger {
  warn(message: string): void;
  info(message: string): void;
  error(message: string): void;
}

// Default console logger
const defaultLogger: Logger = {
  warn: (msg) => console.warn(`[AssignmentManager] ${msg}`),
  info: (msg) => console.log(`[AssignmentManager] ${msg}`),
  error: (msg) => console.error(`[AssignmentManager] ${msg}`),
};

// Project API interface (to be implemented in Phase 1)
export interface ProjectAPI {
  getItemStatus(projectItemId: string): Promise<AssignmentStatus | null>;
  updateItemStatus(projectItemId: string, status: AssignmentStatus): Promise<void>;
  getProjectItemId(issueNumber: number): Promise<string | null>;
  updateAssignedInstance?(projectItemId: string, instanceId: string | null): Promise<void>;
  getItemFieldValue?(projectItemId: string, fieldName: string): Promise<any>;
  queryItems?(filters?: any): Promise<any>;
  getAllItems?(filters?: any): Promise<any>;
}

export class AssignmentManager {
  private assignments: Assignment[] = [];
  private projectAPI?: ProjectAPI;
  private logger: Logger;

  constructor(_projectPath: string, options?: { projectAPI?: ProjectAPI; logger?: Logger }) {
    this.projectAPI = options?.projectAPI;
    this.logger = options?.logger || defaultLogger;
  }

  /**
   * Initialize the assignment manager
   * No longer loads from file - assignments are in-memory only
   */
  async initialize(projectName: string, _projectPath: string): Promise<void> {
    this.logger.info(`Initialized AssignmentManager for project: ${projectName}`);
  }

  /**
   * Create a new assignment
   */
  async createAssignment(input: CreateAssignmentInput): Promise<Assignment> {
    const assignment: Assignment = {
      id: uuidv4(),
      issueNumber: input.issueNumber,
      issueTitle: input.issueTitle,
      issueBody: input.issueBody,
      llmProvider: input.llmProvider,
      llmInstanceId: `${input.llmProvider}-${uuidv4().slice(0, 8)}`,
      status: 'assigned',
      worktreePath: input.worktreePath,
      branchName: input.branchName,
      assignedAt: new Date().toISOString(),
      workSessions: [],
      metadata: {
        requiresTests: input.requiresTests ?? true,
        requiresCI: input.requiresCI ?? true,
        // NOTE: labels removed - read from GitHub/project instead
      },
    };

    this.assignments.push(assignment);
    return assignment;
  }

  /**
   * Get an assignment by ID
   */
  getAssignment(assignmentId: string): Assignment | undefined {
    return this.assignments.find((a) => a.id === assignmentId);
  }

  /**
   * Get an assignment by issue number
   */
  getAssignmentByIssue(issueNumber: number): Assignment | undefined {
    return this.assignments.find((a) => a.issueNumber === issueNumber);
  }

  /**
   * Get assignment by LLM instance ID
   */
  getAssignmentByLLMInstanceId(instanceId: string): Assignment | undefined {
    return this.assignments.find((a) => a.llmInstanceId === instanceId);
  }

  /**
   * Get assignments by status
   */
  getAssignmentsByStatus(status: AssignmentStatus): Assignment[] {
    return this.assignments.filter((a) => a.status === status);
  }

  /**
   * Get assignments by LLM provider
   */
  getAssignmentsByProvider(provider: LLMProvider): Assignment[] {
    return this.assignments.filter((a) => a.llmProvider === provider);
  }

  /**
   * Get all assignments
   */
  getAllAssignments(): Assignment[] {
    return [...this.assignments];
  }

  /**
   * Update an assignment
   */
  async updateAssignment(assignmentId: string, update: UpdateAssignmentInput): Promise<void> {
    const assignment = this.assignments.find((a) => a.id === assignmentId);
    if (!assignment) {
      throw new Error(`Assignment ${assignmentId} not found`);
    }

    // Update fields
    if (update.status !== undefined) {
      assignment.status = update.status;

      // Set timestamps based on status
      if (update.status === 'in-progress' && !assignment.startedAt) {
        assignment.startedAt = new Date().toISOString();
      } else if (update.status === 'dev-complete' && !assignment.completedAt) {
        assignment.completedAt = new Date().toISOString();
      } else if (update.status === 'merged' && !assignment.mergedAt) {
        assignment.mergedAt = new Date().toISOString();
      }
    }

    if (update.processId !== undefined) assignment.processId = update.processId;
    if (update.prNumber !== undefined) assignment.prNumber = update.prNumber;
    if (update.prUrl !== undefined) assignment.prUrl = update.prUrl;
    if (update.ciStatus !== undefined) assignment.ciStatus = update.ciStatus;
    if (update.lastActivity !== undefined) {
      assignment.lastActivity = update.lastActivity;
    } else {
      assignment.lastActivity = new Date().toISOString();
    }
  }

  /**
   * Add a work session to an assignment
   */
  async addWorkSession(assignmentId: string, session: AddWorkSessionInput): Promise<void> {
    const assignment = this.assignments.find((a) => a.id === assignmentId);
    if (!assignment) {
      throw new Error(`Assignment ${assignmentId} not found`);
    }

    assignment.workSessions.push({
      startedAt: session.startedAt || new Date().toISOString(),
      endedAt: session.endedAt,
      summary: session.summary,
      promptUsed: session.promptUsed,
    });

    assignment.lastActivity = new Date().toISOString();
  }

  /**
   * Update the last work session for an assignment
   */
  async updateLastWorkSession(
    assignmentId: string,
    update: Partial<AddWorkSessionInput>
  ): Promise<void> {
    const assignment = this.assignments.find((a) => a.id === assignmentId);
    if (!assignment) {
      throw new Error(`Assignment ${assignmentId} not found`);
    }

    if (assignment.workSessions.length === 0) {
      throw new Error(`No work sessions found for assignment ${assignmentId}`);
    }

    const lastSession = assignment.workSessions[assignment.workSessions.length - 1];

    if (update.endedAt !== undefined) lastSession.endedAt = update.endedAt;
    if (update.summary !== undefined) lastSession.summary = update.summary;
    if (update.promptUsed !== undefined) lastSession.promptUsed = update.promptUsed;

    assignment.lastActivity = new Date().toISOString();
  }

  /**
   * Delete an assignment
   */
  async deleteAssignment(assignmentId: string): Promise<void> {
    const index = this.assignments.findIndex((a) => a.id === assignmentId);
    if (index === -1) {
      throw new Error(`Assignment ${assignmentId} not found`);
    }

    this.assignments.splice(index, 1);
  }

  /**
   * Get count of active assignments (assigned or in-progress)
   * NOTE: This trusts the local in-memory state and does NOT sync from GitHub.
   * Use syncStatusFromGitHub() separately if you need to detect manual status changes.
   */
  async getActiveAssignmentsCount(provider: LLMProvider): Promise<number> {
    // Count in-memory assignments
    const localCount = this.assignments.filter(
      (a) => a.llmProvider === provider && (a.status === 'assigned' || a.status === 'in-progress')
    ).length;

    // If we have ProjectsAPI, also check GitHub for items with assigned instances
    // This handles cases where local cache is out of sync (e.g., deleted)
    if (this.projectAPI && this.projectAPI.getAllItems) {
      try {
        const allItems = await this.projectAPI.getAllItems();
        const assignedInstanceFieldName = 'Assigned Instance';

        // Count items in GitHub with assigned instances
        // NOTE: item.fieldValues is a Record<string, any>, NOT an array
        let githubCount = 0;
        for (const item of allItems) {
          // Check if assigned instance field has a value
          if (item.fieldValues) {
            const assignedValue = item.fieldValues[assignedInstanceFieldName];
            if (assignedValue && typeof assignedValue === 'string') {
              githubCount++;
            }
          }
        }

        // Return the maximum of local or GitHub count to be conservative
        return Math.max(localCount, githubCount);
      } catch (error) {
        // If GitHub query fails, fall back to local count
        this.logger.warn(`Failed to query GitHub for active count: ${error instanceof Error ? error.message : String(error)}`);
        return localCount;
      }
    }

    return localCount;
  }

  /**
   * Sync status from GitHub for all assignments (expensive operation)
   * Only call this periodically to detect manual status changes
   */
  async syncStatusFromGitHub(provider?: LLMProvider): Promise<void> {
    if (!this.projectAPI) return;

    const assignments = provider
      ? this.assignments.filter(a => a.llmProvider === provider)
      : this.assignments;

    for (const assignment of assignments) {
      if (assignment.projectItemId) {
        try {
          const projectStatus = await this.projectAPI.getItemStatus(assignment.projectItemId);
          // Only update if status is mapped (not null) and differs from current
          if (projectStatus !== null && projectStatus !== assignment.status) {
            assignment.status = projectStatus;
            assignment.lastActivity = new Date().toISOString();
            this.logger?.info(`Synced status from GitHub for #${assignment.issueNumber}: ${projectStatus}`);
          }
        } catch (error) {
          // If can't fetch status, keep cached value
          this.logger?.warn(`Could not sync status for assignment ${assignment.id}: ${error}`);
        }
      }
    }
  }

  /**
   * Comprehensive sync of all fields from GitHub Projects
   * - Syncs status AND assigned instance
   * - Removes orphaned local assignments
   * - Clears stale assigned instances in GitHub
   * - More efficient than syncStatusFromGitHub (uses bulk queries)
   */
  async syncAllFieldsFromGitHub(config?: {
    assignedInstanceFieldName?: string;
    readyStatuses?: string[];
    completeStatuses?: string[];
  }): Promise<{
    synced: number;
    conflicts: number;
    removed: number;
    clearedStale: number;
    errors: number;
  }> {
    if (!this.projectAPI) {
      this.logger.warn('No project API available for sync');
      return { synced: 0, conflicts: 0, removed: 0, clearedStale: 0, errors: 0 };
    }

    // Check if advanced methods are available
    if (!this.projectAPI.queryItems || !this.projectAPI.getItemFieldValue) {
      this.logger.warn('Project API does not support bulk queries, falling back to syncStatusFromGitHub');
      await this.syncStatusFromGitHub();
      return { synced: this.assignments.length, conflicts: 0, removed: 0, clearedStale: 0, errors: 0 };
    }

    const assignedInstanceFieldName = config?.assignedInstanceFieldName || 'Assigned Instance';
    const readyStatuses = config?.readyStatuses || ['Ready'];
    const completeStatuses = config?.completeStatuses || ['dev-complete', 'stage-ready', 'merged'];

    let synced = 0;
    let conflicts = 0;
    let removed = 0;
    let clearedStale = 0;
    let errors = 0;

    try {
      // Step 1: Query ALL items from GitHub with their fields (efficient bulk query with pagination)
      this.logger.info('Syncing all fields from GitHub Projects...');
      
      const allItems: any[] = [];
      let hasNextPage = true;
      let cursor: string | undefined = undefined;
      let pageCount = 0;

      // Paginate through all project items
      while (hasNextPage) {
        pageCount++;
        const result = await this.projectAPI.queryItems({ 
          limit: 100,
          cursor: cursor
        });

        allItems.push(...result.items);

        hasNextPage = result.hasNextPage;
        cursor = result.endCursor;

        if (hasNextPage) {
          this.logger.info(`  Fetched page ${pageCount} (${allItems.length} items so far)...`);
        }
      }

      this.logger.info(`Fetched ${allItems.length} total items from GitHub (${pageCount} page${pageCount > 1 ? 's' : ''})`);

      // NOTE: result.items[].fieldValues is a Record<string, any>, NOT an array
      // The ProjectsAPI transforms GraphQL's fieldValues.nodes[] into a flat object

      // Build a map of projectItemId → GitHub state
      const githubStateMap = new Map<string, {
        status: AssignmentStatus | null;
        assignedInstance: string | null;
        issueNumber?: number;
      }>();

      for (const item of allItems) {
        let status: AssignmentStatus | null = null;
        let assignedInstance: string | null = null;

        // Extract fields from fieldValues (it's a Record, not an array)
        if (item.fieldValues) {
          // Get status from fieldValues Record and convert from GitHub format to internal enum
          const statusValue = item.fieldValues['Status'];
          if (statusValue && typeof statusValue === 'string') {
            // Convert GitHub status ("In Progress") to internal enum ("in-progress")
            status = REVERSE_STATUS_MAPPING[statusValue] || null;
          }

          // Get assigned instance from fieldValues Record
          const assignedValue = item.fieldValues[assignedInstanceFieldName];
          if (assignedValue && typeof assignedValue === 'string') {
            assignedInstance = assignedValue;
          }
        }

        githubStateMap.set(item.id, {
          status,
          assignedInstance,
          issueNumber: item.content?.number,
        });
      }

      // Step 2: Sync in-memory assignments with GitHub state
      const assignmentsToRemove: string[] = [];

      for (const assignment of this.assignments) {
        if (!assignment.projectItemId) {
          this.logger.warn(`Assignment #${assignment.issueNumber} has no projectItemId, skipping`);
          continue;
        }

        const githubState = githubStateMap.get(assignment.projectItemId);

        if (!githubState) {
          // Assignment exists locally but not in GitHub - orphaned
          this.logger.warn(`Assignment #${assignment.issueNumber} (${assignment.projectItemId}) not found in GitHub, marking for removal`);
          assignmentsToRemove.push(assignment.id);
          removed++;
          continue;
        }

        // Check for conflicts
        let hasConflict = false;

        // Sync status (githubState.status is already converted to AssignmentStatus enum)
        if (githubState.status !== null && githubState.status !== assignment.status) {
          this.logger.warn(`Status conflict for #${assignment.issueNumber}: local=${assignment.status}, github=${githubState.status}`);
          assignment.status = githubState.status;
          assignment.lastActivity = new Date().toISOString();
          hasConflict = true;
          conflicts++;
        }

        // Sync assigned instance
        const localHasAssignment = !!assignment.llmInstanceId;
        const githubHasAssignment = !!githubState.assignedInstance;

        if (localHasAssignment !== githubHasAssignment) {
          this.logger.warn(`Assigned instance conflict for #${assignment.issueNumber}: local=${localHasAssignment}, github=${githubHasAssignment}`);

          if (!githubHasAssignment) {
            // GitHub cleared the assignment - remove local
            this.logger.info(`GitHub cleared assignment for #${assignment.issueNumber}, removing from local`);
            assignmentsToRemove.push(assignment.id);
            removed++;
            continue;
          }
          // If GitHub has assignment but local doesn't, that's unusual but we'll keep local state
          // since it contains process-specific info (worktree, etc)
          hasConflict = true;
          conflicts++;
        }

        if (hasConflict) {
          this.logger.info(`Synced #${assignment.issueNumber} from GitHub`);
        }

        synced++;
      }

      // Remove orphaned assignments
      for (const assignmentId of assignmentsToRemove) {
        await this.deleteAssignment(assignmentId);
      }

      // Step 3: Clear stale assigned instances in GitHub
      // Items that are in complete/ready statuses but still have assigned instance
      for (const [projectItemId, githubState] of githubStateMap.entries()) {
        if (!githubState.status || !githubState.assignedInstance) {
          continue;
        }

        const shouldNotHaveAssignment = [
          ...readyStatuses,
          ...completeStatuses,
        ].includes(githubState.status);

        if (shouldNotHaveAssignment) {
          this.logger.warn(`Clearing stale assigned instance from GitHub for issue #${githubState.issueNumber} (status: ${githubState.status})`);
          try {
            if (this.projectAPI.updateAssignedInstance) {
              await this.projectAPI.updateAssignedInstance(projectItemId, null);
              clearedStale++;
            }
          } catch (error) {
            this.logger.error(`Failed to clear stale assigned instance: ${error instanceof Error ? error.message : String(error)}`);
            errors++;
          }
        }
      }

      this.logger.info(
        `Sync complete: ${synced} synced, ${conflicts} conflicts, ${removed} removed, ${clearedStale} stale cleared, ${errors} errors`
      );

      return { synced, conflicts, removed, clearedStale, errors };
    } catch (error) {
      this.logger.error(`Failed to sync from GitHub: ${error instanceof Error ? error.message : String(error)}`);
      errors++;
      return { synced, conflicts, removed, clearedStale, errors };
    }
  }

  /**
   * Check if an issue is already assigned
   */
  isIssueAssigned(issueNumber: number): boolean {
    return this.assignments.some((a) => a.issueNumber === issueNumber);
  }

  // ============================================================
  // CONFLICT DETECTION & PROJECT SYNC (Phase 0)
  // ============================================================

  /**
   * Load an assignment with conflict detection
   * Checks project status and resolves conflicts (project wins)
   */
  async loadAssignmentWithConflictDetection(issueNumber: number): Promise<Assignment | undefined> {
    const assignment = this.getAssignmentByIssue(issueNumber);
    if (!assignment) return undefined;

    // If no project API or no projectItemId, return assignment as-is
    if (!this.projectAPI || !assignment.projectItemId) {
      return assignment;
    }

    try {
      // Fetch current status from project
      const projectStatus = await this.projectAPI.getItemStatus(assignment.projectItemId);

      // If status is unmapped (null), don't sync - keep local status
      if (projectStatus === null) {
        return assignment;
      }

      // Detect status conflict
      if (assignment.status !== projectStatus) {
        this.logger.warn(
          `Status conflict detected for #${issueNumber}: ` +
            `local="${assignment.status}", project="${projectStatus}" → Using project status`
        );

        // Project wins - update local to match
        await this.updateAssignment(assignment.id, {
          status: projectStatus,
          lastActivity: new Date().toISOString(),
        });

        // Reload assignment with updated status
        return this.getAssignmentByIssue(issueNumber);
      }

      return assignment;
    } catch (error) {
      this.logger.error(
        `Failed to check project status for #${issueNumber}: ${error instanceof Error ? error.message : String(error)}`
      );
      // Fall back to local status on error
      return assignment;
    }
  }

  /**
   * Update assignment status with sync to project
   * Updates local first, then syncs to project if API available
   */
  async updateStatusWithSync(
    assignmentId: string,
    newStatus: AssignmentStatus
  ): Promise<void> {
    const assignment = this.assignments.find((a) => a.id === assignmentId);
    if (!assignment) {
      throw new Error(`Assignment ${assignmentId} not found`);
    }

    const oldStatus = assignment.status;

    // Skip if status hasn't changed
    if (oldStatus === newStatus) {
      return;
    }

    // Update local first (local operation is fast and reliable)
    await this.updateAssignment(assignmentId, { status: newStatus });

    this.logger.info(
      `Status updated for #${assignment.issueNumber}: ${oldStatus} → ${newStatus}`
    );

    // Sync to project if API available and assignment has projectItemId
    if (this.projectAPI && assignment.projectItemId) {
      try {
        await this.projectAPI.updateItemStatus(assignment.projectItemId, newStatus);
        this.logger.info(`Synced status to project for #${assignment.issueNumber}`);
      } catch (error) {
        this.logger.error(
          `Failed to sync status to project for #${assignment.issueNumber}: ` +
            `${error instanceof Error ? error.message : String(error)}`
        );
        // Don't throw - local update succeeded, project sync failed
        // This allows degraded operation when project API is unavailable
      }
    }

    // Clear Assigned Instance when work is complete (dev-complete, merged)
    // The LLM process is finished and slot should be freed
    if ((newStatus === 'dev-complete' || newStatus === 'merged') && this.projectAPI && assignment.projectItemId) {
      try {
        await this.updateAssignedInstanceWithSync(assignmentId, null);
        this.logger.info(`Cleared assigned instance for #${assignment.issueNumber} (status: ${newStatus})`);
      } catch (error) {
        this.logger.warn(
          `Failed to clear assigned instance for #${assignment.issueNumber}: ` +
            `${error instanceof Error ? error.message : String(error)}`
        );
        // Don't throw - status update succeeded, instance clearing failed
      }
    }
  }

  /**
   * Update assigned instance with sync to project
   * Updates the "Assigned Instance" field in the project to track which LLM instance is working
   */
  async updateAssignedInstanceWithSync(
    assignmentId: string,
    instanceId: string | null
  ): Promise<void> {
    const assignment = this.assignments.find((a) => a.id === assignmentId);
    if (!assignment) {
      throw new Error(`Assignment ${assignmentId} not found`);
    }

    // Sync to project if API available and assignment has projectItemId
    if (this.projectAPI && assignment.projectItemId) {
      try {
        // Check if projectAPI has the updateAssignedInstance method
        if ('updateAssignedInstance' in this.projectAPI && this.projectAPI.updateAssignedInstance) {
          await this.projectAPI.updateAssignedInstance(
            assignment.projectItemId,
            instanceId
          );
          this.logger.info(
            `Updated assigned instance to "${instanceId || '(none)'}" for #${assignment.issueNumber}`
          );
        }
      } catch (error) {
        this.logger.error(
          `Failed to update assigned instance in project for #${assignment.issueNumber}: ` +
            `${error instanceof Error ? error.message : String(error)}`
        );
        // Don't throw - this is a nice-to-have feature
      }
    }
  }

  /**
   * Ensure assignment has projectItemId
   * Fetches from project API if not set
   */
  async ensureProjectItemId(assignmentId: string): Promise<void> {
    const assignment = this.assignments.find((a) => a.id === assignmentId);
    if (!assignment) {
      throw new Error(`Assignment ${assignmentId} not found`);
    }

    // Already has projectItemId
    if (assignment.projectItemId) {
      return;
    }

    // No project API available
    if (!this.projectAPI) {
      this.logger.warn(
        `Cannot fetch projectItemId for #${assignment.issueNumber}: No project API configured`
      );
      return;
    }

    try {
      const projectItemId = await this.projectAPI.getProjectItemId(assignment.issueNumber);
      if (projectItemId) {
        assignment.projectItemId = projectItemId;
        this.logger.info(
          `Linked #${assignment.issueNumber} to project item ${projectItemId}`
        );
      } else {
        this.logger.warn(
          `Issue #${assignment.issueNumber} not found in project`
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to fetch projectItemId for #${assignment.issueNumber}: ` +
          `${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Detect and resolve conflicts for all assignments
   * Useful for migration or periodic reconciliation
   */
  async reconcileAllAssignments(): Promise<{
    total: number;
    conflicts: number;
    errors: number;
  }> {
    if (!this.projectAPI) {
      this.logger.warn('No project API configured, skipping reconciliation');
      return { total: 0, conflicts: 0, errors: 0 };
    }

    let total = 0;
    let conflicts = 0;
    let errors = 0;

    for (const assignment of this.assignments) {
      total++;

      if (!assignment.projectItemId) {
        this.logger.info(`#${assignment.issueNumber} has no projectItemId, attempting to fetch`);
        await this.ensureProjectItemId(assignment.id);
        continue;
      }

      try {
        const projectStatus = await this.projectAPI.getItemStatus(assignment.projectItemId);

        // Skip unmapped statuses (Needs More Info, Evaluated, etc)
        if (projectStatus !== null && assignment.status !== projectStatus) {
          conflicts++;
          this.logger.warn(
            `Reconciling #${assignment.issueNumber}: ${assignment.status} → ${projectStatus}`
          );

          await this.updateAssignment(assignment.id, {
            status: projectStatus,
            lastActivity: new Date().toISOString(),
          });
        }
      } catch (error) {
        errors++;
        this.logger.error(
          `Failed to reconcile #${assignment.issueNumber}: ` +
            `${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    this.logger.info(
      `Reconciliation complete: ${total} assignments, ${conflicts} conflicts resolved, ${errors} errors`
    );

    return { total, conflicts, errors };
  }
}