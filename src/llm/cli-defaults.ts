import { LLMProvider } from '../types/assignments.js';

export const DEFAULT_CLI_PATHS: Record<LLMProvider, string> = {
  claude: 'claude',
  gemini: 'gemini',
  codex: 'codex',
};

export const DEFAULT_CLI_ARGS: Record<LLMProvider, string[]> = {
  claude: ['--dangerously-skip-permissions'],
  gemini: ['--yolo'],
  codex: ['--dangerously-bypass-approvals-and-sandbox'],
};

export const DEFAULT_HOOKS_ENABLED: Record<LLMProvider, boolean> = {
  claude: true,
  gemini: false,
  codex: false,
};

export function resolveCliPath(provider: LLMProvider, configured?: string): string {
  return configured && configured.length > 0 ? configured : DEFAULT_CLI_PATHS[provider];
}

export function resolveCliArgs(provider: LLMProvider, configured?: string[]): string[] {
  if (configured && configured.length > 0) {
    return configured;
  }
  return [...DEFAULT_CLI_ARGS[provider]];
}

export function resolveHooksEnabled(provider: LLMProvider, configured?: boolean): boolean {
  if (configured !== undefined) {
    return configured;
  }
  return DEFAULT_HOOKS_ENABLED[provider];
}
