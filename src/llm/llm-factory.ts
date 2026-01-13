
import { LLMAdapter } from './adapter.js';
import { ClaudeAdapter } from './claude-adapter.js';
import { GeminiAdapter } from './gemini-adapter.js';
import { CodexAdapter } from './codex-adapter.js';
import { LLMConfig, LLMProvider } from '../types/index.js';


import { StokedAdapter } from './stoked-adapter.js';

export class LLMFactory {
  static create(providers: LLMProvider[], configs: Record<LLMProvider, LLMConfig>, autonomousDataDir: string, verbose: boolean): LLMAdapter {
    for (const provider of providers) {
      try {
        const adapter = this.createSingle(provider, configs, autonomousDataDir, verbose);
        if (adapter) return adapter;
      } catch (error) {
        console.warn(`Failed to create LLM adapter for ${provider}:`, error);
      }
    }
    throw new Error('Failed to create any LLM adapter.');
  }

  private static createSingle(provider: LLMProvider, configs: Record<LLMProvider, LLMConfig>, autonomousDataDir: string, verbose: boolean): LLMAdapter | null {
    const config = configs[provider];
    if (!config || !config.enabled) {
      return null;
    }

    switch (provider) {
      case 'claude':
        return new ClaudeAdapter(config, autonomousDataDir, verbose);
      case 'gemini':
        return new GeminiAdapter(config, autonomousDataDir, verbose);
      case 'codex':
        return new CodexAdapter(config, autonomousDataDir);
      case 'stoked':
        if (!config.backend) {
          throw new Error('Stoked adapter requires a backend configuration');
        }
        // Recursively create the backend adapter
        // We force-enable the backend config for this instantiation if it wasn't enabled
        const backendConfig = configs[config.backend];
        if (!backendConfig) {
          throw new Error(`Backend config not found for: ${config.backend}`);
        }

        // Clone configs to modify enabled state temporarily for recursion without side effects
        const tempConfigs = { ...configs, [config.backend]: { ...backendConfig, enabled: true } };

        const backendAdapter = this.createSingle(config.backend, tempConfigs, autonomousDataDir, verbose);
        if (!backendAdapter) {
          throw new Error(`Failed to create backend adapter: ${config.backend}`);
        }
        return new StokedAdapter(config, backendAdapter, autonomousDataDir, verbose);
      default:
        throw new Error(`Unknown LLM provider: ${provider}`);
    }
  }
}
