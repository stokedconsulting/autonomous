/**
 * DesignInput - Interactive input for project design modifications
 */

import React from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';

interface DesignInputProps {
  projectNumber: number;
  contextType: 'project' | 'phase-master' | 'work-item';
  contextTitle: string;
  onSubmit: (input: string) => void;
  onCancel: () => void;
}

export function DesignInput({
  projectNumber,
  contextType,
  contextTitle,
  onSubmit,
  onCancel
}: DesignInputProps): React.ReactElement {
  // Handle keyboard input for cancel
  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
    }
  });

  const handleSubmit = (value: string) => {
    if (value.trim()) {
      onSubmit(value.trim());
    }
  };

  const getContextDescription = () => {
    switch (contextType) {
      case 'project':
        return `Modifying project #${projectNumber}`;
      case 'phase-master':
        return `Adding to phase: ${contextTitle}`;
      case 'work-item':
        return `Related to: ${contextTitle}`;
      default:
        return '';
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">🎨 Design Mode</Text>
      </Box>

      <Box marginBottom={1}>
        <Text dimColor>{getContextDescription()}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text>Enter design modification:</Text>
      </Box>

      <Box marginBottom={1}>
        <TextInput
          placeholder="e.g., add authentication component with OAuth support"
          onSubmit={handleSubmit}
        />
      </Box>

      <Box>
        <Text dimColor>Enter: submit │ Esc/h: cancel</Text>
      </Box>
    </Box>
  );
}
