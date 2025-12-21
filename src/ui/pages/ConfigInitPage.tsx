/**
 * ConfigInitPage - Interactive configuration initialization wizard
 *
 * Provides a multi-step wizard for initializing the autonomous CLI configuration.
 * Only triggers if no config file exists. Uses SelectList for provider selection
 * and InputField for API key entry with masked display.
 *
 * @example
 * ```tsx
 * <ConfigInitPage
 *   onComplete={(config) => console.log('Config saved:', config)}
 *   onSkip={() => console.log('Config init skipped')}
 * />
 * ```
 */

import { useState, useEffect, useCallback, useRef, type ReactElement } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { SelectList, type SelectItem } from '../molecules/SelectList.js';
import { InputField } from '../molecules/InputField.js';
import { ConfirmPrompt } from '../molecules/ConfirmPrompt.js';
import { StepProgress } from '../molecules/StepProgress.js';
import { ResultSummary } from '../molecules/ResultSummary.js';
import type { Step } from '../stores/command-stores/types.js';

/**
 * LLM Provider type
 */
export type LLMProvider = 'claude' | 'gemini' | 'codex';

/**
 * LLM Provider configuration
 */
export interface LLMProviderConfig {
  provider: LLMProvider;
  apiKey?: string;
  cliPath?: string;
}

/**
 * Configuration result
 */
export interface ConfigInitResult {
  /**
   * Path to the created config file
   */
  configPath: string;

  /**
   * Selected LLM provider
   */
  provider: LLMProvider;

  /**
   * Whether API key was provided
   */
  hasApiKey: boolean;

  /**
   * GitHub owner (if detected)
   */
  githubOwner?: string;

  /**
   * GitHub repo (if detected)
   */
  githubRepo?: string;
}

/**
 * Validation error details
 */
export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Props for the ConfigInitPage component
 */
export interface ConfigInitPageProps {
  /**
   * Callback when configuration is complete
   */
  onComplete?: (result: ConfigInitResult) => void;

  /**
   * Callback when user skips configuration
   */
  onSkip?: () => void;

  /**
   * Callback when user exits
   */
  onExit?: () => void;

  /**
   * Whether the component is active (accepting input)
   * @default true
   */
  isActive?: boolean;

  /**
   * Function to check if config exists
   * If not provided, uses ConfigManager
   */
  checkConfigExists?: () => Promise<boolean>;

  /**
   * Function to detect GitHub repo from git remote
   * If not provided, uses parseGitHubRemote
   */
  detectGitHubRepo?: () => Promise<{ owner: string; repo: string } | null>;

  /**
   * Function to save configuration
   * If not provided, uses ConfigManager
   */
  saveConfig?: (config: {
    provider: LLMProvider;
    apiKey?: string;
    githubOwner?: string;
    githubRepo?: string;
  }) => Promise<string>;

  /**
   * Force show config init even if config exists (for testing)
   * @default false
   */
  forceShow?: boolean;
}

/**
 * Wizard step identifiers
 */
type WizardStep =
  | 'checking'
  | 'prompt-create'
  | 'select-provider'
  | 'enter-api-key'
  | 'validating'
  | 'complete'
  | 'skipped';

/**
 * LLM Provider options for SelectList
 */
const LLM_PROVIDERS: SelectItem<LLMProvider>[] = [
  {
    value: 'claude',
    label: 'Claude (Anthropic)',
    description: 'AI-powered code analysis and generation via Claude CLI',
  },
  {
    value: 'gemini',
    label: 'Gemini (Google)',
    description: 'Google\'s AI model for code assistance',
  },
  {
    value: 'codex',
    label: 'Codex (OpenAI)',
    description: 'OpenAI\'s code-focused language model',
  },
];

/**
 * Mask an API key for display (show last 4 characters)
 */
function maskApiKey(key: string): string {
  if (key.length <= 4) {
    return '****';
  }
  return '****' + key.slice(-4);
}

/**
 * Validate API key format
 */
function validateApiKey(value: string, provider: LLMProvider): string | null {
  if (!value || value.length === 0) {
    return null; // Empty is allowed (optional)
  }

  // Provider-specific validation
  switch (provider) {
    case 'claude':
      if (!value.startsWith('sk-ant-')) {
        return 'Claude API keys should start with "sk-ant-"';
      }
      if (value.length < 20) {
        return 'API key seems too short';
      }
      break;
    case 'gemini':
      if (value.length < 10) {
        return 'API key seems too short';
      }
      break;
    case 'codex':
      if (!value.startsWith('sk-')) {
        return 'OpenAI API keys should start with "sk-"';
      }
      if (value.length < 20) {
        return 'API key seems too short';
      }
      break;
  }

  return null;
}

/**
 * Interactive configuration initialization wizard
 *
 * Flow:
 * 1. Check if config exists
 * 2. If exists, skip (config init only triggers if no config exists)
 * 3. Prompt user to create config
 * 4. Select LLM provider using SelectList
 * 5. Optionally enter API key with masked input
 * 6. Validate and save configuration
 * 7. Show success with config file path
 *
 * Keyboard controls:
 * - Arrow keys: Navigate options
 * - Enter: Select/confirm
 * - Escape: Cancel/go back
 * - Tab: Skip optional fields
 */
export function ConfigInitPage({
  onComplete,
  onSkip,
  onExit,
  isActive = true,
  checkConfigExists,
  detectGitHubRepo,
  saveConfig,
  forceShow = false,
}: ConfigInitPageProps): ReactElement {
  const { exit } = useApp();
  const startTimeRef = useRef<number>(Date.now());

  // Wizard state
  const [currentStep, setCurrentStep] = useState<WizardStep>('checking');
  const [selectedProvider, setSelectedProvider] = useState<LLMProvider | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [maskedApiKey, setMaskedApiKey] = useState<string | null>(null);
  const [configPath, setConfigPath] = useState<string>('');
  const [githubOwner, setGithubOwner] = useState<string | null>(null);
  const [githubRepo, setGithubRepo] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Progress steps for StepProgress component
  const [steps, setSteps] = useState<Step[]>([
    { id: 'check', label: 'Check existing config', status: 'active' },
    { id: 'provider', label: 'Select LLM provider', status: 'pending' },
    { id: 'apikey', label: 'Configure API key', status: 'pending' },
    { id: 'validate', label: 'Validate configuration', status: 'pending' },
    { id: 'save', label: 'Save configuration', status: 'pending' },
  ]);

  /**
   * Update a step's status
   */
  const updateStep = useCallback((stepId: string, status: Step['status'], error?: string) => {
    setSteps((prev) =>
      prev.map((step) =>
        step.id === stepId ? { ...step, status, error } : step
      )
    );
  }, []);

  /**
   * Check if config exists on mount
   */
  useEffect(() => {
    const check = async () => {
      try {
        let exists = false;

        if (checkConfigExists) {
          exists = await checkConfigExists();
        } else {
          // Use ConfigManager
          const { ConfigManager } = await import('../../core/config-manager.js');
          const configManager = new ConfigManager(process.cwd());
          exists = await configManager.exists();
        }

        if (exists && !forceShow) {
          // Config exists, skip initialization
          updateStep('check', 'completed');
          setCurrentStep('skipped');
          onSkip?.();
        } else {
          // No config, prompt to create
          updateStep('check', 'completed');

          // Try to detect GitHub repo
          let repoInfo: { owner: string; repo: string } | null = null;
          if (detectGitHubRepo) {
            repoInfo = await detectGitHubRepo();
          } else {
            const { parseGitHubRemote } = await import('../../git/utils.js');
            repoInfo = await parseGitHubRemote(process.cwd());
          }

          if (repoInfo) {
            setGithubOwner(repoInfo.owner);
            setGithubRepo(repoInfo.repo);
          }

          setCurrentStep('prompt-create');
        }
      } catch (err) {
        updateStep('check', 'error', err instanceof Error ? err.message : 'Unknown error');
        setError(err instanceof Error ? err.message : 'Failed to check config');
      }
    };

    if (currentStep === 'checking') {
      check();
    }
  }, [currentStep, checkConfigExists, detectGitHubRepo, forceShow, onSkip, updateStep]);

  /**
   * Handle confirm prompt result
   */
  const handleConfirmCreate = useCallback((confirmed: boolean) => {
    if (confirmed) {
      updateStep('provider', 'active');
      setCurrentStep('select-provider');
    } else {
      setCurrentStep('skipped');
      onSkip?.();
    }
  }, [onSkip, updateStep]);

  /**
   * Handle provider selection
   */
  const handleProviderSelect = useCallback((item: SelectItem<LLMProvider>) => {
    setSelectedProvider(item.value);
    updateStep('provider', 'completed');
    updateStep('apikey', 'active');
    setCurrentStep('enter-api-key');
  }, [updateStep]);

  /**
   * Handle API key submission
   */
  const handleApiKeySubmit = useCallback(async (key: string) => {
    if (key) {
      setMaskedApiKey(maskApiKey(key));
    }
    updateStep('apikey', 'completed');
    updateStep('validate', 'active');
    setCurrentStep('validating');

    // Validate configuration
    const errors: ValidationError[] = [];

    if (!selectedProvider) {
      errors.push({ field: 'provider', message: 'No provider selected' });
    }

    if (key) {
      const keyError = validateApiKey(key, selectedProvider!);
      if (keyError) {
        errors.push({ field: 'apiKey', message: keyError });
      }
    }

    if (errors.length > 0) {
      setValidationErrors(errors);
      updateStep('validate', 'error', errors.map((e) => e.message).join(', '));
      return;
    }

    updateStep('validate', 'completed');
    updateStep('save', 'active');

    // Save configuration
    try {
      let path: string;

      if (saveConfig) {
        path = await saveConfig({
          provider: selectedProvider!,
          apiKey: key || undefined,
          githubOwner: githubOwner || undefined,
          githubRepo: githubRepo || undefined,
        });
      } else {
        // Use ConfigManager
        const { ConfigManager } = await import('../../core/config-manager.js');
        const configManager = new ConfigManager(process.cwd());
        await configManager.initialize(githubOwner || undefined, githubRepo || undefined);
        await configManager.enableLLM(selectedProvider!, {
          apiKey: key || undefined,
        });
        path = '.autonomous/.autonomous-config.json';
      }

      setConfigPath(path);
      updateStep('save', 'completed');
      setCurrentStep('complete');

      onComplete?.({
        configPath: path,
        provider: selectedProvider!,
        hasApiKey: !!key,
        githubOwner: githubOwner || undefined,
        githubRepo: githubRepo || undefined,
      });
    } catch (err) {
      updateStep('save', 'error', err instanceof Error ? err.message : 'Unknown error');
      setError(err instanceof Error ? err.message : 'Failed to save config');
    }
  }, [selectedProvider, githubOwner, githubRepo, saveConfig, onComplete, updateStep]);

  /**
   * Handle API key skip (Tab key)
   */
  const handleApiKeySkip = useCallback(() => {
    handleApiKeySubmit('');
  }, [handleApiKeySubmit]);

  /**
   * Handle cancel/back
   */
  const handleCancel = useCallback(() => {
    switch (currentStep) {
      case 'enter-api-key':
        updateStep('apikey', 'pending');
        updateStep('provider', 'active');
        setCurrentStep('select-provider');
        setApiKey('');
        break;
      case 'select-provider':
        updateStep('provider', 'pending');
        setCurrentStep('prompt-create');
        setSelectedProvider(null);
        break;
      case 'prompt-create':
        setCurrentStep('skipped');
        onSkip?.();
        break;
      default:
        // Exit
        if (onExit) {
          onExit();
        } else {
          exit();
        }
    }
  }, [currentStep, onSkip, onExit, exit, updateStep]);

  /**
   * Handle exit
   */
  const handleExit = useCallback(() => {
    if (onExit) {
      onExit();
    } else {
      exit();
    }
  }, [onExit, exit]);

  /**
   * Keyboard input handler for global actions
   */
  useInput(
    (input, key) => {
      if (!isActive) return;

      // Tab to skip optional API key
      if (key.tab && currentStep === 'enter-api-key') {
        handleApiKeySkip();
        return;
      }

      // Exit with 'q' when complete or skipped
      if (input === 'q' && (currentStep === 'complete' || currentStep === 'skipped')) {
        handleExit();
        return;
      }
    },
    { isActive }
  );

  // Calculate duration
  const duration = Date.now() - startTimeRef.current;

  // Render based on current step
  const renderStep = (): ReactElement => {
    switch (currentStep) {
      case 'checking':
        return (
          <Box flexDirection="column" paddingY={1}>
            <Text color="cyan">Checking for existing configuration...</Text>
          </Box>
        );

      case 'prompt-create':
        return (
          <Box flexDirection="column" paddingY={1}>
            {githubOwner && githubRepo && (
              <Box marginBottom={1}>
                <Text color="green">{'✓ '}</Text>
                <Text>Detected repository: </Text>
                <Text color="cyan" bold>
                  {githubOwner}/{githubRepo}
                </Text>
              </Box>
            )}
            <ConfirmPrompt
              message="No configuration found. Would you like to create one?"
              onConfirm={handleConfirmCreate}
              defaultValue={true}
              isActive={isActive}
            />
          </Box>
        );

      case 'select-provider':
        return (
          <Box flexDirection="column" paddingY={1}>
            <SelectList
              items={LLM_PROVIDERS}
              onSelect={handleProviderSelect}
              onCancel={handleCancel}
              title="Select your LLM provider"
              isActive={isActive}
            />
          </Box>
        );

      case 'enter-api-key':
        return (
          <Box flexDirection="column" paddingY={1}>
            <Box marginBottom={1}>
              <Text color="green">{'✓ '}</Text>
              <Text>Provider: </Text>
              <Text color="cyan" bold>
                {selectedProvider}
              </Text>
            </Box>
            <Box flexDirection="column">
              <InputField
                value={apiKey}
                onChange={setApiKey}
                onSubmit={handleApiKeySubmit}
                onCancel={handleCancel}
                label="API Key"
                placeholder="Enter API key (optional, press Tab to skip)"
                mask={true}
                maskChar="*"
                isActive={isActive}
                validate={(value) => validateApiKey(value, selectedProvider!)}
              />
              <Box marginTop={1}>
                <Text color="gray" dimColor>
                  (Enter to submit, Tab to skip, Esc to go back)
                </Text>
              </Box>
            </Box>
          </Box>
        );

      case 'validating':
        return (
          <Box flexDirection="column" paddingY={1}>
            <Text color="cyan">Validating configuration...</Text>
            {validationErrors.length > 0 && (
              <Box flexDirection="column" marginTop={1}>
                <Text color="red" bold>
                  Validation Errors:
                </Text>
                {validationErrors.map((err, index) => (
                  <Box key={index} marginLeft={2}>
                    <Text color="red">{'✗ '}</Text>
                    <Text color="yellow">{err.field}: </Text>
                    <Text>{err.message}</Text>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        );

      case 'complete':
        return (
          <Box flexDirection="column" paddingY={1}>
            <ResultSummary
              status="success"
              title="Configuration Created"
              subtitle={`Your autonomous CLI is now configured with ${selectedProvider}`}
              details={[
                { label: 'Config file', value: configPath },
                { label: 'Provider', value: selectedProvider! },
                { label: 'API Key', value: maskedApiKey || 'Not set' },
                ...(githubOwner && githubRepo
                  ? [{ label: 'Repository', value: `${githubOwner}/${githubRepo}` }]
                  : []),
              ]}
              nextSteps={[
                'Run `auto setup` to check dependencies',
                'Run `auto start` to begin autonomous mode',
              ]}
              duration={duration}
            />
            <Box marginTop={1}>
              <Text color="gray" dimColor>
                (Press q to exit)
              </Text>
            </Box>
          </Box>
        );

      case 'skipped':
        return (
          <Box flexDirection="column" paddingY={1}>
            <ResultSummary
              status="info"
              title="Configuration Skipped"
              subtitle="Using existing configuration or no configuration created"
            />
          </Box>
        );

      default:
        return <Text>Unknown step</Text>;
    }
  };

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          Configuration Initialization
        </Text>
      </Box>

      {/* Progress indicator */}
      {currentStep !== 'skipped' && currentStep !== 'checking' && (
        <Box marginBottom={1}>
          <StepProgress steps={steps} compact />
        </Box>
      )}

      {/* Error display */}
      {error && (
        <Box marginBottom={1}>
          <Text color="red">{'✗ '}</Text>
          <Text color="red">{error}</Text>
        </Box>
      )}

      {/* Current step content */}
      {renderStep()}
    </Box>
  );
}

export default ConfigInitPage;
