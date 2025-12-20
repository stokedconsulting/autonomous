/**
 * InputField - Text input component with validation and keyboard handling
 *
 * Provides a text input field with real-time validation, placeholder support,
 * and customizable keyboard behavior.
 *
 * @example
 * ```tsx
 * <InputField
 *   label="Repository URL"
 *   placeholder="https://github.com/user/repo"
 *   value={url}
 *   onChange={setUrl}
 *   validate={(value) => {
 *     if (!value.startsWith('https://')) {
 *       return 'URL must start with https://';
 *     }
 *     return null;
 *   }}
 *   onSubmit={(value) => console.log('Submitted:', value)}
 * />
 * ```
 */

import { useState, useEffect, type ReactElement } from 'react';
import { Box, Text, useInput } from 'ink';

/**
 * Validation function type
 */
export type ValidationFn = (value: string) => string | null;

/**
 * Props for the InputField component
 */
export interface InputFieldProps {
  /**
   * Current input value
   */
  value: string;

  /**
   * Callback when the value changes
   */
  onChange: (value: string) => void;

  /**
   * Callback when Enter is pressed with valid input
   */
  onSubmit?: (value: string) => void;

  /**
   * Callback when Escape is pressed
   */
  onCancel?: () => void;

  /**
   * Label shown before the input
   */
  label?: string;

  /**
   * Placeholder text when input is empty
   */
  placeholder?: string;

  /**
   * Validation function that returns an error message or null
   */
  validate?: ValidationFn;

  /**
   * Whether the input is active (accepting input)
   * @default true
   */
  isActive?: boolean;

  /**
   * Whether to mask the input (for passwords)
   * @default false
   */
  mask?: boolean;

  /**
   * Character to use for masking
   * @default '*'
   */
  maskChar?: string;

  /**
   * Whether to show the cursor
   * @default true
   */
  showCursor?: boolean;

  /**
   * Whether the field is required
   * @default false
   */
  required?: boolean;

  /**
   * Maximum input length
   */
  maxLength?: number;
}

/**
 * Text input field with validation and keyboard handling
 *
 * Keyboard controls:
 * - Any character: Append to input
 * - Backspace: Delete last character
 * - Ctrl+U: Clear input
 * - Enter: Submit (if valid)
 * - Escape: Cancel
 */
export function InputField({
  value,
  onChange,
  onSubmit,
  onCancel,
  label,
  placeholder,
  validate,
  isActive = true,
  mask = false,
  maskChar = '*',
  showCursor = true,
  required = false,
  maxLength,
}: InputFieldProps): ReactElement {
  const [cursorVisible, setCursorVisible] = useState(true);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Validate on value change
  useEffect(() => {
    if (!touched) return;

    if (required && value.length === 0) {
      setError('This field is required');
    } else if (validate) {
      setError(validate(value));
    } else {
      setError(null);
    }
  }, [value, validate, required, touched]);

  // Cursor blinking effect
  useEffect(() => {
    if (!isActive || !showCursor) return;

    const interval = setInterval(() => {
      setCursorVisible((prev) => !prev);
    }, 500);

    return () => clearInterval(interval);
  }, [isActive, showCursor]);

  useInput(
    (input, key) => {
      if (!isActive) return;

      // Mark as touched on first input
      if (!touched) {
        setTouched(true);
      }

      // Handle escape
      if (key.escape) {
        onCancel?.();
        return;
      }

      // Handle submit
      if (key.return) {
        // Validate before submit
        const validationError = validate?.(value) ?? null;
        const isRequiredError = required && value.length === 0;

        if (!validationError && !isRequiredError) {
          onSubmit?.(value);
        } else {
          setTouched(true);
          setError(isRequiredError ? 'This field is required' : validationError);
        }
        return;
      }

      // Handle backspace
      if (key.backspace || key.delete) {
        onChange(value.slice(0, -1));
        return;
      }

      // Handle Ctrl+U (clear)
      if (key.ctrl && input === 'u') {
        onChange('');
        return;
      }

      // Handle regular character input
      if (input && !key.ctrl && !key.meta) {
        const newValue = value + input;
        if (maxLength && newValue.length > maxLength) {
          return;
        }
        onChange(newValue);
      }
    },
    { isActive }
  );

  // Display value (masked or plain)
  const displayValue = mask ? maskChar.repeat(value.length) : value;

  // Show placeholder when empty
  const showPlaceholder = value.length === 0 && placeholder;

  return (
    <Box flexDirection="column">
      {/* Label and input line */}
      <Box>
        {/* Label */}
        {label && (
          <Text color="cyan" bold>
            {label}
            {required && <Text color="red">*</Text>}
            {': '}
          </Text>
        )}

        {/* Input area */}
        <Box>
          {/* Display value or placeholder */}
          {showPlaceholder ? (
            <Text color="gray" dimColor>
              {placeholder}
            </Text>
          ) : (
            <Text>{displayValue}</Text>
          )}

          {/* Cursor */}
          {isActive && showCursor && (
            <Text
              backgroundColor={cursorVisible ? 'white' : undefined}
              color={cursorVisible ? 'black' : undefined}
            >
              {cursorVisible ? ' ' : ''}
            </Text>
          )}
        </Box>
      </Box>

      {/* Error message */}
      {error && touched && (
        <Box marginLeft={label ? label.length + 2 : 0}>
          <Text color="red">
            {'✗ '}
            {error}
          </Text>
        </Box>
      )}

      {/* Character count (if maxLength is set) */}
      {maxLength && isActive && (
        <Box marginLeft={label ? label.length + 2 : 0}>
          <Text
            color={value.length >= maxLength ? 'yellow' : 'gray'}
            dimColor={value.length < maxLength}
          >
            {value.length}/{maxLength}
          </Text>
        </Box>
      )}
    </Box>
  );
}

export default InputField;
