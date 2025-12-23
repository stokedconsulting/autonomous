/**
 * Assignment Store - Assignment state management
 */

import { create } from 'zustand';
import type { Assignment, AssignmentStatus } from '../../types/index.js';

interface AssignmentState {
  // State
  assignments: Assignment[];
  loading: boolean;
  error: string | null;
  currentProjectId: string | null;

  // Computed selectors (implemented as functions)
  getByStatus: (status: AssignmentStatus) => Assignment[];
  getActive: () => Assignment[];
  getById: (issueNumber: number) => Assignment | undefined;

  // Actions
  setAssignments: (assignments: Assignment[]) => void;
  updateAssignment: (issueNumber: number, update: Partial<Assignment>) => void;
  addAssignment: (assignment: Assignment) => void;
  removeAssignment: (issueNumber: number) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  loadAssignments: (projectId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export const useAssignmentStore = create<AssignmentState>((set, get) => ({
  assignments: [],
  loading: false,
  error: null,
  currentProjectId: null,

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
      // TODO: Connect to actual data source
      // For now, simulate loading
      await new Promise(resolve => setTimeout(resolve, 500));
      // Mock data would be set here
      set({ loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load assignments', loading: false });
    }
  },

  refresh: async () => {
    const projectId = get().currentProjectId;
    if (projectId) {
      await get().loadAssignments(projectId);
    }
  },
}));
