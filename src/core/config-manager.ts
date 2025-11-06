/**
 * Configuration Manager - Handles .autonomous-config.json
 */

import { promises as fs } from 'fs';
import { watch, FSWatcher } from 'fs';
import { join } from 'path';
import { AutonomousConfig, LLMProvider, LLMConfig } from '../types/index.js';
import { getGitRoot } from '../git/utils.js';
import { MigrationManager } from '../migrations/migration-manager.js';

const DEFAULT_CONFIG: AutonomousConfig = {
  version: '0.1.0',
  llms: {
    claude: {
      enabled: false,
      maxConcurrentIssues: 3,
      cliPath: 'claude',
      hooksEnabled: true,
    },
    gemini: {
      enabled: false,
      maxConcurrentIssues: 3,
      hooksEnabled: false,
    },
    codex: {
      enabled: false,
      maxConcurrentIssues: 3,
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
  private watcher: FSWatcher | null = null;
  private reloadTimeout: NodeJS.Timeout | null = null;
  private onChangeCallback?: (config: AutonomousConfig) => void;
  private projectPath: string;
  private gitRoot: string | null = null;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    // filePath will be set in initialize() after getting git root
    this.filePath = join(projectPath, '.autonomous-config.json'); // temporary fallback
  }

  /**
   * Initialize configuration with defaults or load existing
   *
   * ⚠️ CENTRALIZED PATH RESOLUTION LOGIC ⚠️
   * This is the ONLY method that handles version-aware config file location.
   * All commands should call this method to find and load configs.
   *
   * Path Resolution Strategy:
   * 1. Pre-migration (v0.0.1): .autonomous-config.json in git root
   * 2. Post-migration (v0.1.0+): .autonomous/.autonomous-config.json
   *
   * This method:
   * - Checks new location (.autonomous/) first, then falls back to old location (root)
   * - Runs migrations if config version < current version
   * - Always saves to new location (.autonomous/) after migration
   *
   * DO NOT add config path checks elsewhere - use this method!
   */
  async initialize(githubOwner?: string, githubRepo?: string): Promise<void> {
    // Get git root directory
    this.gitRoot = await getGitRoot(this.projectPath);
    if (!this.gitRoot) {
      throw new Error('Not a git repository or git root not found');
    }

    // CENTRALIZED PATH LOGIC - check both old and new locations
    const newConfigPath = join(this.gitRoot, '.autonomous', '.autonomous-config.json');
    const oldConfigPath = join(this.gitRoot, '.autonomous-config.json');

    // Try to load config from new location first, then old location
    let configLoaded = false;
    let currentVersion = '0.0.1'; // Default for legacy configs without version field

    for (const configPath of [newConfigPath, oldConfigPath]) {
      try {
        this.filePath = configPath;
        await this.load();
        configLoaded = true;
        currentVersion = this.config?.version || '0.0.1';
        break;
      } catch (error) {
        // Continue to next path
      }
    }

    // Always use new location for saving (migrations will move files here)
    this.filePath = newConfigPath;

    // Run migrations if config was loaded
    if (configLoaded && this.config) {
      const migrationManager = new MigrationManager(this.gitRoot);
      const result = await migrationManager.runMigrations(currentVersion);

      // Update config version if migrations ran
      if (result.migrationsRan || result.newVersion !== this.config.version) {
        this.config.version = result.newVersion;
        await this.save();
      }
    } else {
      // No config exists, create default
      this.config = { ...DEFAULT_CONFIG };

      if (githubOwner) this.config.github.owner = githubOwner;
      if (githubRepo) this.config.github.repo = githubRepo;

      // Set to current version for new installs
      this.config.version = MigrationManager.getCurrentVersionString();

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

    // Ensure .autonomous directory exists
    const autonomousDir = join(this.gitRoot || this.projectPath, '.autonomous');
    await fs.mkdir(autonomousDir, { recursive: true });

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

  /**
   * Start watching the configuration file for changes
   * @param onChange - Callback function called when config changes
   */
  startWatching(onChange?: (config: AutonomousConfig) => void): void {
    if (this.watcher) {
      return; // Already watching
    }

    this.onChangeCallback = onChange;

    this.watcher = watch(this.filePath, async (eventType) => {
      if (eventType === 'change') {
        // Debounce file system events - wait 500ms before reloading
        if (this.reloadTimeout) {
          clearTimeout(this.reloadTimeout);
        }

        this.reloadTimeout = setTimeout(async () => {
          try {
            const oldConfig = this.config ? JSON.stringify(this.config) : null;
            await this.load();
            const newConfig = JSON.stringify(this.config);

            // Only notify if config actually changed
            if (oldConfig !== newConfig && this.config) {
              console.log('📝 Configuration file changed, reloading...');
              if (this.onChangeCallback) {
                this.onChangeCallback(this.config);
              }
            }
          } catch (error) {
            console.error('Failed to reload configuration:', error);
          }
        }, 500);
      }
    });

    this.watcher.on('error', (error) => {
      console.error('Config file watcher error:', error);
    });
  }

  /**
   * Stop watching the configuration file
   */
  stopWatching(): void {
    if (this.reloadTimeout) {
      clearTimeout(this.reloadTimeout);
      this.reloadTimeout = null;
    }

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    this.onChangeCallback = undefined;
  }
}
