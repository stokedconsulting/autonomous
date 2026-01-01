/**
 * Header - Application header with branding and navigation
 */

import React from 'react';
import { Box, Text } from 'ink';
import { useUIStore } from '../stores/ui-store.js';
import { Hotkey } from '../atoms/Hotkey.js';
import { TabBar } from '../molecules/TabBar.js';

export function Header(): React.ReactElement {
  const breadcrumbs = useUIStore((s) => s.breadcrumbs);

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="cyan"
      paddingX={1}
    >
      {/* Title Row */}
      <Box justifyContent="space-between">
        <Box>
          <Text bold color="cyan">◆ AUTONOMOUS</Text>
        </Box>
        <Box gap={2}>
          <Hotkey keys="?" label="help" />
          <Hotkey keys="q" label="back" />
        </Box>
      </Box>

      {/* Tab Bar */}
      <Box marginTop={1}>
        <TabBar />
      </Box>

      {/* Breadcrumbs - only show when navigating within a tab */}
      {breadcrumbs.length > 0 && (
        <Box marginTop={1}>
          <Text dimColor>
            {breadcrumbs.map((crumb, i) => (
              <React.Fragment key={i}>
                {i > 0 && ' › '}
                {crumb}
              </React.Fragment>
            ))}
          </Text>
        </Box>
      )}
    </Box>
  );
}
