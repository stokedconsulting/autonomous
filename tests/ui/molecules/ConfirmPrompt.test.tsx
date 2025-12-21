/**
 * Tests for ConfirmPrompt component
 *
 * Note: ink-testing-library has limited support for components with useInput.
 * These tests focus on rendering with isActive=false to avoid cleanup issues.
 */

import { describe, it, expect, jest } from '@jest/globals';
import { render } from 'ink-testing-library';
import { ConfirmPrompt } from '../../../src/ui/molecules/ConfirmPrompt.js';

describe('ConfirmPrompt', () => {
  const mockOnConfirm = jest.fn<(confirmed: boolean) => void>();

  describe('basic rendering', () => {
    it('should render the message', () => {
      const { lastFrame, unmount } = render(
        <ConfirmPrompt message="Continue?" onConfirm={mockOnConfirm} isActive={false} />
      );

      expect(lastFrame()).toContain('Continue?');
      unmount();
    });

    it('should show Yes and No options', () => {
      const { lastFrame, unmount } = render(
        <ConfirmPrompt message="Confirm?" onConfirm={mockOnConfirm} isActive={false} />
      );

      expect(lastFrame()).toContain('Yes');
      expect(lastFrame()).toContain('No');
      unmount();
    });

    it('should show keyboard hints by default', () => {
      const { lastFrame, unmount } = render(
        <ConfirmPrompt message="Continue?" onConfirm={mockOnConfirm} isActive={false} />
      );

      const frame = lastFrame() || '';
      expect(frame).toContain('y/n');
      unmount();
    });
  });

  describe('custom options', () => {
    it('should use custom yes/no text', () => {
      const { lastFrame, unmount } = render(
        <ConfirmPrompt
          message="Delete?"
          onConfirm={mockOnConfirm}
          yesText="Delete"
          noText="Cancel"
          isActive={false}
        />
      );

      expect(lastFrame()).toContain('Delete');
      expect(lastFrame()).toContain('Cancel');
      unmount();
    });

    it('should hide keyboard hints when showHints is false', () => {
      const { lastFrame, unmount } = render(
        <ConfirmPrompt
          message="Continue?"
          onConfirm={mockOnConfirm}
          showHints={false}
          isActive={false}
        />
      );

      const frame = lastFrame() || '';
      expect(frame).not.toContain('y/n to select');
      unmount();
    });
  });

  describe('module exports', () => {
    it('should export ConfirmPrompt component', () => {
      expect(ConfirmPrompt).toBeDefined();
      expect(typeof ConfirmPrompt).toBe('function');
    });
  });
});
