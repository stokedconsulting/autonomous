/**
 * TextArea - Multi-line text input component for Ink
 *
 * Supports:
 * - Multi-line text editing
 * - Arrow key navigation (Up/Down/Left/Right)
 * - Home/End for line start/end
 * - Enter for new line
 * - Tab to submit (most reliable)
 * - Ctrl+D to submit (Unix style)
 * - Ctrl+Enter to submit (may not work in all terminals)
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface TextAreaProps {
  placeholder?: string;
  minHeight?: number;
  onSubmit: (value: string) => void;
  onCancel?: () => void;
}

export function TextArea({
  placeholder = 'Enter text...',
  minHeight = 5,
  onSubmit,
  onCancel,
}: TextAreaProps): React.ReactElement {
  const [lines, setLines] = useState<string[]>(['']);
  const [cursorRow, setCursorRow] = useState(0);
  const [cursorCol, setCursorCol] = useState(0);

  const currentLine = lines[cursorRow] || '';
  const hasContent = lines.some(line => line.length > 0);

  useInput((input, key) => {
    // Handle escape to cancel
    if (key.escape && onCancel) {
      onCancel();
      return;
    }

    // Tab to submit (most reliable in terminals)
    if (key.tab) {
      const value = lines.join('\n').trim();
      if (value) {
        onSubmit(value);
      }
      return;
    }

    // Ctrl+Enter or Cmd+Enter to submit (may not work in all terminals)
    if (key.return && (key.ctrl || key.meta)) {
      const value = lines.join('\n').trim();
      if (value) {
        onSubmit(value);
      }
      return;
    }

    // Ctrl+D to submit (Unix "end of input" signal)
    if (key.ctrl && input === 'd') {
      const value = lines.join('\n').trim();
      if (value) {
        onSubmit(value);
      }
      return;
    }

    // Enter to add new line
    if (key.return) {
      const before = currentLine.slice(0, cursorCol);
      const after = currentLine.slice(cursorCol);
      setLines(prev => [
        ...prev.slice(0, cursorRow),
        before,
        after,
        ...prev.slice(cursorRow + 1),
      ]);
      setCursorRow(prev => prev + 1);
      setCursorCol(0);
      return;
    }

    // Backspace
    if (key.backspace || key.delete) {
      if (cursorCol > 0) {
        // Delete character before cursor
        setLines(prev => {
          const newLines = [...prev];
          newLines[cursorRow] = currentLine.slice(0, cursorCol - 1) + currentLine.slice(cursorCol);
          return newLines;
        });
        setCursorCol(prev => prev - 1);
      } else if (cursorRow > 0) {
        // Merge with previous line
        const prevLine = lines[cursorRow - 1];
        setLines(prev => {
          const newLines = [...prev];
          newLines[cursorRow - 1] = prevLine + currentLine;
          newLines.splice(cursorRow, 1);
          return newLines;
        });
        setCursorRow(prev => prev - 1);
        setCursorCol(prevLine.length);
      }
      return;
    }

    // Arrow keys
    if (key.upArrow) {
      if (cursorRow > 0) {
        setCursorRow(prev => prev - 1);
        setCursorCol(prev => Math.min(prev, lines[cursorRow - 1]?.length || 0));
      }
      return;
    }

    if (key.downArrow) {
      if (cursorRow < lines.length - 1) {
        setCursorRow(prev => prev + 1);
        setCursorCol(prev => Math.min(prev, lines[cursorRow + 1]?.length || 0));
      }
      return;
    }

    if (key.leftArrow) {
      if (cursorCol > 0) {
        setCursorCol(prev => prev - 1);
      } else if (cursorRow > 0) {
        setCursorRow(prev => prev - 1);
        setCursorCol(lines[cursorRow - 1]?.length || 0);
      }
      return;
    }

    if (key.rightArrow) {
      if (cursorCol < currentLine.length) {
        setCursorCol(prev => prev + 1);
      } else if (cursorRow < lines.length - 1) {
        setCursorRow(prev => prev + 1);
        setCursorCol(0);
      }
      return;
    }

    // Home key (go to start of line)
    if (input === '\x1b[H' || (key.ctrl && input === 'a')) {
      setCursorCol(0);
      return;
    }

    // End key (go to end of line)
    if (input === '\x1b[F' || (key.ctrl && input === 'e')) {
      setCursorCol(currentLine.length);
      return;
    }

    // Regular character input
    if (input && !key.ctrl && !key.meta && input.length === 1 && input >= ' ') {
      setLines(prev => {
        const newLines = [...prev];
        newLines[cursorRow] = currentLine.slice(0, cursorCol) + input + currentLine.slice(cursorCol);
        return newLines;
      });
      setCursorCol(prev => prev + 1);
    }
  });

  // Render lines with cursor
  const renderLines = () => {
    if (!hasContent && lines.length === 1) {
      return (
        <Box>
          <Text dimColor>{placeholder}</Text>
          <Text backgroundColor="white"> </Text>
        </Box>
      );
    }

    return lines.map((line, rowIndex) => {
      const isCurrentRow = rowIndex === cursorRow;

      if (isCurrentRow) {
        const before = line.slice(0, cursorCol);
        const cursor = line[cursorCol] || ' ';
        const after = line.slice(cursorCol + 1);

        return (
          <Box key={rowIndex}>
            <Text>{before}</Text>
            <Text backgroundColor="white" color="black">{cursor}</Text>
            <Text>{after}</Text>
          </Box>
        );
      }

      return (
        <Box key={rowIndex}>
          <Text>{line || ' '}</Text>
        </Box>
      );
    });
  };

  // Pad to minimum height
  const paddingLines = Math.max(0, minHeight - lines.length);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      minHeight={minHeight + 2}
    >
      {renderLines()}
      {Array.from({ length: paddingLines }).map((_, i) => (
        <Box key={`pad-${i}`}>
          <Text> </Text>
        </Box>
      ))}
    </Box>
  );
}
