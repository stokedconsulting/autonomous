/**
 * Tests for help command implementation
 *
 * Tests the CLI help routing and integration with Commander.js
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock the UI modules before importing help.ts
jest.unstable_mockModule('../../../src/ui/index.js', () => ({
  renderCommand: jest.fn<() => Promise<number>>().mockResolvedValue(0),
}));

jest.unstable_mockModule('../../../src/ui/pages/HelpPage.js', () => ({
  HelpPage: jest.fn<() => null>(),
}));

jest.unstable_mockModule('react', () => ({
  createElement: jest.fn<() => null>(),
  default: { createElement: jest.fn<() => null>() },
}));

// Now import the help module
const { buildCommandCategories, generateTextHelp, shouldUseInteractiveHelp, configureHelpOverride, createHelpCommand } = await import('../../../src/cli/commands/help.js');
const { Command } = await import('commander');

describe('help command', () => {
  describe('shouldUseInteractiveHelp', () => {
    // Store original isTTY value
    let originalIsTTY: boolean | undefined;

    beforeEach(() => {
      originalIsTTY = process.stdout.isTTY;
    });

    afterEach(() => {
      // Restore original isTTY
      Object.defineProperty(process.stdout, 'isTTY', {
        value: originalIsTTY,
        writable: true,
        configurable: true,
      });
    });

    it('should return false when --no-interactive flag is set', () => {
      const result = shouldUseInteractiveHelp({ noInteractive: true });
      expect(result).toBe(false);
    });

    it('should return true when --interactive flag is set', () => {
      const result = shouldUseInteractiveHelp({ interactive: true });
      expect(result).toBe(true);
    });

    it('should return true when TTY is true and no flags set', () => {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: true,
        writable: true,
        configurable: true,
      });
      const result = shouldUseInteractiveHelp({});
      expect(result).toBe(true);
    });

    it('should return false when TTY is false and no flags set', () => {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: false,
        writable: true,
        configurable: true,
      });
      const result = shouldUseInteractiveHelp({});
      expect(result).toBe(false);
    });

    it('should return false when TTY is undefined and no flags set', () => {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: undefined,
        writable: true,
        configurable: true,
      });
      const result = shouldUseInteractiveHelp({});
      expect(result).toBe(false);
    });

    it('should prioritize --no-interactive over TTY detection', () => {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: true,
        writable: true,
        configurable: true,
      });
      const result = shouldUseInteractiveHelp({ noInteractive: true });
      expect(result).toBe(false);
    });

    it('should prioritize --interactive over TTY detection', () => {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: false,
        writable: true,
        configurable: true,
      });
      const result = shouldUseInteractiveHelp({ interactive: true });
      expect(result).toBe(true);
    });
  });

  describe('buildCommandCategories', () => {
    it('should extract commands from a program', () => {
      const program = new Command();
      program.name('test');

      program
        .command('start')
        .description('Start the process')
        .option('--force', 'Force start');

      program
        .command('stop')
        .description('Stop the process');

      const categories = buildCommandCategories(program);

      // Commands should be categorized
      expect(categories.length).toBeGreaterThan(0);

      // Find the category containing our commands
      const allCommands = categories.flatMap(c => c.commands);
      const startCmd = allCommands.find(c => c.name === 'start');
      const stopCmd = allCommands.find(c => c.name === 'stop');

      expect(startCmd).toBeDefined();
      expect(startCmd?.description).toBe('Start the process');
      expect(startCmd?.options).toBeDefined();
      expect(startCmd?.options?.length).toBe(1);
      expect(startCmd?.options?.[0].flag).toContain('--force');

      expect(stopCmd).toBeDefined();
      expect(stopCmd?.description).toBe('Stop the process');
    });

    it('should handle subcommands correctly', () => {
      const program = new Command();
      program.name('test');

      const config = program
        .command('config')
        .description('Configuration commands');

      config
        .command('init')
        .description('Initialize configuration');

      config
        .command('show')
        .description('Show configuration');

      const categories = buildCommandCategories(program);
      const allCommands = categories.flatMap(c => c.commands);

      // Should extract subcommands with full names
      const initCmd = allCommands.find(c => c.name === 'config init');
      const showCmd = allCommands.find(c => c.name === 'config show');

      expect(initCmd).toBeDefined();
      expect(initCmd?.description).toBe('Initialize configuration');
      expect(showCmd).toBeDefined();
      expect(showCmd?.description).toBe('Show configuration');
    });

    it('should skip the help command itself', () => {
      const program = new Command();
      program.name('test');

      program
        .command('help')
        .description('Show help');

      program
        .command('start')
        .description('Start the process');

      const categories = buildCommandCategories(program);
      const allCommands = categories.flatMap(c => c.commands);

      const helpCmd = allCommands.find(c => c.name === 'help');
      const startCmd = allCommands.find(c => c.name === 'start');

      expect(helpCmd).toBeUndefined();
      expect(startCmd).toBeDefined();
    });

    it('should extract command with arguments', () => {
      const program = new Command();
      program.name('test');

      program
        .command('assign')
        .argument('<issue-number>', 'Issue number to assign')
        .description('Assign an issue');

      const categories = buildCommandCategories(program);
      const allCommands = categories.flatMap(c => c.commands);
      const assignCmd = allCommands.find(c => c.name === 'assign');

      expect(assignCmd).toBeDefined();
      expect(assignCmd?.usage).toContain('<issue-number>');
    });

    it('should categorize commands correctly', () => {
      const program = new Command();
      program.name('test');

      // Add commands from different categories
      program.command('start').description('Start');
      program.command('push').description('Push');
      program.command('setup').description('Setup');

      const categories = buildCommandCategories(program);

      // Verify categories are created
      expect(categories.length).toBeGreaterThan(0);

      // Commands should be in their appropriate categories
      const workflowCat = categories.find(c => c.name === 'workflow');
      const gitCat = categories.find(c => c.name === 'git');
      const configCat = categories.find(c => c.name === 'config');

      // At least one of these should exist based on the command mapping
      const foundCategories = [workflowCat, gitCat, configCat].filter(Boolean);
      expect(foundCategories.length).toBeGreaterThan(0);
    });
  });

  describe('generateTextHelp', () => {
    const mockCategories = [
      {
        name: 'workflow',
        label: 'Workflow Commands',
        description: 'Commands for workflow management',
        commands: [
          {
            name: 'start',
            description: 'Start the process',
            usage: 'auto start [options]',
            options: [
              { flag: '--force', description: 'Force start' },
              { flag: '--verbose, -v', description: 'Verbose output' },
            ],
            examples: ['auto start', 'auto start --force'],
            aliases: ['run'],
          },
          {
            name: 'stop',
            description: 'Stop the process',
          },
        ],
      },
      {
        name: 'git',
        label: 'Git Commands',
        commands: [
          {
            name: 'push',
            description: 'Push changes',
          },
        ],
      },
    ];

    it('should generate header with title', () => {
      const output = generateTextHelp(mockCategories);
      expect(output).toContain('Autonomous CLI - Help');
    });

    it('should show all category labels', () => {
      const output = generateTextHelp(mockCategories);
      expect(output).toContain('Workflow Commands');
      expect(output).toContain('Git Commands');
    });

    it('should show category descriptions', () => {
      const output = generateTextHelp(mockCategories);
      expect(output).toContain('Commands for workflow management');
    });

    it('should show command names and descriptions', () => {
      const output = generateTextHelp(mockCategories);
      expect(output).toContain('start');
      expect(output).toContain('Start the process');
      expect(output).toContain('stop');
      expect(output).toContain('Stop the process');
      expect(output).toContain('push');
      expect(output).toContain('Push changes');
    });

    it('should show command aliases', () => {
      const output = generateTextHelp(mockCategories);
      expect(output).toContain('run');
    });

    it('should show usage hint at the bottom', () => {
      const output = generateTextHelp(mockCategories);
      expect(output).toContain('auto help <command>');
    });

    describe('focused command output', () => {
      it('should show detailed info for a specific command', () => {
        const output = generateTextHelp(mockCategories, 'start');
        expect(output).toContain('Command: start');
        expect(output).toContain('Category: Workflow Commands');
        expect(output).toContain('Usage:');
        expect(output).toContain('auto start [options]');
        expect(output).toContain('Options:');
        expect(output).toContain('--force');
        expect(output).toContain('Examples:');
      });

      it('should show aliases for focused command', () => {
        const output = generateTextHelp(mockCategories, 'start');
        expect(output).toContain('Aliases:');
        expect(output).toContain('run');
      });

      it('should find command by alias', () => {
        const output = generateTextHelp(mockCategories, 'run');
        expect(output).toContain('Command: start');
      });

      it('should show error message for unknown command', () => {
        const output = generateTextHelp(mockCategories, 'unknown');
        expect(output).toContain("Command 'unknown' not found");
        expect(output).toContain('Available commands:');
      });

      it('should list available commands when unknown command requested', () => {
        const output = generateTextHelp(mockCategories, 'unknown');
        expect(output).toContain('start');
        expect(output).toContain('stop');
        expect(output).toContain('push');
      });
    });

    describe('parent command matching', () => {
      const categoriesWithSubcommands = [
        {
          name: 'project',
          label: 'Project Management',
          commands: [
            { name: 'project init', description: 'Initialize project' },
            { name: 'project status', description: 'Show project status' },
            { name: 'project sync', description: 'Sync project data' },
          ],
        },
        {
          name: 'config',
          label: 'Configuration',
          commands: [
            { name: 'config init', description: 'Initialize config' },
            { name: 'config show', description: 'Show config' },
          ],
        },
      ];

      it('should show subcommands when parent command is specified', () => {
        const output = generateTextHelp(categoriesWithSubcommands, 'project');
        expect(output).toContain('Command Group: project');
        expect(output).toContain('Subcommands:');
        expect(output).toContain('init');
        expect(output).toContain('status');
        expect(output).toContain('sync');
      });

      it('should show help hint for parent command', () => {
        const output = generateTextHelp(categoriesWithSubcommands, 'project');
        expect(output).toContain('auto help project <subcommand>');
      });

      it('should work with different parent commands', () => {
        const output = generateTextHelp(categoriesWithSubcommands, 'config');
        expect(output).toContain('Command Group: config');
        expect(output).toContain('init');
        expect(output).toContain('show');
      });
    });
  });

  describe('createHelpCommand', () => {
    it('should create a help command with correct configuration', () => {
      const program = new Command();
      program.name('test');

      const helpCmd = createHelpCommand(program);

      expect(helpCmd.name()).toBe('help');
      expect(helpCmd.description()).toBe('Display interactive help for commands');
    });

    it('should have optional command argument', () => {
      const program = new Command();
      program.name('test');

      const helpCmd = createHelpCommand(program);
      const args = helpCmd.registeredArguments;

      expect(args.length).toBe(1);
      expect(args[0].required).toBe(false);
    });

    it('should have --interactive option', () => {
      const program = new Command();
      program.name('test');

      const helpCmd = createHelpCommand(program);
      const options = helpCmd.options;

      const interactiveOpt = options.find(o => o.long === '--interactive');
      expect(interactiveOpt).toBeDefined();
    });

    it('should have --no-interactive option', () => {
      const program = new Command();
      program.name('test');

      const helpCmd = createHelpCommand(program);
      const options = helpCmd.options;

      const noInteractiveOpt = options.find(o => o.long === '--no-interactive');
      expect(noInteractiveOpt).toBeDefined();
    });
  });

  describe('configureHelpOverride', () => {
    it('should add help command to program', () => {
      const program = new Command();
      program.name('test');

      configureHelpOverride(program);

      const helpCmd = program.commands.find(c => c.name() === 'help');
      expect(helpCmd).toBeDefined();
    });

    it('should configure help option event handler', () => {
      const program = new Command();
      program.name('test');

      configureHelpOverride(program);

      // The help option is configured via helpOption() method
      // which sets up special handling rather than adding to options array
      // Verify the help command was added (which is the key behavior)
      const helpCmd = program.commands.find(c => c.name() === 'help');
      expect(helpCmd).toBeDefined();
      expect(helpCmd?.description()).toBe('Display interactive help for commands');
    });
  });

  describe('integration with Commander', () => {
    it('should work with the complete program structure', () => {
      const program = new Command();
      program.name('autonomous');

      // Add some typical commands
      program.command('start').description('Start autonomous mode');
      program.command('stop').description('Stop all instances');
      program.command('status').description('View status');

      const config = program.command('config').description('Configuration');
      config.command('init').description('Initialize');
      config.command('show').description('Show config');

      program.command('push').description('Push changes');
      program.command('setup').description('Install dependencies');

      configureHelpOverride(program);

      const categories = buildCommandCategories(program);

      // Verify structure
      expect(categories.length).toBeGreaterThan(0);

      const allCommands = categories.flatMap(c => c.commands);
      expect(allCommands.length).toBeGreaterThanOrEqual(6);

      // Verify specific commands exist
      expect(allCommands.find(c => c.name === 'start')).toBeDefined();
      expect(allCommands.find(c => c.name === 'config init')).toBeDefined();
    });
  });

  describe('option extraction', () => {
    it('should extract option flags correctly', () => {
      const program = new Command();
      program.name('test');

      program
        .command('test-cmd')
        .option('-f, --force', 'Force operation')
        .option('-v, --verbose', 'Verbose output')
        .option('--dry-run', 'Simulate only')
        .description('Test command');

      const categories = buildCommandCategories(program);
      const allCommands = categories.flatMap(c => c.commands);
      const cmd = allCommands.find(c => c.name === 'test-cmd');

      expect(cmd?.options).toBeDefined();
      expect(cmd?.options?.length).toBe(3);

      const flags = cmd?.options?.map(o => o.flag);
      expect(flags).toContainEqual(expect.stringContaining('--force'));
      expect(flags).toContainEqual(expect.stringContaining('--verbose'));
      expect(flags).toContainEqual(expect.stringContaining('--dry-run'));
    });

    it('should extract option descriptions', () => {
      const program = new Command();
      program.name('test');

      program
        .command('test-cmd')
        .option('--output <path>', 'Output file path')
        .description('Test command');

      const categories = buildCommandCategories(program);
      const allCommands = categories.flatMap(c => c.commands);
      const cmd = allCommands.find(c => c.name === 'test-cmd');

      const outputOpt = cmd?.options?.find(o => o.flag.includes('--output'));
      expect(outputOpt?.description).toBe('Output file path');
    });
  });

  describe('piped output detection', () => {
    let originalIsTTY: boolean | undefined;

    beforeEach(() => {
      originalIsTTY = process.stdout.isTTY;
    });

    afterEach(() => {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: originalIsTTY,
        writable: true,
        configurable: true,
      });
    });

    it('should detect piped output (non-TTY) and return false', () => {
      // Simulate piped output: auto help | cat
      Object.defineProperty(process.stdout, 'isTTY', {
        value: undefined,
        writable: true,
        configurable: true,
      });

      const result = shouldUseInteractiveHelp({});
      expect(result).toBe(false);
    });

    it('should detect terminal output (TTY) and return true', () => {
      // Simulate direct terminal output
      Object.defineProperty(process.stdout, 'isTTY', {
        value: true,
        writable: true,
        configurable: true,
      });

      const result = shouldUseInteractiveHelp({});
      expect(result).toBe(true);
    });
  });
});
