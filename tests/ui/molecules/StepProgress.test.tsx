/**
 * Tests for StepProgress component
 */

import { describe, it, expect } from '@jest/globals';
import { render } from 'ink-testing-library';
import { StepProgress } from '../../../src/ui/molecules/StepProgress.js';
import type { Step } from '../../../src/ui/stores/command-stores/types.js';

describe('StepProgress', () => {
  const basicSteps: Step[] = [
    { id: '1', label: 'Initialize', status: 'completed' },
    { id: '2', label: 'Configure', status: 'active' },
    { id: '3', label: 'Deploy', status: 'pending' },
  ];

  describe('basic rendering', () => {
    it('should render all steps', () => {
      const { lastFrame } = render(<StepProgress steps={basicSteps} />);

      expect(lastFrame()).toContain('Initialize');
      expect(lastFrame()).toContain('Configure');
      expect(lastFrame()).toContain('Deploy');
    });

    it('should render title when provided', () => {
      const { lastFrame } = render(
        <StepProgress steps={basicSteps} title="Setup Progress" />
      );

      expect(lastFrame()).toContain('Setup Progress');
    });

    it('should show progress count with title', () => {
      const { lastFrame } = render(
        <StepProgress steps={basicSteps} title="Progress" />
      );

      expect(lastFrame()).toContain('(1/3)');
    });
  });

  describe('status indicators', () => {
    it('should show completed indicator for completed steps', () => {
      const steps: Step[] = [{ id: '1', label: 'Done', status: 'completed' }];
      const { lastFrame } = render(<StepProgress steps={steps} />);

      expect(lastFrame()).toContain('✓');
    });

    it('should show active indicator for active steps', () => {
      const steps: Step[] = [{ id: '1', label: 'Running', status: 'active' }];
      const { lastFrame } = render(<StepProgress steps={steps} />);

      expect(lastFrame()).toContain('◉');
    });

    it('should show pending indicator for pending steps', () => {
      const steps: Step[] = [{ id: '1', label: 'Waiting', status: 'pending' }];
      const { lastFrame } = render(<StepProgress steps={steps} />);

      expect(lastFrame()).toContain('○');
    });

    it('should show error indicator for error steps', () => {
      const steps: Step[] = [
        { id: '1', label: 'Failed', status: 'error', error: 'Something went wrong' },
      ];
      const { lastFrame } = render(<StepProgress steps={steps} />);

      expect(lastFrame()).toContain('✗');
      expect(lastFrame()).toContain('Something went wrong');
    });

    it('should show skipped indicator for skipped steps', () => {
      const steps: Step[] = [{ id: '1', label: 'Skipped', status: 'skipped' }];
      const { lastFrame } = render(<StepProgress steps={steps} />);

      expect(lastFrame()).toContain('⊘');
    });
  });

  describe('active step', () => {
    it('should indicate in progress for active step', () => {
      const steps: Step[] = [{ id: '1', label: 'Running', status: 'active' }];
      const { lastFrame } = render(<StepProgress steps={steps} />);

      expect(lastFrame()).toContain('(in progress)');
    });
  });

  describe('options', () => {
    it('should show step numbers when showNumbers is true', () => {
      const { lastFrame } = render(
        <StepProgress steps={basicSteps} showNumbers={true} />
      );

      expect(lastFrame()).toContain('1.');
      expect(lastFrame()).toContain('2.');
      expect(lastFrame()).toContain('3.');
    });

    it('should hide connectors when showConnectors is false', () => {
      const { lastFrame } = render(
        <StepProgress steps={basicSteps} showConnectors={false} />
      );

      expect(lastFrame()).not.toContain('│');
    });

    it('should render in compact mode', () => {
      const { lastFrame } = render(
        <StepProgress steps={basicSteps} compact={true} />
      );

      // Compact mode should still show all steps
      expect(lastFrame()).toContain('Initialize');
      expect(lastFrame()).toContain('Configure');
      expect(lastFrame()).toContain('Deploy');
    });
  });

  describe('error state', () => {
    it('should show Error in title when a step has error', () => {
      const stepsWithError: Step[] = [
        { id: '1', label: 'Complete', status: 'completed' },
        { id: '2', label: 'Failed', status: 'error', error: 'Network error' },
      ];
      const { lastFrame } = render(
        <StepProgress steps={stepsWithError} title="Progress" />
      );

      expect(lastFrame()).toContain('Error');
    });
  });

  describe('progress calculation', () => {
    it('should count completed and skipped steps', () => {
      const mixedSteps: Step[] = [
        { id: '1', label: 'Done', status: 'completed' },
        { id: '2', label: 'Skipped', status: 'skipped' },
        { id: '3', label: 'Pending', status: 'pending' },
      ];
      const { lastFrame } = render(
        <StepProgress steps={mixedSteps} title="Progress" />
      );

      expect(lastFrame()).toContain('(2/3)');
    });
  });

  describe('empty state', () => {
    it('should handle empty steps array', () => {
      const { lastFrame } = render(
        <StepProgress steps={[]} title="Empty" />
      );

      expect(lastFrame()).toContain('Empty');
      expect(lastFrame()).toContain('(0/0)');
    });
  });
});
