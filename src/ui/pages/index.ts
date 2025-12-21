/**
 * Pages - Full-page Ink UI components
 *
 * This module exports page-level components for the CLI interface.
 * Pages are complete screens with their own navigation and state management.
 */

// Help Page - Interactive help with categorized commands
export {
  HelpPage,
  type HelpPageProps,
  type CommandInfo,
  type CommandOption,
  type CommandCategory,
} from './HelpPage.js';

// Setup Page - Interactive setup wizard with dependency checking
export {
  SetupPage,
  type SetupPageProps,
  type SetupResult,
  type DependencyCheckResult,
  type DependencyCheckFn,
} from './SetupPage.js';

// Config Init Page - Interactive configuration initialization wizard
export {
  ConfigInitPage,
  type ConfigInitPageProps,
  type ConfigInitResult,
  type LLMProviderConfig,
  type ValidationError,
  type LLMProvider as ConfigLLMProvider,
} from './ConfigInitPage.js';
