/**
 * ProgressTracker - Multi-step progress indicator
 */

import React from 'react';
import { Box, Text } from 'ink';

interface Step {
  label: string;
  status: 'pending' | 'active' | 'complete' | 'error';
}

interface ProgressTrackerProps {
  steps: Step[];
  showConnectors?: boolean;
}

const STEP_ICONS: Record<Step['status'], string> = {
  pending: '\u25CB',   // ○
  active: '\u25D0',    // ◐
  complete: '\u25CF',  // ●
  error: '\u2717',     // ✗
};

const STEP_COLORS: Record<Step['status'], string> = {
  pending: 'gray',
  active: 'cyan',
  complete: 'green',
  error: 'red',
};

export function ProgressTracker({
  steps,
  showConnectors = true,
}: ProgressTrackerProps): React.ReactElement {
  return (
    <Box flexDirection="row" gap={1}>
      {steps.map((step, index) => (
        <React.Fragment key={index}>
          <Box>
            <Text color={STEP_COLORS[step.status]}>
              {STEP_ICONS[step.status]}
            </Text>
            <Text
              color={step.status === 'active' ? 'cyan' : 'white'}
              bold={step.status === 'active'}
              dimColor={step.status === 'pending'}
            >
              {' '}{step.label}
            </Text>
          </Box>

          {/* Connector line */}
          {showConnectors && index < steps.length - 1 && (
            <Text color={step.status === 'complete' ? 'green' : 'gray'}>
              {'\u2192'}
            </Text>
          )}
        </React.Fragment>
      ))}
    </Box>
  );
}
