/**
 * renderCommand - Integration point between Commander actions and Ink
 *
 * This utility handles Ink's render/waitUntilExit lifecycle, provides error
 * boundaries, and returns exit codes for Commander actions to use.
 *
 * Usage:
 *   const exitCode = await renderCommand(<SetupUI />);
 *   process.exit(exitCode);
 */

import React, { Component, type ReactNode, type ReactElement } from 'react';
import { render, Box, Text } from 'ink';

/**
 * Exit codes for Commander actions
 */
export const ExitCode = {
  SUCCESS: 0,
  ERROR: 1,
  USER_ABORT: 130,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

/**
 * Context for components to signal exit with a specific code
 */
export interface RenderCommandContext {
  exit: (code?: ExitCodeValue) => void;
}

/**
 * Props for components that can control exit behavior
 */
export interface CommandComponentProps {
  onExit?: (code?: ExitCodeValue) => void;
}

/**
 * Props for the ErrorBoundary component
 */
interface ErrorBoundaryProps {
  children: ReactNode;
  onError?: (error: Error) => void;
}

/**
 * State for the ErrorBoundary component
 */
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error display component for user-friendly error messages
 */
function ErrorDisplay({ error }: { error: Error }): ReactElement {
  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Box>
        <Text color="red" bold>
          {'✗ Error: '}
        </Text>
        <Text color="red">{error.message}</Text>
      </Box>
      {error.stack && process.env.DEBUG && (
        <Box marginTop={1}>
          <Text color="gray" dimColor>
            {error.stack}
          </Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Error boundary component that catches React errors and displays them gracefully
 */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error): void {
    this.props.onError?.(error);
  }

  render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      return <ErrorDisplay error={this.state.error} />;
    }
    return this.props.children;
  }
}

/**
 * Options for renderCommand
 */
export interface RenderCommandOptions {
  /**
   * If true, errors will be rethrown after display
   * @default false
   */
  rethrowErrors?: boolean;

  /**
   * Custom exit code to use on error
   * @default ExitCode.ERROR
   */
  errorExitCode?: ExitCodeValue;

  /**
   * If true, debug information will be shown for errors
   * @default false (uses process.env.DEBUG)
   */
  debug?: boolean;
}

/**
 * Result returned by renderCommand
 */
export interface RenderCommandResult {
  /**
   * Exit code for the command
   */
  exitCode: ExitCodeValue;

  /**
   * Error that occurred, if any
   */
  error?: Error;
}

/**
 * Wrapper component that provides exit functionality and error boundary
 */
function CommandWrapper({
  children,
  onError,
  onExit,
}: {
  children: ReactElement;
  onError: (error: Error) => void;
  onExit: (code: ExitCodeValue) => void;
}): ReactElement {
  // Clone the child element to inject the onExit prop
  const childWithProps = React.cloneElement(children, {
    onExit,
  } as CommandComponentProps);

  return <ErrorBoundary onError={onError}>{childWithProps}</ErrorBoundary>;
}

/**
 * Renders an Ink component and waits for it to complete.
 *
 * This is the main integration point between Commander actions and Ink.
 * It handles the render/waitUntilExit lifecycle and provides error boundaries.
 *
 * @param element - The React element to render (typically an Ink component)
 * @param options - Optional configuration
 * @returns A promise that resolves to the exit code
 *
 * @example
 * ```typescript
 * // In a Commander action:
 * export async function setupCommand(options: SetupOptions): Promise<void> {
 *   const exitCode = await renderCommand(<SetupUI options={options} />);
 *   process.exit(exitCode);
 * }
 *
 * // In the Ink component:
 * function SetupUI({ options, onExit }: Props) {
 *   const handleComplete = () => {
 *     // Signal successful completion
 *     onExit?.(ExitCode.SUCCESS);
 *   };
 *
 *   // ... render UI
 * }
 * ```
 */
export async function renderCommand(
  element: ReactElement,
  options: RenderCommandOptions = {}
): Promise<ExitCodeValue> {
  const { rethrowErrors = false, errorExitCode = ExitCode.ERROR } = options;

  let exitCode: ExitCodeValue = ExitCode.SUCCESS;
  let caughtError: Error | undefined;

  const handleError = (error: Error): void => {
    exitCode = errorExitCode;
    caughtError = error;
  };

  const handleExit = (code: ExitCodeValue = ExitCode.SUCCESS): void => {
    exitCode = code;
  };

  try {
    const { waitUntilExit, unmount } = render(
      <CommandWrapper onError={handleError} onExit={handleExit}>
        {element}
      </CommandWrapper>
    );

    // Handle SIGINT (Ctrl+C) gracefully
    const handleSigint = (): void => {
      unmount();
      exitCode = ExitCode.USER_ABORT;
    };

    process.on('SIGINT', handleSigint);

    try {
      await waitUntilExit();
    } finally {
      process.off('SIGINT', handleSigint);
    }

    if (rethrowErrors && caughtError) {
      throw caughtError;
    }

    return exitCode;
  } catch (error) {
    // Handle any uncaught errors during rendering
    const err = error instanceof Error ? error : new Error(String(error));

    // Render error display as a fallback
    const { waitUntilExit } = render(<ErrorDisplay error={err} />);
    await waitUntilExit();

    if (rethrowErrors) {
      throw err;
    }

    return errorExitCode;
  }
}

/**
 * Extended version of renderCommand that returns full result details
 *
 * @param element - The React element to render
 * @param options - Optional configuration
 * @returns A promise that resolves to the full result including exit code and any error
 */
export async function renderCommandWithResult(
  element: ReactElement,
  options: RenderCommandOptions = {}
): Promise<RenderCommandResult> {
  const { errorExitCode = ExitCode.ERROR } = options;

  let exitCode: ExitCodeValue = ExitCode.SUCCESS;
  let caughtError: Error | undefined;

  const handleError = (error: Error): void => {
    exitCode = errorExitCode;
    caughtError = error;
  };

  const handleExit = (code: ExitCodeValue = ExitCode.SUCCESS): void => {
    exitCode = code;
  };

  try {
    const { waitUntilExit, unmount } = render(
      <CommandWrapper onError={handleError} onExit={handleExit}>
        {element}
      </CommandWrapper>
    );

    const handleSigint = (): void => {
      unmount();
      exitCode = ExitCode.USER_ABORT;
    };

    process.on('SIGINT', handleSigint);

    try {
      await waitUntilExit();
    } finally {
      process.off('SIGINT', handleSigint);
    }

    return {
      exitCode,
      error: caughtError,
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));

    const { waitUntilExit } = render(<ErrorDisplay error={err} />);
    await waitUntilExit();

    return {
      exitCode: errorExitCode,
      error: err,
    };
  }
}

export default renderCommand;
