#!/usr/bin/env node

/**
 * Autonomous CLI - Main entry point
 */

import { Command } from 'commander';
import { startCommand } from './commands/start.js';
import { stopCommand } from './commands/stop.js';
import { statusCommand } from './commands/status.js';
import { configCommand } from './commands/config.js';

const program = new Command();

program
  .name('autonomous')
  .description('Orchestrate multiple LLM instances to autonomously work on GitHub issues')
  .version('0.1.0');

// Start command
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

// Parse arguments
program.parse();
