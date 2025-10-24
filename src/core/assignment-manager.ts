/**
 * Assignment Manager - Handles autonomous-assignments.json
 *
 * SYNC STRATEGY:
 * - Local JSON is source of truth for process state (worktrees, sessions, timestamps)
 * - GitHub Projects is source of truth for user-visible status
 * - Conflicts are detected and resolved (project wins for status)
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  Assignment,
  AssignmentsFile,
  CreateAssignmentInput,
  UpdateAssignmentInput,
  AddWorkSessionInput,
  AssignmentStatus,
  LLMProvider,
} from '../types/index.js';

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
  getItemStatus(projectItemId: string): Promise<AssignmentStatus>;
  updateItemStatus(projectItemId: string, status: AssignmentStatus): Promise<void>;
  getProjectItemId(issueNumber: number): Promise<string | null>;
}

export class AssignmentManager {
  private filePath: string;
  private data: AssignmentsFile | null = null;
  private projectAPI?: ProjectAPI;
  private logger: Logger;

  constructor(projectPath: string, options?: { projectAPI?: ProjectAPI; logger?: Logger }) {
    this.filePath = join(projectPath, 'autonomous-assignments.json');
    this.projectAPI = options?.projectAPI;
    this.logger = options?.logger || defaultLogger;
  }

  /**
   * Initialize or load the assignments file
   */
  async initialize(projectName: string, projectPath: string): Promise<void> {
    try {
      await this.load();
    } catch (error) {
      // File doesn't exist, create it
      this.data = {
        version: '1.0.0',
        projectName,
        projectPath,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        assignments: [],
      };
      await this.save();
    }
  }

  /**
   * Load assignments from file
   */
  async load(): Promise<void> {
    const content = await fs.readFile(this.filePath, 'utf-8');
    this.data = JSON.parse(content);
  }

  /**
   * Save assignments to file
   */
  async save(): Promise<void> {
    if (!this.data) {
      throw new Error('Assignment data not initialized');
    }

    this.data.updatedAt = new Date().toISOString();
    await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  /**
   * Create a new assignment
   */
  async createAssignment(input: CreateAssignmentInput): Promise<Assignment> {
    if (!this.data) {
      throw new Error('Assignment manager not initialized');
    }

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

    this.data.assignments.push(assignment);
    await this.save();

    return assignment;
  }

  /**
   * Get an assignment by ID
   */
  getAssignment(assignmentId: string): Assignment | undefined {
    if (!this.data) return undefined;
    return this.data.assignments.find((a) => a.id === assignmentId);
  }

  /**
   * Get an assignment by issue number
   */
  getAssignmentByIssue(issueNumber: number): Assignment | undefined {
    if (!this.data) return undefined;
    return this.data.assignments.find((a) => a.issueNumber === issueNumber);
  }

  /**
   * Get assignments by status
   */
  getAssignmentsByStatus(status: AssignmentStatus): Assignment[] {
    if (!this.data) return [];
    return this.data.assignments.filter((a) => a.status === status);
  }

  /**
   * Get assignments by LLM provider
   */
  getAssignmentsByProvider(provider: LLMProvider): Assignment[] {
    if (!this.data) return [];
    return this.data.assignments.filter((a) => a.llmProvider === provider);
  }

  /**
   * Get all assignments
   */
  getAllAssignments(): Assignment[] {
    if (!this.data) return [];
    return [...this.data.assignments];
  }

  /**
   * Update an assignment
   */
  async updateAssignment(assignmentId: string, update: UpdateAssignmentInput): Promise<void> {
    if (!this.data) {
      throw new Error('Assignment manager not initialized');
    }

    const assignment = this.data.assignments.find((a) => a.id === assignmentId);
    if (!assignment) {
      throw new Error(`Assignment ${assignmentId} not found`);
    }

    // Update fields
    if (update.status !== undefined) {
      assignment.status = update.status;

      // Set timestamps based on status
      if (update.status === 'in-progress' && !assignment.startedAt) {
        assignment.startedAt = new Date().toISOString();
      } else if (update.status === 'llm-complete' && !assignment.completedAt) {
        assignment.completedAt = new Date().toISOString();
      } else if (update.status === 'merged' && !assignment.mergedAt) {
        assignment.mergedAt = new Date().toISOString();
      }
    }

    if (update.prNumber !== undefined) assignment.prNumber = update.prNumber;
    if (update.prUrl !== undefined) assignment.prUrl = update.prUrl;
    if (update.ciStatus !== undefined) assignment.ciStatus = update.ciStatus;
    if (update.lastActivity !== undefined) {
      assignment.lastActivity = update.lastActivity;
    } else {
      assignment.lastActivity = new Date().toISOString();
    }

    await this.save();
  }

  /**
   * Add a work session to an assignment
   */
  async addWorkSession(assignmentId: string, session: AddWorkSessionInput): Promise<void> {
    if (!this.data) {
      throw new Error('Assignment manager not initialized');
    }

    const assignment = this.data.assignments.find((a) => a.id === assignmentId);
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

    await this.save();
  }

  /**
   * Update the last work session for an assignment
   */
  async updateLastWorkSession(
    assignmentId: string,
    update: Partial<AddWorkSessionInput>
  ): Promise<void> {
    if (!this.data) {
      throw new Error('Assignment manager not initialized');
    }

    const assignment = this.data.assignments.find((a) => a.id === assignmentId);
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

    await this.save();
  }

  /**
   * Delete an assignment
   */
  async deleteAssignment(assignmentId: string): Promise<void> {
    if (!this.data) {
      throw new Error('Assignment manager not initialized');
    }

    const index = this.data.assignments.findIndex((a) => a.id === assignmentId);
    if (index === -1) {
      throw new Error(`Assignment ${assignmentId} not found`);
    }

    this.data.assignments.splice(index, 1);
    await this.save();
  }

  /**
   * Get active assignments count for a provider
   */
  getActiveAssignmentsCount(provider: LLMProvider): number {
    if (!this.data) return 0;
    return this.data.assignments.filter(
      (a) => a.llmProvider === provider && (a.status === 'assigned' || a.status === 'in-progress')
    ).length;
  }

  /**
   * Check if an issue is already assigned
   */
  isIssueAssigned(issueNumber: number): boolean {
    if (!this.data) return false;
    return this.data.assignments.some((a) => a.issueNumber === issueNumber);
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
    if (!this.data) {
      throw new Error('Assignment manager not initialized');
    }

    const assignment = this.data.assignments.find((a) => a.id === assignmentId);
    if (!assignment) {
      throw new Error(`Assignment ${assignmentId} not found`);
    }

    const oldStatus = assignment.status;

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
  }

  /**
   * Ensure assignment has projectItemId
   * Fetches from project API if not set
   */
  async ensureProjectItemId(assignmentId: string): Promise<void> {
    if (!this.data) {
      throw new Error('Assignment manager not initialized');
    }

    const assignment = this.data.assignments.find((a) => a.id === assignmentId);
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
        await this.save();
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
    if (!this.data) {
      throw new Error('Assignment manager not initialized');
    }

    if (!this.projectAPI) {
      this.logger.warn('No project API configured, skipping reconciliation');
      return { total: 0, conflicts: 0, errors: 0 };
    }

    let total = 0;
    let conflicts = 0;
    let errors = 0;

    for (const assignment of this.data.assignments) {
      total++;

      if (!assignment.projectItemId) {
        this.logger.info(`#${assignment.issueNumber} has no projectItemId, attempting to fetch`);
        await this.ensureProjectItemId(assignment.id);
        continue;
      }

      try {
        const projectStatus = await this.projectAPI.getItemStatus(assignment.projectItemId);

        if (assignment.status !== projectStatus) {
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
