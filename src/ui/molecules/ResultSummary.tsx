/**
 * ResultSummary - Success/failure summary component with details
 *
 * Displays operation results with visual status indicators,
 * detailed information, and optional next steps.
 *
 * @example
 * ```tsx
 * <ResultSummary
 *   status="success"
 *   title="Repository Created"
 *   details={[
 *     { label: 'Name', value: 'my-project' },
 *     { label: 'Path', value: '/home/user/my-project' },
 *   ]}
 *   nextSteps={[
 *     'cd my-project',
 *     'npm install',
 *   ]}
 * />
 * ```
 */

import type { ReactElement } from 'react';
import { Box, Text } from 'ink';

/**
 * Result status type
 */
export type ResultStatus = 'success' | 'warning' | 'error' | 'info';

/**
 * Detail item for the result summary
 */
export interface ResultDetail {
  /**
   * Label for the detail
   */
  label: string;

  /**
   * Value to display
   */
  value: string | number;

  /**
   * Optional color override for the value
   */
  color?: string;
}

/**
 * Status configuration for visual styling
 */
const STATUS_CONFIG = {
  success: {
    icon: '✓',
    color: 'green',
    bgColor: undefined,
  },
  warning: {
    icon: '⚠',
    color: 'yellow',
    bgColor: undefined,
  },
  error: {
    icon: '✗',
    color: 'red',
    bgColor: undefined,
  },
  info: {
    icon: 'ℹ',
    color: 'blue',
    bgColor: undefined,
  },
} as const;

/**
 * Props for the ResultSummary component
 */
export interface ResultSummaryProps {
  /**
   * Result status
   */
  status: ResultStatus;

  /**
   * Main title/message
   */
  title: string;

  /**
   * Optional subtitle or description
   */
  subtitle?: string;

  /**
   * Array of detail items to display
   */
  details?: ResultDetail[];

  /**
   * Optional list of next steps or commands
   */
  nextSteps?: string[];

  /**
   * Optional error object for error status
   */
  error?: Error;

  /**
   * Whether to show duration
   */
  duration?: number;

  /**
   * Whether to use compact mode
   * @default false
   */
  compact?: boolean;

  /**
   * Whether to show a border around the summary
   * @default false
   */
  bordered?: boolean;
}

/**
 * Detail row component
 */
function DetailRow({
  detail,
  labelWidth,
}: {
  detail: ResultDetail;
  labelWidth: number;
}): ReactElement {
  return (
    <Box>
      <Text color="gray">{detail.label.padEnd(labelWidth)}: </Text>
      <Text color={detail.color as 'green' | 'red' | 'yellow' | 'blue' | 'cyan' | undefined}>
        {String(detail.value)}
      </Text>
    </Box>
  );
}

/**
 * Success/failure summary component
 *
 * Displays operation results with:
 * - Status icon and title
 * - Optional subtitle
 * - Key-value detail pairs
 * - Next steps or commands
 * - Error information for failures
 */
export function ResultSummary({
  status,
  title,
  subtitle,
  details,
  nextSteps,
  error,
  duration,
  compact = false,
  bordered = false,
}: ResultSummaryProps): ReactElement {
  const config = STATUS_CONFIG[status];

  // Calculate label width for alignment
  const labelWidth = details
    ? Math.max(...details.map((d) => d.label.length))
    : 0;

  // Format duration
  const formattedDuration = duration
    ? duration >= 1000
      ? `${(duration / 1000).toFixed(1)}s`
      : `${duration}ms`
    : null;

  const content = (
    <Box flexDirection="column" paddingX={bordered ? 1 : 0}>
      {/* Header with status icon and title */}
      <Box>
        <Text color={config.color} bold>
          {config.icon}{' '}
        </Text>
        <Text bold>{title}</Text>
        {formattedDuration && (
          <Text color="gray" dimColor>
            {' '}
            ({formattedDuration})
          </Text>
        )}
      </Box>

      {/* Subtitle */}
      {subtitle && !compact && (
        <Box marginLeft={2} marginTop={0}>
          <Text color="gray">{subtitle}</Text>
        </Box>
      )}

      {/* Details */}
      {details && details.length > 0 && !compact && (
        <Box flexDirection="column" marginLeft={2} marginTop={1}>
          {details.map((detail, index) => (
            <DetailRow key={index} detail={detail} labelWidth={labelWidth} />
          ))}
        </Box>
      )}

      {/* Error details */}
      {status === 'error' && error && !compact && (
        <Box flexDirection="column" marginLeft={2} marginTop={1}>
          <Text color="red" dimColor>
            {error.message}
          </Text>
          {process.env.DEBUG && error.stack && (
            <Box marginTop={1}>
              <Text color="gray" dimColor>
                {error.stack
                  .split('\n')
                  .slice(1, 4)
                  .map((line) => line.trim())
                  .join('\n')}
              </Text>
            </Box>
          )}
        </Box>
      )}

      {/* Next steps */}
      {nextSteps && nextSteps.length > 0 && status === 'success' && !compact && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="cyan" bold>
            Next steps:
          </Text>
          <Box flexDirection="column" marginLeft={2}>
            {nextSteps.map((step, index) => (
              <Box key={index}>
                <Text color="gray">{index + 1}. </Text>
                <Text color="white">{step}</Text>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Warning next steps */}
      {nextSteps && nextSteps.length > 0 && status === 'warning' && !compact && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="yellow" bold>
            Recommended actions:
          </Text>
          <Box flexDirection="column" marginLeft={2}>
            {nextSteps.map((step, index) => (
              <Box key={index}>
                <Text color="gray">• </Text>
                <Text>{step}</Text>
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );

  // Wrap in border if requested
  if (bordered) {
    return (
      <Box
        borderStyle="round"
        borderColor={config.color}
        paddingX={1}
        marginY={1}
      >
        {content}
      </Box>
    );
  }

  return <Box marginY={compact ? 0 : 1}>{content}</Box>;
}

/**
 * Helper to create a success result
 */
export function successResult(
  title: string,
  options?: Omit<ResultSummaryProps, 'status' | 'title'>
): ResultSummaryProps {
  return { status: 'success', title, ...options };
}

/**
 * Helper to create an error result
 */
export function errorResult(
  title: string,
  error?: Error,
  options?: Omit<ResultSummaryProps, 'status' | 'title' | 'error'>
): ResultSummaryProps {
  return { status: 'error', title, error, ...options };
}

/**
 * Helper to create a warning result
 */
export function warningResult(
  title: string,
  options?: Omit<ResultSummaryProps, 'status' | 'title'>
): ResultSummaryProps {
  return { status: 'warning', title, ...options };
}

/**
 * Helper to create an info result
 */
export function infoResult(
  title: string,
  options?: Omit<ResultSummaryProps, 'status' | 'title'>
): ResultSummaryProps {
  return { status: 'info', title, ...options };
}

export default ResultSummary;
