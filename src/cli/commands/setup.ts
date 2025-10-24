/**
 * Setup command - Check and install dependencies for autonomous
 */

import chalk from 'chalk';
import { DependencyChecker } from '../../utils/dependency-checker.js';
import * as readline from 'readline';

interface SetupOptions {
  installAll?: boolean;
  skipPrompts?: boolean;
}

/**
 * Simple prompt function using readline
 */
function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

export async function setupCommand(options: SetupOptions): Promise<void> {
  console.log(chalk.blue.bold('\n🔧 Autonomous Setup\n'));

  const cwd = process.cwd();
  const checker = new DependencyChecker(cwd);

  // Check all dependencies
  console.log(chalk.gray('Checking dependencies...\n'));
  const dependencies = await checker.checkAll();

  // Display status
  checker.displayStatus(dependencies);

  // Find what can be auto-installed
  const missingRequired = dependencies.filter((d) => d.required && !d.installed);
  const missingOptional = dependencies.filter((d) => !d.required && !d.installed);

  if (missingRequired.length > 0) {
    console.log(chalk.red('\n⚠️  Cannot continue: Required dependencies are missing'));
    console.log(chalk.yellow('Please install the required dependencies manually:'));
    for (const dep of missingRequired) {
      console.log(chalk.yellow(`  ${dep.name}: ${dep.installCommand}`));
    }
    process.exit(1);
  }

  // Handle optional dependencies
  if (missingOptional.length > 0) {
    console.log(chalk.blue('\n📦 Optional Dependencies\n'));

    // Filter to only those we can auto-install
    const autoInstallable = missingOptional.filter((d) =>
      d.name.includes('@changesets/cli')
    );

    if (autoInstallable.length > 0 && !options.skipPrompts) {
      console.log(chalk.gray('The following optional dependencies are not installed:\n'));
      for (const dep of autoInstallable) {
        console.log(chalk.yellow(`  • ${dep.name}`));
        console.log(chalk.gray(`    ${dep.purpose}\n`));
      }

      if (options.installAll) {
        // Install all without prompting
        for (const dep of autoInstallable) {
          if (dep.name.includes('@changesets/cli')) {
            await checker.installChangesets();
          }
        }
      } else {
        // Prompt for each
        for (const dep of autoInstallable) {
          if (dep.name.includes('@changesets/cli')) {
            const answer = await prompt(
              chalk.cyan(`Install ${dep.name}? (Recommended for push command) [Y/n]: `)
            );

            if (answer === '' || answer === 'y' || answer === 'yes') {
              await checker.installChangesets();
            }
          }
        }
      }
    }

    // Show manual installation for others
    const manualInstall = missingOptional.filter(
      (d) => !d.name.includes('@changesets/cli')
    );

    if (manualInstall.length > 0) {
      console.log(chalk.blue('\n📋 Manual Installation Recommended:\n'));
      for (const dep of manualInstall) {
        console.log(chalk.yellow(`  • ${dep.name}`));
        console.log(chalk.gray(`    ${dep.purpose}`));
        console.log(chalk.gray(`    Install: ${dep.installCommand}\n`));
      }
    }
  }

  console.log(chalk.green.bold('\n✓ Setup complete!\n'));
  console.log(chalk.gray('You can now use:'));
  console.log(chalk.gray('  auto start     - Start autonomous issue processing'));
  console.log(chalk.gray('  auto assign    - Manually assign an issue'));
  console.log(chalk.gray('  auto push      - Auto-commit and push changes'));
  console.log(chalk.gray('  auto status    - View current assignments'));
}
