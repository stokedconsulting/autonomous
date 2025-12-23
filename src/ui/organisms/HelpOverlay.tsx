/**
 * HelpOverlay - Keyboard shortcut reference overlay
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Hotkey } from '../atoms/Hotkey.js';
import { Divider } from '../atoms/Divider.js';
import { useUIStore } from '../stores/ui-store.js';

interface KeyGroup {
  title: string;
  keys: Array<{ key: string; description: string }>;
}

const KEY_GROUPS: KeyGroup[] = [
  {
    title: 'Navigation',
    keys: [
      { key: 'j/↓', description: 'Move down' },
      { key: 'k/↑', description: 'Move up' },
      { key: 'h/←', description: 'Go back' },
      { key: 'l/→', description: 'Enter/Select' },
      { key: 'g', description: 'Go to top' },
      { key: 'G', description: 'Go to bottom' },
    ],
  },
  {
    title: 'Views',
    keys: [
      { key: '1', description: 'Status Dashboard' },
      { key: '2', description: 'LLM Orchestrator' },
      { key: '3', description: 'Project Browser' },
      { key: '4', description: 'Review Queue' },
      { key: '5', description: 'Configuration' },
    ],
  },
  {
    title: 'Actions',
    keys: [
      { key: 'Enter', description: 'Select/Confirm' },
      { key: 'Space', description: 'Toggle selection' },
      { key: 'r', description: 'Refresh data' },
      { key: 'f', description: 'Filter' },
      { key: '/', description: 'Search' },
    ],
  },
  {
    title: 'General',
    keys: [
      { key: '?', description: 'Toggle help' },
      { key: 'q', description: 'Back/Quit' },
      { key: 'Ctrl+C', description: 'Force quit' },
    ],
  },
];

export function HelpOverlay(): React.ReactElement | null {
  const showHelp = useUIStore((s) => s.showHelp);

  if (!showHelp) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      paddingX={2}
      paddingY={1}
      marginY={1}
    >
      <Box justifyContent="center" marginBottom={1}>
        <Text bold color="yellow">⌨ Keyboard Shortcuts</Text>
      </Box>

      <Box flexDirection="row" gap={4}>
        {KEY_GROUPS.map((group, groupIndex) => (
          <Box key={groupIndex} flexDirection="column" minWidth={24}>
            <Text bold color="cyan">{group.title}</Text>
            <Divider width={20} />
            {group.keys.map((item, keyIndex) => (
              <Box key={keyIndex} gap={1}>
                <Box minWidth={10}>
                  <Hotkey keys={item.key} label="" />
                </Box>
                <Text dimColor>{item.description}</Text>
              </Box>
            ))}
          </Box>
        ))}
      </Box>

      <Box marginTop={1} justifyContent="center">
        <Text dimColor>Press </Text>
        <Text color="yellow">?</Text>
        <Text dimColor> to close</Text>
      </Box>
    </Box>
  );
}
