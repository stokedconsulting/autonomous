/**
 * Header - Application header with branding and navigation
 */

import React from 'react';
import { Box, Text } from 'ink';
import { useUIStore, ViewType } from '../stores/ui-store.js';
import { Hotkey } from '../atoms/Hotkey.js';

const VIEW_LABELS: Record<ViewType, string> = {
  'status': 'Status Dashboard',
  'orchestrator': 'LLM Orchestrator',
  'project': 'Project Browser',
  'review': 'Review Queue',
  'config': 'Configuration',
  'help': 'Help',
};

export function Header(): React.ReactElement {
  const currentView = useUIStore((s) => s.currentView);
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
          <Text color="gray"> │ </Text>
          <Text color="white">{VIEW_LABELS[currentView]}</Text>
        </Box>
        <Box gap={2}>
          <Hotkey keys="?" label="help" />
          <Hotkey keys="q" label="back" />
        </Box>
      </Box>

      {/* Breadcrumbs */}
      {breadcrumbs.length > 0 && (
        <Box marginTop={0}>
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
