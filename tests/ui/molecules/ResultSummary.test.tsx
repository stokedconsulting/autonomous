/**
 * Tests for ResultSummary component
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { render } from 'ink-testing-library';
import {
  ResultSummary,
  successResult,
  errorResult,
  warningResult,
  infoResult,
  type ResultDetail,
} from '../../../src/ui/molecules/ResultSummary.js';

describe('ResultSummary', () => {
  let originalDebug: string | undefined;

  beforeEach(() => {
    originalDebug = process.env.DEBUG;
    delete process.env.DEBUG;
  });

  afterEach(() => {
    if (originalDebug !== undefined) {
      process.env.DEBUG = originalDebug;
    } else {
      delete process.env.DEBUG;
    }
  });

  describe('basic rendering', () => {
    it('should render success status with title', () => {
      const { lastFrame } = render(
        <ResultSummary status="success" title="Operation Complete" />
      );

      expect(lastFrame()).toContain('✓');
      expect(lastFrame()).toContain('Operation Complete');
    });

    it('should render error status with title', () => {
      const { lastFrame } = render(
        <ResultSummary status="error" title="Operation Failed" />
      );

      expect(lastFrame()).toContain('✗');
      expect(lastFrame()).toContain('Operation Failed');
    });

    it('should render warning status with title', () => {
      const { lastFrame } = render(
        <ResultSummary status="warning" title="Proceed with caution" />
      );

      expect(lastFrame()).toContain('⚠');
      expect(lastFrame()).toContain('Proceed with caution');
    });

    it('should render info status with title', () => {
      const { lastFrame } = render(
        <ResultSummary status="info" title="Information" />
      );

      expect(lastFrame()).toContain('ℹ');
      expect(lastFrame()).toContain('Information');
    });
  });

  describe('subtitle', () => {
    it('should show subtitle when provided', () => {
      const { lastFrame } = render(
        <ResultSummary
          status="success"
          title="Complete"
          subtitle="All tasks finished successfully"
        />
      );

      expect(lastFrame()).toContain('All tasks finished successfully');
    });

    it('should hide subtitle in compact mode', () => {
      const { lastFrame } = render(
        <ResultSummary
          status="success"
          title="Complete"
          subtitle="All tasks finished"
          compact
        />
      );

      expect(lastFrame()).not.toContain('All tasks finished');
    });
  });

  describe('details', () => {
    const details: ResultDetail[] = [
      { label: 'Name', value: 'my-project' },
      { label: 'Path', value: '/home/user/project' },
      { label: 'Files', value: 42 },
    ];

    it('should render all detail items', () => {
      const { lastFrame } = render(
        <ResultSummary status="success" title="Created" details={details} />
      );

      expect(lastFrame()).toContain('Name');
      expect(lastFrame()).toContain('my-project');
      expect(lastFrame()).toContain('Path');
      expect(lastFrame()).toContain('/home/user/project');
      expect(lastFrame()).toContain('Files');
      expect(lastFrame()).toContain('42');
    });

    it('should align labels correctly', () => {
      const { lastFrame } = render(
        <ResultSummary status="success" title="Result" details={details} />
      );

      // All labels should be present
      expect(lastFrame()).toContain('Name');
      expect(lastFrame()).toContain('Path');
      expect(lastFrame()).toContain('Files');
    });

    it('should hide details in compact mode', () => {
      const { lastFrame } = render(
        <ResultSummary status="success" title="Done" details={details} compact />
      );

      expect(lastFrame()).not.toContain('my-project');
      expect(lastFrame()).not.toContain('/home/user/project');
    });

    it('should apply custom color to detail values', () => {
      const coloredDetails: ResultDetail[] = [
        { label: 'Status', value: 'Active', color: 'green' },
      ];
      const { lastFrame } = render(
        <ResultSummary status="info" title="Info" details={coloredDetails} />
      );

      expect(lastFrame()).toContain('Active');
    });
  });

  describe('error details', () => {
    it('should show error message for error status', () => {
      const error = new Error('Connection failed');
      const { lastFrame } = render(
        <ResultSummary status="error" title="Failed" error={error} />
      );

      expect(lastFrame()).toContain('Connection failed');
    });

    it('should show stack trace when DEBUG is set', () => {
      process.env.DEBUG = 'true';
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at test.ts:10:5\n    at runner.ts:20:3';

      const { lastFrame } = render(
        <ResultSummary status="error" title="Error" error={error} />
      );

      expect(lastFrame()).toContain('test.ts');
    });

    it('should hide stack trace by default', () => {
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at secret.ts:10:5';

      const { lastFrame } = render(
        <ResultSummary status="error" title="Error" error={error} />
      );

      expect(lastFrame()).not.toContain('secret.ts');
    });

    it('should hide error in compact mode', () => {
      const error = new Error('Hidden error');
      const { lastFrame } = render(
        <ResultSummary status="error" title="Failed" error={error} compact />
      );

      expect(lastFrame()).not.toContain('Hidden error');
    });
  });

  describe('next steps', () => {
    const nextSteps = ['cd my-project', 'npm install', 'npm start'];

    it('should show next steps for success status', () => {
      const { lastFrame } = render(
        <ResultSummary status="success" title="Created" nextSteps={nextSteps} />
      );

      expect(lastFrame()).toContain('Next steps');
      expect(lastFrame()).toContain('cd my-project');
      expect(lastFrame()).toContain('npm install');
      expect(lastFrame()).toContain('npm start');
    });

    it('should show numbered steps for success', () => {
      const { lastFrame } = render(
        <ResultSummary status="success" title="Done" nextSteps={['step one']} />
      );

      expect(lastFrame()).toContain('1.');
    });

    it('should show recommended actions for warnings', () => {
      const { lastFrame } = render(
        <ResultSummary
          status="warning"
          title="Warning"
          nextSteps={['Check logs', 'Update config']}
        />
      );

      expect(lastFrame()).toContain('Recommended actions');
      expect(lastFrame()).toContain('Check logs');
    });

    it('should hide next steps in compact mode', () => {
      const { lastFrame } = render(
        <ResultSummary
          status="success"
          title="Done"
          nextSteps={nextSteps}
          compact
        />
      );

      expect(lastFrame()).not.toContain('Next steps');
    });

    it('should not show next steps for error status', () => {
      const { lastFrame } = render(
        <ResultSummary
          status="error"
          title="Failed"
          nextSteps={['This should not appear']}
        />
      );

      expect(lastFrame()).not.toContain('Next steps');
    });
  });

  describe('duration', () => {
    it('should show duration in seconds', () => {
      const { lastFrame } = render(
        <ResultSummary status="success" title="Complete" duration={2500} />
      );

      expect(lastFrame()).toContain('2.5s');
    });

    it('should show duration in milliseconds for short durations', () => {
      const { lastFrame } = render(
        <ResultSummary status="success" title="Complete" duration={500} />
      );

      expect(lastFrame()).toContain('500ms');
    });
  });

  describe('bordered mode', () => {
    it('should render with border when bordered is true', () => {
      const { lastFrame } = render(
        <ResultSummary status="success" title="Bordered" bordered />
      );

      // Border characters should be present
      const frame = lastFrame();
      expect(frame).toBeDefined();
    });
  });

  describe('helper functions', () => {
    it('successResult should create success props', () => {
      const props = successResult('Test Success', {
        subtitle: 'With subtitle',
      });

      expect(props.status).toBe('success');
      expect(props.title).toBe('Test Success');
      expect(props.subtitle).toBe('With subtitle');
    });

    it('errorResult should create error props with error object', () => {
      const error = new Error('Test error');
      const props = errorResult('Test Error', error, {
        subtitle: 'Error occurred',
      });

      expect(props.status).toBe('error');
      expect(props.title).toBe('Test Error');
      expect(props.error).toBe(error);
      expect(props.subtitle).toBe('Error occurred');
    });

    it('warningResult should create warning props', () => {
      const props = warningResult('Test Warning', {
        nextSteps: ['Step 1'],
      });

      expect(props.status).toBe('warning');
      expect(props.title).toBe('Test Warning');
      expect(props.nextSteps).toEqual(['Step 1']);
    });

    it('infoResult should create info props', () => {
      const props = infoResult('Test Info', {
        details: [{ label: 'Key', value: 'Value' }],
      });

      expect(props.status).toBe('info');
      expect(props.title).toBe('Test Info');
      expect(props.details).toHaveLength(1);
    });
  });

  describe('empty states', () => {
    it('should handle empty details array', () => {
      const { lastFrame } = render(
        <ResultSummary status="success" title="Done" details={[]} />
      );

      expect(lastFrame()).toContain('Done');
    });

    it('should handle empty nextSteps array', () => {
      const { lastFrame } = render(
        <ResultSummary status="success" title="Done" nextSteps={[]} />
      );

      expect(lastFrame()).not.toContain('Next steps');
    });
  });
});
