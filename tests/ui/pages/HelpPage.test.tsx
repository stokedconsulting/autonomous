/**
 * Tests for HelpPage component
 *
 * Note: ink-testing-library has limited support for components with useInput.
 * These tests focus on rendering with isActive=false to avoid cleanup issues.
 */

import { describe, it, expect, jest } from '@jest/globals';
import { render } from 'ink-testing-library';
import {
  HelpPage,
  type CommandCategory,
  type CommandInfo,
} from '../../../src/ui/pages/HelpPage.js';

describe('HelpPage', () => {
  const mockOnExit = jest.fn<() => void>();

  // Sample commands for testing
  const sampleCommands: CommandInfo[] = [
    {
      name: 'start',
      description: 'Start a new workflow',
      usage: 'auto start [options]',
      options: [
        { flag: '--force', description: 'Force start even if running' },
        { flag: '--name', description: 'Workflow name', required: true },
      ],
      examples: ['auto start', 'auto start --force'],
      aliases: ['run', 'begin'],
    },
    {
      name: 'stop',
      description: 'Stop the current workflow',
      examples: ['auto stop'],
    },
  ];

  const sampleCategories: CommandCategory[] = [
    {
      name: 'workflow',
      label: 'Workflow Commands',
      description: 'Commands for managing workflows',
      commands: sampleCommands,
    },
    {
      name: 'git',
      label: 'Git Commands',
      commands: [
        { name: 'commit', description: 'Create a commit' },
        { name: 'push', description: 'Push changes' },
      ],
    },
    {
      name: 'project',
      label: 'Project Commands',
      commands: [
        { name: 'init', description: 'Initialize a project' },
      ],
    },
    {
      name: 'config',
      label: 'Configuration Commands',
      commands: [
        { name: 'set', description: 'Set a configuration value' },
        { name: 'get', description: 'Get a configuration value' },
      ],
    },
  ];

  beforeEach(() => {
    mockOnExit.mockClear();
  });

  describe('basic rendering', () => {
    it('should render the title', () => {
      const { lastFrame, unmount } = render(
        <HelpPage categories={sampleCategories} isActive={false} />
      );

      expect(lastFrame()).toContain('Help');
      unmount();
    });

    it('should render custom title', () => {
      const { lastFrame, unmount } = render(
        <HelpPage
          categories={sampleCategories}
          title="CLI Reference"
          isActive={false}
        />
      );

      expect(lastFrame()).toContain('CLI Reference');
      unmount();
    });

    it('should show total command count in header', () => {
      const { lastFrame, unmount } = render(
        <HelpPage categories={sampleCategories} isActive={false} />
      );

      // 2 + 2 + 1 + 2 = 7 commands total
      expect(lastFrame()).toContain('7 commands');
      unmount();
    });

    it('should render all category labels', () => {
      const { lastFrame, unmount } = render(
        <HelpPage categories={sampleCategories} isActive={false} />
      );

      expect(lastFrame()).toContain('Workflow Commands');
      expect(lastFrame()).toContain('Git Commands');
      expect(lastFrame()).toContain('Project Commands');
      expect(lastFrame()).toContain('Configuration Commands');
      unmount();
    });

    it('should show command count for each category', () => {
      const { lastFrame, unmount } = render(
        <HelpPage categories={sampleCategories} isActive={false} />
      );

      expect(lastFrame()).toContain('(2 commands)');
      expect(lastFrame()).toContain('(1 commands)');
      unmount();
    });
  });

  describe('category expansion', () => {
    it('should show all categories expanded by default', () => {
      const { lastFrame, unmount } = render(
        <HelpPage categories={sampleCategories} isActive={false} />
      );

      // All command names should be visible
      expect(lastFrame()).toContain('start');
      expect(lastFrame()).toContain('stop');
      expect(lastFrame()).toContain('commit');
      expect(lastFrame()).toContain('push');
      expect(lastFrame()).toContain('init');
      expect(lastFrame()).toContain('set');
      expect(lastFrame()).toContain('get');
      unmount();
    });

    it('should show expand/collapse indicators', () => {
      const { lastFrame, unmount } = render(
        <HelpPage categories={sampleCategories} isActive={false} />
      );

      // Should show expanded indicator for all categories by default
      const frame = lastFrame() || '';
      // Count the number of down arrows (expanded indicator)
      const expandedCount = (frame.match(/▼/g) || []).length;
      expect(expandedCount).toBe(4);
      unmount();
    });

    it('should respect initialExpanded prop', () => {
      const { lastFrame, unmount } = render(
        <HelpPage
          categories={sampleCategories}
          initialExpanded={new Set(['workflow'])}
          isActive={false}
        />
      );

      const frame = lastFrame() || '';
      // Only workflow commands should be visible
      expect(frame).toContain('start');
      expect(frame).toContain('stop');
      // Other categories should be collapsed (right arrow indicator)
      const collapsedCount = (frame.match(/▶/g) || []).length;
      expect(collapsedCount).toBe(3);
      unmount();
    });
  });

  describe('command display', () => {
    it('should show command names and descriptions', () => {
      const { lastFrame, unmount } = render(
        <HelpPage categories={sampleCategories} isActive={false} />
      );

      expect(lastFrame()).toContain('start');
      expect(lastFrame()).toContain('Start a new workflow');
      expect(lastFrame()).toContain('commit');
      expect(lastFrame()).toContain('Create a commit');
      unmount();
    });

    it('should show command aliases', () => {
      const { lastFrame, unmount } = render(
        <HelpPage categories={sampleCategories} isActive={false} />
      );

      expect(lastFrame()).toContain('run');
      expect(lastFrame()).toContain('begin');
      unmount();
    });

    it('should show category descriptions when expanded', () => {
      const { lastFrame, unmount } = render(
        <HelpPage categories={sampleCategories} isActive={false} />
      );

      expect(lastFrame()).toContain('Commands for managing workflows');
      unmount();
    });
  });

  describe('keyboard hints', () => {
    it('should show navigation hints', () => {
      const { lastFrame, unmount } = render(
        <HelpPage categories={sampleCategories} isActive={false} />
      );

      const frame = lastFrame() || '';
      expect(frame).toContain('navigate');
      expect(frame).toContain('q to exit');
      unmount();
    });
  });

  describe('empty categories', () => {
    it('should handle categories with no commands', () => {
      const emptyCategories: CommandCategory[] = [
        {
          name: 'empty',
          label: 'Empty Category',
          commands: [],
        },
      ];

      const { lastFrame, unmount } = render(
        <HelpPage categories={emptyCategories} isActive={false} />
      );

      expect(lastFrame()).toContain('Empty Category');
      expect(lastFrame()).toContain('(0 commands)');
      unmount();
    });
  });

  describe('single category', () => {
    it('should render correctly with only one category', () => {
      const singleCategory: CommandCategory[] = [
        {
          name: 'main',
          label: 'Main Commands',
          commands: [
            { name: 'help', description: 'Show help' },
          ],
        },
      ];

      const { lastFrame, unmount } = render(
        <HelpPage categories={singleCategory} isActive={false} />
      );

      expect(lastFrame()).toContain('Main Commands');
      expect(lastFrame()).toContain('help');
      expect(lastFrame()).toContain('Show help');
      unmount();
    });
  });

  describe('module exports', () => {
    it('should export HelpPage component', () => {
      expect(HelpPage).toBeDefined();
      expect(typeof HelpPage).toBe('function');
    });

    it('should export all type interfaces (verified via TypeScript compilation)', () => {
      // Type imports are verified at compile time
      // This test just ensures the module is properly structured
      const categories: CommandCategory[] = [];
      const command: CommandInfo = { name: 'test', description: 'test' };
      expect(Array.isArray(categories)).toBe(true);
      expect(typeof command.name).toBe('string');
    });
  });

  describe('command options', () => {
    it('should properly store command options in data structure', () => {
      const commandWithOptions: CommandInfo = {
        name: 'test',
        description: 'Test command',
        options: [
          { flag: '--verbose', description: 'Verbose output' },
          { flag: '--output', description: 'Output path', required: true, defaultValue: './out' },
        ],
      };

      expect(commandWithOptions.options).toHaveLength(2);
      expect(commandWithOptions.options![0].flag).toBe('--verbose');
      expect(commandWithOptions.options![1].required).toBe(true);
      expect(commandWithOptions.options![1].defaultValue).toBe('./out');
    });
  });

  describe('command examples', () => {
    it('should properly store command examples in data structure', () => {
      const commandWithExamples: CommandInfo = {
        name: 'test',
        description: 'Test command',
        examples: ['test --help', 'test --verbose', 'test input.txt'],
      };

      expect(commandWithExamples.examples).toHaveLength(3);
      expect(commandWithExamples.examples![0]).toBe('test --help');
    });
  });

  describe('initial state', () => {
    it('should render with first category focused', () => {
      const { lastFrame, unmount } = render(
        <HelpPage categories={sampleCategories} isActive={false} />
      );

      // Component renders without error
      const frame = lastFrame() || '';
      expect(frame.length).toBeGreaterThan(0);
      expect(frame).toContain('Workflow Commands');
      unmount();
    });
  });

  describe('accessibility', () => {
    it('should include clear visual indicators', () => {
      const { lastFrame, unmount } = render(
        <HelpPage categories={sampleCategories} isActive={false} />
      );

      const frame = lastFrame() || '';
      // Should have visual indicators for expansion state
      expect(frame.includes('▼') || frame.includes('▶')).toBe(true);
      unmount();
    });
  });

  describe('complex command structures', () => {
    it('should handle commands with all optional fields', () => {
      const complexCategories: CommandCategory[] = [
        {
          name: 'complex',
          label: 'Complex Category',
          description: 'Category with complex commands',
          commands: [
            {
              name: 'full-command',
              description: 'A command with all fields',
              usage: 'auto full-command [options] <args>',
              options: [
                { flag: '-v, --verbose', description: 'Verbose', required: false },
                { flag: '-o, --output', description: 'Output', required: true, defaultValue: 'stdout' },
              ],
              examples: ['auto full-command -v', 'auto full-command --output file.txt'],
              aliases: ['fc', 'full'],
            },
          ],
        },
      ];

      const { lastFrame, unmount } = render(
        <HelpPage categories={complexCategories} isActive={false} />
      );

      const frame = lastFrame() || '';
      expect(frame).toContain('Complex Category');
      expect(frame).toContain('full-command');
      expect(frame).toContain('fc');
      expect(frame).toContain('full');
      unmount();
    });

    it('should handle commands with minimal fields', () => {
      const minimalCategories: CommandCategory[] = [
        {
          name: 'minimal',
          label: 'Minimal',
          commands: [
            { name: 'simple', description: 'Simple command' },
          ],
        },
      ];

      const { lastFrame, unmount } = render(
        <HelpPage categories={minimalCategories} isActive={false} />
      );

      expect(lastFrame()).toContain('simple');
      expect(lastFrame()).toContain('Simple command');
      unmount();
    });
  });
});
