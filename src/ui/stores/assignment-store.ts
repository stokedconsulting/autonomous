/**
 * Assignment Store - Assignment state management with project grouping
 */

import { create } from 'zustand';
import { AssignmentManager } from '../../core/assignment-manager.js';
import { basename } from 'path';
import { appendFileSync } from 'fs';
import { join } from 'path';
import type { Assignment, AssignmentStatus } from '../../types/index.js';

// Helper to log to file
const logToFile = (message: string) => {
  try {
    const logPath = join(process.cwd(), '.autonomous', 'ui-debug.log');
    const timestamp = new Date().toISOString();
    appendFileSync(logPath, `[${timestamp}] ${message}\n`);
  } catch (err) {
    // Ignore logging errors
  }
};

export interface ProjectGroup {
  projectNumber: number;
  projectName: string;
  assignments: Assignment[];
  isExpanded: boolean;
}

interface AssignmentState {
  // State
  assignments: Assignment[];
  loading: boolean;
  error: string | null;
  currentProjectId: string | null;
  projectOrder: number[]; // Ordered list of project numbers
  expandedProjects: Set<number>; // Which projects are expanded
  assignmentManager: AssignmentManager | null;

  // Computed selectors (implemented as functions)
  getByStatus: (status: AssignmentStatus) => Assignment[];
  getActive: () => Assignment[];
  getById: (issueNumber: number) => Assignment | undefined;
  getGroupedByProject: () => ProjectGroup[];

  // Actions
  setAssignments: (assignments: Assignment[]) => void;
  updateAssignment: (issueNumber: number, update: Partial<Assignment>) => void;
  addAssignment: (assignment: Assignment) => void;
  removeAssignment: (issueNumber: number) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  loadAssignments: (projectId: string) => Promise<void>;
  refresh: () => Promise<void>;

  // Project grouping actions
  toggleProject: (projectNumber: number) => void;
  expandAllProjects: () => void;
  collapseAllProjects: () => void;
  setProjectOrder: (order: number[]) => void;
  moveProjectUp: (projectNumber: number) => void;
  moveProjectDown: (projectNumber: number) => void;

  // Batch unassignment actions
  unassignProject: (projectNumber: number) => Promise<void>;
  unassignPhase: (phaseIssueNumber: number) => Promise<void>;
}

export const useAssignmentStore = create<AssignmentState>((set, get) => ({
  assignments: [],
  loading: false,
  error: null,
  currentProjectId: null,
  projectOrder: [],
  expandedProjects: new Set(),
  assignmentManager: null,

  getByStatus: (status) => {
    return get().assignments.filter(a => a.status === status);
  },

  getActive: () => {
    return get().assignments.filter(a =>
      a.status === 'in-progress' || a.status === 'assigned'
    );
  },

  getById: (issueNumber) => {
    return get().assignments.find(a => a.issueNumber === issueNumber);
  },

  getGroupedByProject: () => {
    const { assignments, projectOrder, expandedProjects } = get();

    // Group assignments by project number
    const grouped = new Map<number, Assignment[]>();
    const projectNames = new Map<number, string>();

    assignments.forEach(assignment => {
      const projectNum = assignment.projectNumber ?? 0;
      if (!grouped.has(projectNum)) {
        grouped.set(projectNum, []);

        // Extract project name from issue title (look for [...] pattern)
        let projectName = projectNum === 0 ? 'Unassigned' : `Project ${projectNum}`;
        if (assignment.issueTitle) {
          const match = assignment.issueTitle.match(/^\[(.*?)\]/);
          if (match) {
            projectName = match[1];
          }
        }
        projectNames.set(projectNum, projectName);
      }
      grouped.get(projectNum)!.push(assignment);
    });

    // Create ordered project groups
    const allProjectNums = Array.from(grouped.keys());
    const orderedProjectNums = projectOrder.length > 0
      ? [...projectOrder.filter(p => grouped.has(p)), ...allProjectNums.filter(p => !projectOrder.includes(p))]
      : allProjectNums.sort((a, b) => a - b);

    return orderedProjectNums.map(projectNum => ({
      projectNumber: projectNum,
      projectName: projectNames.get(projectNum) ?? `Project ${projectNum}`,
      assignments: grouped.get(projectNum) ?? [],
      isExpanded: expandedProjects.has(projectNum),
    }));
  },

  setAssignments: (assignments) => set({ assignments, loading: false, error: null }),

  updateAssignment: (issueNumber, update) => set((state) => ({
    assignments: state.assignments.map(a =>
      a.issueNumber === issueNumber ? { ...a, ...update } : a
    ),
  })),

  addAssignment: (assignment) => set((state) => ({
    assignments: [...state.assignments, assignment],
  })),

  removeAssignment: (issueNumber) => set((state) => ({
    assignments: state.assignments.filter(a => a.issueNumber !== issueNumber),
  })),

  setLoading: (loading) => set({ loading }),

  setError: (error) => set({ error, loading: false }),

  loadAssignments: async (projectId: string) => {
    set({ loading: true, error: null, currentProjectId: projectId });
    try {
      // Load assignments using AssignmentManager (same as orchestrator)
      const cwd = process.cwd();
      const projectName = basename(cwd);
      const manager = new AssignmentManager(cwd);

      await manager.initialize(projectName, cwd);
      const assignments = manager.getAllAssignments();

      // NOTE: projectNumber should be set when assignments are created
      // Projects are discovered from assignments, not from config

      // Auto-expand projects with active assignments ONLY if there's exactly one such project
      const activeProjectNumbers = new Set<number>();
      assignments.forEach(a => {
        if (a.status === 'in-progress' || a.status === 'assigned') {
          activeProjectNumbers.add(a.projectNumber ?? 0);
        }
      });

      // Only expand if there's exactly one project with active work
      const shouldExpand = activeProjectNumbers.size === 1 ? activeProjectNumbers : new Set<number>();

      set({
        assignments,
        loading: false,
        assignmentManager: manager,
        expandedProjects: shouldExpand,
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load assignments', loading: false });
    }
  },

  refresh: async () => {
    const { currentProjectId, assignmentManager } = get();
    if (!assignmentManager || !currentProjectId) {
      await get().loadAssignments(currentProjectId ?? 'current');
      return;
    }

    try {
      set({ loading: true });
      const assignments = assignmentManager.getAllAssignments();
      set({ assignments, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to refresh', loading: false });
    }
  },

  // Project grouping actions
  toggleProject: (projectNumber) => set((state) => {
    const newExpanded = new Set(state.expandedProjects);
    if (newExpanded.has(projectNumber)) {
      newExpanded.delete(projectNumber);
    } else {
      newExpanded.add(projectNumber);
    }
    return { expandedProjects: newExpanded };
  }),

  expandAllProjects: () => set((state) => {
    const projectNums = new Set(state.assignments.map(a => a.projectNumber ?? 0));
    return { expandedProjects: projectNums };
  }),

  collapseAllProjects: () => set({ expandedProjects: new Set() }),

  setProjectOrder: (order) => set({ projectOrder: order }),

  moveProjectUp: (projectNumber) => set((state) => {
    const { projectOrder } = state;
    const index = projectOrder.indexOf(projectNumber);
    if (index > 0) {
      const newOrder = [...projectOrder];
      [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
      return { projectOrder: newOrder };
    }
    return state;
  }),

  moveProjectDown: (projectNumber) => set((state) => {
    const { projectOrder } = state;
    const index = projectOrder.indexOf(projectNumber);
    if (index >= 0 && index < projectOrder.length - 1) {
      const newOrder = [...projectOrder];
      [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
      return { projectOrder: newOrder };
    }
    return state;
  }),

  // Batch unassignment actions
  unassignProject: async (projectNumber) => {
    const { assignments, assignmentManager } = get();

    logToFile(`unassignProject called for project #${projectNumber}`);
    logToFile(`Total assignments: ${assignments.length}`);
    logToFile(`Assignment manager exists: ${!!assignmentManager}`);

    if (!assignmentManager) {
      logToFile('ERROR: Assignment manager not initialized');
      set({ error: 'Assignment manager not initialized', loading: false });
      return;
    }

    try {
      set({ loading: true });
      // Filter assignments matching the project number (handle null/undefined like grouping does)
      const projectAssignments = assignments.filter(a => (a.projectNumber ?? 0) === projectNumber);

      logToFile(`Found ${projectAssignments.length} assignments for project #${projectNumber}`);
      projectAssignments.forEach(a => {
        logToFile(`  - Assignment ${a.id}: issue #${a.issueNumber} (${a.issueTitle}) - projectNumber: ${a.projectNumber}`);
      });

      if (projectAssignments.length === 0) {
        logToFile('WARN: No assignments found for this project');
        set({ loading: false });
        return;
      }

      // Delete all assignments for this project
      logToFile('Starting deletion...');
      await Promise.all(
        projectAssignments.map(async (a) => {
          logToFile(`Deleting assignment ${a.id} (issue #${a.issueNumber})`);
          return assignmentManager.deleteAssignment(a.id);
        })
      );

      // Reload assignments
      const updatedAssignments = assignmentManager.getAllAssignments();
      logToFile(`Deletion complete. Reloaded: ${updatedAssignments.length} total assignments`);
      set({ assignments: updatedAssignments, loading: false });
    } catch (err) {
      logToFile(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
      if (err instanceof Error && err.stack) {
        logToFile(`Stack: ${err.stack}`);
      }
      set({ error: err instanceof Error ? err.message : 'Failed to unassign project', loading: false });
    }
  },

  unassignPhase: async (phaseIssueNumber) => {
    const { assignments, assignmentManager } = get();
    if (!assignmentManager) return;

    try {
      set({ loading: true });

      // Find phase master assignment
      const phaseMaster = assignments.find(a =>
        a.issueNumber === phaseIssueNumber && a.metadata?.isPhaseMaster
      );

      if (!phaseMaster) {
        set({ error: 'Phase master not found', loading: false });
        return;
      }

      // Delete phase master and all assignments in the same project
      // TODO: In the future, we could track phase relationships more explicitly
      const phaseAssignments = assignments.filter(a =>
        (a.projectNumber ?? 0) === (phaseMaster.projectNumber ?? 0)
      );

      await Promise.all(
        phaseAssignments.map(a => assignmentManager.deleteAssignment(a.id))
      );

      // Reload assignments
      const updatedAssignments = assignmentManager.getAllAssignments();
      set({ assignments: updatedAssignments, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to unassign phase', loading: false });
    }
  },
}));
