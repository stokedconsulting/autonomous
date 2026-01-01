/**
 * Dashboard - Main dashboard with hierarchical project grouping
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';
import { SummaryBar } from '../molecules/SummaryBar.js';
import { ProjectGroup } from '../molecules/ProjectGroup.js';
import { ProgressTracker } from '../molecules/ProgressTracker.js';
import { Divider } from '../atoms/Divider.js';
import { useAssignmentStore } from '../stores/assignment-store.js';
import { useUIStore } from '../stores/ui-store.js';
import { useKeyboardNav } from '../hooks/useKeyboardNav.js';

export function Dashboard(): React.ReactElement {
  const assignments = useAssignmentStore((s) => s.assignments);
  const getGroupedByProject = useAssignmentStore((s) => s.getGroupedByProject);
  const toggleProject = useAssignmentStore((s) => s.toggleProject);
  const unassignProject = useAssignmentStore((s) => s.unassignProject);
  const moveProjectUp = useAssignmentStore((s) => s.moveProjectUp);
  const moveProjectDown = useAssignmentStore((s) => s.moveProjectDown);
  const refresh = useAssignmentStore((s) => s.refresh);
  const loading = useAssignmentStore((s) => s.loading);
  const error = useAssignmentStore((s) => s.error);
  const selectedIndex = useUIStore((s) => s.selectedIndex);
  const navigate = useUIStore((s) => s.navigate);

  const projectGroups = getGroupedByProject();

  // Calculate viewport constraints
  const terminalHeight = process.stdout.rows || 24;
  const fixedContentHeight = 10; // Header + summary + progress + divider + footer
  const availableHeight = Math.max(terminalHeight - fixedContentHeight, 5);

  // Build flat list of items for navigation (projects + expanded assignments)
  const flatItems: Array<{ type: 'project' | 'assignment'; projectNumber: number; issueNumber?: number }> = [];
  projectGroups.forEach(group => {
    flatItems.push({ type: 'project', projectNumber: group.projectNumber });
    if (group.isExpanded) {
      group.assignments.forEach(assignment => {
        flatItems.push({ type: 'assignment', projectNumber: group.projectNumber, issueNumber: assignment.issueNumber });
      });
    }
  });

  // Keyboard navigation
  useKeyboardNav({
    enableVimNav: true,
    maxItems: flatItems.length,
    handlers: [
      {
        key: 'space',
        handler: () => {
          const item = flatItems[selectedIndex];
          if (item && item.type === 'project') {
            toggleProject(item.projectNumber);
          }
        },
      },
      {
        key: 'enter',
        handler: () => {
          const item = flatItems[selectedIndex];
          if (item && item.type === 'assignment') {
            navigate('review');
          } else if (item && item.type === 'project') {
            toggleProject(item.projectNumber);
          }
        },
      },
      {
        key: 'x',
        handler: async () => {
          const item = flatItems[selectedIndex];
          if (item && item.type === 'project') {
            await unassignProject(item.projectNumber);
          }
        },
      },
      {
        key: 'K', // Shift+k to move project up
        handler: () => {
          const item = flatItems[selectedIndex];
          if (item && item.type === 'project') {
            moveProjectUp(item.projectNumber);
          }
        },
      },
      {
        key: 'J', // Shift+j to move project down
        handler: () => {
          const item = flatItems[selectedIndex];
          if (item && item.type === 'project') {
            moveProjectDown(item.projectNumber);
          }
        },
      },
      {
        key: 'r',
        handler: async () => {
          await refresh();
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

      {/* Project Groups */}
      {projectGroups.length === 0 ? (
        <Box padding={1}>
          <Text dimColor>No active assignments. Press 'n' to start a new one.</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {/* Calculate viewport window */}
          {(() => {
            // Estimate lines per group (header:2, each assignment:3 when expanded)
            const linesPerGroup = projectGroups.map(g =>
              g.isExpanded ? 2 + (g.assignments.length * 3) : 2
            );

            // Find which groups to render based on selectedIndex
            let startGroup = 0;
            let endGroup = projectGroups.length;

            // Find the group containing the selected item
            let selectedGroupIndex = 0;
            let accumulatedItems = 0;
            for (let i = 0; i < projectGroups.length; i++) {
              const group = projectGroups[i];
              const groupItemCount = 1 + (group.isExpanded ? group.assignments.length : 0);
              if (selectedIndex < accumulatedItems + groupItemCount) {
                selectedGroupIndex = i;
                break;
              }
              accumulatedItems += groupItemCount;
            }

            // Calculate viewport window around selected group
            let totalLines = 0;
            startGroup = selectedGroupIndex;

            // Expand upward from selected group
            for (let i = selectedGroupIndex; i >= 0; i--) {
              const groupLines = linesPerGroup[i];
              if (totalLines + groupLines <= availableHeight) {
                totalLines += groupLines;
                startGroup = i;
              } else {
                break;
              }
            }

            // Expand downward to fill remaining space
            totalLines = linesPerGroup.slice(startGroup, selectedGroupIndex + 1).reduce((a, b) => a + b, 0);
            for (let i = selectedGroupIndex + 1; i < projectGroups.length; i++) {
              const groupLines = linesPerGroup[i];
              if (totalLines + groupLines <= availableHeight) {
                totalLines += groupLines;
                endGroup = i + 1;
              } else {
                break;
              }
            }

            // Render only groups in viewport
            return projectGroups.slice(startGroup, endGroup).map((group, relativeIndex) => {
              const groupIndex = startGroup + relativeIndex;
              const projectIndex = flatItems.findIndex(
                item => item.type === 'project' && item.projectNumber === group.projectNumber
              );

              if (projectIndex === -1) return null;

              return (
                <ProjectGroup
                  key={`project-${group.projectNumber}`}
                  group={group}
                  projectIndex={projectIndex}
                  selectedIndex={selectedIndex}
                  canMoveUp={groupIndex > 0}
                  canMoveDown={groupIndex < projectGroups.length - 1}
                />
              );
            });
          })()}
        </Box>
      )}

      {/* Footer hints */}
      <Box marginTop={1}>
        <Text dimColor>
          j/k: navigate ({selectedIndex + 1}/{flatItems.length}) │ Space/Enter: toggle │ x: unassign │ Shift+J/K: reorder │ r: refresh │ ?: help
        </Text>
      </Box>
    </Box>
  );
}
