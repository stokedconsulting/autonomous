/**
 * Help command implementation
 *
 * Integrates Ink HelpUI with Commander, supporting:
 * - Interactive mode (default in TTY)
 * - Text mode (piped output or --no-interactive)
 * - Jump to specific command section
 */

import { Command } from 'commander';

/**
 * Command option definition (matches HelpPage.CommandOption)
 */
interface CommandOption {
  flag: string;
  description: string;
  required?: boolean;
  defaultValue?: string;
}

/**
 * Command information (matches HelpPage.CommandInfo)
 */
interface CommandInfo {
  name: string;
  description: string;
  usage?: string;
  options?: CommandOption[];
  examples?: string[];
  aliases?: string[];
}

/**
 * Command category (matches HelpPage.CommandCategory)
 */
interface CommandCategory {
  name: string;
  label: string;
  description?: string;
  commands: CommandInfo[];
}

/**
 * Command category definitions for organizing help output
 */
const COMMAND_CATEGORIES: Record<string, { label: string; description?: string }> = {
  workflow: {
    label: 'Workflow Commands',
    description: 'Commands for orchestrating autonomous work',
  },
  project: {
    label: 'Project Management',
    description: 'GitHub Projects v2 integration and management',
  },
  item: {
    label: 'Item Commands',
    description: 'Commands for managing individual issues',
  },
  git: {
    label: 'Git & Merge',
    description: 'Git operations and branch management',
  },
  config: {
    label: 'Configuration',
    description: 'Setup and configuration commands',
  },
  advanced: {
    label: 'Advanced',
    description: 'Advanced operations and utilities',
  },
};

/**
 * Maps commands to their categories
 */
const COMMAND_CATEGORY_MAP: Record<string, string> = {
  // Workflow
  start: 'workflow',
  stop: 'workflow',
  status: 'workflow',
  assign: 'workflow',
  unassign: 'workflow',
  evaluate: 'workflow',
  review: 'workflow',
  clarify: 'workflow',

  // Project Management
  project: 'project',
  epic: 'project',
  optimize: 'project',

  // Item Commands
  item: 'item',

  // Git & Merge
  push: 'git',
  'merge-to-main': 'git',
  'stage-diff': 'git',

  // Configuration
  config: 'config',
  setup: 'config',
  update: 'config',

  // Advanced
  persona: 'advanced',
};

/**
 * Extracts option information from a Commander Option
 */
function extractOptionInfo(option: {
  flags: string;
  description: string;
  required: boolean;
  defaultValue?: unknown;
}): CommandOption {
  return {
    flag: option.flags,
    description: option.description || '',
    required: option.required,
    defaultValue:
      option.defaultValue !== undefined
        ? String(option.defaultValue)
        : undefined,
  };
}

/**
 * Extracts command info from a Commander Command
 */
function extractCommandInfo(cmd: Command): CommandInfo {
  const options: CommandOption[] = [];

  // Extract options from the command
  for (const opt of cmd.options) {
    options.push(extractOptionInfo(opt));
  }

  // Build usage string
  const args = cmd.registeredArguments || [];
  const argStr = args
    .map((arg: { name(): string; required: boolean }) =>
      arg.required ? `<${arg.name()}>` : `[${arg.name()}]`
    )
    .join(' ');
  const usage = `auto ${cmd.name()}${argStr ? ` ${argStr}` : ''}`;

  // Get aliases
  const aliases = cmd.aliases();

  // Build examples based on options
  const examples: string[] = [`auto ${cmd.name()}`];
  if (argStr) {
    examples[0] = usage;
  }

  // Add common option examples
  const hasVerbose = options.some((o) => o.flag.includes('--verbose'));
  const hasJson = options.some((o) => o.flag.includes('--json'));
  if (hasVerbose) {
    examples.push(`auto ${cmd.name()} --verbose`);
  }
  if (hasJson) {
    examples.push(`auto ${cmd.name()} --json`);
  }

  return {
    name: cmd.name(),
    description: cmd.description(),
    usage,
    options: options.length > 0 ? options : undefined,
    examples: examples.length > 1 ? examples : undefined,
    aliases: aliases.length > 0 ? aliases : undefined,
  };
}

/**
 * Recursively extracts commands, including subcommands
 */
function extractAllCommands(
  program: Command,
  prefix = ''
): Map<string, CommandInfo[]> {
  const categoryCommands = new Map<string, CommandInfo[]>();

  for (const cmd of program.commands) {
    const cmdName = prefix ? `${prefix} ${cmd.name()}` : cmd.name();

    // Skip the help command itself
    if (cmd.name() === 'help') continue;

    // Check if this command has subcommands
    if (cmd.commands.length > 0) {
      // Recursively extract subcommands
      for (const subCmd of cmd.commands) {
        const subCmdName = `${cmdName} ${subCmd.name()}`;
        const category = COMMAND_CATEGORY_MAP[cmd.name()] || 'advanced';

        const info = extractCommandInfo(subCmd);
        // Override name and usage to include parent command
        info.name = subCmdName;
        info.usage = `auto ${subCmdName}${info.usage?.replace(`auto ${subCmd.name()}`, '').trim() || ''}`;

        if (!categoryCommands.has(category)) {
          categoryCommands.set(category, []);
        }
        categoryCommands.get(category)!.push(info);
      }
    } else {
      // Regular command
      const category = COMMAND_CATEGORY_MAP[cmd.name()] || 'advanced';
      const info = extractCommandInfo(cmd);

      if (!categoryCommands.has(category)) {
        categoryCommands.set(category, []);
      }
      categoryCommands.get(category)!.push(info);
    }
  }

  return categoryCommands;
}

/**
 * Builds command categories for the HelpPage component
 */
export function buildCommandCategories(program: Command): CommandCategory[] {
  const categoryCommands = extractAllCommands(program);
  const categories: CommandCategory[] = [];

  // Order categories as defined
  const categoryOrder = [
    'workflow',
    'project',
    'item',
    'git',
    'config',
    'advanced',
  ];

  for (const categoryName of categoryOrder) {
    const commands = categoryCommands.get(categoryName);
    if (commands && commands.length > 0) {
      const categoryDef = COMMAND_CATEGORIES[categoryName] || {
        label: categoryName,
      };
      categories.push({
        name: categoryName,
        label: categoryDef.label,
        description: categoryDef.description,
        commands: commands.sort((a, b) => a.name.localeCompare(b.name)),
      });
    }
  }

  return categories;
}

/**
 * Generates plain text help output for non-interactive mode
 */
export function generateTextHelp(
  categories: CommandCategory[],
  focusCommand?: string
): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('Autonomous CLI - Help');
  lines.push('═'.repeat(60));
  lines.push('');

  // If focusing on a specific command, show only that
  if (focusCommand) {
    for (const category of categories) {
      const cmd = category.commands.find(
        (c) =>
          c.name === focusCommand ||
          c.name.split(' ').pop() === focusCommand ||
          c.aliases?.includes(focusCommand)
      );
      if (cmd) {
        lines.push(`Command: ${cmd.name}`);
        lines.push(`Category: ${category.label}`);
        lines.push('');
        lines.push(`  ${cmd.description}`);
        lines.push('');

        if (cmd.usage) {
          lines.push('Usage:');
          lines.push(`  ${cmd.usage}`);
          lines.push('');
        }

        if (cmd.aliases && cmd.aliases.length > 0) {
          lines.push('Aliases:');
          lines.push(`  ${cmd.aliases.join(', ')}`);
          lines.push('');
        }

        if (cmd.options && cmd.options.length > 0) {
          lines.push('Options:');
          for (const opt of cmd.options) {
            const defaultStr = opt.defaultValue
              ? ` (default: ${opt.defaultValue})`
              : '';
            const reqStr = opt.required ? ' (required)' : '';
            lines.push(`  ${opt.flag}${reqStr}${defaultStr}`);
            lines.push(`      ${opt.description}`);
          }
          lines.push('');
        }

        if (cmd.examples && cmd.examples.length > 0) {
          lines.push('Examples:');
          for (const ex of cmd.examples) {
            lines.push(`  $ ${ex}`);
          }
          lines.push('');
        }

        return lines.join('\n');
      }
    }
    // Command not found
    lines.push(`Command '${focusCommand}' not found.`);
    lines.push('');
    lines.push('Available commands:');
    for (const category of categories) {
      for (const cmd of category.commands) {
        lines.push(`  ${cmd.name}`);
      }
    }
    return lines.join('\n');
  }

  // Show all categories and commands
  for (const category of categories) {
    lines.push(`${category.label}`);
    if (category.description) {
      lines.push(`  ${category.description}`);
    }
    lines.push('─'.repeat(60));

    for (const cmd of category.commands) {
      const aliasStr =
        cmd.aliases && cmd.aliases.length > 0
          ? ` (${cmd.aliases.join(', ')})`
          : '';
      lines.push(`  ${cmd.name}${aliasStr}`);
      lines.push(`      ${cmd.description}`);
    }
    lines.push('');
  }

  lines.push('─'.repeat(60));
  lines.push('Use "auto help <command>" for more information about a command.');
  lines.push('');

  return lines.join('\n');
}

/**
 * Determines if output should be interactive based on TTY and options
 */
export function shouldUseInteractiveHelp(options: {
  interactive?: boolean;
  noInteractive?: boolean;
}): boolean {
  // Explicit --no-interactive flag
  if (options.noInteractive === true) {
    return false;
  }

  // Explicit --interactive flag
  if (options.interactive === true) {
    return true;
  }

  // Default: use TTY detection
  return process.stdout.isTTY === true;
}

/**
 * Find the category that contains a specific command
 */
function findCommandCategory(
  categories: CommandCategory[],
  commandName: string
): string | undefined {
  for (const category of categories) {
    const found = category.commands.find(
      (c) =>
        c.name === commandName ||
        c.name.split(' ').pop() === commandName ||
        c.aliases?.includes(commandName)
    );
    if (found) {
      return category.name;
    }
  }
  return undefined;
}

export interface HelpOptions {
  interactive?: boolean;
  noInteractive?: boolean;
}

/**
 * Dynamically imports and renders the interactive help page
 * Using dynamic import to avoid ESM issues with Ink at module load time
 */
async function renderInteractiveHelp(
  categories: CommandCategory[],
  focusCommand?: string
): Promise<number> {
  // Dynamic import of ESM modules
  const [{ renderCommand }, { HelpPage }, React] = await Promise.all([
    import('../../ui/index.js'),
    import('../../ui/pages/HelpPage.js'),
    import('react'),
  ]);

  // Determine initial expanded categories based on focus command
  let initialExpanded: Set<string> | undefined;
  if (focusCommand) {
    const targetCategory = findCommandCategory(categories, focusCommand);
    if (targetCategory) {
      // Collapse all categories except the target
      initialExpanded = new Set([targetCategory]);
    }
  }

  const exitCode = await renderCommand(
    React.createElement(HelpPage, {
      categories,
      title: 'Autonomous CLI Help',
      initialExpanded,
      onExit: () => process.exit(0),
    })
  );

  return exitCode;
}

/**
 * Help command action handler
 */
export async function helpCommand(
  command: string | undefined,
  options: HelpOptions,
  program: Command
): Promise<void> {
  const categories = buildCommandCategories(program);
  const useInteractive = shouldUseInteractiveHelp(options);

  if (!useInteractive) {
    // Text-only mode
    const output = generateTextHelp(categories, command);
    console.log(output);
    process.exit(0);
  }

  // Interactive mode with Ink (using dynamic imports)
  const exitCode = await renderInteractiveHelp(categories, command);
  process.exit(exitCode);
}

/**
 * Creates and configures the help command for Commander
 */
export function createHelpCommand(program: Command): Command {
  const helpCmd = new Command('help')
    .description('Display interactive help for commands')
    .argument('[command]', 'Command to get help for')
    .option('--interactive', 'Force interactive mode')
    .option('--no-interactive', 'Force text-only output')
    .action(async (command: string | undefined, options: HelpOptions) => {
      await helpCommand(command, options, program);
    });

  return helpCmd;
}

/**
 * Override Commander's default help behavior to use Ink UI
 */
export function configureHelpOverride(program: Command): void {
  // Add our custom help command
  program.addCommand(createHelpCommand(program));

  // Override the help option to redirect to our help command
  program.helpOption('-h, --help', 'Display help for command');

  // Hook into the help event
  program.on('option:help', () => {
    const categories = buildCommandCategories(program);
    const useInteractive = shouldUseInteractiveHelp({});

    if (!useInteractive) {
      const output = generateTextHelp(categories);
      console.log(output);
      process.exit(0);
    }

    // In interactive mode, render the help page (using dynamic imports)
    renderInteractiveHelp(categories).then((exitCode) => {
      process.exit(exitCode);
    });
  });
}
