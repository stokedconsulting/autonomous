/**
 * QueuePage - View and manage work queue and active assignments
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';
import { Header } from '../organisms/Header.js';
import { HelpOverlay } from '../organisms/HelpOverlay.js';
import { Divider } from '../atoms/Divider.js';
import { ConfigManager } from '../../core/config-manager.js';
import { Assignment } from '../../types/assignments.js';

interface WorkerSlot {
  provider: string;
  total: number;
  active: number;
  available: number;
}

export function QueuePage(): React.ReactElement {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workerSlots, setWorkerSlots] = useState<WorkerSlot[]>([]);
  const [activeAssignments, setActiveAssignments] = useState<Assignment[]>([]);
  const [queuedAssignments, setQueuedAssignments] = useState<Assignment[]>([]);

  // Calculate viewport constraints
  const terminalHeight = process.stdout.rows || 24;
  const fixedContentHeight = 12; // Header + dividers + footer + worker summary
  const availableHeight = Math.max(terminalHeight - fixedContentHeight, 5);
  const maxActiveVisible = Math.floor(availableHeight / 2);
  const maxQueuedVisible = Math.floor(availableHeight / 2);

  useEffect(() => {
    async function loadQueueStatus() {
      try {
        setLoading(true);
        setError(null);

        // Load configuration to get worker slots
        const configManager = new ConfigManager(process.cwd());
        await configManager.initialize();
        const config = configManager.getConfig();

        // Calculate worker slots from LLM config
        const slots: WorkerSlot[] = [];
        for (const [provider, llmConfig] of Object.entries(config.llms)) {
          if (llmConfig.enabled) {
            slots.push({
              provider,
              total: llmConfig.maxConcurrentIssues,
              active: 0, // TODO: Get from assignment manager
              available: llmConfig.maxConcurrentIssues, // TODO: Calculate from active assignments
            });
          }
        }
        setWorkerSlots(slots);

        // TODO: Load active and queued assignments from orchestrator
        // For now, using empty arrays
        setActiveAssignments([]);
        setQueuedAssignments([]);

        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load queue status');
        setLoading(false);
      }
    }

    loadQueueStatus();
  }, []);

  if (loading) {
    return (
      <Box flexDirection="column">
        <Header />
        <HelpOverlay />
        <Box flexDirection="column" padding={1}>
          <Box gap={1}>
            <Spinner label="Loading queue status..." />
          </Box>
        </Box>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column">
        <Header />
        <HelpOverlay />
        <Box flexDirection="column" padding={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      </Box>
    );
  }

  const totalSlots = workerSlots.reduce((sum, slot) => sum + slot.total, 0);
  const totalActive = workerSlots.reduce((sum, slot) => sum + slot.active, 0);
  const totalAvailable = workerSlots.reduce((sum, slot) => sum + slot.available, 0);

  return (
    <Box flexDirection="column">
      <Header />
      <HelpOverlay />

      <Box flexDirection="column" padding={1}>
        {/* Worker Slots Overview */}
        <Divider title="Worker Capacity" />
        <Box flexDirection="column" marginBottom={1}>
          <Box marginBottom={1}>
            <Text bold>
              {totalActive}/{totalSlots} slots in use ({totalAvailable} available)
            </Text>
          </Box>
          {workerSlots.map(slot => (
            <Box key={slot.provider}>
              <Text color="cyan">{slot.provider}: </Text>
              <Text color="green">{slot.active}</Text>
              <Text>/</Text>
              <Text color="yellow">{slot.total}</Text>
              <Text dimColor> ({slot.available} available)</Text>
            </Box>
          ))}
        </Box>

        {/* Active Assignments */}
        <Divider title={`Active Work (${activeAssignments.length})`} />
        <Box flexDirection="column" marginBottom={1}>
          {activeAssignments.length === 0 ? (
            <Box padding={1}>
              <Text dimColor>No active work in progress</Text>
            </Box>
          ) : (
            <>
              {activeAssignments.slice(0, maxActiveVisible).map(assignment => (
                <Box key={assignment.id}>
                  <Text color="yellow">● </Text>
                  <Text>#{assignment.issueNumber} </Text>
                  <Text dimColor>{assignment.issueTitle}</Text>
                  <Text dimColor> │ {assignment.llmProvider}</Text>
                </Box>
              ))}
              {activeAssignments.length > maxActiveVisible && (
                <Box paddingLeft={2}>
                  <Text dimColor>... and {activeAssignments.length - maxActiveVisible} more</Text>
                </Box>
              )}
            </>
          )}
        </Box>

        {/* Queued Assignments */}
        <Divider title={`Queue (${queuedAssignments.length})`} />
        <Box flexDirection="column" marginBottom={1}>
          {queuedAssignments.length === 0 ? (
            <Box padding={1}>
              <Text dimColor>No items in queue</Text>
            </Box>
          ) : (
            <>
              {queuedAssignments.slice(0, maxQueuedVisible).map((assignment, index) => (
                <Box key={assignment.id}>
                  <Text dimColor>{index + 1}. </Text>
                  <Text color="cyan">○ </Text>
                  <Text>#{assignment.issueNumber} </Text>
                  <Text dimColor>{assignment.issueTitle}</Text>
                </Box>
              ))}
              {queuedAssignments.length > maxQueuedVisible && (
                <Box paddingLeft={2}>
                  <Text dimColor>... and {queuedAssignments.length - maxQueuedVisible} more in queue</Text>
                </Box>
              )}
            </>
          )}
        </Box>

        <Box marginTop={1}>
          <Text dimColor>
            q: back │ c: configure workers │ ?: help
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
