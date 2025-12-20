/**
 * Tests for SelectList component
 *
 * Note: ink-testing-library has limited support for components with useInput.
 * These tests focus on rendering with isActive=false to avoid cleanup issues.
 */

import { describe, it, expect, jest } from '@jest/globals';
import { render } from 'ink-testing-library';
import { SelectList, type SelectItem } from '../../../src/ui/molecules/SelectList.js';

describe('SelectList', () => {
  const mockOnSelect = jest.fn<(item: SelectItem) => void>();

  const basicItems: SelectItem[] = [
    { value: 'npm', label: 'npm' },
    { value: 'yarn', label: 'Yarn' },
    { value: 'pnpm', label: 'pnpm' },
  ];

  describe('basic rendering', () => {
    it('should render all items', () => {
      const { lastFrame, unmount } = render(
        <SelectList items={basicItems} onSelect={mockOnSelect} isActive={false} />
      );

      expect(lastFrame()).toContain('npm');
      expect(lastFrame()).toContain('Yarn');
      expect(lastFrame()).toContain('pnpm');
      unmount();
    });

    it('should render title when provided', () => {
      const { lastFrame, unmount } = render(
        <SelectList
          items={basicItems}
          onSelect={mockOnSelect}
          title="Select package manager"
          isActive={false}
        />
      );

      expect(lastFrame()).toContain('Select package manager');
      unmount();
    });

    it('should show keyboard hints by default', () => {
      const { lastFrame, unmount } = render(
        <SelectList items={basicItems} onSelect={mockOnSelect} isActive={false} />
      );

      const frame = lastFrame() || '';
      expect(frame).toContain('navigate');
      expect(frame).toContain('select');
      unmount();
    });

    it('should hide hints when showHints is false', () => {
      const { lastFrame, unmount } = render(
        <SelectList items={basicItems} onSelect={mockOnSelect} showHints={false} isActive={false} />
      );

      const frame = lastFrame() || '';
      expect(frame).not.toContain('navigate');
      unmount();
    });
  });

  describe('focus and indicator', () => {
    it('should use custom indicator', () => {
      const { lastFrame, unmount } = render(
        <SelectList items={basicItems} onSelect={mockOnSelect} indicator=">" isActive={false} />
      );

      const frame = lastFrame() || '';
      expect(frame).toContain('>');
      unmount();
    });

    it('should render with default indicator', () => {
      const { lastFrame, unmount } = render(
        <SelectList items={basicItems} onSelect={mockOnSelect} isActive={false} />
      );

      // Should render without errors
      const frame = lastFrame() || '';
      expect(frame.length).toBeGreaterThan(0);
      unmount();
    });
  });

  describe('descriptions', () => {
    it('should show item descriptions', () => {
      const itemsWithDesc: SelectItem[] = [
        { value: 'pnpm', label: 'pnpm', description: 'Fast, disk space efficient' },
      ];
      const { lastFrame, unmount } = render(
        <SelectList items={itemsWithDesc} onSelect={mockOnSelect} isActive={false} />
      );

      expect(lastFrame()).toContain('Fast, disk space efficient');
      unmount();
    });
  });

  describe('disabled items', () => {
    it('should show disabled indicator', () => {
      const itemsWithDisabled: SelectItem[] = [
        { value: 'npm', label: 'npm' },
        { value: 'yarn', label: 'Yarn', disabled: true },
      ];
      const { lastFrame, unmount } = render(
        <SelectList items={itemsWithDisabled} onSelect={mockOnSelect} isActive={false} />
      );

      expect(lastFrame()).toContain('unavailable');
      unmount();
    });
  });

  describe('scrolling', () => {
    it('should limit visible items when limit is set', () => {
      const manyItems: SelectItem[] = [
        { value: '1', label: 'One' },
        { value: '2', label: 'Two' },
        { value: '3', label: 'Three' },
        { value: '4', label: 'Four' },
        { value: '5', label: 'Five' },
      ];
      const { lastFrame, unmount } = render(
        <SelectList items={manyItems} onSelect={mockOnSelect} limit={3} isActive={false} />
      );

      const frame = lastFrame() || '';
      expect(frame).toContain('One');
      expect(frame).toContain('Two');
      expect(frame).toContain('Three');
      unmount();
    });
  });

  describe('module exports', () => {
    it('should export SelectList component', () => {
      expect(SelectList).toBeDefined();
      expect(typeof SelectList).toBe('function');
    });
  });
});
