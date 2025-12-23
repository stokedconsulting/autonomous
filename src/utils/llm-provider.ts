import { LLMProvider } from '../types/assignments.js';
import { AutonomousConfig } from '../types/config.js';

export const LLM_PROVIDERS: LLMProvider[] = ['claude', 'gemini', 'codex'];

export function parseLLMProvider(value: string): LLMProvider | null {
  const normalized = value.trim().toLowerCase();
  return LLM_PROVIDERS.includes(normalized as LLMProvider)
    ? (normalized as LLMProvider)
    : null;
}

export function getEnabledLLMProviders(config: AutonomousConfig): LLMProvider[] {
  return (Object.keys(config.llms) as LLMProvider[]).filter(
    (provider) => config.llms[provider]?.enabled
  );
}

export function resolveLLMProvider(config: AutonomousConfig, requested?: string): LLMProvider {
  const enabledProviders = getEnabledLLMProviders(config);

  if (requested) {
    const parsed = parseLLMProvider(requested);
    if (!parsed) {
      throw new Error(`Invalid provider: ${requested}`);
    }
    if (!enabledProviders.includes(parsed)) {
      throw new Error(`Provider "${parsed}" is not enabled`);
    }
    return parsed;
  }

  if (enabledProviders.length === 0) {
    throw new Error('No LLM providers enabled');
  }

  if (enabledProviders.length > 1) {
    throw new Error(
      `Multiple LLM providers enabled (${enabledProviders.join(', ')}). ` +
      'Specify --provider or run "auto config use-llm <provider>".'
    );
  }

  return enabledProviders[0];
}
