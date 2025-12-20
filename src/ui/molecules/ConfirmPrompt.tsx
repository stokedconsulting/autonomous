/**
 * ConfirmPrompt - Yes/No confirmation component with keyboard support
 *
 * Provides an interactive confirmation prompt that responds to keyboard input.
 * Supports y/n keys, arrow navigation, and Enter to confirm.
 *
 * @example
 * ```tsx
 * <ConfirmPrompt
 *   message="Are you sure you want to continue?"
 *   onConfirm={(confirmed) => {
 *     if (confirmed) {
 *       // User confirmed
 *     }
 *   }}
 * />
 * ```
 */

import { useState, useCallback, type ReactElement } from 'react';
import { Box, Text, useInput } from 'ink';

/**
 * Props for the ConfirmPrompt component
 */
export interface ConfirmPromptProps {
  /**
   * The confirmation message to display
   */
  message: string;

  /**
   * Callback when the user confirms or denies
   */
  onConfirm: (confirmed: boolean) => void;

  /**
   * Default selection (true = Yes, false = No)
   * @default false
   */
  defaultValue?: boolean;

  /**
   * Text for the positive option
   * @default "Yes"
   */
  yesText?: string;

  /**
   * Text for the negative option
   * @default "No"
   */
  noText?: string;

  /**
   * Whether the prompt is active (accepting input)
   * @default true
   */
  isActive?: boolean;

  /**
   * Whether to show keyboard hints
   * @default true
   */
  showHints?: boolean;
}

/**
 * Interactive Yes/No confirmation prompt
 *
 * Keyboard controls:
 * - y/Y: Select Yes
 * - n/N: Select No
 * - Left/Right arrows: Toggle selection
 * - Enter: Confirm selection
 * - Escape: Cancel (selects No)
 */
export function ConfirmPrompt({
  message,
  onConfirm,
  defaultValue = false,
  yesText = 'Yes',
  noText = 'No',
  isActive = true,
  showHints = true,
}: ConfirmPromptProps): ReactElement {
  const [selected, setSelected] = useState<boolean>(defaultValue);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSubmit = useCallback(
    (value: boolean) => {
      if (!isSubmitted) {
        setIsSubmitted(true);
        setSelected(value);
        onConfirm(value);
      }
    },
    [onConfirm, isSubmitted]
  );

  useInput(
    (input, key) => {
      if (!isActive || isSubmitted) return;

      // Direct key shortcuts
      if (input.toLowerCase() === 'y') {
        handleSubmit(true);
        return;
      }
      if (input.toLowerCase() === 'n') {
        handleSubmit(false);
        return;
      }

      // Arrow key navigation
      if (key.leftArrow || key.rightArrow) {
        setSelected((prev) => !prev);
        return;
      }

      // Enter to confirm current selection
      if (key.return) {
        handleSubmit(selected);
        return;
      }

      // Escape to cancel
      if (key.escape) {
        handleSubmit(false);
        return;
      }
    },
    { isActive: isActive && !isSubmitted }
  );

  return (
    <Box flexDirection="column">
      {/* Prompt message */}
      <Box>
        <Text color="cyan" bold>
          {'? '}
        </Text>
        <Text>{message}</Text>
      </Box>

      {/* Options */}
      <Box marginLeft={2} marginTop={1}>
        {/* Yes option */}
        <Box marginRight={2}>
          <Text
            color={selected ? 'green' : undefined}
            bold={selected}
            inverse={selected && !isSubmitted}
          >
            {selected ? '› ' : '  '}
            {yesText}
          </Text>
        </Box>

        {/* No option */}
        <Box>
          <Text
            color={!selected ? 'red' : undefined}
            bold={!selected}
            inverse={!selected && !isSubmitted}
          >
            {!selected ? '› ' : '  '}
            {noText}
          </Text>
        </Box>
      </Box>

      {/* Keyboard hints */}
      {showHints && !isSubmitted && (
        <Box marginTop={1} marginLeft={2}>
          <Text color="gray" dimColor>
            (y/n to select, arrows to toggle, enter to confirm)
          </Text>
        </Box>
      )}

      {/* Submitted state */}
      {isSubmitted && (
        <Box marginTop={1}>
          <Text color={selected ? 'green' : 'yellow'}>
            {selected ? '✓' : '✗'} {selected ? yesText : noText}
          </Text>
        </Box>
      )}
    </Box>
  );
}

export default ConfirmPrompt;
