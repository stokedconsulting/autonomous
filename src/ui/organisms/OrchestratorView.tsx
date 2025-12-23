/**
 * OrchestratorView - LLM instance management and monitoring
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';
import { LogStream } from '../molecules/LogStream.js';
import { Divider } from '../atoms/Divider.js';
import { TimeAgo } from '../atoms/TimeAgo.js';
import { useOrchestratorStore } from '../stores/orchestrator-store.js';
import { useUIStore } from '../stores/ui-store.js';
import { useKeyboardNav } from '../hooks/useKeyboardNav.js';

const STATUS_COLORS: Record<string, string> = {
  starting: 'yellow',
  running: 'cyan',
  stopping: 'yellow',
  stopped: 'gray',
};

interface InstanceDisplayData {
  id: string;
  issueNumber: number;
  provider: string;
  status: string;
  startedAt: Date;
  cpuHistory: number[];
  memoryMB: number;
}

export function OrchestratorView(): React.ReactElement {
  const instances = useOrchestratorStore((s) => s.instances);
  const getLogs = useOrchestratorStore((s) => s.getLogs);
  const updateInstance = useOrchestratorStore((s) => s.updateInstance);
  const selectedIndex = useUIStore((s) => s.selectedIndex);

  // Convert Map to array for rendering
  const instancesArray: InstanceDisplayData[] = Array.from(instances.values());

  useKeyboardNav({
    enableVimNav: true,
    maxItems: instancesArray.length,
    handlers: [
      {
        key: 'p',
        handler: () => {
          const selected = instancesArray[selectedIndex];
          if (selected) {
            if (selected.status === 'running') {
              updateInstance(selected.id, { status: 'stopping' });
            } else if (selected.status === 'stopping') {
              updateInstance(selected.id, { status: 'running' });
            }
          }
        },
      },
      {
        key: 's',
        handler: () => {
          const selected = instancesArray[selectedIndex];
          if (selected && selected.status === 'running') {
            updateInstance(selected.id, { status: 'stopped' });
          }
        },
      },
    ],
  });

  const runningCount = instancesArray.filter((i) => i.status === 'running').length;
  const stoppedCount = instancesArray.filter((i) => i.status === 'stopped').length;

  return (
    <Box flexDirection="column" padding={1}>
      {/* Summary Header */}
      <Box borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
        <Box gap={3}>
          <Text>
            <Text bold>Instances:</Text> {instancesArray.length}
          </Text>
          <Text color="cyan">
            Running: {runningCount}
          </Text>
          <Text color="gray">
            Stopped: {stoppedCount}
          </Text>
        </Box>
      </Box>

      <Divider title="LLM Instances" />

      {/* Instance List */}
      {instancesArray.length === 0 ? (
        <Box padding={1}>
          <Text dimColor>No LLM instances running. Start an assignment to spawn instances.</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {instancesArray.map((instance, index) => {
            const isFocused = index === selectedIndex;
            const instanceLogs = getLogs(instance.id);
            return (
              <Box
                key={instance.id}
                flexDirection="column"
                borderStyle="round"
                borderColor={isFocused ? 'cyan' : 'gray'}
                paddingX={1}
                marginBottom={1}
              >
                {/* Instance Header */}
                <Box justifyContent="space-between">
                  <Box gap={1}>
                    <Text color={isFocused ? 'cyan' : 'white'}>
                      {isFocused ? '▸ ' : '  '}
                    </Text>
                    <Text bold color="yellow">#{instance.issueNumber}</Text>
                    <Text> - </Text>
                    <Text>{instance.provider}</Text>
                  </Box>
                  <Box gap={2}>
                    {instance.status === 'running' && <Spinner />}
                    <Text color={STATUS_COLORS[instance.status] || 'gray'}>
                      {instance.status.toUpperCase()}
                    </Text>
                  </Box>
                </Box>

                {/* Instance Details */}
                <Box marginLeft={2} gap={2}>
                  <Text dimColor>Memory: {instance.memoryMB}MB</Text>
                  <TimeAgo date={instance.startedAt} />
                </Box>

                {/* Recent Output (when focused) */}
                {isFocused && instanceLogs.length > 0 && (
                  <Box marginTop={1}>
                    <LogStream
                      logs={instanceLogs}
                      maxLines={5}
                      title="Recent Output"
                      follow
                    />
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      )}

      {/* Footer */}
      <Box marginTop={1}>
        <Text dimColor>
          j/k: navigate │ p: pause/resume │ s: stop │ r: refresh │ ?: help
        </Text>
      </Box>
    </Box>
  );
}
