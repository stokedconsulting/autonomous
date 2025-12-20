/**
 * StepProgress - Multi-step progress indicator component
 *
 * Displays a vertical list of steps with visual status indicators.
 * Supports pending, active, completed, skipped, and error states.
 *
 * @example
 * ```tsx
 * <StepProgress
 *   steps={[
 *     { id: '1', label: 'Initialize', status: 'completed' },
 *     { id: '2', label: 'Configure', status: 'active' },
 *     { id: '3', label: 'Deploy', status: 'pending' },
 *   ]}
 *   title="Setup Progress"
 * />
 * ```
 */

import type { ReactElement } from 'react';
import { Box, Text } from 'ink';
import type { Step } from '../stores/command-stores/types.js';

/**
 * Status indicator symbols for each step state
 */
const STATUS_INDICATORS = {
  pending: '○',
  active: '◉',
  completed: '✓',
  skipped: '⊘',
  error: '✗',
} as const;

/**
 * Color mapping for each step status
 */
const STATUS_COLORS = {
  pending: 'gray',
  active: 'cyan',
  completed: 'green',
  skipped: 'yellow',
  error: 'red',
} as const;

/**
 * Props for the StepProgress component
 */
export interface StepProgressProps {
  /**
   * Array of steps to display
   */
  steps: Step[];

  /**
   * Optional title shown above the steps
   */
  title?: string;

  /**
   * Whether to show step numbers
   * @default false
   */
  showNumbers?: boolean;

  /**
   * Whether to show connector lines between steps
   * @default true
   */
  showConnectors?: boolean;

  /**
   * Whether the progress indicator is compact (single line per step)
   * @default false
   */
  compact?: boolean;
}

/**
 * Single step item component
 */
function StepItem({
  step,
  index,
  showNumbers,
  showConnector,
  isLast,
  compact,
}: {
  step: Step;
  index: number;
  showNumbers: boolean;
  showConnector: boolean;
  isLast: boolean;
  compact: boolean;
}): ReactElement {
  const indicator = STATUS_INDICATORS[step.status];
  const color = STATUS_COLORS[step.status];
  const isActive = step.status === 'active';

  return (
    <Box flexDirection="column">
      <Box>
        {/* Status indicator */}
        <Text color={color} bold={isActive}>
          {indicator}
        </Text>

        {/* Step number (optional) */}
        {showNumbers && (
          <Text color="gray" dimColor>
            {` ${index + 1}.`}
          </Text>
        )}

        {/* Step label */}
        <Text
          color={step.status === 'pending' ? 'gray' : undefined}
          dimColor={step.status === 'pending' || step.status === 'skipped'}
          bold={isActive}
        >
          {' '}
          {step.label}
        </Text>

        {/* Active indicator */}
        {isActive && (
          <Text color="cyan" dimColor>
            {' '}
            (in progress)
          </Text>
        )}
      </Box>

      {/* Error message */}
      {step.status === 'error' && step.error && (
        <Box marginLeft={2}>
          <Text color="red" dimColor>
            {step.error}
          </Text>
        </Box>
      )}

      {/* Connector line */}
      {showConnector && !isLast && !compact && (
        <Box marginLeft={0}>
          <Text color="gray" dimColor>
            │
          </Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Multi-step progress indicator component
 *
 * Displays a vertical list of steps with visual status indicators for:
 * - pending: Waiting to be started
 * - active: Currently in progress
 * - completed: Successfully finished
 * - skipped: Intentionally skipped
 * - error: Failed with an error message
 */
export function StepProgress({
  steps,
  title,
  showNumbers = false,
  showConnectors = true,
  compact = false,
}: StepProgressProps): ReactElement {
  // Calculate progress statistics
  const completedCount = steps.filter(
    (s) => s.status === 'completed' || s.status === 'skipped'
  ).length;
  const totalCount = steps.length;
  const hasError = steps.some((s) => s.status === 'error');

  return (
    <Box flexDirection="column" marginY={compact ? 0 : 1}>
      {/* Title with progress count */}
      {title && (
        <Box marginBottom={1}>
          <Text bold>{title}</Text>
          <Text color="gray" dimColor>
            {` (${completedCount}/${totalCount})`}
          </Text>
          {hasError && (
            <Text color="red" bold>
              {' '}
              - Error
            </Text>
          )}
        </Box>
      )}

      {/* Step list */}
      <Box flexDirection="column">
        {steps.map((step, index) => (
          <StepItem
            key={step.id}
            step={step}
            index={index}
            showNumbers={showNumbers}
            showConnector={showConnectors}
            isLast={index === steps.length - 1}
            compact={compact}
          />
        ))}
      </Box>
    </Box>
  );
}

export default StepProgress;
