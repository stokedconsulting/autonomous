/**
 * Divider - Horizontal separator line
 */

import React from 'react';
import { Box, Text } from 'ink';

interface DividerProps {
  title?: string;
  width?: number;
  char?: string;
}

export function Divider({ title, width = 60, char = '\u2500' }: DividerProps): React.ReactElement {
  if (title) {
    const titleLength = title.length + 2; // Add padding
    const sideLength = Math.floor((width - titleLength) / 2);
    const leftSide = char.repeat(Math.max(0, sideLength));
    const rightSide = char.repeat(Math.max(0, width - sideLength - titleLength));

    return (
      <Box>
        <Text dimColor>{leftSide}</Text>
        <Text bold> {title} </Text>
        <Text dimColor>{rightSide}</Text>
      </Box>
    );
  }

  return (
    <Box>
      <Text dimColor>{char.repeat(width)}</Text>
    </Box>
  );
}
