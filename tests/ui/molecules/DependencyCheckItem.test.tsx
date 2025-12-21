/**
 * Tests for DependencyCheckItem component
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { render } from 'ink-testing-library';
import {
  DependencyCheckItem,
  checkingDependency,
  passedDependency,
  failedDependency,
  warnDependency,
} from '../../../src/ui/molecules/DependencyCheckItem.js';

describe('DependencyCheckItem', () => {
  // Mock timers for spinner animation tests
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('basic rendering', () => {
    it('should render dependency name', () => {
      const { lastFrame } = render(
        <DependencyCheckItem name="node" status="pass" />
      );

      expect(lastFrame()).toContain('node');
    });

    it('should render pass status with check mark', () => {
      const { lastFrame } = render(
        <DependencyCheckItem name="node" status="pass" />
      );

      expect(lastFrame()).toContain('✓');
      expect(lastFrame()).toContain('node');
    });

    it('should render fail status with X mark', () => {
      const { lastFrame } = render(
        <DependencyCheckItem name="pnpm" status="fail" />
      );

      expect(lastFrame()).toContain('✗');
      expect(lastFrame()).toContain('pnpm');
    });

    it('should render warn status with warning mark', () => {
      const { lastFrame } = render(
        <DependencyCheckItem name="npm" status="warn" />
      );

      expect(lastFrame()).toContain('⚠');
      expect(lastFrame()).toContain('npm');
    });

    it('should render checking status with spinner', () => {
      const { lastFrame } = render(
        <DependencyCheckItem name="docker" status="checking" />
      );

      // Should contain the dependency name and checking text
      expect(lastFrame()).toContain('docker');
      expect(lastFrame()).toContain('checking...');

      // Should contain one of the spinner frames
      const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
      const frame = lastFrame() ?? '';
      const hasSpinnerFrame = spinnerFrames.some((s) => frame.includes(s));
      expect(hasSpinnerFrame).toBe(true);
    });
  });

  describe('spinner animation', () => {
    it('should animate spinner through frames', () => {
      const { lastFrame } = render(
        <DependencyCheckItem name="test" status="checking" />
      );

      const frame1 = lastFrame();

      // Advance timer to next spinner frame
      jest.advanceTimersByTime(80);

      const frame2 = lastFrame();

      // Both frames should contain the dependency name
      expect(frame1).toContain('test');
      expect(frame2).toContain('test');

      // Both frames should contain checking text
      expect(frame1).toContain('checking...');
      expect(frame2).toContain('checking...');
    });

    it('should cycle through all spinner frames', () => {
      const { lastFrame } = render(
        <DependencyCheckItem name="test" status="checking" />
      );

      const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

      // Advance through all frames
      for (let i = 0; i < spinnerFrames.length; i++) {
        jest.advanceTimersByTime(80);
        const frame = lastFrame() ?? '';
        const hasAnySpinner = spinnerFrames.some((s) => frame.includes(s));
        expect(hasAnySpinner).toBe(true);
      }
    });
  });

  describe('version display', () => {
    it('should show version for pass status', () => {
      const { lastFrame } = render(
        <DependencyCheckItem name="node" status="pass" version="18.17.0" />
      );

      expect(lastFrame()).toContain('v18.17.0');
    });

    it('should show version for warn status', () => {
      const { lastFrame } = render(
        <DependencyCheckItem name="npm" status="warn" version="9.0.0" />
      );

      expect(lastFrame()).toContain('v9.0.0');
    });

    it('should not show version for fail status', () => {
      const { lastFrame } = render(
        <DependencyCheckItem name="pnpm" status="fail" version="1.0.0" />
      );

      expect(lastFrame()).not.toContain('v1.0.0');
    });

    it('should not show version for checking status', () => {
      const { lastFrame } = render(
        <DependencyCheckItem name="docker" status="checking" version="20.10.0" />
      );

      expect(lastFrame()).not.toContain('v20.10.0');
    });
  });

  describe('required version display', () => {
    it('should show required version with version', () => {
      const { lastFrame } = render(
        <DependencyCheckItem
          name="node"
          status="pass"
          version="18.17.0"
          requiredVersion=">=18.0.0"
        />
      );

      expect(lastFrame()).toContain('requires >=18.0.0');
    });

    it('should not show required version without version', () => {
      const { lastFrame } = render(
        <DependencyCheckItem
          name="pnpm"
          status="fail"
          requiredVersion=">=8.0.0"
        />
      );

      expect(lastFrame()).not.toContain('requires');
    });
  });

  describe('fix command', () => {
    it('should show fix command for fail status', () => {
      const { lastFrame } = render(
        <DependencyCheckItem
          name="pnpm"
          status="fail"
          fixCommand="npm install -g pnpm"
        />
      );

      expect(lastFrame()).toContain('Fix:');
      expect(lastFrame()).toContain('npm install -g pnpm');
    });

    it('should show fix command for warn status', () => {
      const { lastFrame } = render(
        <DependencyCheckItem
          name="npm"
          status="warn"
          version="9.0.0"
          fixCommand="npm install -g npm@latest"
        />
      );

      expect(lastFrame()).toContain('Fix:');
      expect(lastFrame()).toContain('npm install -g npm@latest');
    });

    it('should not show fix command for pass status', () => {
      const { lastFrame } = render(
        <DependencyCheckItem
          name="node"
          status="pass"
          fixCommand="This should not appear"
        />
      );

      expect(lastFrame()).not.toContain('Fix:');
      expect(lastFrame()).not.toContain('This should not appear');
    });

    it('should not show fix command for checking status', () => {
      const { lastFrame } = render(
        <DependencyCheckItem
          name="docker"
          status="checking"
          fixCommand="This should not appear"
        />
      );

      expect(lastFrame()).not.toContain('Fix:');
    });

    it('should not show fix command in compact mode', () => {
      const { lastFrame } = render(
        <DependencyCheckItem
          name="pnpm"
          status="fail"
          fixCommand="npm install -g pnpm"
          compact
        />
      );

      expect(lastFrame()).not.toContain('Fix:');
      expect(lastFrame()).not.toContain('npm install -g pnpm');
    });
  });

  describe('fix link', () => {
    it('should show fix link for fail status', () => {
      const { lastFrame } = render(
        <DependencyCheckItem
          name="docker"
          status="fail"
          fixLink="https://docker.com/install"
        />
      );

      expect(lastFrame()).toContain('Help:');
      expect(lastFrame()).toContain('https://docker.com/install');
    });

    it('should show fix link for warn status', () => {
      const { lastFrame } = render(
        <DependencyCheckItem
          name="git"
          status="warn"
          version="2.30.0"
          fixLink="https://git-scm.com/downloads"
        />
      );

      expect(lastFrame()).toContain('Help:');
      expect(lastFrame()).toContain('https://git-scm.com/downloads');
    });

    it('should prefer fix command over fix link when both provided', () => {
      const { lastFrame } = render(
        <DependencyCheckItem
          name="pnpm"
          status="fail"
          fixCommand="npm install -g pnpm"
          fixLink="https://pnpm.io"
        />
      );

      expect(lastFrame()).toContain('Fix:');
      expect(lastFrame()).toContain('npm install -g pnpm');
      expect(lastFrame()).toContain('(more info)');
    });

    it('should not show fix link in compact mode', () => {
      const { lastFrame } = render(
        <DependencyCheckItem
          name="docker"
          status="fail"
          fixLink="https://docker.com/install"
          compact
        />
      );

      expect(lastFrame()).not.toContain('Help:');
      expect(lastFrame()).not.toContain('https://docker.com/install');
    });
  });

  describe('compact mode', () => {
    it('should render name and status in compact mode', () => {
      const { lastFrame } = render(
        <DependencyCheckItem name="node" status="pass" version="18.17.0" compact />
      );

      expect(lastFrame()).toContain('✓');
      expect(lastFrame()).toContain('node');
      expect(lastFrame()).toContain('v18.17.0');
    });

    it('should hide fix suggestions in compact mode', () => {
      const { lastFrame } = render(
        <DependencyCheckItem
          name="pnpm"
          status="fail"
          fixCommand="npm install -g pnpm"
          fixLink="https://pnpm.io"
          compact
        />
      );

      expect(lastFrame()).toContain('✗');
      expect(lastFrame()).toContain('pnpm');
      expect(lastFrame()).not.toContain('Fix:');
      expect(lastFrame()).not.toContain('Help:');
    });
  });

  describe('helper functions', () => {
    it('checkingDependency should create checking props', () => {
      const props = checkingDependency('docker');

      expect(props.name).toBe('docker');
      expect(props.status).toBe('checking');
    });

    it('passedDependency should create pass props with version', () => {
      const props = passedDependency('node', '18.17.0', {
        requiredVersion: '>=18.0.0',
      });

      expect(props.name).toBe('node');
      expect(props.status).toBe('pass');
      expect(props.version).toBe('18.17.0');
      expect(props.requiredVersion).toBe('>=18.0.0');
    });

    it('failedDependency should create fail props with fix command', () => {
      const props = failedDependency('pnpm', 'npm install -g pnpm', {
        fixLink: 'https://pnpm.io',
      });

      expect(props.name).toBe('pnpm');
      expect(props.status).toBe('fail');
      expect(props.fixCommand).toBe('npm install -g pnpm');
      expect(props.fixLink).toBe('https://pnpm.io');
    });

    it('warnDependency should create warn props with version', () => {
      const props = warnDependency('npm', '9.0.0', {
        fixCommand: 'npm install -g npm@latest',
      });

      expect(props.name).toBe('npm');
      expect(props.status).toBe('warn');
      expect(props.version).toBe('9.0.0');
      expect(props.fixCommand).toBe('npm install -g npm@latest');
    });
  });

  describe('multiple dependencies', () => {
    it('should render multiple dependency items correctly', () => {
      const { lastFrame } = render(
        <>
          <DependencyCheckItem name="node" status="pass" version="18.17.0" />
          <DependencyCheckItem name="pnpm" status="fail" fixCommand="npm i -g pnpm" />
          <DependencyCheckItem name="git" status="warn" version="2.30.0" />
        </>
      );

      const frame = lastFrame() ?? '';

      // All dependencies should be visible
      expect(frame).toContain('node');
      expect(frame).toContain('pnpm');
      expect(frame).toContain('git');

      // All status indicators should be visible
      expect(frame).toContain('✓');
      expect(frame).toContain('✗');
      expect(frame).toContain('⚠');

      // Fix command should be visible
      expect(frame).toContain('npm i -g pnpm');
    });
  });

  describe('edge cases', () => {
    it('should handle empty name', () => {
      const { lastFrame } = render(
        <DependencyCheckItem name="" status="pass" />
      );

      expect(lastFrame()).toContain('✓');
    });

    it('should handle undefined optional props', () => {
      const { lastFrame } = render(
        <DependencyCheckItem name="test" status="pass" />
      );

      expect(lastFrame()).toContain('test');
      expect(lastFrame()).not.toContain('v');
      expect(lastFrame()).not.toContain('Fix:');
      expect(lastFrame()).not.toContain('Help:');
    });

    it('should handle long dependency names', () => {
      const { lastFrame } = render(
        <DependencyCheckItem
          name="very-long-dependency-name-with-scope"
          status="pass"
        />
      );

      expect(lastFrame()).toContain('very-long-dependency-name-with-scope');
    });

    it('should handle long version strings', () => {
      const { lastFrame } = render(
        <DependencyCheckItem
          name="test"
          status="pass"
          version="1.2.3-beta.4+build.567"
        />
      );

      expect(lastFrame()).toContain('v1.2.3-beta.4+build.567');
    });

    it('should handle long fix commands', () => {
      const longCommand = 'npm install -g very-long-package-name@latest --force';
      const { lastFrame } = render(
        <DependencyCheckItem
          name="test"
          status="fail"
          fixCommand={longCommand}
        />
      );

      expect(lastFrame()).toContain(longCommand);
    });
  });
});
