/**
 * Configuration Manager - Handles .autonomous-config.json
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { AutonomousConfig, LLMProvider, LLMConfig } from '../types/index.js';

const DEFAULT_CONFIG: AutonomousConfig = {
  version: '1.0.0',
  llms: {
    claude: {
      enabled: false,
      maxConcurrentIssues: 1,
      cliPath: 'claude',
      hooksEnabled: true,
    },
    gemini: {
      enabled: false,
      maxConcurrentIssues: 1,
      hooksEnabled: false,
    },
    codex: {
      enabled: false,
      maxConcurrentIssues: 1,
      hooksEnabled: false,
    },
  },
  github: {
    owner: '',
    repo: '',
    labels: ['autonomous-ready'],
    excludeLabels: ['wontfix', 'duplicate'],
  },
  worktree: {
    baseDir: '..',
    namingPattern: '{projectName}-issue-{number}',
    branchPrefix: 'feature/issue-',
    cleanup: {
      onComplete: false,
      onError: false,
    },
  },
  requirements: {
    testingRequired: true,
    ciMustPass: true,
    prTemplateRequired: false,
  },
  logging: {
    level: 'info',
  },
};

export class ConfigManager {
  private filePath: string;
  private config: AutonomousConfig | null = null;

  constructor(projectPath: string) {
    this.filePath = join(projectPath, '.autonomous-config.json');
  }

  /**
   * Initialize configuration with defaults or load existing
   */
  async initialize(githubOwner?: string, githubRepo?: string): Promise<void> {
    try {
      await this.load();
    } catch (error) {
      // File doesn't exist, create default config
      this.config = { ...DEFAULT_CONFIG };

      if (githubOwner) this.config.github.owner = githubOwner;
      if (githubRepo) this.config.github.repo = githubRepo;

      await this.save();
    }
  }

  /**
   * Load configuration from file
   */
  async load(): Promise<void> {
    const content = await fs.readFile(this.filePath, 'utf-8');
    this.config = JSON.parse(content);
  }

  /**
   * Save configuration to file
   */
  async save(): Promise<void> {
    if (!this.config) {
      throw new Error('Configuration not initialized');
    }

    await fs.writeFile(this.filePath, JSON.stringify(this.config, null, 2), 'utf-8');
  }

  /**
   * Get the full configuration
   */
  getConfig(): AutonomousConfig {
    if (!this.config) {
      throw new Error('Configuration not initialized');
    }
    return this.config;
  }

  /**
   * Get LLM configuration for a specific provider
   */
  getLLMConfig(provider: LLMProvider): LLMConfig {
    if (!this.config) {
      throw new Error('Configuration not initialized');
    }
    return this.config.llms[provider];
  }

  /**
   * Get all enabled LLM providers
   */
  getEnabledLLMs(): LLMProvider[] {
    if (!this.config) {
      throw new Error('Configuration not initialized');
    }

    return (Object.keys(this.config.llms) as LLMProvider[]).filter(
      (provider) => this.config!.llms[provider].enabled
    );
  }

  /**
   * Enable an LLM provider
   */
  async enableLLM(provider: LLMProvider, config?: Partial<LLMConfig>): Promise<void> {
    if (!this.config) {
      throw new Error('Configuration not initialized');
    }

    this.config.llms[provider] = {
      ...this.config.llms[provider],
      ...config,
      enabled: true,
    };

    await this.save();
  }

  /**
   * Disable an LLM provider
   */
  async disableLLM(provider: LLMProvider): Promise<void> {
    if (!this.config) {
      throw new Error('Configuration not initialized');
    }

    this.config.llms[provider].enabled = false;
    await this.save();
  }

  /**
   * Update LLM configuration
   */
  async updateLLMConfig(provider: LLMProvider, update: Partial<LLMConfig>): Promise<void> {
    if (!this.config) {
      throw new Error('Configuration not initialized');
    }

    this.config.llms[provider] = {
      ...this.config.llms[provider],
      ...update,
    };

    await this.save();
  }

  /**
   * Set GitHub configuration
   */
  async setGitHub(owner: string, repo: string): Promise<void> {
    if (!this.config) {
      throw new Error('Configuration not initialized');
    }

    this.config.github.owner = owner;
    this.config.github.repo = repo;

    await this.save();
  }

  /**
   * Update GitHub configuration
   */
  async updateGitHub(updates: Partial<AutonomousConfig['github']>): Promise<void> {
    if (!this.config) {
      throw new Error('Configuration not initialized');
    }

    this.config.github = {
      ...this.config.github,
      ...updates,
    };

    await this.save();
  }

  /**
   * Check if configuration is valid
   */
  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!this.config) {
      errors.push('Configuration not initialized');
      return { valid: false, errors };
    }

    if (!this.config.github.owner) {
      errors.push('GitHub owner is required');
    }

    if (!this.config.github.repo) {
      errors.push('GitHub repository is required');
    }

    const enabledLLMs = this.getEnabledLLMs();
    if (enabledLLMs.length === 0) {
      errors.push('At least one LLM must be enabled');
    }

    // Validate each enabled LLM has required settings
    for (const provider of enabledLLMs) {
      const llmConfig = this.config.llms[provider];
      if (!llmConfig.cliPath && provider === 'claude') {
        errors.push(`Claude CLI path is required`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Check if the configuration file exists
   */
  async exists(): Promise<boolean> {
    try {
      await fs.access(this.filePath);
      return true;
    } catch {
      return false;
    }
  }
}
