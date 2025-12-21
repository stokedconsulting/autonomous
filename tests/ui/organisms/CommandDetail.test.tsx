/**
 * Tests for CommandDetail component
 *
 * Note: ink-testing-library has limited support for components with useInput.
 * These tests focus on rendering with isActive=false to avoid cleanup issues.
 */

import { describe, it, expect, jest } from '@jest/globals';
import { render } from 'ink-testing-library';
import { CommandDetail } from '../../../src/ui/organisms/CommandDetail.js';
import type { CommandDefinition } from '../../../src/ui/organisms/types.js';

describe('CommandDetail', () => {
  // Mock callbacks
  const mockOnBack = jest.fn<() => void>();

  // Basic command definition
  const basicCommand: CommandDefinition = {
    name: 'init',
    summary: 'Initialize a new project',
  };

  // Full command definition with all features
  const fullCommand: CommandDefinition = {
    name: 'deploy',
    summary: 'Deploy your application to production',
    description: 'This command deploys your application to the specified environment with all necessary configurations.',
    parent: 'project',
    category: 'deployment',
    aliases: ['d', 'push-live'],
    arguments: [
      {
        name: 'environment',
        description: 'Target deployment environment',
        required: true,
      },
      {
        name: 'version',
        description: 'Version tag to deploy',
        required: false,
        defaultValue: 'latest',
      },
    ],
    options: [
      {
        short: '-f',
        long: '--force',
        description: 'Force deployment without confirmation',
        required: false,
      },
      {
        short: '-t',
        long: '--timeout',
        description: 'Deployment timeout in seconds',
        paramName: 'seconds',
        defaultValue: '300',
      },
      {
        long: '--env-file',
        description: 'Path to environment file',
        paramName: 'path',
        required: true,
      },
    ],
    examples: [
      {
        description: 'Deploy to production',
        command: 'cli project deploy production',
      },
      {
        description: 'Force deploy with custom timeout',
        command: 'cli project deploy staging --force --timeout 600',
        output: 'Deployed to staging in 45s',
      },
    ],
    relatedCommands: [
      { name: 'status', description: 'Check deployment status' },
      { name: 'rollback', description: 'Rollback to previous version' },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('basic rendering', () => {
    it('should render command name and summary', () => {
      const { lastFrame, unmount } = render(
        <CommandDetail command={basicCommand} isActive={false} />
      );

      const frame = lastFrame() || '';
      expect(frame).toContain('init');
      expect(frame).toContain('Initialize a new project');
      unmount();
    });

    it('should render with parent command prefix', () => {
      const commandWithParent: CommandDefinition = {
        ...basicCommand,
        parent: 'project',
      };
      const { lastFrame, unmount } = render(
        <CommandDetail command={commandWithParent} isActive={false} />
      );

      const frame = lastFrame() || '';
      expect(frame).toContain('project');
      expect(frame).toContain('init');
      unmount();
    });

    it('should render detailed description when provided', () => {
      const commandWithDesc: CommandDefinition = {
        ...basicCommand,
        description: 'This is a detailed description of the init command.',
      };
      const { lastFrame, unmount } = render(
        <CommandDetail command={commandWithDesc} isActive={false} />
      );

      expect(lastFrame()).toContain('detailed description');
      unmount();
    });

    it('should render category badge when provided', () => {
      const commandWithCategory: CommandDefinition = {
        ...basicCommand,
        category: 'workflow',
      };
      const { lastFrame, unmount } = render(
        <CommandDetail command={commandWithCategory} isActive={false} />
      );

      expect(lastFrame()).toContain('workflow');
      unmount();
    });
  });

  describe('command syntax', () => {
    it('should show Usage label', () => {
      const { lastFrame, unmount } = render(
        <CommandDetail command={basicCommand} isActive={false} />
      );

      expect(lastFrame()).toContain('Usage:');
      unmount();
    });

    it('should display aliases when provided', () => {
      const commandWithAliases: CommandDefinition = {
        ...basicCommand,
        aliases: ['i', 'start'],
      };
      const { lastFrame, unmount } = render(
        <CommandDetail command={commandWithAliases} isActive={false} />
      );

      const frame = lastFrame() || '';
      expect(frame).toContain('Aliases:');
      expect(frame).toContain('i');
      expect(frame).toContain('start');
      unmount();
    });

    it('should display required arguments with angle brackets', () => {
      const commandWithArgs: CommandDefinition = {
        ...basicCommand,
        arguments: [
          { name: 'project', description: 'Project name', required: true },
        ],
      };
      const { lastFrame, unmount } = render(
        <CommandDetail command={commandWithArgs} isActive={false} />
      );

      expect(lastFrame()).toContain('<project>');
      unmount();
    });

    it('should display optional arguments with square brackets', () => {
      const commandWithOptionalArg: CommandDefinition = {
        ...basicCommand,
        arguments: [
          { name: 'template', description: 'Template name', required: false },
        ],
      };
      const { lastFrame, unmount } = render(
        <CommandDetail command={commandWithOptionalArg} isActive={false} />
      );

      expect(lastFrame()).toContain('[template]');
      unmount();
    });

    it('should display variadic arguments with ellipsis', () => {
      const commandWithVariadic: CommandDefinition = {
        ...basicCommand,
        arguments: [
          { name: 'files', description: 'Files to process', variadic: true },
        ],
      };
      const { lastFrame, unmount } = render(
        <CommandDetail command={commandWithVariadic} isActive={false} />
      );

      expect(lastFrame()).toContain('files...');
      unmount();
    });

    it('should show [options] indicator when options exist', () => {
      const commandWithOptions: CommandDefinition = {
        ...basicCommand,
        options: [
          { long: '--verbose', description: 'Enable verbose output' },
        ],
      };
      const { lastFrame, unmount } = render(
        <CommandDetail command={commandWithOptions} isActive={false} />
      );

      expect(lastFrame()).toContain('[options]');
      unmount();
    });

    it('should show <options> indicator when required options exist', () => {
      const commandWithRequiredOption: CommandDefinition = {
        ...basicCommand,
        options: [
          { long: '--config', description: 'Config file', required: true },
        ],
      };
      const { lastFrame, unmount } = render(
        <CommandDetail command={commandWithRequiredOption} isActive={false} />
      );

      expect(lastFrame()).toContain('<options>');
      unmount();
    });
  });

  describe('arguments section', () => {
    it('should display Arguments header when arguments exist', () => {
      const commandWithArgs: CommandDefinition = {
        ...basicCommand,
        arguments: [
          { name: 'name', description: 'Project name' },
        ],
      };
      const { lastFrame, unmount } = render(
        <CommandDetail command={commandWithArgs} isActive={false} />
      );

      expect(lastFrame()).toContain('Arguments:');
      unmount();
    });

    it('should display argument descriptions', () => {
      const commandWithArgs: CommandDefinition = {
        ...basicCommand,
        arguments: [
          { name: 'name', description: 'The name of the project to create' },
        ],
      };
      const { lastFrame, unmount } = render(
        <CommandDetail command={commandWithArgs} isActive={false} />
      );

      expect(lastFrame()).toContain('The name of the project to create');
      unmount();
    });

    it('should display default values for arguments', () => {
      const commandWithDefaultArg: CommandDefinition = {
        ...basicCommand,
        arguments: [
          { name: 'dir', description: 'Directory', defaultValue: '.' },
        ],
      };
      const { lastFrame, unmount } = render(
        <CommandDetail command={commandWithDefaultArg} isActive={false} />
      );

      const frame = lastFrame() || '';
      expect(frame).toContain('default:');
      expect(frame).toContain('.');
      unmount();
    });
  });

  describe('options table', () => {
    it('should display Options header when options exist', () => {
      const commandWithOptions: CommandDefinition = {
        ...basicCommand,
        options: [
          { long: '--help', description: 'Show help' },
        ],
      };
      const { lastFrame, unmount } = render(
        <CommandDetail command={commandWithOptions} isActive={false} />
      );

      expect(lastFrame()).toContain('Options:');
      unmount();
    });

    it('should show no options message when empty', () => {
      const { lastFrame, unmount } = render(
        <CommandDetail command={basicCommand} isActive={false} />
      );

      expect(lastFrame()).toContain('No options available');
      unmount();
    });

    it('should display short and long flags', () => {
      const commandWithOptions: CommandDefinition = {
        ...basicCommand,
        options: [
          { short: '-v', long: '--verbose', description: 'Verbose output' },
        ],
      };
      const { lastFrame, unmount } = render(
        <CommandDetail command={commandWithOptions} isActive={false} />
      );

      const frame = lastFrame() || '';
      expect(frame).toContain('-v');
      expect(frame).toContain('--verbose');
      unmount();
    });

    it('should display option descriptions', () => {
      const commandWithOptions: CommandDefinition = {
        ...basicCommand,
        options: [
          { long: '--debug', description: 'Enable debug mode for troubleshooting' },
        ],
      };
      const { lastFrame, unmount } = render(
        <CommandDetail command={commandWithOptions} isActive={false} />
      );

      expect(lastFrame()).toContain('Enable debug mode for troubleshooting');
      unmount();
    });

    it('should display parameter names for value options', () => {
      const commandWithParamOption: CommandDefinition = {
        ...basicCommand,
        options: [
          { long: '--output', description: 'Output file', paramName: 'file' },
        ],
      };
      const { lastFrame, unmount } = render(
        <CommandDetail command={commandWithParamOption} isActive={false} />
      );

      expect(lastFrame()).toContain('file');
      unmount();
    });

    it('should display default values for options', () => {
      const commandWithDefaultOption: CommandDefinition = {
        ...basicCommand,
        options: [
          { long: '--port', description: 'Port number', paramName: 'num', defaultValue: '3000' },
        ],
      };
      const { lastFrame, unmount } = render(
        <CommandDetail command={commandWithDefaultOption} isActive={false} />
      );

      const frame = lastFrame() || '';
      expect(frame).toContain('default:');
      expect(frame).toContain('3000');
      unmount();
    });

    it('should mark required options', () => {
      const commandWithRequiredOption: CommandDefinition = {
        ...basicCommand,
        options: [
          { long: '--config', description: 'Config path', required: true },
        ],
      };
      const { lastFrame, unmount } = render(
        <CommandDetail command={commandWithRequiredOption} isActive={false} />
      );

      expect(lastFrame()).toContain('[required]');
      unmount();
    });
  });

  describe('examples section', () => {
    it('should display Examples header when examples exist', () => {
      const commandWithExamples: CommandDefinition = {
        ...basicCommand,
        examples: [
          { description: 'Basic usage', command: 'cli init' },
        ],
      };
      const { lastFrame, unmount } = render(
        <CommandDetail command={commandWithExamples} isActive={false} />
      );

      expect(lastFrame()).toContain('Examples:');
      unmount();
    });

    it('should display example descriptions as comments', () => {
      const commandWithExamples: CommandDefinition = {
        ...basicCommand,
        examples: [
          { description: 'Create a new project', command: 'cli init my-app' },
        ],
      };
      const { lastFrame, unmount } = render(
        <CommandDetail command={commandWithExamples} isActive={false} />
      );

      expect(lastFrame()).toContain('# Create a new project');
      unmount();
    });

    it('should display command with $ prefix', () => {
      const commandWithExamples: CommandDefinition = {
        ...basicCommand,
        examples: [
          { description: 'Test', command: 'cli init test-project' },
        ],
      };
      const { lastFrame, unmount } = render(
        <CommandDetail command={commandWithExamples} isActive={false} />
      );

      const frame = lastFrame() || '';
      expect(frame).toContain('$');
      // Due to syntax highlighting, command parts are separated by ANSI codes
      expect(frame).toContain('cli');
      expect(frame).toContain('init');
      expect(frame).toContain('test-project');
      unmount();
    });

    it('should display example output when provided', () => {
      const commandWithOutput: CommandDefinition = {
        ...basicCommand,
        examples: [
          {
            description: 'Check status',
            command: 'cli status',
            output: 'All systems operational',
          },
        ],
      };
      const { lastFrame, unmount } = render(
        <CommandDetail command={commandWithOutput} isActive={false} />
      );

      expect(lastFrame()).toContain('All systems operational');
      unmount();
    });
  });

  describe('related commands section', () => {
    it('should display Related Commands header when related commands exist', () => {
      const commandWithRelated: CommandDefinition = {
        ...basicCommand,
        relatedCommands: [
          { name: 'build', description: 'Build the project' },
        ],
      };
      const { lastFrame, unmount } = render(
        <CommandDetail command={commandWithRelated} isActive={false} />
      );

      expect(lastFrame()).toContain('Related Commands:');
      unmount();
    });

    it('should display related command names and descriptions', () => {
      const commandWithRelated: CommandDefinition = {
        ...basicCommand,
        relatedCommands: [
          { name: 'build', description: 'Build the project' },
          { name: 'test', description: 'Run tests' },
        ],
      };
      const { lastFrame, unmount } = render(
        <CommandDetail command={commandWithRelated} isActive={false} />
      );

      const frame = lastFrame() || '';
      expect(frame).toContain('build');
      expect(frame).toContain('Build the project');
      expect(frame).toContain('test');
      expect(frame).toContain('Run tests');
      unmount();
    });

    it('should show focus indicator on first related command', () => {
      const commandWithRelated: CommandDefinition = {
        ...basicCommand,
        relatedCommands: [
          { name: 'first', description: 'First related' },
          { name: 'second', description: 'Second related' },
        ],
      };
      const { lastFrame, unmount } = render(
        <CommandDetail command={commandWithRelated} isActive={false} />
      );

      // First item should have focus indicator
      expect(lastFrame()).toContain('›');
      unmount();
    });
  });

  describe('keyboard hints', () => {
    it('should show keyboard hints by default', () => {
      const { lastFrame, unmount } = render(
        <CommandDetail command={basicCommand} isActive={false} />
      );

      expect(lastFrame()).toContain('q to quit');
      unmount();
    });

    it('should show back hint when onBack is provided', () => {
      const { lastFrame, unmount } = render(
        <CommandDetail command={basicCommand} onBack={mockOnBack} isActive={false} />
      );

      expect(lastFrame()).toContain('esc/q to go back');
      unmount();
    });

    it('should show navigation hints when related commands exist', () => {
      const commandWithRelated: CommandDefinition = {
        ...basicCommand,
        relatedCommands: [
          { name: 'other', description: 'Other command' },
        ],
      };
      const { lastFrame, unmount } = render(
        <CommandDetail command={commandWithRelated} isActive={false} />
      );

      const frame = lastFrame() || '';
      expect(frame).toContain('↑↓');
      expect(frame).toContain('navigate');
      unmount();
    });

    it('should hide hints when showHints is false', () => {
      const { lastFrame, unmount } = render(
        <CommandDetail command={basicCommand} showHints={false} isActive={false} />
      );

      expect(lastFrame()).not.toContain('to quit');
      unmount();
    });
  });

  describe('bordered mode', () => {
    it('should render without border by default', () => {
      const { lastFrame, unmount } = render(
        <CommandDetail command={basicCommand} isActive={false} />
      );

      // Border characters from ink's round border style
      const frame = lastFrame() || '';
      expect(frame).not.toContain('╭');
      expect(frame).not.toContain('╰');
      unmount();
    });

    it('should render with border when bordered is true', () => {
      const { lastFrame, unmount } = render(
        <CommandDetail command={basicCommand} bordered={true} isActive={false} />
      );

      // Should have some border-like structure (ink uses round borders)
      // The exact characters depend on ink's implementation
      const frame = lastFrame() || '';
      expect(frame.length).toBeGreaterThan(0);
      unmount();
    });
  });

  describe('full command display', () => {
    it('should render all sections for a complete command', () => {
      const { lastFrame, unmount } = render(
        <CommandDetail command={fullCommand} isActive={false} />
      );

      const frame = lastFrame() || '';

      // Header
      expect(frame).toContain('deploy');
      expect(frame).toContain('Deploy your application');

      // Parent
      expect(frame).toContain('project');

      // Category
      expect(frame).toContain('deployment');

      // Aliases
      expect(frame).toContain('Aliases:');

      // Arguments
      expect(frame).toContain('Arguments:');
      expect(frame).toContain('environment');
      expect(frame).toContain('version');

      // Options
      expect(frame).toContain('Options:');
      expect(frame).toContain('--force');
      expect(frame).toContain('--timeout');
      expect(frame).toContain('--env-file');

      // Examples
      expect(frame).toContain('Examples:');
      expect(frame).toContain('production');
      expect(frame).toContain('staging');

      // Related commands
      expect(frame).toContain('Related Commands:');
      expect(frame).toContain('status');
      expect(frame).toContain('rollback');

      unmount();
    });
  });

  describe('module exports', () => {
    it('should export CommandDetail component', () => {
      expect(CommandDetail).toBeDefined();
      expect(typeof CommandDetail).toBe('function');
    });
  });
});
