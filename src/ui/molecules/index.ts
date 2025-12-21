/**
 * Molecules - Shared command UI components
 *
 * This module exports reusable UI components for command interfaces.
 * All components are designed to work with the existing theme system
 * and provide full keyboard navigation support.
 */

// Step Progress - Multi-step progress indicator
export {
  StepProgress,
  type StepProgressProps,
} from './StepProgress.js';

// Confirm Prompt - Yes/No confirmation with keyboard support
export {
  ConfirmPrompt,
  type ConfirmPromptProps,
} from './ConfirmPrompt.js';

// Input Field - Text input with validation and keyboard handling
export {
  InputField,
  type InputFieldProps,
  type ValidationFn,
} from './InputField.js';

// Select List - Arrow-navigable list selection
export {
  SelectList,
  type SelectListProps,
  type SelectItem,
} from './SelectList.js';

// Result Summary - Success/failure summary with details
export {
  ResultSummary,
  type ResultSummaryProps,
  type ResultStatus,
  type ResultDetail,
  successResult,
  errorResult,
  warningResult,
  infoResult,
} from './ResultSummary.js';

// Dependency Check Item - Dependency status indicator with spinner
export {
  DependencyCheckItem,
  type DependencyCheckItemProps,
  type DependencyStatus,
  checkingDependency,
  passedDependency,
  failedDependency,
  warnDependency,
} from './DependencyCheckItem.js';
