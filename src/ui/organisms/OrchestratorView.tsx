/**
 * OrchestratorView - LLM instance management and monitoring
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Spinner } from '@inkjs/ui';
import { LogStream } from '../molecules/LogStream.js';
import { Divider } from '../atoms/Divider.js';
import { TimeAgo } from '../atoms/TimeAgo.js';
import { useOrchestratorStore } from '../stores/orchestrator-store.js';
import { useUIStore } from '../stores/ui-store.js';
import { useAssignmentStore } from '../stores/assignment-store.js';
import { useKeyboardNav } from '../hooks/useKeyboardNav.js';
import { execSync, spawn } from 'child_process';

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
  const status = useOrchestratorStore((s) => s.status);
  const setStatus = useOrchestratorStore((s) => s.setStatus);
  const selectedIndex = useUIStore((s) => s.selectedIndex);
  const [orchestratorProcess, setOrchestratorProcess] = useState<ReturnType<typeof spawn> | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  // Convert Map to array for rendering
  const instancesArray: InstanceDisplayData[] = Array.from(instances.values());

  // Calculate viewport constraints
  const terminalHeight = process.stdout.rows || 24;
  const fixedContentHeight = 12; // Header + summary + controls + divider + footer
  const linesPerInstance = 8; // Estimated lines per instance with logs
  const maxVisibleInstances = Math.max(Math.floor((terminalHeight - fixedContentHeight) / linesPerInstance), 1);

  // Handle 'S' key to start orchestrator
  useInput((input) => {
    if ((input === 'S' || input === 's') && status === 'idle') {
      handleStartOrchestrator();
    } else if ((input === 'X' || input === 'x') && (status === 'running' || status === 'starting')) {
      handleStopOrchestrator();
    } else if ((input === 'N' || input === 'n') && status === 'running') {
      handleAddInstance();
    } else if ((input === 'R' || input === 'r') && instancesArray.length > 0) {
      handleRemoveInstance();
    }
  });

  // Start orchestrator
  const handleStartOrchestrator = () => {
    try {
      setStartError(null);
      setStatus('starting');

      console.log('\n🚀 Starting orchestrator...\n');

      // Spawn auto start in the background
      const proc = spawn('auto', ['start', '--verbose'], {
        cwd: process.cwd(),
        stdio: 'inherit',
        detached: false,
      });

      proc.on('error', (err) => {
        setStartError(`Failed to start: ${err.message}`);
        setStatus('idle');
      });

      proc.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          setStartError(`Orchestrator exited with code ${code}`);
        }
        setStatus('idle');
        setOrchestratorProcess(null);
      });

      setOrchestratorProcess(proc);

      // Give it a moment to start
      setTimeout(() => {
        if (proc.exitCode === null) {
          setStatus('running');
        }
      }, 1000);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : 'Failed to start orchestrator');
      setStatus('idle');
    }
  };

  // Stop orchestrator
  const handleStopOrchestrator = () => {
    try {
      setStatus('stopping');
      console.log('\n⏹️  Stopping orchestrator...\n');

      if (orchestratorProcess) {
        orchestratorProcess.kill('SIGINT');
        setOrchestratorProcess(null);
      } else {
        // Try to stop via CLI
        execSync('auto stop', {
          cwd: process.cwd(),
          stdio: 'inherit',
        });
      }

      setStatus('idle');
    } catch (err) {
      console.error('Failed to stop orchestrator:', err);
      setStatus('idle');
    }
  };

  // Add new instance
  const handleAddInstance = () => {
    try {
      console.log('\n➕ Adding new LLM instance...\n');

      execSync('auto instance add', {
        cwd: process.cwd(),
        stdio: 'inherit',
      });

      console.log('✓ Instance added\n');
    } catch (err) {
      console.error('Failed to add instance:', err);
    }
  };

  // Remove selected instance
  const handleRemoveInstance = () => {
    try {
      const selected = instancesArray[selectedIndex];
      if (!selected) {
        console.error('No instance selected');
        return;
      }

      console.log(`\n➖ Removing instance #${selected.issueNumber}...\n`);

      execSync(`auto instance remove ${selected.id}`, {
        cwd: process.cwd(),
        stdio: 'inherit',
      });

      console.log('✓ Instance removed\n');
    } catch (err) {
      console.error('Failed to remove instance:', err);
    }
  };

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
        <Box justifyContent="space-between">
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
          <Box gap={2}>
            {status === 'starting' && <Spinner />}
            <Text bold color={status === 'running' ? 'green' : status === 'starting' ? 'yellow' : 'gray'}>
              {status === 'idle' ? 'STOPPED' : status.toUpperCase()}
            </Text>
          </Box>
        </Box>
      </Box>

      {/* Orchestrator Controls */}
      <Box borderStyle="round" borderColor={status === 'idle' ? 'yellow' : 'green'} paddingX={1} marginBottom={1}>
        <Box justifyContent="space-between">
          <Text bold>Orchestrator Controls:</Text>
          <Box gap={2}>
            {status === 'idle' && (
              <Text color="yellow">
                Press <Text bold color="cyan">S</Text> to Start
              </Text>
            )}
            {(status === 'running' || status === 'starting') && (
              <Text color="red">
                Press <Text bold color="cyan">X</Text> to Stop
              </Text>
            )}
          </Box>
        </Box>
      </Box>

      {/* Error Display */}
      {startError && (
        <Box borderStyle="round" borderColor="red" paddingX={1} marginBottom={1}>
          <Text color="red">Error: {startError}</Text>
        </Box>
      )}

      <Divider title="LLM Instances" />

      {/* Instance List */}
      {instancesArray.length === 0 ? (
        <Box padding={1}>
          <Text dimColor>No LLM instances running. Start an assignment to spawn instances.</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {(() => {
            // Calculate viewport window around selected instance
            const startIndex = Math.max(0, selectedIndex - Math.floor(maxVisibleInstances / 2));
            const endIndex = Math.min(instancesArray.length, startIndex + maxVisibleInstances);
            const visibleInstances = instancesArray.slice(startIndex, endIndex);

            return visibleInstances.map((instance, relativeIndex) => {
              const index = startIndex + relativeIndex;
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
                      {/* Project Context */}
                      {(() => {
                        const assignmentStore = useAssignmentStore.getState();
                        const assignment = assignmentStore.getById(instance.issueNumber);
                        const projectNum = assignment?.projectNumber;
                        if (projectNum) {
                          return <Text dimColor> (Proj #{projectNum})</Text>;
                        }
                        return null;
                      })()}
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
            });
          })()}
        </Box>
      )}

      {/* Footer */}
      <Box marginTop={1}>
        <Text dimColor>
          {status === 'idle' && 'S: start │ '}
          {(status === 'running' || status === 'starting') && 'X: stop │ '}
          {status === 'running' && 'N: new instance │ '}
          {instancesArray.length > 0 && 'R: remove selected │ '}
          j/k: navigate │ p: pause/resume │ ?: help
        </Text>
      </Box>
    </Box>
  );
}
