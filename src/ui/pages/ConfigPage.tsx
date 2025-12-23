/**
 * ConfigPage - Configuration wizard and settings
 */

import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { Header } from '../organisms/Header.js';
import { HelpOverlay } from '../organisms/HelpOverlay.js';
import { Divider } from '../atoms/Divider.js';
import { useUIStore } from '../stores/ui-store.js';
import { useKeyboardNav } from '../hooks/useKeyboardNav.js';

interface ConfigSection {
  id: string;
  title: string;
  description: string;
  status: 'configured' | 'pending' | 'error';
}

const CONFIG_SECTIONS: ConfigSection[] = [
  { id: 'github', title: 'GitHub Connection', description: 'Repository and project settings', status: 'configured' },
  { id: 'llm', title: 'LLM Providers', description: 'Claude, GPT, and other model configs', status: 'configured' },
  { id: 'worktree', title: 'Worktree Settings', description: 'Git worktree base path and cleanup', status: 'pending' },
  { id: 'review', title: 'Review Pipeline', description: 'Auto-review and merge settings', status: 'pending' },
  { id: 'notifications', title: 'Notifications', description: 'Slack, email, and webhook integrations', status: 'pending' },
];

const STATUS_ICONS: Record<string, { icon: string; color: string }> = {
  configured: { icon: '✓', color: 'green' },
  pending: { icon: '○', color: 'yellow' },
  error: { icon: '✗', color: 'red' },
};

export function ConfigPage(): React.ReactElement {
  const selectedIndex = useUIStore((s) => s.selectedIndex);
  const [editingSection, setEditingSection] = useState<string | null>(null);

  useKeyboardNav({
    enableVimNav: true,
    maxItems: CONFIG_SECTIONS.length,
    handlers: [
      {
        key: 'enter',
        handler: () => {
          const section = CONFIG_SECTIONS[selectedIndex];
          if (section) {
            setEditingSection(section.id);
          }
        },
      },
      {
        key: 'escape',
        handler: () => {
          setEditingSection(null);
        },
      },
    ],
  });

  return (
    <Box flexDirection="column">
      <Header />
      <HelpOverlay />

      <Box flexDirection="column" padding={1}>
        <Divider title="Configuration" />

        {/* Config Sections */}
        <Box flexDirection="column">
          {CONFIG_SECTIONS.map((section, index) => {
            const isFocused = index === selectedIndex;
            const statusInfo = STATUS_ICONS[section.status];

            return (
              <Box
                key={section.id}
                flexDirection="column"
                borderStyle="round"
                borderColor={isFocused ? 'cyan' : 'gray'}
                paddingX={1}
                marginBottom={1}
              >
                <Box justifyContent="space-between">
                  <Box gap={1}>
                    <Text color={isFocused ? 'cyan' : 'white'}>
                      {isFocused ? '▸ ' : '  '}
                    </Text>
                    <Text color={statusInfo.color}>{statusInfo.icon}</Text>
                    <Text bold>{section.title}</Text>
                  </Box>
                  <Text color={statusInfo.color}>
                    {section.status.toUpperCase()}
                  </Text>
                </Box>

                <Box marginLeft={4}>
                  <Text dimColor>{section.description}</Text>
                </Box>

                {/* Inline editing when section is being edited */}
                {editingSection === section.id && (
                  <Box marginTop={1} marginLeft={4} flexDirection="column">
                    <Text color="cyan">Editing {section.title}...</Text>
                    <Text dimColor>Press Esc to cancel</Text>
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>

        {/* Quick Stats */}
        <Box marginTop={1} borderStyle="round" borderColor="gray" paddingX={1}>
          <Box gap={3}>
            <Text dimColor>Configuration Status:</Text>
            <Text color="green">
              {CONFIG_SECTIONS.filter(s => s.status === 'configured').length} configured
            </Text>
            <Text color="yellow">
              {CONFIG_SECTIONS.filter(s => s.status === 'pending').length} pending
            </Text>
            <Text color="red">
              {CONFIG_SECTIONS.filter(s => s.status === 'error').length} errors
            </Text>
          </Box>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>
            j/k: navigate │ Enter: edit section │ Esc: cancel │ ?: help
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
