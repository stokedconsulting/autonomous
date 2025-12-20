/**
 * ErrorBoundary - React error boundary component for Ink UI
 *
 * Catches errors in child components and displays a user-friendly error message.
 */

import { Component, type ReactNode, type ReactElement } from 'react';
import { Box, Text } from 'ink';

/**
 * Props for the ErrorDisplay component
 */
export interface ErrorDisplayProps {
  /**
   * The error to display
   */
  error: Error;

  /**
   * Title shown before the error message
   * @default "Error"
   */
  title?: string;

  /**
   * Whether to show the stack trace
   * @default Uses process.env.DEBUG
   */
  showStack?: boolean;
}

/**
 * Error display component for user-friendly error messages
 *
 * Displays an error with consistent styling and optional stack trace.
 *
 * @example
 * ```tsx
 * <ErrorDisplay
 *   error={new Error("Something went wrong")}
 *   title="Configuration Error"
 *   showStack={true}
 * />
 * ```
 */
export function ErrorDisplay({
  error,
  title = 'Error',
  showStack,
}: ErrorDisplayProps): ReactElement {
  const shouldShowStack = showStack ?? !!process.env.DEBUG;

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Box>
        <Text color="red" bold>
          {`✗ ${title}: `}
        </Text>
        <Text color="red">{error.message}</Text>
      </Box>
      {shouldShowStack && error.stack && (
        <Box marginTop={1} flexDirection="column">
          <Text color="gray" dimColor>
            Stack trace:
          </Text>
          <Box marginLeft={2}>
            <Text color="gray" dimColor>
              {error.stack
                .split('\n')
                .slice(1)
                .map((line) => line.trim())
                .join('\n')}
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}

/**
 * Props for the ErrorBoundary component
 */
export interface ErrorBoundaryProps {
  /**
   * Child components to render
   */
  children: ReactNode;

  /**
   * Callback when an error is caught
   */
  onError?: (error: Error) => void;

  /**
   * Custom fallback component to render on error
   * If not provided, ErrorDisplay is used
   */
  fallback?: ReactElement | ((error: Error) => ReactElement);

  /**
   * Title for the error display
   * @default "Error"
   */
  errorTitle?: string;

  /**
   * Whether to show stack traces
   */
  showStack?: boolean;
}

/**
 * State for the ErrorBoundary component
 */
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary component that catches React errors and displays them gracefully
 *
 * This component wraps child components and catches any errors that occur during
 * rendering, displaying a user-friendly error message instead of crashing.
 *
 * @example
 * ```tsx
 * <ErrorBoundary
 *   onError={(err) => logger.error('UI error:', err)}
 *   errorTitle="Setup Failed"
 * >
 *   <SetupWizard />
 * </ErrorBoundary>
 * ```
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
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
      const { fallback, errorTitle, showStack } = this.props;

      if (fallback) {
        if (typeof fallback === 'function') {
          return fallback(this.state.error);
        }
        return fallback;
      }

      return (
        <ErrorDisplay
          error={this.state.error}
          title={errorTitle}
          showStack={showStack}
        />
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
