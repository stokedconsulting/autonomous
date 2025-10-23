/**
 * Assignment Manager - Handles autonomous-assignments.json
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

export class AssignmentManager {
  private filePath: string;
  private data: AssignmentsFile | null = null;

  constructor(projectPath: string) {
    this.filePath = join(projectPath, 'autonomous-assignments.json');
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
        labels: input.labels ?? [],
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
}
