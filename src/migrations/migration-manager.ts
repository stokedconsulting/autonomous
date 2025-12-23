/**
 * Migration Manager - Handles version migrations for autonomous system
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import chalk from 'chalk';

export interface Migration {
  version: string;
  name: string;
  run: (projectRoot: string) => Promise<void>;
}

export class MigrationManager {
  private static readonly CURRENT_VERSION = '0.1.0';

  private migrations: Migration[] = [];
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.registerMigrations();
  }

  /**
   * Register all migrations in order
   */
  private registerMigrations(): void {
    // Migration v0.0.1 -> v0.1.0: Move config and data files to .autonomous/
    this.migrations.push({
      version: '0.1.0',
      name: 'Move files to .autonomous directory',
      run: async (projectRoot: string) => {
        const autonomousDir = join(projectRoot, '.autonomous');

        // Ensure .autonomous directory and subdirectories exist
        await fs.mkdir(autonomousDir, { recursive: true });
        await fs.mkdir(join(autonomousDir, 'sessions'), { recursive: true });
        await fs.mkdir(join(autonomousDir, 'logs'), { recursive: true });
        await fs.mkdir(join(autonomousDir, 'hooks'), { recursive: true });
        await fs.mkdir(join(autonomousDir, 'prompts'), { recursive: true });

        console.log(chalk.green(`  ✓ Created .autonomous/ subdirectories: sessions/, logs/, hooks/, prompts/`));

        // Files to migrate from root to .autonomous/
        const filesToMigrate = [
          '.autonomous-config.json',
        ];

        for (const filename of filesToMigrate) {
          const oldPath = join(projectRoot, filename);
          const newPath = join(autonomousDir, filename);

          try {
            // Check if old file exists
            await fs.access(oldPath);

            // Check if new file already exists (skip if already migrated)
            try {
              await fs.access(newPath);
              console.log(chalk.gray(`  - ${filename} already in .autonomous/, skipping`));
              continue;
            } catch {
              // New file doesn't exist, proceed with migration
            }

            // Move file
            await fs.rename(oldPath, newPath);
            console.log(chalk.green(`  ✓ Moved ${filename} to .autonomous/`));
          } catch (error) {
            // File doesn't exist in old location, skip
            console.log(chalk.gray(`  - ${filename} not found in root, skipping`));
          }
        }

        // Organize existing .autonomous files into subdirectories
        await this.organizeExistingFiles(autonomousDir);

        // Add .autonomous/ to .gitignore if not already present
        await this.addToGitignore(projectRoot);
      },
    });
  }

  /**
   * Organize existing .autonomous files into subdirectories
   */
  private async organizeExistingFiles(autonomousDir: string): Promise<void> {
    try {
      const files = await fs.readdir(autonomousDir);
      let moved = 0;

      for (const file of files) {
        // Skip if it's a directory
        const filePath = join(autonomousDir, file);
        const stats = await fs.stat(filePath);
        if (stats.isDirectory()) continue;

        // Skip config file
        if (file === '.autonomous-config.json') {
          continue;
        }

        let targetDir: string | null = null;

        // Categorize and move files
        if (file.startsWith('instance-') && file.endsWith('.json')) {
          targetDir = join(autonomousDir, 'sessions');
        } else if (file.startsWith('start-') && file.endsWith('.sh')) {
          targetDir = join(autonomousDir, 'sessions');
        } else if (file.startsWith('output-') && file.endsWith('.log')) {
          targetDir = join(autonomousDir, 'logs');
        } else if (file.startsWith('prompt-') && file.endsWith('.txt')) {
          targetDir = join(autonomousDir, 'prompts');
        } else if (file.endsWith('.sh')) {
          // Other shell scripts likely hooks
          targetDir = join(autonomousDir, 'hooks');
        }

        if (targetDir) {
          try {
            const targetPath = join(targetDir, file);
            await fs.rename(filePath, targetPath);
            moved++;
          } catch (error) {
            // Skip files that can't be moved
          }
        }
      }

      if (moved > 0) {
        console.log(chalk.green(`  ✓ Organized ${moved} existing files into subdirectories`));
      }
    } catch (error) {
      console.log(chalk.yellow(`  ⚠️  Could not organize existing files: ${error instanceof Error ? error.message : String(error)}`));
    }
  }

  /**
   * Add .autonomous/ to project's .gitignore
   */
  private async addToGitignore(projectRoot: string): Promise<void> {
    const gitignorePath = join(projectRoot, '.gitignore');

    try {
      // Read existing .gitignore
      let content = '';
      try {
        content = await fs.readFile(gitignorePath, 'utf-8');
      } catch {
        // .gitignore doesn't exist, create it
      }

      // Check if .autonomous/ already in gitignore
      const lines = content.split('\n');
      const hasAutonomous = lines.some(line =>
        line.trim() === '.autonomous/' ||
        line.trim() === '.autonomous' ||
        line.trim() === '/.autonomous/'
      );

      if (!hasAutonomous) {
        // Add .autonomous/ to gitignore
        const newContent = content + (content && !content.endsWith('\n') ? '\n' : '') +
                          '\n# Autonomous AI system data\n.autonomous/\n';
        await fs.writeFile(gitignorePath, newContent, 'utf-8');
        console.log(chalk.green(`  ✓ Added .autonomous/ to .gitignore`));
      } else {
        console.log(chalk.gray(`  - .autonomous/ already in .gitignore`));
      }
    } catch (error) {
      console.log(chalk.yellow(`  ⚠️  Could not update .gitignore: ${error instanceof Error ? error.message : String(error)}`));
    }
  }


  /**
   * Compare version strings (simple semver comparison)
   */
  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < 3; i++) {
      const diff = (parts1[i] || 0) - (parts2[i] || 0);
      if (diff !== 0) return diff;
    }

    return 0;
  }

  /**
   * Run pending migrations
   * @param currentVersion - Current version from config (default '0.0.1' for legacy configs)
   * @returns Object with whether migrations ran and the new version
   */
  async runMigrations(currentVersion: string = '0.0.1'): Promise<{ migrationsRan: boolean; newVersion: string }> {
    // Normalize legacy versions: anything < 0.2.0 should trigger migrations
    // Common old versions: 0.0.1, 0.1.0, 1.0.0
    const normalizedCurrent = currentVersion;

    // Already on current version
    if (normalizedCurrent === MigrationManager.CURRENT_VERSION) {
      return { migrationsRan: false, newVersion: normalizedCurrent };
    }

    // Check if upgrade needed
    if (this.compareVersions(normalizedCurrent, MigrationManager.CURRENT_VERSION) >= 0) {
      // Current version is newer than or equal to executable version
      return { migrationsRan: false, newVersion: normalizedCurrent };
    }

    // Run migrations
    console.log(chalk.blue(`\n📦 Migration needed: v${currentVersion} → v${MigrationManager.CURRENT_VERSION}\n`));

    const migrationsToRun = this.migrations.filter(m =>
      this.compareVersions(m.version, currentVersion) > 0 &&
      this.compareVersions(m.version, MigrationManager.CURRENT_VERSION) <= 0
    );

    if (migrationsToRun.length === 0) {
      return { migrationsRan: false, newVersion: MigrationManager.CURRENT_VERSION };
    }

    console.log(chalk.blue(`Running ${migrationsToRun.length} migration(s)...\n`));

    for (const migration of migrationsToRun) {
      console.log(chalk.cyan(`📋 Migration v${migration.version}: ${migration.name}`));

      try {
        await migration.run(this.projectRoot);
        console.log(chalk.green(`✓ Migration v${migration.version} completed\n`));
      } catch (error) {
        console.error(chalk.red(`✗ Migration v${migration.version} failed:`), error);
        throw error;
      }
    }

    console.log(chalk.green(`✓ All migrations completed. Now on v${MigrationManager.CURRENT_VERSION}\n`));

    return { migrationsRan: true, newVersion: MigrationManager.CURRENT_VERSION };
  }

  /**
   * Get current version string
   */
  static getCurrentVersionString(): string {
    return MigrationManager.CURRENT_VERSION;
  }
}
