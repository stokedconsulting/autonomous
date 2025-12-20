/**
 * Tests for InputField component
 *
 * Note: ink-testing-library has limited support for components with useInput.
 * These tests focus on rendering with isActive=false to avoid cleanup issues.
 */

import { describe, it, expect, jest } from '@jest/globals';
import { render } from 'ink-testing-library';
import { InputField, type ValidationFn } from '../../../src/ui/molecules/InputField.js';

describe('InputField', () => {
  const mockOnChange = jest.fn<(value: string) => void>();

  describe('basic rendering', () => {
    it('should render with label', () => {
      const { lastFrame, unmount } = render(
        <InputField value="" onChange={mockOnChange} label="Name" isActive={false} />
      );

      expect(lastFrame()).toContain('Name');
      unmount();
    });

    it('should show placeholder when value is empty', () => {
      const { lastFrame, unmount } = render(
        <InputField
          value=""
          onChange={mockOnChange}
          placeholder="Enter your name"
          isActive={false}
        />
      );

      expect(lastFrame()).toContain('Enter your name');
      unmount();
    });

    it('should display the current value', () => {
      const { lastFrame, unmount } = render(
        <InputField value="hello" onChange={mockOnChange} isActive={false} />
      );

      expect(lastFrame()).toContain('hello');
      unmount();
    });

    it('should not show placeholder when value exists', () => {
      const { lastFrame, unmount } = render(
        <InputField
          value="test"
          onChange={mockOnChange}
          placeholder="Enter something"
          isActive={false}
        />
      );

      expect(lastFrame()).toContain('test');
      expect(lastFrame()).not.toContain('Enter something');
      unmount();
    });
  });

  describe('required field', () => {
    it('should show asterisk for required fields', () => {
      const { lastFrame, unmount } = render(
        <InputField value="" onChange={mockOnChange} label="Name" required isActive={false} />
      );

      expect(lastFrame()).toContain('*');
      unmount();
    });
  });

  describe('masking', () => {
    it('should mask input when mask is true', () => {
      const { lastFrame, unmount } = render(
        <InputField value="secret" onChange={mockOnChange} mask isActive={false} />
      );

      expect(lastFrame()).toContain('******');
      expect(lastFrame()).not.toContain('secret');
      unmount();
    });

    it('should use custom mask character', () => {
      const { lastFrame, unmount } = render(
        <InputField value="pwd" onChange={mockOnChange} mask maskChar="#" isActive={false} />
      );

      expect(lastFrame()).toContain('###');
      unmount();
    });
  });

  describe('module exports', () => {
    it('should export InputField component', () => {
      expect(InputField).toBeDefined();
      expect(typeof InputField).toBe('function');
    });

    it('should export ValidationFn type', () => {
      // TypeScript type check - if this compiles, it passes
      const testValidate: ValidationFn = (value) => value ? null : 'Error';
      expect(typeof testValidate).toBe('function');
    });
  });
});
