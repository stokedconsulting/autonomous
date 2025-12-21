/**
 * Tests for SetupPage component
 *
 * Note: ink-testing-library has limited support for components with useInput.
 * These tests focus on rendering with isActive=false to avoid cleanup issues.
 * Async behavior is tested with custom dependency checks that resolve immediately.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render } from 'ink-testing-library';
import {
  SetupPage,
  type SetupPageProps,
  type DependencyCheckResult,
  type DependencyCheckFn,
} from '../../../src/ui/pages/SetupPage.js';

describe('SetupPage', () => {
  const mockOnComplete = jest.fn<(result: any) => void>();
  const mockOnExit = jest.fn<() => void>();

  beforeEach(() => {
    mockOnComplete.mockClear();
    mockOnExit.mockClear();
  });

  /**
   * Create mock dependency check functions that resolve immediately
   */
  const createMockChecks = (results: DependencyCheckResult[]): DependencyCheckFn[] => {
    return results.map((result) => jest.fn<DependencyCheckFn>().mockResolvedValue(result));
  };

  /**
   * Sample successful dependency results
   */
  const successfulDependencies: DependencyCheckResult[] = [
    { name: 'Git', required: true, installed: true, version: '2.40.0', purpose: 'Version control' },
    { name: 'Node.js', required: true, installed: true, version: '20.10.0', purpose: 'JavaScript runtime' },
    { name: 'Claude CLI', required: true, installed: true, version: '1.0.0', purpose: 'AI analysis' },
    { name: 'GitHub CLI', required: false, installed: true, version: '2.30.0', purpose: 'PR management' },
    { name: 'pnpm', required: false, installed: true, version: '8.10.0', purpose: 'Package management' },
  ];

  /**
   * Sample mixed dependency results (some missing)
   */
  const mixedDependencies: DependencyCheckResult[] = [
    { name: 'Git', required: true, installed: true, version: '2.40.0', purpose: 'Version control' },
    { name: 'Node.js', required: true, installed: true, version: '20.10.0', purpose: 'JavaScript runtime' },
    { name: 'Claude CLI', required: true, installed: false, installCommand: 'brew install claude', purpose: 'AI analysis' },
    { name: 'GitHub CLI', required: false, installed: false, installCommand: 'brew install gh', purpose: 'PR management' },
    { name: 'pnpm', required: false, installed: true, version: '8.10.0', purpose: 'Package management' },
  ];

  /**
   * Sample failed dependency results
   */
  const failedDependencies: DependencyCheckResult[] = [
    { name: 'Git', required: true, installed: false, installCommand: 'brew install git', purpose: 'Version control' },
    { name: 'Node.js', required: true, installed: false, installCommand: 'brew install node', purpose: 'JavaScript runtime' },
    { name: 'Claude CLI', required: true, installed: false, installCommand: 'Visit https://claude.ai/download', purpose: 'AI analysis' },
    { name: 'GitHub CLI', required: false, installed: false, installCommand: 'brew install gh', purpose: 'PR management' },
    { name: 'pnpm', required: false, installed: false, installCommand: 'npm install -g pnpm', purpose: 'Package management' },
  ];

  describe('basic rendering', () => {
    it('should render the default title', () => {
      const { lastFrame, unmount } = render(
        <SetupPage
          isActive={false}
          autoStart={false}
        />
      );

      expect(lastFrame()).toContain('Environment Setup');
      unmount();
    });

    it('should render custom title', () => {
      const { lastFrame, unmount } = render(
        <SetupPage
          title="Dependency Check"
          isActive={false}
          autoStart={false}
        />
      );

      expect(lastFrame()).toContain('Dependency Check');
      unmount();
    });

    it('should show description text', () => {
      const { lastFrame, unmount } = render(
        <SetupPage
          isActive={false}
          autoStart={false}
        />
      );

      expect(lastFrame()).toContain('Checking required and optional dependencies');
      unmount();
    });

    it('should render all default dependency names', () => {
      const { lastFrame, unmount } = render(
        <SetupPage
          isActive={false}
          autoStart={false}
        />
      );

      expect(lastFrame()).toContain('Git');
      expect(lastFrame()).toContain('Node.js');
      expect(lastFrame()).toContain('Claude CLI');
      expect(lastFrame()).toContain('GitHub CLI');
      expect(lastFrame()).toContain('Package Manager');
      unmount();
    });

    it('should show required indicator for required dependencies', () => {
      const { lastFrame, unmount } = render(
        <SetupPage
          isActive={false}
          autoStart={false}
        />
      );

      // Required dependencies should be marked
      expect(lastFrame()).toContain('(required)');
      unmount();
    });
  });

  describe('keyboard hints', () => {
    it('should show start hint when not started', () => {
      const { lastFrame, unmount } = render(
        <SetupPage
          isActive={false}
          autoStart={false}
        />
      );

      expect(lastFrame()).toContain('Press Enter to start');
      unmount();
    });
  });

  describe('dependency checklist header', () => {
    it('should show Dependencies header', () => {
      const { lastFrame, unmount } = render(
        <SetupPage
          isActive={false}
          autoStart={false}
        />
      );

      expect(lastFrame()).toContain('Dependencies');
      unmount();
    });

    it('should show progress count', () => {
      const { lastFrame, unmount } = render(
        <SetupPage
          isActive={false}
          autoStart={false}
        />
      );

      // Should show 0 of 5 completed initially
      expect(lastFrame()).toContain('(0/5)');
      unmount();
    });
  });

  describe('status indicators', () => {
    it('should show pending indicator for unchecked dependencies', () => {
      const { lastFrame, unmount } = render(
        <SetupPage
          isActive={false}
          autoStart={false}
        />
      );

      // Pending indicator
      expect(lastFrame()).toContain('○');
      unmount();
    });
  });

  describe('props validation', () => {
    it('should accept onComplete callback', () => {
      const { unmount } = render(
        <SetupPage
          onComplete={mockOnComplete}
          isActive={false}
          autoStart={false}
        />
      );

      // Just verify it renders without error
      unmount();
    });

    it('should accept onExit callback', () => {
      const { unmount } = render(
        <SetupPage
          onExit={mockOnExit}
          isActive={false}
          autoStart={false}
        />
      );

      // Just verify it renders without error
      unmount();
    });

    it('should accept isActive prop', () => {
      const { unmount } = render(
        <SetupPage
          isActive={false}
          autoStart={false}
        />
      );

      unmount();
    });
  });

  describe('async completion with mock checks', () => {
    it('should complete with all successful dependencies', async () => {
      const mockChecks = createMockChecks(successfulDependencies);

      const { lastFrame, unmount } = render(
        <SetupPage
          dependencyChecks={mockChecks}
          autoStart={true}
          isActive={false}
        />
      );

      // Wait for async checks to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      const frame = lastFrame() || '';

      // Should show success indicators
      expect(frame).toContain('✓');

      unmount();
    });

    it('should show error indicators for missing required dependencies', async () => {
      const mockChecks = createMockChecks(mixedDependencies);

      const { lastFrame, unmount } = render(
        <SetupPage
          dependencyChecks={mockChecks}
          autoStart={true}
          isActive={false}
        />
      );

      // Wait for async checks to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      const frame = lastFrame() || '';

      // Should show error indicator for missing required dependency
      expect(frame).toContain('✗');

      unmount();
    });

    it('should show warning indicators for missing optional dependencies', async () => {
      const mockChecks = createMockChecks(mixedDependencies);

      const { lastFrame, unmount } = render(
        <SetupPage
          dependencyChecks={mockChecks}
          autoStart={true}
          isActive={false}
        />
      );

      // Wait for async checks to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      const frame = lastFrame() || '';

      // Should show warning indicator for missing optional dependency
      expect(frame).toContain('⚠');

      unmount();
    });

    it('should show install commands for missing dependencies', async () => {
      const mockChecks = createMockChecks(mixedDependencies);

      const { lastFrame, unmount } = render(
        <SetupPage
          dependencyChecks={mockChecks}
          autoStart={true}
          isActive={false}
        />
      );

      // Wait for async checks to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      const frame = lastFrame() || '';

      // Should show install commands
      expect(frame).toContain('Install');

      unmount();
    });

    it('should show version for installed dependencies', async () => {
      const mockChecks = createMockChecks(successfulDependencies);

      const { lastFrame, unmount } = render(
        <SetupPage
          dependencyChecks={mockChecks}
          autoStart={true}
          isActive={false}
        />
      );

      // Wait for async checks to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      const frame = lastFrame() || '';

      // Should show version
      expect(frame).toContain('v2.40.0');

      unmount();
    });
  });

  describe('result summary', () => {
    it('should show Environment Ready on success', async () => {
      const mockChecks = createMockChecks(successfulDependencies);

      const { lastFrame, unmount } = render(
        <SetupPage
          dependencyChecks={mockChecks}
          autoStart={true}
          isActive={false}
        />
      );

      // Wait for async checks to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      const frame = lastFrame() || '';

      expect(frame).toContain('Environment Ready');

      unmount();
    });

    it('should show Missing Required Dependencies on failure', async () => {
      const mockChecks = createMockChecks(failedDependencies);

      const { lastFrame, unmount } = render(
        <SetupPage
          dependencyChecks={mockChecks}
          autoStart={true}
          isActive={false}
        />
      );

      // Wait for async checks to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      const frame = lastFrame() || '';

      expect(frame).toContain('Missing Required Dependencies');

      unmount();
    });

    it('should show statistics for installed dependencies', async () => {
      const mockChecks = createMockChecks(successfulDependencies);

      const { lastFrame, unmount } = render(
        <SetupPage
          dependencyChecks={mockChecks}
          autoStart={true}
          isActive={false}
        />
      );

      // Wait for async checks to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      const frame = lastFrame() || '';

      expect(frame).toContain('Installed');

      unmount();
    });
  });

  describe('next steps', () => {
    it('should show recommended actions when dependencies are missing', async () => {
      const mockChecks = createMockChecks(mixedDependencies);

      const { lastFrame, unmount } = render(
        <SetupPage
          dependencyChecks={mockChecks}
          autoStart={true}
          isActive={false}
        />
      );

      // Wait for async checks to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      const frame = lastFrame() || '';

      expect(frame).toContain('Recommended Actions');

      unmount();
    });

    it('should show install commands in next steps', async () => {
      const mockChecks = createMockChecks(mixedDependencies);

      const { lastFrame, unmount } = render(
        <SetupPage
          dependencyChecks={mockChecks}
          autoStart={true}
          isActive={false}
        />
      );

      // Wait for async checks to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      const frame = lastFrame() || '';

      // Should show specific install commands
      expect(frame).toContain('brew install');

      unmount();
    });
  });

  describe('parallel execution', () => {
    it('should check dependencies with concurrent execution', async () => {
      // This test verifies that multiple dependencies are checked and
      // the order of completion can vary (demonstrating parallel-like behavior)
      const mockChecks = createMockChecks(successfulDependencies);

      const { lastFrame, unmount } = render(
        <SetupPage
          dependencyChecks={mockChecks}
          autoStart={true}
          isActive={false}
        />
      );

      // Wait for all checks to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      const frame = lastFrame() || '';

      // All checks should be called (verified by seeing success indicators)
      const successCount = (frame.match(/✓/g) || []).length;
      expect(successCount).toBeGreaterThanOrEqual(5);

      // All mock functions should have been called
      mockChecks.forEach((check) => {
        expect(check).toHaveBeenCalled();
      });

      unmount();
    });
  });

  describe('onComplete callback', () => {
    it('should call onComplete with result when checks finish', async () => {
      const mockChecks = createMockChecks(successfulDependencies);

      const { unmount } = render(
        <SetupPage
          dependencyChecks={mockChecks}
          onComplete={mockOnComplete}
          autoStart={true}
          isActive={false}
        />
      );

      // Wait for async checks to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(mockOnComplete).toHaveBeenCalled();

      const result = mockOnComplete.mock.calls[0][0];
      expect(result).toHaveProperty('dependencies');
      expect(result).toHaveProperty('allRequiredInstalled');
      expect(result).toHaveProperty('duration');
      expect(result.allRequiredInstalled).toBe(true);

      unmount();
    });

    it('should report allRequiredInstalled as false when required deps missing', async () => {
      const mockChecks = createMockChecks(mixedDependencies);

      const { unmount } = render(
        <SetupPage
          dependencyChecks={mockChecks}
          onComplete={mockOnComplete}
          autoStart={true}
          isActive={false}
        />
      );

      // Wait for async checks to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(mockOnComplete).toHaveBeenCalled();

      const result = mockOnComplete.mock.calls[0][0];
      expect(result.allRequiredInstalled).toBe(false);

      unmount();
    });

    it('should include duration in result', async () => {
      const mockChecks = createMockChecks(successfulDependencies);

      const { unmount } = render(
        <SetupPage
          dependencyChecks={mockChecks}
          onComplete={mockOnComplete}
          autoStart={true}
          isActive={false}
        />
      );

      // Wait for async checks to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(mockOnComplete).toHaveBeenCalled();

      const result = mockOnComplete.mock.calls[0][0];
      expect(typeof result.duration).toBe('number');
      expect(result.duration).toBeGreaterThan(0);

      unmount();
    });
  });

  describe('autoStart behavior', () => {
    it('should not auto-start when autoStart is false', () => {
      const mockChecks = createMockChecks(successfulDependencies);

      const { lastFrame, unmount } = render(
        <SetupPage
          dependencyChecks={mockChecks}
          autoStart={false}
          isActive={false}
        />
      );

      // Should still show pending state
      const frame = lastFrame() || '';
      expect(frame).toContain('○'); // Pending indicator
      expect(frame).toContain('Press Enter to start');

      unmount();
    });

    it('should auto-start when autoStart is true', async () => {
      const mockChecks = createMockChecks(successfulDependencies);

      const { lastFrame, unmount } = render(
        <SetupPage
          dependencyChecks={mockChecks}
          autoStart={true}
          isActive={false}
        />
      );

      // Wait for checks to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      const frame = lastFrame() || '';
      // Should show completed state
      expect(frame).toContain('✓'); // Success indicator

      unmount();
    });
  });

  describe('type exports', () => {
    it('should export SetupPageProps type', () => {
      // Type verification through usage
      const props: SetupPageProps = {
        onComplete: () => {},
        onExit: () => {},
        isActive: true,
        autoStart: true,
        title: 'Test',
      };
      expect(props.title).toBe('Test');
    });

    it('should export DependencyCheckResult type', () => {
      // Type verification through usage
      const result: DependencyCheckResult = {
        name: 'Test',
        required: true,
        installed: true,
        version: '1.0.0',
        purpose: 'Testing',
        installCommand: 'npm install test',
      };
      expect(result.name).toBe('Test');
    });

    it('should export DependencyCheckFn type', () => {
      // Type verification through usage
      const checkFn: DependencyCheckFn = async () => ({
        name: 'Test',
        required: true,
        installed: true,
        purpose: 'Testing',
      });
      expect(typeof checkFn).toBe('function');
    });
  });

  describe('edge cases', () => {
    it('should handle empty dependency checks array', async () => {
      const { lastFrame, unmount } = render(
        <SetupPage
          dependencyChecks={[]}
          autoStart={true}
          isActive={false}
        />
      );

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should render without crashing
      expect(lastFrame()).toBeTruthy();

      unmount();
    });

    it('should handle check function that throws', async () => {
      const throwingChecks: DependencyCheckFn[] = [
        async () => {
          throw new Error('Check failed');
        },
      ];

      const { lastFrame, unmount } = render(
        <SetupPage
          dependencyChecks={throwingChecks}
          autoStart={true}
          isActive={false}
        />
      );

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Should show error state
      const frame = lastFrame() || '';
      expect(frame).toContain('✗');

      unmount();
    });

    it('should handle slow dependency checks', async () => {
      const slowChecks: DependencyCheckFn[] = successfulDependencies.map(
        (dep) =>
          async () => {
            await new Promise((resolve) => setTimeout(resolve, 200));
            return dep;
          }
      );

      const { lastFrame, unmount } = render(
        <SetupPage
          dependencyChecks={slowChecks}
          autoStart={true}
          isActive={false}
        />
      );

      // Wait a bit for checks to start
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check that checking state is shown (◉ checking indicator)
      const midFrame = lastFrame() || '';
      // Should show checking indicator for at least one dependency
      expect(midFrame).toContain('◉');

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 600));

      const finalFrame = lastFrame() || '';
      expect(finalFrame).toContain('✓');

      unmount();
    });
  });

  describe('progress updates', () => {
    it('should show progress count updating as checks complete', async () => {
      let resolvers: Array<(value: DependencyCheckResult) => void> = [];

      const controlledChecks: DependencyCheckFn[] = [
        () => new Promise((resolve) => { resolvers.push(resolve); }),
        () => new Promise((resolve) => { resolvers.push(resolve); }),
        () => new Promise((resolve) => { resolvers.push(resolve); }),
        () => new Promise((resolve) => { resolvers.push(resolve); }),
        () => new Promise((resolve) => { resolvers.push(resolve); }),
      ];

      const { lastFrame, unmount } = render(
        <SetupPage
          dependencyChecks={controlledChecks}
          autoStart={true}
          isActive={false}
        />
      );

      // Wait for checks to start
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Resolve first check
      resolvers[0]?.(successfulDependencies[0]);
      await new Promise((resolve) => setTimeout(resolve, 100));

      const afterFirst = lastFrame() || '';
      expect(afterFirst).toContain('(1/5)');

      // Resolve remaining checks
      for (let i = 1; i < 5; i++) {
        resolvers[i]?.(successfulDependencies[i]);
      }
      await new Promise((resolve) => setTimeout(resolve, 200));

      const afterAll = lastFrame() || '';
      expect(afterAll).toContain('(5/5)');

      unmount();
    });
  });

  describe('retry keyboard hint', () => {
    it('should show retry hint after completion', async () => {
      const mockChecks = createMockChecks(successfulDependencies);

      const { lastFrame, unmount } = render(
        <SetupPage
          dependencyChecks={mockChecks}
          autoStart={true}
          isActive={false}
        />
      );

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 500));

      const frame = lastFrame() || '';
      expect(frame).toContain('r to retry');

      unmount();
    });
  });

  describe('module exports', () => {
    it('should export SetupPage component', () => {
      expect(SetupPage).toBeDefined();
      expect(typeof SetupPage).toBe('function');
    });
  });
});
