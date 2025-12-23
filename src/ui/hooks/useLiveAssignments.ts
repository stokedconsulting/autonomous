/**
 * useLiveAssignments - Hook for loading and managing live assignments
 */

import { useEffect } from 'react';
import { useAssignmentStore } from '../stores/assignment-store.js';
import { AssignmentManager } from '../../core/assignment-manager.js';
import { basename } from 'path';

export function useLiveAssignments() {
  const { assignments, loading, error, setAssignments, setLoading, setError } = useAssignmentStore();

  useEffect(() => {
    const loadAssignments = async () => {
      setLoading(true);
      try {
        const cwd = process.cwd();
        const projectName = basename(cwd);
        const manager = new AssignmentManager(cwd);

        await manager.initialize(projectName, cwd);
        const allAssignments = manager.getAllAssignments();
        setAssignments(allAssignments);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load assignments');
      }
    };

    loadAssignments();

    // Refresh every 5 seconds for live updates
    const interval = setInterval(loadAssignments, 5000);
    return () => clearInterval(interval);
  }, [setAssignments, setLoading, setError]);

  return { assignments, loading, error };
}
