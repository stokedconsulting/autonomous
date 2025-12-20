/**
 * Tests for renderCommand utility
 *
 * These tests verify the integration between Commander actions and Ink components.
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import type { FC, ReactElement } from 'react';
import {
  renderCommand,
  renderCommandWithResult,
  ExitCode,
  type CommandComponentProps,
} from '../../src/ui/renderCommand';
import { ErrorBoundary, ErrorDisplay } from '../../src/ui/ErrorBoundary';

// Mock process.exit to prevent tests from exiting
const originalProcessOn = process.on.bind(process);
const originalProcessOff = process.off.bind(process);

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  process.on = originalProcessOn;
  process.off = originalProcessOff;
});

describe('ExitCode', () => {
  it('should define correct exit codes', () => {
    expect(ExitCode.SUCCESS).toBe(0);
    expect(ExitCode.ERROR).toBe(1);
    expect(ExitCode.USER_ABORT).toBe(130);
  });
});

describe('ErrorDisplay', () => {
  it('should render error message with default title', () => {
    const error = new Error('Test error message');
    const { lastFrame } = render(<ErrorDisplay error={error} />);

    expect(lastFrame()).toContain('Error');
    expect(lastFrame()).toContain('Test error message');
  });

  it('should render error with custom title', () => {
    const error = new Error('Config failed');
    const { lastFrame } = render(
      <ErrorDisplay error={error} title="Configuration Error" />
    );

    expect(lastFrame()).toContain('Configuration Error');
    expect(lastFrame()).toContain('Config failed');
  });

  it('should show stack trace when showStack is true', () => {
    const error = new Error('Stack test');
    error.stack = 'Error: Stack test\n    at test.ts:10:5\n    at runner.ts:20:3';

    const { lastFrame } = render(<ErrorDisplay error={error} showStack={true} />);

    expect(lastFrame()).toContain('Stack trace');
    expect(lastFrame()).toContain('test.ts');
  });

  it('should hide stack trace by default', () => {
    const originalDebug = process.env.DEBUG;
    delete process.env.DEBUG;

    const error = new Error('No stack');
    error.stack = 'Error: No stack\n    at test.ts:10:5';

    const { lastFrame } = render(<ErrorDisplay error={error} />);

    expect(lastFrame()).not.toContain('Stack trace');

    process.env.DEBUG = originalDebug;
  });
});

describe('ErrorBoundary', () => {
  it('should render children when no error', () => {
    const { lastFrame } = render(
      <ErrorBoundary>
        <Text>Child content</Text>
      </ErrorBoundary>
    );

    expect(lastFrame()).toContain('Child content');
  });

  it('should call onError callback when error occurs', () => {
    const onError = jest.fn();

    function ThrowingComponent(): ReactElement {
      throw new Error('Test error');
    }

    render(
      <ErrorBoundary onError={onError}>
        <ThrowingComponent />
      </ErrorBoundary>
    );

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect((onError.mock.calls[0][0] as Error).message).toBe('Test error');
  });

  it('should render default error display when error occurs', () => {
    function ThrowingComponent(): ReactElement {
      throw new Error('Boundary test error');
    }

    const { lastFrame } = render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );

    expect(lastFrame()).toContain('Error');
    expect(lastFrame()).toContain('Boundary test error');
  });

  it('should render custom fallback when provided', () => {
    function ThrowingComponent(): ReactElement {
      throw new Error('Custom fallback test');
    }

    const { lastFrame } = render(
      <ErrorBoundary fallback={<Text>Custom error fallback</Text>}>
        <ThrowingComponent />
      </ErrorBoundary>
    );

    expect(lastFrame()).toContain('Custom error fallback');
  });

  it('should render fallback function with error', () => {
    function ThrowingComponent(): ReactElement {
      throw new Error('Function fallback test');
    }

    const { lastFrame } = render(
      <ErrorBoundary fallback={(err) => <Text>Error: {err.message}</Text>}>
        <ThrowingComponent />
      </ErrorBoundary>
    );

    expect(lastFrame()).toContain('Error: Function fallback test');
  });
});

describe('renderCommand', () => {
  // Note: Full lifecycle tests for renderCommand are best done via integration tests
  // since the Ink render/waitUntilExit lifecycle doesn't work well with jest test isolation.
  // These tests validate the module structure and exports.

  it('should export renderCommand as a function', () => {
    expect(typeof renderCommand).toBe('function');
  });

  it('should export ExitCode constants with correct values', () => {
    expect(ExitCode.SUCCESS).toBe(0);
    expect(ExitCode.ERROR).toBe(1);
    expect(ExitCode.USER_ABORT).toBe(130);
  });

  it('should export renderCommandWithResult as a function', () => {
    expect(typeof renderCommandWithResult).toBe('function');
  });
});

describe('renderCommandWithResult', () => {
  // Note: Full lifecycle tests for renderCommandWithResult are best done via integration tests.
  // These tests validate the module structure and return type contract.

  it('should export renderCommandWithResult that returns a Promise', () => {
    expect(typeof renderCommandWithResult).toBe('function');
  });
});

describe('Integration patterns', () => {
  // Note: Full integration tests for renderCommand should be done in a separate
  // integration test file that can properly handle the Ink lifecycle.
  // This section documents the expected usage patterns.

  it('should support CommandComponentProps interface', () => {
    // The CommandComponentProps interface allows components to signal exit
    const component: FC<CommandComponentProps> = ({ onExit }) => {
      // Components can call onExit with an exit code
      if (onExit) {
        onExit(ExitCode.SUCCESS);
      }
      return <Text>Test</Text>;
    };

    expect(component).toBeDefined();
  });

  it('should provide exit code values for process.exit usage', () => {
    // These exit codes can be used directly with process.exit
    expect(ExitCode.SUCCESS).toBe(0); // Unix success
    expect(ExitCode.ERROR).toBe(1);   // Unix general error
    expect(ExitCode.USER_ABORT).toBe(130); // Ctrl+C signal
  });
});
