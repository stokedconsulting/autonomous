#!/usr/bin/env node

/**
 * Autonomous CLI - Main entry point
 */

import { Command } from 'commander';
import { startCommand } from './commands/start.js';
import { stopCommand } from './commands/stop.js';
import { statusCommand } from './commands/status.js';
import { configCommand } from './commands/config.js';
import { pushCommand } from './commands/push.js';
import { assignCommand } from './commands/assign.js';
import { unassignCommand } from './commands/unassign.js';
import { setupCommand } from './commands/setup.js';
import { evaluateCommand } from './commands/evaluate.js';
import {
  projectInitCommand,
  projectStatusCommand,
  projectListReadyCommand,
} from './commands/project.js';

const program = new Command();

program
  .name('autonomous')
  .description('Orchestrate multiple LLM instances to autonomously work on GitHub issues')
  .version('0.1.0')
  .option('-d, --dry-run', 'Simulate without actually starting LLMs')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(startCommand); // Default action when no command is specified

// Start command (explicit)
program
  .command('start')
  .description('Start autonomous mode and begin processing issues')
  .option('-d, --dry-run', 'Simulate without actually starting LLMs')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(startCommand);

// Stop command
program
  .command('stop')
  .description('Stop all running LLM instances')
  .option('-f, --force', 'Force stop all instances')
  .action(stopCommand);

// Status command
program
  .command('status')
  .description('View current assignments and their status')
  .option('-j, --json', 'Output as JSON')
  .option('-w, --watch', 'Watch mode - continuously update status')
  .action(statusCommand);

// Config command
const config = program
  .command('config')
  .description('Manage configuration');

config
  .command('init')
  .description('Initialize configuration in the current project')
  .option('--github-owner <owner>', 'GitHub repository owner')
  .option('--github-repo <repo>', 'GitHub repository name')
  .option('--interactive', 'Interactive configuration setup')
  .action(configCommand.init);

config
  .command('add-llm <provider>')
  .description('Add and configure an LLM provider (claude, gemini, codex)')
  .option('--cli-path <path>', 'Path to LLM CLI executable')
  .option('--cli-args <args>', 'Additional CLI arguments (e.g., "--debug hooks")')
  .option('--api-key <key>', 'API key for the LLM')
  .option('--max-concurrent <number>', 'Maximum concurrent issues', parseInt)
  .option('--enable-hooks', 'Enable hooks support')
  .action(configCommand.addLLM);

config
  .command('show')
  .description('Show current configuration')
  .option('-j, --json', 'Output as JSON')
  .action(configCommand.show);

config
  .command('validate')
  .description('Validate current configuration')
  .action(configCommand.validate);

// Push command
program
  .command('push')
  .description('Auto-generate changeset, commit, and push changes')
  .option('--pr', 'Create or update pull request')
  .action(pushCommand);

// Assign command
program
  .command('assign <issue-number>')
  .description('Manually assign a specific issue to autonomous processing')
  .option('--skip-eval', 'Skip issue evaluation step')
  .option('-v, --verbose', 'Enable verbose output')
  .action(assignCommand);

// Unassign command
program
  .command('unassign <issue-number>')
  .description('Stop work on a specific issue and clean up')
  .option('--cleanup', 'Automatically delete worktree without prompting')
  .option('-f, --force', 'Skip all confirmation prompts')
  .action(unassignCommand);

// Setup command
program
  .command('setup')
  .description('Check and install dependencies for autonomous commands')
  .option('--install-all', 'Install all optional dependencies without prompting')
  .option('--skip-prompts', 'Skip all prompts')
  .action(setupCommand);

// Evaluate command
program
  .command('evaluate')
  .description('Evaluate issues and cache results (without starting autonomous mode)')
  .option('-f, --force', 'Re-evaluate all issues, ignoring cache')
  .option('-v, --verbose', 'Show detailed evaluation results')
  .option('-i, --issues <numbers>', 'Comma-separated issue numbers to evaluate (e.g., "1,2,3")')
  .action(evaluateCommand);

// Project command
const project = program
  .command('project')
  .description('Manage GitHub Projects v2 integration');

project
  .command('init')
  .description('Initialize GitHub Projects integration')
  .option('--project-number <number>', 'GitHub Projects v2 number', parseInt)
  .option('--project-id <id>', 'GitHub Projects v2 ID (alternative to number)')
  .option('--org', 'Organization project (default: true)')
  .action(projectInitCommand);

project
  .command('status')
  .description('Show project status and ready items')
  .option('-j, --json', 'Output as JSON')
  .option('-v, --verbose', 'Show detailed information')
  .action(projectStatusCommand);

project
  .command('list-ready')
  .description('List ready items with hybrid prioritization')
  .option('-l, --limit <number>', 'Limit number of items to show', parseInt)
  .option('-j, --json', 'Output as JSON')
  .option('-v, --verbose', 'Show detailed prioritization breakdown')
  .action(projectListReadyCommand);

// Parse arguments
program.parse();
