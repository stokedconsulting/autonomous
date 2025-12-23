/**
 * Dashboard - Main dashboard organism combining summary, assignments, and activity
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';
import { SummaryBar } from '../molecules/SummaryBar.js';
import { AssignmentCard } from '../molecules/AssignmentCard.js';
import { ProgressTracker } from '../molecules/ProgressTracker.js';
import { Divider } from '../atoms/Divider.js';
import { useAssignmentStore } from '../stores/assignment-store.js';
import { useUIStore } from '../stores/ui-store.js';
import { useKeyboardNav } from '../hooks/useKeyboardNav.js';

export function Dashboard(): React.ReactElement {
  const assignments = useAssignmentStore((s) => s.assignments);
  const loading = useAssignmentStore((s) => s.loading);
  const error = useAssignmentStore((s) => s.error);
  const selectedIndex = useUIStore((s) => s.selectedIndex);
  const navigate = useUIStore((s) => s.navigate);

  // Keyboard navigation
  useKeyboardNav({
    enableVimNav: true,
    maxItems: assignments.length,
    handlers: [
      {
        key: 'enter',
        handler: () => {
          const selected = assignments[selectedIndex];
          if (selected) {
            navigate('review');
          }
        },
      },
      {
        key: 'r',
        handler: () => {
          useAssignmentStore.getState().refresh();
        },
      },
    ],
  });

  // Calculate pipeline steps
  const pipelineSteps = [
    {
      label: 'Assigned',
      status: assignments.some((a) => a.status === 'assigned') ? 'active' : 'complete',
    },
    {
      label: 'In Progress',
      status: assignments.some((a) => a.status === 'in-progress') ? 'active' :
              assignments.some((a) => a.status === 'assigned') ? 'pending' : 'complete',
    },
    {
      label: 'Review',
      status: assignments.some((a) => a.status === 'in-review') ? 'active' :
              assignments.every((a) => ['dev-complete', 'merged', 'stage-ready'].includes(a.status)) ? 'complete' : 'pending',
    },
    {
      label: 'Complete',
      status: assignments.every((a) => a.status === 'merged') ? 'complete' :
              assignments.some((a) => a.status === 'dev-complete') ? 'active' : 'pending',
    },
  ] as const;

  if (loading) {
    return (
      <Box flexDirection="column" padding={1}>
        <Box gap={1}>
          <Spinner label="Loading assignments..." />
        </Box>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">✗ Error: {error}</Text>
        <Text dimColor>Press 'r' to retry</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      {/* Summary Bar */}
      <SummaryBar assignments={assignments} />

      {/* Pipeline Progress */}
      <Box marginY={1}>
        <ProgressTracker steps={[...pipelineSteps]} showConnectors />
      </Box>

      <Divider title="Active Assignments" />

      {/* Assignment List */}
      {assignments.length === 0 ? (
        <Box padding={1}>
          <Text dimColor>No active assignments. Press 'n' to start a new one.</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {assignments.map((assignment, index) => (
            <AssignmentCard
              key={assignment.issueNumber}
              assignment={assignment}
              isFocused={index === selectedIndex}
              showDetails={index === selectedIndex}
            />
          ))}
        </Box>
      )}

      {/* Footer hints */}
      <Box marginTop={1}>
        <Text dimColor>
          j/k: navigate │ Enter: view details │ r: refresh │ ?: help
        </Text>
      </Box>
    </Box>
  );
}
