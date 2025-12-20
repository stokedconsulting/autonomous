/**
 * UI Module - Ink-based terminal UI utilities
 *
 * This module provides the integration layer between Commander.js CLI actions
 * and Ink's React-based terminal UI components.
 */

export {
  renderCommand,
  renderCommandWithResult,
  ExitCode,
  type ExitCodeValue,
  type RenderCommandContext,
  type CommandComponentProps,
  type RenderCommandOptions,
  type RenderCommandResult,
} from './renderCommand.js';

export {
  ErrorBoundary,
  ErrorDisplay,
  type ErrorBoundaryProps,
  type ErrorDisplayProps,
} from './ErrorBoundary.js';
