/**
 * SetupPage - Interactive setup wizard with dependency checking
 *
 * Displays a checklist of required dependencies with live status updates
 * as each dependency is checked in parallel. Provides fix suggestions
 * for missing dependencies.
 *
 * @example
 * ```tsx
 * <SetupPage
 *   onComplete={(result) => console.log('Setup complete:', result)}
 *   onExit={() => process.exit(0)}
 * />
 * ```
 */

import { useState, useEffect, useCallback, useRef, type ReactElement } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { ResultSummary, type ResultStatus } from '../molecules/ResultSummary.js';

/**
 * Dependency check result
 */
export interface DependencyCheckResult {
  /**
   * Name of the dependency
   */
  name: string;

  /**
   * Whether this dependency is required or optional
   */
  required: boolean;

  /**
   * Whether the dependency is installed
   */
  installed: boolean;

  /**
   * Version of the installed dependency
   */
  version?: string;

  /**
   * Command or instructions to install the dependency
   */
  installCommand?: string;

  /**
   * Description of what the dependency is used for
   */
  purpose: string;
}

/**
 * Setup result containing all dependency check results
 */
export interface SetupResult {
  /**
   * All dependency check results
   */
  dependencies: DependencyCheckResult[];

  /**
   * Whether all required dependencies are installed
   */
  allRequiredInstalled: boolean;

  /**
   * Duration of the setup check in milliseconds
   */
  duration: number;
}

/**
 * Dependency check function type
 */
export type DependencyCheckFn = () => Promise<DependencyCheckResult>;

/**
 * Props for the SetupPage component
 */
export interface SetupPageProps {
  /**
   * Callback when setup is complete
   */
  onComplete?: (result: SetupResult) => void;

  /**
   * Callback when user exits the setup
   */
  onExit?: () => void;

  /**
   * Whether the component is active (accepting input)
   * @default true
   */
  isActive?: boolean;

  /**
   * Custom dependency check functions
   * If not provided, uses the default DependencyChecker
   */
  dependencyChecks?: DependencyCheckFn[];

  /**
   * Title shown at the top of the setup page
   * @default 'Environment Setup'
   */
  title?: string;

  /**
   * Whether to auto-start checking dependencies
   * @default true
   */
  autoStart?: boolean;
}

/**
 * Status indicator symbols
 */
const STATUS_ICONS = {
  pending: '○',
  checking: '◉',
  success: '✓',
  warning: '⚠',
  error: '✗',
} as const;

/**
 * Default dependency definitions
 */
const DEFAULT_DEPENDENCIES: Array<{
  id: string;
  name: string;
  required: boolean;
  purpose: string;
}> = [
  { id: 'git', name: 'Git', required: true, purpose: 'Version control and worktree management' },
  { id: 'node', name: 'Node.js', required: true, purpose: 'JavaScript runtime for CLI execution' },
  { id: 'claude', name: 'Claude CLI', required: true, purpose: 'AI-powered code analysis and generation' },
  { id: 'gh', name: 'GitHub CLI (gh)', required: false, purpose: 'Pull request creation and management' },
  { id: 'pnpm', name: 'Package Manager', required: false, purpose: 'Dependency management' },
];

/**
 * Check status for a dependency
 */
type CheckStatus = 'pending' | 'checking' | 'success' | 'warning' | 'error';

/**
 * Internal dependency state
 */
interface DependencyState {
  id: string;
  name: string;
  required: boolean;
  purpose: string;
  status: CheckStatus;
  result?: DependencyCheckResult;
  error?: string;
}

/**
 * Individual dependency item component
 */
function DependencyItem({
  dep,
  showDetails = false,
}: {
  dep: DependencyState;
  showDetails?: boolean;
}): ReactElement {
  const getStatusColor = (status: CheckStatus): string => {
    switch (status) {
      case 'pending':
        return 'gray';
      case 'checking':
        return 'cyan';
      case 'success':
        return 'green';
      case 'warning':
        return 'yellow';
      case 'error':
        return 'red';
    }
  };

  const getIcon = (status: CheckStatus): string => {
    return STATUS_ICONS[status];
  };

  const color = getStatusColor(dep.status);
  const icon = getIcon(dep.status);
  const isActive = dep.status === 'checking';

  return (
    <Box flexDirection="column">
      <Box>
        {/* Status icon */}
        <Text color={color} bold={isActive}>
          {icon}
        </Text>

        {/* Dependency name */}
        <Text
          color={dep.status === 'pending' ? 'gray' : undefined}
          dimColor={dep.status === 'pending'}
          bold={isActive}
        >
          {' '}
          {dep.name}
        </Text>

        {/* Required badge */}
        {dep.required && (
          <Text color="yellow" dimColor>
            {' '}
            (required)
          </Text>
        )}

        {/* Version if available */}
        {dep.result?.version && (
          <Text color="gray" dimColor>
            {' '}
            v{dep.result.version}
          </Text>
        )}

        {/* Status indicator for checking */}
        {isActive && (
          <Text color="cyan" dimColor>
            {' '}
            checking...
          </Text>
        )}
      </Box>

      {/* Purpose description */}
      {showDetails && (
        <Box marginLeft={2}>
          <Text color="gray" dimColor>
            {dep.purpose}
          </Text>
        </Box>
      )}

      {/* Error/install instructions */}
      {(dep.status === 'error' || dep.status === 'warning') && dep.result?.installCommand && (
        <Box marginLeft={2} flexDirection="column">
          <Text color={dep.status === 'error' ? 'red' : 'yellow'} dimColor>
            Install: {dep.result.installCommand}
          </Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Checklist header component
 */
function ChecklistHeader({
  title,
  completedCount,
  totalCount,
  isChecking,
}: {
  title: string;
  completedCount: number;
  totalCount: number;
  isChecking: boolean;
}): ReactElement {
  return (
    <Box marginBottom={1}>
      <Text color="cyan" bold>
        {title}
      </Text>
      <Text color="gray" dimColor>
        {' '}
        ({completedCount}/{totalCount})
      </Text>
      {isChecking && (
        <Text color="cyan" dimColor>
          {' '}
          - Checking...
        </Text>
      )}
    </Box>
  );
}

/**
 * Next steps component for failures
 */
function NextSteps({
  missingDeps,
}: {
  missingDeps: DependencyState[];
}): ReactElement {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="yellow" bold>
        Recommended Actions:
      </Text>
      <Box flexDirection="column" marginLeft={2}>
        {missingDeps.map((dep, index) => (
          <Box key={dep.id} flexDirection="column">
            <Box>
              <Text color="gray">{index + 1}. </Text>
              <Text>
                Install {dep.name}
                {dep.required ? ' (required)' : ' (optional)'}
              </Text>
            </Box>
            {dep.result?.installCommand && (
              <Box marginLeft={3}>
                <Text color="gray">$ </Text>
                <Text color="cyan">{dep.result.installCommand}</Text>
              </Box>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/**
 * Interactive setup page with dependency checking
 *
 * Checks all required and optional dependencies in parallel,
 * displaying live status updates and fix suggestions for
 * any missing dependencies.
 *
 * Keyboard controls:
 * - Enter: Start checking (if not auto-started)
 * - r: Retry failed checks
 * - q or Escape: Exit
 */
export function SetupPage({
  onComplete,
  onExit,
  isActive = true,
  dependencyChecks,
  title = 'Environment Setup',
  autoStart = true,
}: SetupPageProps): ReactElement {
  const { exit } = useApp();
  const startTimeRef = useRef<number>(0);

  // Initialize dependency states
  const [dependencies, setDependencies] = useState<DependencyState[]>(() =>
    DEFAULT_DEPENDENCIES.map((dep) => ({
      ...dep,
      status: 'pending' as CheckStatus,
    }))
  );

  const [isChecking, setIsChecking] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);

  /**
   * Check a single dependency
   */
  const checkDependency = useCallback(
    async (depId: string): Promise<DependencyCheckResult> => {
      // Use custom checks if provided
      if (dependencyChecks) {
        const index = DEFAULT_DEPENDENCIES.findIndex((d) => d.id === depId);
        if (index >= 0 && dependencyChecks[index]) {
          return dependencyChecks[index]();
        }
      }

      // Default dependency checks
      const { $ } = await import('zx');
      $.verbose = false;

      switch (depId) {
        case 'git': {
          try {
            const result = await $`git --version`;
            const version = result.stdout.trim().replace('git version ', '');
            return {
              name: 'Git',
              required: true,
              installed: true,
              version,
              purpose: 'Version control and worktree management',
            };
          } catch {
            return {
              name: 'Git',
              required: true,
              installed: false,
              installCommand: 'brew install git',
              purpose: 'Version control and worktree management',
            };
          }
        }

        case 'node': {
          try {
            const result = await $`node --version`;
            const version = result.stdout.trim().replace('v', '');
            return {
              name: 'Node.js',
              required: true,
              installed: true,
              version,
              purpose: 'JavaScript runtime for CLI execution',
            };
          } catch {
            return {
              name: 'Node.js',
              required: true,
              installed: false,
              installCommand: 'brew install node',
              purpose: 'JavaScript runtime for CLI execution',
            };
          }
        }

        case 'claude': {
          try {
            // Try 'claude' command first
            let result;
            try {
              result = await $`claude --version`;
            } catch {
              // Try 'cld' as alternative
              result = await $`cld --version`;
            }
            const version = result.stdout.trim();
            return {
              name: 'Claude CLI',
              required: true,
              installed: true,
              version,
              purpose: 'AI-powered code analysis and generation',
            };
          } catch {
            return {
              name: 'Claude CLI',
              required: true,
              installed: false,
              installCommand: 'Visit https://claude.ai/download',
              purpose: 'AI-powered code analysis and generation',
            };
          }
        }

        case 'gh': {
          try {
            const result = await $`gh --version`;
            const versionLine = result.stdout.split('\n')[0];
            const version = versionLine.replace('gh version ', '').trim().split(' ')[0];
            return {
              name: 'GitHub CLI (gh)',
              required: false,
              installed: true,
              version,
              purpose: 'Pull request creation and management',
            };
          } catch {
            return {
              name: 'GitHub CLI (gh)',
              required: false,
              installed: false,
              installCommand: 'brew install gh',
              purpose: 'Pull request creation and management',
            };
          }
        }

        case 'pnpm': {
          // Check for pnpm, npm, or yarn
          try {
            const result = await $`pnpm --version`;
            return {
              name: 'pnpm',
              required: false,
              installed: true,
              version: result.stdout.trim(),
              purpose: 'Package management (preferred for monorepos)',
            };
          } catch {
            try {
              const result = await $`npm --version`;
              return {
                name: 'npm',
                required: false,
                installed: true,
                version: result.stdout.trim(),
                purpose: 'Package management',
              };
            } catch {
              try {
                const result = await $`yarn --version`;
                return {
                  name: 'yarn',
                  required: false,
                  installed: true,
                  version: result.stdout.trim(),
                  purpose: 'Package management',
                };
              } catch {
                return {
                  name: 'Package Manager',
                  required: false,
                  installed: false,
                  installCommand: 'npm install -g pnpm',
                  purpose: 'Package management',
                };
              }
            }
          }
        }

        default:
          throw new Error(`Unknown dependency: ${depId}`);
      }
    },
    [dependencyChecks]
  );

  /**
   * Update a single dependency's state
   */
  const updateDependency = useCallback((depId: string, updates: Partial<DependencyState>) => {
    setDependencies((prev) =>
      prev.map((dep) => (dep.id === depId ? { ...dep, ...updates } : dep))
    );
  }, []);

  /**
   * Run all dependency checks in parallel
   */
  const runChecks = useCallback(async () => {
    setIsChecking(true);
    setHasStarted(true);
    startTimeRef.current = Date.now();

    // Mark all as checking
    setDependencies((prev) =>
      prev.map((dep) => ({ ...dep, status: 'checking' as CheckStatus }))
    );

    // Run all checks in parallel
    const checkPromises = DEFAULT_DEPENDENCIES.map(async (dep) => {
      try {
        // Small stagger to visualize parallel execution
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 100));

        const result = await checkDependency(dep.id);

        // Determine status based on result
        let status: CheckStatus;
        if (result.installed) {
          status = 'success';
        } else if (result.required) {
          status = 'error';
        } else {
          status = 'warning';
        }

        updateDependency(dep.id, { status, result });
        return { id: dep.id, result, status };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        updateDependency(dep.id, {
          status: 'error',
          error: errorMsg,
          result: {
            name: dep.name,
            required: dep.required,
            installed: false,
            purpose: dep.purpose,
          },
        });
        return { id: dep.id, status: 'error' as CheckStatus, error: errorMsg };
      }
    });

    await Promise.all(checkPromises);
    setIsChecking(false);
    setIsComplete(true);
  }, [checkDependency, updateDependency]);

  /**
   * Calculate final result and call onComplete
   */
  useEffect(() => {
    if (isComplete && !isChecking) {
      const duration = Date.now() - startTimeRef.current;
      const allResults = dependencies.map((dep) => dep.result).filter(Boolean) as DependencyCheckResult[];
      const allRequiredInstalled = dependencies
        .filter((dep) => dep.required)
        .every((dep) => dep.status === 'success');

      const result: SetupResult = {
        dependencies: allResults,
        allRequiredInstalled,
        duration,
      };

      onComplete?.(result);
    }
  }, [isComplete, isChecking, dependencies, onComplete]);

  /**
   * Auto-start if configured
   */
  useEffect(() => {
    if (autoStart && !hasStarted) {
      runChecks();
    }
  }, [autoStart, hasStarted, runChecks]);

  /**
   * Handle exit
   */
  const handleExit = useCallback(() => {
    if (onExit) {
      onExit();
    } else {
      exit();
    }
  }, [onExit, exit]);

  /**
   * Keyboard input handler
   */
  useInput(
    (input, key) => {
      if (!isActive) return;

      // Start checking with Enter
      if (key.return && !hasStarted && !isChecking) {
        runChecks();
        return;
      }

      // Retry with 'r'
      if ((input === 'r' || input === 'R') && isComplete && !isChecking) {
        setIsComplete(false);
        setDependencies((prev) =>
          prev.map((dep) => ({
            ...dep,
            status: 'pending' as CheckStatus,
            result: undefined,
            error: undefined,
          }))
        );
        runChecks();
        return;
      }

      // Exit with 'q' or Escape
      if (input === 'q' || key.escape) {
        handleExit();
        return;
      }
    },
    { isActive }
  );

  // Calculate statistics
  const completedCount = dependencies.filter(
    (d) => d.status === 'success' || d.status === 'warning' || d.status === 'error'
  ).length;
  const successCount = dependencies.filter((d) => d.status === 'success').length;
  const errorCount = dependencies.filter((d) => d.status === 'error').length;
  const warningCount = dependencies.filter((d) => d.status === 'warning').length;
  const missingDeps = dependencies.filter(
    (d) => d.status === 'error' || d.status === 'warning'
  );
  const allRequiredInstalled = dependencies
    .filter((d) => d.required)
    .every((d) => d.status === 'success');

  // Determine overall status
  const getOverallStatus = (): ResultStatus => {
    if (errorCount > 0 && dependencies.some((d) => d.required && d.status === 'error')) {
      return 'error';
    }
    if (warningCount > 0 || errorCount > 0) {
      return 'warning';
    }
    return 'success';
  };

  return (
    <Box flexDirection="column" paddingY={1}>
      {/* Header */}
      <Box marginBottom={1} paddingX={1}>
        <Text color="cyan" bold>
          {title}
        </Text>
      </Box>

      {/* Description */}
      <Box marginBottom={1} paddingX={1}>
        <Text color="gray">
          Checking required and optional dependencies for the autonomous CLI...
        </Text>
      </Box>

      {/* Dependency checklist */}
      <Box flexDirection="column" paddingX={1}>
        <ChecklistHeader
          title="Dependencies"
          completedCount={completedCount}
          totalCount={dependencies.length}
          isChecking={isChecking}
        />

        {/* Dependency items */}
        <Box flexDirection="column" marginLeft={1}>
          {dependencies.map((dep) => (
            <DependencyItem
              key={dep.id}
              dep={dep}
              showDetails={isComplete && (dep.status === 'error' || dep.status === 'warning')}
            />
          ))}
        </Box>
      </Box>

      {/* Result summary when complete */}
      {isComplete && !isChecking && (
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          <ResultSummary
            status={getOverallStatus()}
            title={
              allRequiredInstalled
                ? 'Environment Ready'
                : 'Missing Required Dependencies'
            }
            subtitle={
              allRequiredInstalled
                ? `${successCount} dependencies installed${warningCount > 0 ? `, ${warningCount} optional missing` : ''}`
                : `${errorCount} required ${errorCount === 1 ? 'dependency' : 'dependencies'} missing`
            }
            details={[
              { label: 'Installed', value: successCount, color: 'green' },
              { label: 'Missing (optional)', value: warningCount, color: 'yellow' },
              { label: 'Missing (required)', value: errorCount, color: 'red' },
            ].filter((d) => (d.value as number) > 0)}
            duration={Date.now() - startTimeRef.current}
          />

          {/* Next steps for missing dependencies */}
          {missingDeps.length > 0 && <NextSteps missingDeps={missingDeps} />}
        </Box>
      )}

      {/* Keyboard hints */}
      <Box marginTop={1} paddingX={1}>
        <Text color="gray" dimColor>
          {!hasStarted
            ? '(Press Enter to start, q to exit)'
            : isChecking
              ? '(Checking dependencies...)'
              : isComplete
                ? '(Press r to retry, q to exit)'
                : '(q to exit)'}
        </Text>
      </Box>
    </Box>
  );
}

export default SetupPage;
