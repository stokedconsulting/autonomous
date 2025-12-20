/**
 * SelectList - Arrow-navigable list selection component
 *
 * Provides a keyboard-navigable list of options with visual focus indicators.
 * Supports single and multi-select modes.
 *
 * @example
 * ```tsx
 * <SelectList
 *   items={[
 *     { value: 'npm', label: 'npm' },
 *     { value: 'yarn', label: 'Yarn' },
 *     { value: 'pnpm', label: 'pnpm', description: 'Fast, disk space efficient' },
 *   ]}
 *   onSelect={(item) => console.log('Selected:', item.value)}
 * />
 * ```
 */

import { useState, useCallback, type ReactElement } from 'react';
import { Box, Text, useInput } from 'ink';

/**
 * List item definition
 */
export interface SelectItem<T = string> {
  /**
   * The value associated with this item
   */
  value: T;

  /**
   * Display label for the item
   */
  label: string;

  /**
   * Optional description shown below the label
   */
  description?: string;

  /**
   * Whether this item is disabled
   * @default false
   */
  disabled?: boolean;
}

/**
 * Props for the SelectList component
 */
export interface SelectListProps<T = string> {
  /**
   * Array of items to display
   */
  items: SelectItem<T>[];

  /**
   * Callback when an item is selected
   */
  onSelect: (item: SelectItem<T>) => void;

  /**
   * Callback when escape is pressed
   */
  onCancel?: () => void;

  /**
   * Optional title shown above the list
   */
  title?: string;

  /**
   * Initially selected index
   * @default 0
   */
  initialIndex?: number;

  /**
   * Whether the list is active (accepting input)
   * @default true
   */
  isActive?: boolean;

  /**
   * Whether to show keyboard hints
   * @default true
   */
  showHints?: boolean;

  /**
   * Maximum number of visible items (enables scrolling)
   */
  limit?: number;

  /**
   * Indicator character for the focused item
   * @default '›'
   */
  indicator?: string;
}

/**
 * Single list item component
 */
function ListItem<T>({
  item,
  isFocused,
  indicator,
}: {
  item: SelectItem<T>;
  isFocused: boolean;
  indicator: string;
}): ReactElement {
  const isDisabled = item.disabled ?? false;

  return (
    <Box flexDirection="column">
      <Box>
        {/* Focus indicator */}
        <Text color={isFocused ? 'cyan' : undefined}>
          {isFocused ? indicator : ' '}{' '}
        </Text>

        {/* Label */}
        <Text
          color={isDisabled ? 'gray' : isFocused ? 'cyan' : undefined}
          bold={isFocused && !isDisabled}
          dimColor={isDisabled}
          strikethrough={isDisabled}
        >
          {item.label}
        </Text>

        {/* Disabled indicator */}
        {isDisabled && (
          <Text color="gray" dimColor>
            {' '}
            (unavailable)
          </Text>
        )}
      </Box>

      {/* Description */}
      {item.description && (
        <Box marginLeft={3}>
          <Text color="gray" dimColor>
            {item.description}
          </Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Arrow-navigable list selection component
 *
 * Keyboard controls:
 * - Up/k: Move focus up
 * - Down/j: Move focus down
 * - Enter/Space: Select focused item
 * - g: Jump to first item
 * - G: Jump to last item
 * - Escape: Cancel selection
 */
export function SelectList<T = string>({
  items,
  onSelect,
  onCancel,
  title,
  initialIndex = 0,
  isActive = true,
  showHints = true,
  limit,
  indicator = '›',
}: SelectListProps<T>): ReactElement {
  const [focusedIndex, setFocusedIndex] = useState(
    Math.min(initialIndex, items.length - 1)
  );
  const [isSubmitted, setIsSubmitted] = useState(false);

  // Calculate scroll window if limit is set
  const scrollOffset = limit
    ? Math.max(0, Math.min(focusedIndex - Math.floor(limit / 2), items.length - limit))
    : 0;
  const visibleItems = limit ? items.slice(scrollOffset, scrollOffset + limit) : items;

  // Find next non-disabled item
  const findNextEnabled = useCallback(
    (startIndex: number, direction: 1 | -1): number => {
      let index = startIndex;
      const maxIterations = items.length;
      let iterations = 0;

      while (iterations < maxIterations) {
        index = (index + direction + items.length) % items.length;
        if (!items[index].disabled) {
          return index;
        }
        iterations++;
      }

      return startIndex; // No non-disabled item found
    },
    [items]
  );

  const handleSelect = useCallback(
    (index: number) => {
      const item = items[index];
      if (!item.disabled && !isSubmitted) {
        setIsSubmitted(true);
        onSelect(item);
      }
    },
    [items, onSelect, isSubmitted]
  );

  useInput(
    (input, key) => {
      if (!isActive || isSubmitted) return;

      // Navigation
      if (key.upArrow || input === 'k') {
        setFocusedIndex((prev) => findNextEnabled(prev, -1));
        return;
      }

      if (key.downArrow || input === 'j') {
        setFocusedIndex((prev) => findNextEnabled(prev, 1));
        return;
      }

      // Jump to start/end (vim-style g/G)
      if (input === 'g') {
        const firstEnabled = items.findIndex((item) => !item.disabled);
        if (firstEnabled !== -1) {
          setFocusedIndex(firstEnabled);
        }
        return;
      }

      if (input === 'G') {
        for (let i = items.length - 1; i >= 0; i--) {
          if (!items[i].disabled) {
            setFocusedIndex(i);
            break;
          }
        }
        return;
      }

      // Select
      if (key.return || input === ' ') {
        handleSelect(focusedIndex);
        return;
      }

      // Cancel
      if (key.escape) {
        onCancel?.();
        return;
      }
    },
    { isActive: isActive && !isSubmitted }
  );

  return (
    <Box flexDirection="column">
      {/* Title */}
      {title && (
        <Box marginBottom={1}>
          <Text color="cyan" bold>
            {'? '}
          </Text>
          <Text bold>{title}</Text>
        </Box>
      )}

      {/* Scroll indicator (top) */}
      {limit && scrollOffset > 0 && (
        <Box marginLeft={2}>
          <Text color="gray" dimColor>
            ↑ {scrollOffset} more
          </Text>
        </Box>
      )}

      {/* Item list */}
      <Box flexDirection="column">
        {visibleItems.map((item, visibleIndex) => {
          const actualIndex = scrollOffset + visibleIndex;
          return (
            <ListItem
              key={String(item.value)}
              item={item}
              isFocused={actualIndex === focusedIndex && !isSubmitted}
              indicator={indicator}
            />
          );
        })}
      </Box>

      {/* Scroll indicator (bottom) */}
      {limit && scrollOffset + limit < items.length && (
        <Box marginLeft={2}>
          <Text color="gray" dimColor>
            ↓ {items.length - scrollOffset - limit} more
          </Text>
        </Box>
      )}

      {/* Keyboard hints */}
      {showHints && !isSubmitted && (
        <Box marginTop={1}>
          <Text color="gray" dimColor>
            (↑↓ to navigate, enter to select
            {onCancel ? ', esc to cancel' : ''})
          </Text>
        </Box>
      )}

      {/* Selected confirmation */}
      {isSubmitted && (
        <Box marginTop={1}>
          <Text color="green">
            {'✓ '}
            {items[focusedIndex].label}
          </Text>
        </Box>
      )}
    </Box>
  );
}

export default SelectList;
