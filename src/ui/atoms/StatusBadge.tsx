/**
 * StatusBadge - Status indicator with icon and color
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { AssignmentStatus } from '../../types/index.js';

interface StatusBadgeProps {
  status: AssignmentStatus;
  showLabel?: boolean;
}

const STATUS_CONFIG: Record<AssignmentStatus, { icon: string; color: string; label: string }> = {
  'assigned': { icon: '\u25CB', color: 'gray', label: 'Assigned' },
  'in-progress': { icon: '\u25D0', color: 'cyan', label: 'In Progress' },
  'in-review': { icon: '\u25D1', color: 'yellow', label: 'In Review' },
  'dev-complete': { icon: '\u25D5', color: 'greenBright', label: 'Dev Complete' },
  'merge-review': { icon: '\u25D1', color: 'magenta', label: 'Merge Review' },
  'stage-ready': { icon: '\u25D4', color: 'blue', label: 'Stage Ready' },
  'merged': { icon: '\u25CF', color: 'green', label: 'Merged' },
};

export function StatusBadge({ status, showLabel = true }: StatusBadgeProps): React.ReactElement {
  const config = STATUS_CONFIG[status] || { icon: '\u2022', color: 'gray', label: status };

  return (
    <Box>
      <Text color={config.color}>{config.icon}</Text>
      {showLabel && <Text color={config.color}> {config.label}</Text>}
    </Box>
  );
}
