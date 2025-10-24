/**
 * Dependency checker and installer for autonomous commands
 */

import { $ } from 'zx';
import { promises as fs } from 'fs';
import { join } from 'path';
import chalk from 'chalk';

export interface DependencyStatus {
  name: string;
  required: boolean;
  installed: boolean;
  version?: string;
  installCommand?: string;
  purpose: string;
}

export class DependencyChecker {
  private cwd: string;

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
  }

  /**
   * Check all dependencies needed for autonomous commands
   */
  async checkAll(): Promise<DependencyStatus[]> {
    return [
      await this.checkGit(),
      await this.checkClaude(),
      await this.checkChangesets(),
      await this.checkGitHubCLI(),
      await this.checkPackageManager(),
    ];
  }

  /**
   * Check Git
   */
  async checkGit(): Promise<DependencyStatus> {
    try {
      $.verbose = false;
      const result = await $`git --version`;
      const version = result.stdout.trim().replace('git version ', '');
      return {
        name: 'Git',
        required: true,
        installed: true,
        version,
        purpose: 'Version control and worktree management',
      };
    } catch {
      return {
        name: 'Git',
        required: true,
        installed: false,
        installCommand: 'brew install git',
        purpose: 'Version control and worktree management',
      };
    }
  }

  /**
   * Check Claude CLI
   */
  async checkClaude(): Promise<DependencyStatus> {
    try {
      $.verbose = false;

      // First check if Claude is configured in .autonomous-config.json
      try {
        const configPath = join(this.cwd, '.autonomous-config.json');
        const configData = await fs.readFile(configPath, 'utf-8');
        const config = JSON.parse(configData);
        const claudePath = config.llms?.claude?.cliPath;

        if (claudePath) {
          // Try the configured path
          try {
            await fs.access(claudePath);
            // Try to get version
            try {
              const result = await $`${claudePath} --version`;
              return {
                name: 'Claude CLI',
                required: true,
                installed: true,
                version: result.stdout.trim() || 'configured',
                purpose: 'AI-powered issue evaluation and commit message generation',
              };
            } catch {
              // Path exists but can't get version - still consider it installed
              return {
                name: 'Claude CLI',
                required: true,
                installed: true,
                version: `configured at ${claudePath}`,
                purpose: 'AI-powered issue evaluation and commit message generation',
              };
            }
          } catch {
            // Configured path doesn't exist
            return {
              name: 'Claude CLI',
              required: true,
              installed: false,
              installCommand: `Configured path not found: ${claudePath}`,
              purpose: 'AI-powered issue evaluation and commit message generation',
            };
          }
        }
      } catch {
        // No config or can't read it - continue to PATH check
      }

      // Try common names in PATH
      let result;
      try {
        result = await $`claude --version`;
      } catch {
        try {
          result = await $`cld --version`;
        } catch {
          // Try with explicit shell to catch aliases
          try {
            const shell = process.env.SHELL || '/bin/bash';
            result = await $`${shell} -l -c "claude --version"`;
          } catch {
            try {
              const shell = process.env.SHELL || '/bin/bash';
              result = await $`${shell} -l -c "cld --version"`;
            } catch {
              throw new Error('Not found');
            }
          }
        }
      }

      return {
        name: 'Claude CLI',
        required: true,
        installed: true,
        version: result.stdout.trim(),
        purpose: 'AI-powered issue evaluation and commit message generation',
      };
    } catch {
      return {
        name: 'Claude CLI',
        required: true,
        installed: false,
        installCommand: 'Visit https://claude.ai/download or configure: autonomous config add-llm claude --cli-path /path/to/claude',
        purpose: 'AI-powered issue evaluation and commit message generation',
      };
    }
  }

  /**
   * Check @changesets/cli package
   */
  async checkChangesets(): Promise<DependencyStatus> {
    try {
      const pkgPath = join(this.cwd, 'package.json');
      const pkgData = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));

      const hasChangeset =
        pkgData.devDependencies?.['@changesets/cli'] ||
        pkgData.dependencies?.['@changesets/cli'];

      if (hasChangeset) {
        return {
          name: '@changesets/cli',
          required: false,
          installed: true,
          version: hasChangeset,
          purpose: 'Automatic versioning and changelog generation (for push command)',
        };
      }

      // Check if .changeset directory exists
      try {
        await fs.access(join(this.cwd, '.changeset'));
        return {
          name: '@changesets/cli',
          required: false,
          installed: false,
          installCommand: 'pnpm add -D @changesets/cli && pnpm changeset init',
          purpose: 'Automatic versioning and changelog generation (for push command)',
        };
      } catch {
        // No changeset directory, so not needed
        return {
          name: '@changesets/cli',
          required: false,
          installed: false,
          purpose: 'Optional: Automatic versioning and changelog generation',
        };
      }
    } catch {
      return {
        name: '@changesets/cli',
        required: false,
        installed: false,
        purpose: 'Optional: Automatic versioning and changelog generation',
      };
    }
  }

  /**
   * Check GitHub CLI (gh)
   */
  async checkGitHubCLI(): Promise<DependencyStatus> {
    try {
      $.verbose = false;
      const result = await $`gh --version`;
      const versionLine = result.stdout.split('\n')[0];
      const version = versionLine.replace('gh version ', '').trim();
      return {
        name: 'GitHub CLI (gh)',
        required: false,
        installed: true,
        version,
        purpose: 'Pull request creation and management (for push --pr)',
      };
    } catch {
      return {
        name: 'GitHub CLI (gh)',
        required: false,
        installed: false,
        installCommand: 'brew install gh',
        purpose: 'Pull request creation and management (for push --pr)',
      };
    }
  }

  /**
   * Check package manager (pnpm, npm, yarn)
   */
  async checkPackageManager(): Promise<DependencyStatus> {
    $.verbose = false;

    // Try pnpm first
    try {
      const result = await $`pnpm --version`;
      return {
        name: 'pnpm',
        required: false,
        installed: true,
        version: result.stdout.trim(),
        purpose: 'Package management (preferred for monorepos)',
      };
    } catch {
      // Try npm
      try {
        const result = await $`npm --version`;
        return {
          name: 'npm',
          required: false,
          installed: true,
          version: result.stdout.trim(),
          purpose: 'Package management',
        };
      } catch {
        // Try yarn
        try {
          const result = await $`yarn --version`;
          return {
            name: 'yarn',
            required: false,
            installed: true,
            version: result.stdout.trim(),
            purpose: 'Package management',
          };
        } catch {
          return {
            name: 'Package Manager',
            required: true,
            installed: false,
            installCommand: 'brew install pnpm',
            purpose: 'Package management',
          };
        }
      }
    }
  }

  /**
   * Display dependency status
   */
  displayStatus(dependencies: DependencyStatus[]): void {
    console.log(chalk.blue.bold('\n📦 Dependency Status\n'));

    const required = dependencies.filter((d) => d.required);
    const optional = dependencies.filter((d) => !d.required);

    console.log(chalk.bold('Required:'));
    for (const dep of required) {
      if (dep.installed) {
        console.log(chalk.green(`  ✓ ${dep.name} ${dep.version ? `(${dep.version})` : ''}`));
      } else {
        console.log(chalk.red(`  ✗ ${dep.name} - NOT INSTALLED`));
        if (dep.installCommand) {
          console.log(chalk.gray(`    Install: ${dep.installCommand}`));
        }
      }
      console.log(chalk.gray(`    ${dep.purpose}`));
    }

    console.log(chalk.bold('\nOptional:'));
    for (const dep of optional) {
      if (dep.installed) {
        console.log(chalk.green(`  ✓ ${dep.name} ${dep.version ? `(${dep.version})` : ''}`));
      } else {
        console.log(chalk.yellow(`  - ${dep.name} - Not installed`));
        if (dep.installCommand) {
          console.log(chalk.gray(`    Install: ${dep.installCommand}`));
        }
      }
      console.log(chalk.gray(`    ${dep.purpose}`));
    }

    // Check if any required deps are missing
    const missingRequired = required.filter((d) => !d.installed);
    if (missingRequired.length > 0) {
      console.log(chalk.red.bold('\n⚠️  Missing required dependencies!'));
      console.log(chalk.yellow('Please install the required dependencies listed above.'));
    } else {
      console.log(chalk.green.bold('\n✓ All required dependencies installed!'));
    }
  }

  /**
   * Install @changesets/cli if needed
   */
  async installChangesets(): Promise<boolean> {
    console.log(chalk.blue('\n📦 Installing @changesets/cli...\n'));

    try {
      $.verbose = true;

      // Detect package manager
      const pkgManager = await this.detectPackageManager();

      if (pkgManager === 'pnpm') {
        await $`pnpm add -D @changesets/cli`;
        await $`pnpm changeset init`;
      } else if (pkgManager === 'yarn') {
        await $`yarn add -D @changesets/cli`;
        await $`yarn changeset init`;
      } else {
        await $`npm install --save-dev @changesets/cli`;
        await $`npx changeset init`;
      }

      console.log(chalk.green('\n✓ @changesets/cli installed successfully'));
      console.log(chalk.gray('Configuration created in .changeset/config.json'));
      return true;
    } catch (error: any) {
      console.error(chalk.red('✗ Failed to install @changesets/cli:'), error.message);
      return false;
    }
  }

  /**
   * Detect which package manager is being used
   */
  private async detectPackageManager(): Promise<'pnpm' | 'yarn' | 'npm'> {
    try {
      await fs.access(join(this.cwd, 'pnpm-lock.yaml'));
      return 'pnpm';
    } catch {
      try {
        await fs.access(join(this.cwd, 'yarn.lock'));
        return 'yarn';
      } catch {
        return 'npm';
      }
    }
  }
}
