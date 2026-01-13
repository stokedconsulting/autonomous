/**
 * ConfigInitPage - Interactive configuration initialization wizard
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { MultiSelect, PasswordInput, Spinner } from '@inkjs/ui';
import { ConfigManager } from '../../core/config-manager.js';
import { parseGitHubRemote, getGitRoot } from '../../git/utils.js';
import { resolveCliArgs, resolveCliPath, resolveHooksEnabled } from '../../llm/cli-defaults.js';
import { LLMProvider } from '../../types/assignments.js';
import { join } from 'path';

type ConfigStep = 'select-providers' | 'api-keys' | 'saving' | 'summary' | 'error';

interface ProviderOption {
  label: string;
  value: LLMProvider;
}

export interface ConfigInitPageProps {
  onComplete?: (configPath: string) => void;
}

const PROVIDER_LABELS: Record<LLMProvider, string> = {
  claude: 'Claude (Anthropic)',
  gemini: 'Gemini (Google)',
  codex: 'Codex (OpenAI)',
  stoked: 'Stoked (Meta-Agent)',
};

const PROVIDERS_REQUIRING_KEY: LLMProvider[] = ['gemini', 'codex'];

async function resolveConfigPath(cwd: string): Promise<string> {
  const gitRoot = await getGitRoot(cwd);
  const basePath = gitRoot ?? cwd;
  return join(basePath, '.autonomous', '.autonomous-config.json');
}

export function ConfigInitPage({ onComplete }: ConfigInitPageProps): React.ReactElement {
  const [step, setStep] = useState<ConfigStep>('select-providers');
  const [selectedProviders, setSelectedProviders] = useState<LLMProvider[]>([]);
  const [apiKeys, setApiKeys] = useState<Partial<Record<LLMProvider, string>>>({});
  const [keyIndex, setKeyIndex] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [configPath, setConfigPath] = useState<string | null>(null);

  const providerOptions: ProviderOption[] = useMemo(() => {
    return (['claude', 'gemini', 'codex'] as LLMProvider[]).map(provider => ({
      value: provider,
      label: `${PROVIDER_LABELS[provider]} • ${resolveCliPath(provider)}`,
    }));
  }, []);

  const providersNeedingKeys = useMemo(() => {
    return selectedProviders.filter((provider) => PROVIDERS_REQUIRING_KEY.includes(provider));
  }, [selectedProviders]);

  const activeProvider = providersNeedingKeys[keyIndex];

  useInput((_, key) => {
    if (step === 'summary' && key.return) {
      if (configPath && onComplete) {
        onComplete(configPath);
      }
    }
  }, { isActive: step === 'summary' });

  const saveConfig = useCallback(async () => {
    try {
      const cwd = process.cwd();
      const remoteInfo = await parseGitHubRemote(cwd);
      const configManager = new ConfigManager(cwd);

      await configManager.initialize(remoteInfo?.owner, remoteInfo?.repo);

      for (const provider of selectedProviders) {
        const providerConfig = {
          apiKey: apiKeys[provider],
          cliPath: resolveCliPath(provider),
          cliArgs: resolveCliArgs(provider),
          hooksEnabled: resolveHooksEnabled(provider),
        };
        await configManager.enableLLM(provider, providerConfig);
      }

      const resolvedPath = await resolveConfigPath(cwd);
      setConfigPath(resolvedPath);
      setStep('summary');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setStep('error');
    }
  }, [apiKeys, selectedProviders]);

  useEffect(() => {
    if (step === 'saving') {
      void saveConfig();
    }
  }, [saveConfig, step]);

  if (step === 'saving') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Spinner label="Saving configuration..." />
      </Box>
    );
  }

  if (step === 'error') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text color="red" bold>✗ Configuration setup failed</Text>
        {errorMessage && <Text color="red">{errorMessage}</Text>}
        <Text dimColor>Review the error and try again.</Text>
      </Box>
    );
  }

  if (step === 'summary' && configPath) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text color="green" bold>✓ Configuration initialized</Text>
        <Text dimColor>Config saved to:</Text>
        <Text color="cyan">{configPath}</Text>
        <Box marginTop={1}>
          <Text dimColor>Enabled providers: </Text>
          <Text>{selectedProviders.map(p => PROVIDER_LABELS[p]).join(', ')}</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Press Enter to continue</Text>
        </Box>
      </Box>
    );
  }

  if (step === 'api-keys' && activeProvider) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text bold>Enter API key for {PROVIDER_LABELS[activeProvider]}</Text>
        <Text dimColor>Input is masked for security.</Text>
        <Box marginTop={1}>
          <PasswordInput
            placeholder="API key"
            onSubmit={(value) => {
              if (!value.trim()) {
                setErrorMessage('API key cannot be empty.');
                return;
              }

              setApiKeys((prev) => ({ ...prev, [activeProvider]: value.trim() }));
              setErrorMessage(null);

              if (keyIndex + 1 < providersNeedingKeys.length) {
                setKeyIndex((prev) => prev + 1);
              } else {
                setStep('saving');
              }
            }}
          />
        </Box>
        {errorMessage && (
          <Box marginTop={1}>
            <Text color="red">{errorMessage}</Text>
          </Box>
        )}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingY={1}>
      <Text bold>Select LLM providers to enable</Text>
      <Text dimColor>Use Space to toggle, Enter to continue.</Text>
      <Box marginTop={1}>
        <MultiSelect
          options={providerOptions}
          defaultValue={selectedProviders}
          onChange={(values) => {
            setSelectedProviders(values as LLMProvider[]);
            setErrorMessage(null);
          }}
          onSubmit={(values) => {
            const providers = values as LLMProvider[];
            if (providers.length === 0) {
              setErrorMessage('Select at least one provider to continue.');
              return;
            }

            setSelectedProviders(providers);
            setKeyIndex(0);
            setErrorMessage(null);

            if (providers.some(p => PROVIDERS_REQUIRING_KEY.includes(p))) {
              setStep('api-keys');
            } else {
              setStep('saving');
            }
          }}
        />
      </Box>
      {errorMessage && (
        <Box marginTop={1}>
          <Text color="red">{errorMessage}</Text>
        </Box>
      )}
    </Box>
  );
}
