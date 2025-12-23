
import { LLMAdapter } from './adapter.js';
import { ClaudeAdapter } from './claude-adapter.js';
import { GeminiAdapter } from './gemini-adapter.js';
import { CodexAdapter } from './codex-adapter.js';
import { LLMConfig, LLMProvider } from '../types/index.js';

export class LLMFactory {
  static create(providers: LLMProvider[], configs: Record<LLMProvider, LLMConfig>, autonomousDataDir: string, verbose: boolean): LLMAdapter {
    for (const provider of providers) {
      try {
        const config = configs[provider];
        if (!config || !config.enabled) {
          continue;
        }

        switch (provider) {
          case 'claude':
            return new ClaudeAdapter(config, autonomousDataDir, verbose);
          case 'gemini':
            return new GeminiAdapter(config, autonomousDataDir, verbose);
          case 'codex':
            return new CodexAdapter(config, autonomousDataDir, verbose);
          default:
            throw new Error(`Unknown LLM provider: ${provider}`);
        }
      } catch (error) {
        console.warn(`Failed to create LLM adapter for ${provider}:`, error);
      }
    }
    throw new Error('Failed to create any LLM adapter.');
  }
}
