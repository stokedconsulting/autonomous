/**
 * StatusChangeMenu - Menu for changing item status
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Select } from '@inkjs/ui';

interface StatusChangeMenuProps {
  currentStatus: string;
  onStatusChange: (newStatus: string) => void;
  onCancel: () => void;
}

export function StatusChangeMenu({ currentStatus, onStatusChange, onCancel }: StatusChangeMenuProps): React.ReactElement {
  const statuses = [
    { value: 'Todo', label: '○ Todo', color: 'gray' },
    { value: 'Ready', label: '◐ Ready', color: 'cyan' },
    { value: 'Evaluated', label: '◑ Evaluated', color: 'blue' },
    { value: 'In Progress', label: '● In Progress', color: 'yellow' },
    { value: 'In Review', label: '◆ In Review', color: 'magenta' },
    { value: 'Dev Complete', label: '✓ Dev Complete', color: 'green' },
    { value: 'Done', label: '✓ Done', color: 'green' },
    { value: 'Blocked', label: '⚠ Blocked', color: 'red' },
    { value: 'cancel', label: '← Cancel', color: 'white' },
  ];

  const handleSelect = (value: string) => {
    if (value === 'cancel') {
      onCancel();
    } else {
      onStatusChange(value);
    }
  };

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="yellow">Change Status</Text>
      </Box>
      <Box marginBottom={1}>
        <Text dimColor>Current: </Text>
        <Text color="cyan">{currentStatus}</Text>
      </Box>
      <Select
        options={statuses.map(s => ({
          label: s.label,
          value: s.value,
        }))}
        onChange={handleSelect}
      />
    </Box>
  );
}
