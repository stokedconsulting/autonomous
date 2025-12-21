/**
 * Organisms - Complex composed UI components
 *
 * This module exports organism-level components that combine multiple
 * molecules and atoms to create complete, interactive interfaces.
 * Organisms represent distinct sections of the UI with their own
 * logic and state management.
 */

// CommandDetail - Comprehensive command documentation display
export {
  CommandDetail,
  type CommandDetailProps,
} from './CommandDetail.js';

// Types for organisms
// Note: CommandOption is not exported to avoid conflict with pages/HelpPage
// Import directly from './organisms/types.js' if needed
export type {
  CommandDefinition,
  CommandArgument,
  CommandExample,
  RelatedCommand,
} from './types.js';

// Re-export with alias for consumers who need the detailed option type
export type { CommandOption as DetailedCommandOption } from './types.js';
