/**
 * TabBar - Top-level tab navigation
 */

import React from 'react';
import { Box, Text } from 'ink';
import { useUIStore, TabType } from '../stores/ui-store.js';

interface Tab {
  key: TabType;
  label: string;
  shortcut: string;
}

const TABS: Tab[] = [
  { key: 'status', label: 'Status', shortcut: '1' },
  { key: 'project', label: 'Projects', shortcut: '2' },
  { key: 'orchestrator', label: 'Orchestrator', shortcut: '3' },
];

export function TabBar(): React.ReactElement {
  const currentTab = useUIStore((s) => s.currentTab);

  return (
    <Box gap={1}>
      {TABS.map((tab, index) => {
        const isActive = currentTab === tab.key;

        return (
          <Box key={tab.key}>
            {index > 0 && <Text dimColor> │ </Text>}
            <Text
              bold={isActive}
              color={isActive ? 'cyan' : undefined}
              dimColor={!isActive}
            >
              {tab.shortcut}.{' '}
              {isActive && <Text inverse> {tab.label} </Text>}
              {!isActive && tab.label}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
