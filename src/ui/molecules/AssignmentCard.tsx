/**
 * AssignmentCard - Single assignment display with details
 */

import React from 'react';
import { Box, Text } from 'ink';
import { StatusBadge } from '../atoms/StatusBadge.js';
import { TimeAgo } from '../atoms/TimeAgo.js';
import type { Assignment } from '../../types/index.js';

interface AssignmentCardProps {
  assignment: Assignment;
  isFocused?: boolean;
  showDetails?: boolean;
}

export function AssignmentCard({
  assignment,
  isFocused = false,
  showDetails = false,
}: AssignmentCardProps): React.ReactElement {
  const focusIndicator = isFocused ? '\u25B8 ' : '  ';
  const borderColor = isFocused ? 'cyan' : 'gray';

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor}
      paddingX={1}
      marginBottom={1}
    >
      {/* Header Row */}
      <Box>
        <Text color={isFocused ? 'cyan' : 'white'}>
          {focusIndicator}
        </Text>
        <Text color="yellow" bold>#{assignment.issueNumber}</Text>
        <Text> </Text>
        <Text bold>{assignment.issueTitle}</Text>
        <Box flexGrow={1} />
        <StatusBadge status={assignment.status} />
      </Box>

      {/* Details Row */}
      <Box marginLeft={2}>
        <Text dimColor>LLM: </Text>
        <Text>{assignment.llmProvider}</Text>
        <Text dimColor> | Branch: </Text>
        <Text color="blue">{assignment.branchName}</Text>
        <Box flexGrow={1} />
        {assignment.lastActivity && (
          <TimeAgo date={assignment.lastActivity} />
        )}
      </Box>

      {/* Extended Details */}
      {showDetails && (
        <>
          {assignment.prUrl && (
            <Box marginLeft={2}>
              <Text dimColor>PR: </Text>
              <Text color="blue" underline>{assignment.prUrl}</Text>
              {assignment.ciStatus && (
                <Text color={assignment.ciStatus === 'success' ? 'green' : 'yellow'}>
                  {' '}{assignment.ciStatus === 'success' ? '\u2713' : '\u23F3'} CI
                </Text>
              )}
            </Box>
          )}

          {assignment.worktreePath && (
            <Box marginLeft={2}>
              <Text dimColor>Worktree: </Text>
              <Text>{assignment.worktreePath}</Text>
            </Box>
          )}

          {assignment.workSessions.length > 0 && (
            <Box marginLeft={2}>
              <Text dimColor>Sessions: </Text>
              <Text>{assignment.workSessions.length}</Text>
              {assignment.workSessions[assignment.workSessions.length - 1]?.summary && (
                <>
                  <Text dimColor> | Last: </Text>
                  <Text>{assignment.workSessions[assignment.workSessions.length - 1].summary}</Text>
                </>
              )}
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
