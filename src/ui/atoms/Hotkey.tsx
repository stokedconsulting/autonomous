/**
 * Hotkey - Keyboard shortcut indicator
 */

import React from 'react';
import { Box, Text } from 'ink';

interface HotkeyProps {
  keys: string;
  label: string;
}

export function Hotkey({ keys, label }: HotkeyProps): React.ReactElement {
  return (
    <Box>
      <Text color="cyan" bold>[{keys}]</Text>
      <Text dimColor> {label}</Text>
    </Box>
  );
}
