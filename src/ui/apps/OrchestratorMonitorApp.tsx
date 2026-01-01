/**
 * OrchestratorMonitorApp - Real-time Ink UI for orchestrator monitoring
 *
 * Features:
 * - Live initialization progress
 * - Project detection status
 * - Issue count and assignment tracking
 * - LLM capacity monitoring
 * - Real-time updates during orchestrator operation
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';
import { ConfigManager } from '../../core/config-manager.js';
import { Orchestrator } from '../../core/orchestrator.js';
import { AssignmentManager } from '../../core/assignment-manager.js';

export interface OrchestratorMonitorAppProps {
  orchestrator: Orchestrator;
  configManager: ConfigManager;
  assignmentManager: AssignmentManager;
  verbose?: boolean;
  dryRun?: boolean;
}

type InitPhase =
  | 'init-config'
  | 'init-github'
  | 'init-project'
  | 'init-llms'
  | 'init-workers'
  | 'starting'
  | 'running'
  | 'error';

interface OrchestratorStatus {
  phase: InitPhase;
  projectDetected: boolean;
  projectNumber?: number;
  issueCount: number;
  assignmentCount: number;
  activeAssignments: number;
  llmCapacity: string;
  errorMessage?: string;
}

export function OrchestratorMonitorApp({
  orchestrator,
  configManager,
  assignmentManager,
  verbose,
  dryRun,
}: OrchestratorMonitorAppProps): React.ReactElement {
  const [status, setStatus] = useState<OrchestratorStatus>({
    phase: 'init-config',
    projectDetected: false,
    issueCount: 0,
    assignmentCount: 0,
    activeAssignments: 0,
    llmCapacity: '0/0',
  });

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    async function initializeOrchestrator() {
      try {
        // Phase 1: Config
        setStatus(prev => ({ ...prev, phase: 'init-config' }));
        await new Promise(resolve => setTimeout(resolve, 100));

        // Phase 2: GitHub API
        setStatus(prev => ({ ...prev, phase: 'init-github' }));
        await new Promise(resolve => setTimeout(resolve, 100));

        // Phase 3: Project detection
        setStatus(prev => ({ ...prev, phase: 'init-project' }));

        // Check for project detection from assignments
        const assignments = assignmentManager.getAllAssignments();
        const projectNumber = assignments.find(a => a.projectNumber)?.projectNumber;
        const projectDetected = Boolean(projectNumber);

        setStatus(prev => ({
          ...prev,
          projectDetected,
          projectNumber,
          assignmentCount: assignments.length,
          activeAssignments: assignments.filter(a => a.processId).length,
        }));

        // Phase 4: LLMs
        setStatus(prev => ({ ...prev, phase: 'init-llms' }));
        await new Promise(resolve => setTimeout(resolve, 100));

        // Phase 5: Workers
        setStatus(prev => ({ ...prev, phase: 'init-workers' }));
        await new Promise(resolve => setTimeout(resolve, 100));

        // Phase 6: Starting
        setStatus(prev => ({ ...prev, phase: 'starting' }));

        if (!dryRun) {
          await orchestrator.start();
          setStatus(prev => ({ ...prev, phase: 'running' }));
        } else {
          setStatus(prev => ({ ...prev, phase: 'running' }));
        }

        // Monitor status updates
        const interval = setInterval(() => {
          const assignments = assignmentManager.getAllAssignments();
          const enabledLLMs = configManager.getEnabledLLMs();
          const totalSlots = enabledLLMs.reduce((sum, provider) => {
            const llmConfig = configManager.getLLMConfig(provider);
            return sum + (llmConfig.maxConcurrentIssues || 3);
          }, 0);

          setStatus(prev => ({
            ...prev,
            assignmentCount: assignments.length,
            activeAssignments: assignments.filter(a => a.processId).length,
            llmCapacity: `${assignments.filter(a => a.processId).length}/${totalSlots}`,
          }));
        }, 2000);

        cleanup = () => clearInterval(interval);

      } catch (error) {
        setStatus(prev => ({
          ...prev,
          phase: 'error',
          errorMessage: error instanceof Error ? error.message : String(error),
        }));
      }
    }

    initializeOrchestrator();

    return () => {
      if (cleanup) cleanup();
    };
  }, [orchestrator, configManager, assignmentManager, dryRun]);

  const getPhaseText = (): string => {
    switch (status.phase) {
      case 'init-config': return 'Initializing configuration...';
      case 'init-github': return 'Connecting to GitHub...';
      case 'init-project': return 'Detecting project...';
      case 'init-llms': return 'Initializing LLM adapters...';
      case 'init-workers': return 'Starting workers...';
      case 'starting': return 'Starting orchestrator...';
      case 'running': return dryRun ? 'Dry run complete' : 'Orchestrator running';
      case 'error': return 'Error during initialization';
    }
  };

  const isInitializing = ['init-config', 'init-github', 'init-project', 'init-llms', 'init-workers', 'starting'].includes(status.phase);

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="blue">
          🚀 Autonomous Mode {dryRun ? '(Dry Run)' : ''}
        </Text>
      </Box>

      {/* Initialization Progress */}
      {isInitializing && (
        <Box marginBottom={1}>
          <Spinner label={getPhaseText()} />
        </Box>
      )}

      {/* Status Summary */}
      <Box flexDirection="column" marginBottom={1}>
        {/* Project Detection */}
        <Box>
          <Text>
            {status.projectDetected ? '✓' : '⚠'}{' '}
            <Text color={status.projectDetected ? 'green' : 'yellow'}>
              Project: {status.projectDetected ? `#${status.projectNumber}` : 'Not detected'}
            </Text>
          </Text>
        </Box>

        {/* Assignment Status */}
        <Box>
          <Text>
            📋 Assignments: {status.assignmentCount} total, {status.activeAssignments} active
          </Text>
        </Box>

        {/* LLM Capacity */}
        <Box>
          <Text>
            🤖 Capacity: {status.llmCapacity}
          </Text>
        </Box>
      </Box>

      {/* Running Status */}
      {status.phase === 'running' && (
        <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="green" padding={1}>
          <Text color="green" bold>
            ✓ {dryRun ? 'Dry run completed successfully' : 'Orchestrator is now running'}
          </Text>

          {!dryRun && (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>
                Monitoring {status.assignmentCount} assignment{status.assignmentCount !== 1 ? 's' : ''}
              </Text>
              <Text dimColor>
                Press Ctrl+C to stop
              </Text>
            </Box>
          )}
        </Box>
      )}

      {/* Error Status */}
      {status.phase === 'error' && (
        <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="red" padding={1}>
          <Text color="red" bold>
            ✗ Error: {status.errorMessage}
          </Text>
        </Box>
      )}

      {/* Verbose Details */}
      {verbose && status.phase === 'running' && (
        <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="gray" padding={1}>
          <Text bold>Verbose Mode</Text>
          <Text dimColor>Showing detailed orchestrator logs...</Text>
        </Box>
      )}
    </Box>
  );
}
