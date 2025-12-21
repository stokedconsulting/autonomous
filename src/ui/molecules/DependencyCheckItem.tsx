/**
 * DependencyCheckItem - Dependency status indicator component
 *
 * Displays a dependency check item with visual status indicators,
 * spinner animation while checking, and fix suggestions on failure.
 *
 * @example
 * ```tsx
 * <DependencyCheckItem
 *   name="node"
 *   status="pass"
 *   version="18.17.0"
 *   requiredVersion=">=18.0.0"
 * />
 *
 * <DependencyCheckItem
 *   name="pnpm"
 *   status="fail"
 *   fixCommand="npm install -g pnpm"
 * />
 *
 * <DependencyCheckItem
 *   name="docker"
 *   status="checking"
 * />
 * ```
 */

import { type ReactElement, useState, useEffect } from 'react';
import { Box, Text } from 'ink';

/**
 * Dependency check status type
 */
export type DependencyStatus = 'checking' | 'pass' | 'fail' | 'warn';

/**
 * Status indicator symbols for each dependency state
 */
const STATUS_INDICATORS = {
  checking: '', // Will be replaced by spinner
  pass: '✓',
  fail: '✗',
  warn: '⚠',
} as const;

/**
 * Color mapping for each status
 */
const STATUS_COLORS = {
  checking: 'cyan',
  pass: 'green',
  fail: 'red',
  warn: 'yellow',
} as const;

/**
 * Spinner frames for the checking animation
 */
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Spinner interval in milliseconds
 */
const SPINNER_INTERVAL = 80;

/**
 * Props for the DependencyCheckItem component
 */
export interface DependencyCheckItemProps {
  /**
   * Name of the dependency being checked
   */
  name: string;

  /**
   * Current status of the dependency check
   */
  status: DependencyStatus;

  /**
   * Detected version of the dependency (shown when status is pass/warn)
   */
  version?: string;

  /**
   * Required version specification for display
   */
  requiredVersion?: string;

  /**
   * Command to fix the dependency issue (shown on fail/warn)
   */
  fixCommand?: string;

  /**
   * Link for additional help (shown on fail/warn)
   */
  fixLink?: string;

  /**
   * Whether to use compact mode (single line only)
   * @default false
   */
  compact?: boolean;
}

/**
 * Spinner component for the checking state
 */
function Spinner(): ReactElement {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, SPINNER_INTERVAL);

    return () => clearInterval(timer);
  }, []);

  return (
    <Text color="cyan">{SPINNER_FRAMES[frameIndex]}</Text>
  );
}

/**
 * Status icon component that shows spinner or static icon
 */
function StatusIcon({ status }: { status: DependencyStatus }): ReactElement {
  if (status === 'checking') {
    return <Spinner />;
  }

  return (
    <Text color={STATUS_COLORS[status]} bold>
      {STATUS_INDICATORS[status]}
    </Text>
  );
}

/**
 * Dependency check item component
 *
 * Displays a single dependency with:
 * - Visual spinner during check
 * - ✓ for pass, ✗ for fail, ⚠ for warning
 * - Version info when available
 * - One-line fix suggestion visible without scrolling
 */
export function DependencyCheckItem({
  name,
  status,
  version,
  requiredVersion,
  fixCommand,
  fixLink,
  compact = false,
}: DependencyCheckItemProps): ReactElement {
  const showVersion = version && (status === 'pass' || status === 'warn');
  const showFix = (status === 'fail' || status === 'warn') && (fixCommand || fixLink);
  const isActive = status === 'checking';

  return (
    <Box flexDirection="column">
      {/* Main row with status, name, and version */}
      <Box>
        {/* Status indicator */}
        <StatusIcon status={status} />

        {/* Dependency name */}
        <Text
          color={status === 'fail' ? 'red' : undefined}
          dimColor={status === 'checking'}
          bold={isActive}
        >
          {' '}
          {name}
        </Text>

        {/* Version info */}
        {showVersion && (
          <Text color="gray" dimColor>
            {' '}
            v{version}
          </Text>
        )}

        {/* Required version specification */}
        {requiredVersion && showVersion && (
          <Text color="gray" dimColor>
            {' '}
            (requires {requiredVersion})
          </Text>
        )}

        {/* Checking status text */}
        {isActive && (
          <Text color="cyan" dimColor>
            {' '}
            checking...
          </Text>
        )}
      </Box>

      {/* Fix suggestion row (not in compact mode) */}
      {showFix && !compact && (
        <Box marginLeft={2}>
          {fixCommand && (
            <Text color="gray">
              <Text color="yellow">Fix: </Text>
              <Text color="white">{fixCommand}</Text>
            </Text>
          )}
          {fixLink && !fixCommand && (
            <Text color="gray">
              <Text color="yellow">Help: </Text>
              <Text color="cyan" underline>
                {fixLink}
              </Text>
            </Text>
          )}
          {fixLink && fixCommand && (
            <Text color="gray">
              {' '}
              <Text color="cyan" underline>
                (more info)
              </Text>
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}

/**
 * Helper to create a checking dependency item
 */
export function checkingDependency(
  name: string,
  options?: Omit<DependencyCheckItemProps, 'name' | 'status'>
): DependencyCheckItemProps {
  return { name, status: 'checking', ...options };
}

/**
 * Helper to create a passed dependency item
 */
export function passedDependency(
  name: string,
  version?: string,
  options?: Omit<DependencyCheckItemProps, 'name' | 'status' | 'version'>
): DependencyCheckItemProps {
  return { name, status: 'pass', version, ...options };
}

/**
 * Helper to create a failed dependency item
 */
export function failedDependency(
  name: string,
  fixCommand?: string,
  options?: Omit<DependencyCheckItemProps, 'name' | 'status' | 'fixCommand'>
): DependencyCheckItemProps {
  return { name, status: 'fail', fixCommand, ...options };
}

/**
 * Helper to create a warning dependency item
 */
export function warnDependency(
  name: string,
  version?: string,
  options?: Omit<DependencyCheckItemProps, 'name' | 'status' | 'version'>
): DependencyCheckItemProps {
  return { name, status: 'warn', version, ...options };
}

export default DependencyCheckItem;
