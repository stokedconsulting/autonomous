/**
 * SummaryBar - Quick status summary with progress
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { Assignment, AssignmentStatus } from '../../types/index.js';

interface SummaryBarProps {
  assignments: Assignment[];
}

const STATUS_COLORS: Record<AssignmentStatus, string> = {
  'assigned': 'gray',
  'in-progress': 'cyan',
  'in-review': 'yellow',
  'dev-complete': 'greenBright',
  'merge-review': 'magenta',
  'stage-ready': 'blue',
  'merged': 'green',
};

export function SummaryBar({ assignments }: SummaryBarProps): React.ReactElement {
  const total = assignments.length;

  const counts: Record<AssignmentStatus, number> = {
    'assigned': 0,
    'in-progress': 0,
    'in-review': 0,
    'dev-complete': 0,
    'merge-review': 0,
    'stage-ready': 0,
    'merged': 0,
  };

  assignments.forEach(a => {
    if (a.status in counts) {
      counts[a.status]++;
    }
  });

  // Calculate progress percentage
  const completed = counts['merged'] + counts['stage-ready'] + counts['dev-complete'];
  const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;

  // Create progress bar
  const barWidth = 40;
  const filledWidth = Math.round((progressPercent / 100) * barWidth);
  const progressBar = '\u2593'.repeat(filledWidth) + '\u2591'.repeat(barWidth - filledWidth);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      {/* Counts row */}
      <Box gap={2}>
        <Text>Total: <Text bold>{total}</Text></Text>
        {counts['assigned'] > 0 && (
          <Text color={STATUS_COLORS['assigned']}>
            Assigned: {counts['assigned']}
          </Text>
        )}
        <Text color={STATUS_COLORS['in-progress']}>
          In Progress: {counts['in-progress']}
        </Text>
        <Text color={STATUS_COLORS['dev-complete']}>
          Complete: {counts['dev-complete']}
        </Text>
        <Text color={STATUS_COLORS['merged']}>
          Merged: {counts['merged']}
        </Text>
      </Box>

      {/* Progress bar */}
      <Box marginTop={0}>
        <Text color="cyan">{progressBar}</Text>
        <Text dimColor> {progressPercent}% pipeline</Text>
      </Box>
    </Box>
  );
}
