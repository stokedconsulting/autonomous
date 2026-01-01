/**
 * WorkerConfigMenu - Display worker capacity for each LLM provider
 */

import React from 'react';
import { Box, Text } from 'ink';
import { LLMProvider } from '../../types/assignments.js';

export interface WorkerConfig {
  provider: LLMProvider;
  maxConcurrent: number;
  enabled: boolean;
}

interface WorkerConfigMenuProps {
  configs: WorkerConfig[];
}

export function WorkerConfigMenu({ configs }: WorkerConfigMenuProps): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="green" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="green">Worker Configuration</Text>
      </Box>

      <Box marginBottom={1}>
        <Text dimColor>
          Maximum concurrent issues each LLM provider can work on:
        </Text>
      </Box>

      {/* Worker Config List */}
      <Box flexDirection="column" marginBottom={1}>
        {configs.map((config) => (
          <Box key={config.provider} marginBottom={1}>
            <Box width={15}>
              <Text color={config.enabled ? 'cyan' : 'gray'}>
                {config.provider}:
              </Text>
            </Box>
            <Box>
              <Text color="yellow">{config.maxConcurrent}</Text>
              <Text dimColor> slots</Text>
              {!config.enabled && (
                <Text color="red"> (disabled)</Text>
              )}
            </Box>
          </Box>
        ))}
      </Box>

      {/* Instructions */}
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor color="yellow">
          To change worker capacity, edit .autonomous-config.json
        </Text>
        <Text dimColor>
          Then restart the orchestrator for changes to take effect
        </Text>
        <Box marginTop={1}>
          <Text dimColor>Esc: close</Text>
        </Box>
      </Box>
    </Box>
  );
}
