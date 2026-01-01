/**
 * ProjectGroup - Collapsible project section with assignments
 */

import React from 'react';
import { Box, Text } from 'ink';
import { AssignmentCard } from './AssignmentCard.js';
import type { ProjectGroup as ProjectGroupType } from '../stores/assignment-store.js';

interface ProjectGroupProps {
  group: ProjectGroupType;
  projectIndex: number; // Index of this project in flat items list
  selectedIndex: number; // Global selected index
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}

export function ProjectGroup({
  group,
  projectIndex,
  selectedIndex,
  canMoveUp,
  canMoveDown,
}: ProjectGroupProps): React.ReactElement {
  const { projectName, assignments, isExpanded } = group;

  const isProjectFocused = selectedIndex === projectIndex;
  const expandIcon = isExpanded ? '▼' : '▶';
  const borderColor = isProjectFocused ? 'cyan' : 'blue';

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Project Header */}
      <Box
        borderStyle="single"
        borderColor={borderColor}
        paddingX={1}
      >
        <Text color={isProjectFocused ? 'cyan' : 'blue'} bold>
          {expandIcon} {projectName}
        </Text>
        <Text dimColor> ({assignments.length} assignments)</Text>
        <Box flexGrow={1} />

        {/* Project Actions */}
        {isProjectFocused && (
          <Box gap={1}>
            {canMoveUp && <Text dimColor>[↑ Shift+K]</Text>}
            {canMoveDown && <Text dimColor>[↓ Shift+J]</Text>}
            <Text dimColor>[Space: toggle]</Text>
            <Text color="red">[x: unassign all]</Text>
          </Box>
        )}
      </Box>

      {/* Assignments (when expanded) */}
      {isExpanded && (
        <Box flexDirection="column" paddingLeft={2}>
          {assignments.map((assignment, assignmentIndex) => {
            // Calculate global index: project index + 1 (for project itself) + assignment index
            const assignmentGlobalIndex = projectIndex + 1 + assignmentIndex;
            return (
              <AssignmentCard
                key={assignment.issueNumber}
                assignment={assignment}
                isFocused={assignmentGlobalIndex === selectedIndex}
                showDetails={assignmentGlobalIndex === selectedIndex}
              />
            );
          })}
        </Box>
      )}
    </Box>
  );
}
