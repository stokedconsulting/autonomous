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
  projectSyncLabelsCommand,
  projectClearAssignmentsCommand,
  projectBackfillCommand,
} from './commands/project.js';
import { optimizeCommand } from './commands/optimize.js';
import { itemCommand, itemLogCommand } from './commands/item.js';
import { mergeToMainCommand, showStageDiffCommand } from './commands/merge.js';
import { reviewCommand, itemReviewCommand } from './commands/review.js';
import { clarifyCommand } from './commands/clarify.js';
import { personaCommand } from './commands/persona.js';
import { updateCommand } from './commands/update.js';
import { epicCommand } from './commands/epic.js';
import { readFileSync } from 'fs';
import { join } from 'path';

// Import package.json for version (single source of truth)
// Note: __dirname is available when compiled to CommonJS
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../../package.json'), 'utf-8')
);
const VERSION = packageJson.version;

const program = new Command();

program
  .name('autonomous')
  .description('Orchestrate multiple LLM instances to autonomously work on GitHub issues')
  .version(VERSION)
  .showHelpAfterError()
  .configureHelp({
    sortSubcommands: true,
  });

// Start command (explicit)
program
  .command('start')
  .description('Start autonomous mode and begin processing issues')
  .option('-d, --dry-run', 'Simulate without actually starting LLMs')
  .option('-v, --verbose', 'Enable verbose logging')
  .option('--epic <name>', 'Only process items from specified epic (phased execution)')
  .option('-mm, --merge-main', 'Auto-merge to main after review (with --epic)')
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
  .option('-v, --verbose', 'Show detailed information')
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
  .option('--no-project', 'Disable project integration (enabled by default if project exists)')
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
  .option('--skip-main-conflict-check', 'Skip checking for conflicts with remote main before pushing')
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

project
  .command('sync-labels')
  .description('Backfill all project fields (Complexity, Impact, Work Type, Area, Effort)')
  .option('-v, --verbose', 'Show detailed sync progress')
  .action(projectSyncLabelsCommand);

project
  .command('clear-assignments')
  .description('Clear all stale "Assigned Instance" values from Todo/Ready/Evaluated items')
  .action(projectClearAssignmentsCommand);

project
  .command('backfill')
  .description('Backfill project fields (Complexity, Impact, Work Type, Area, Effort) for items')
  .option('--status <status>', 'Status to backfill (e.g., "In Review", "Ready")')
  .option('--all', 'Backfill ALL items in the project (ignores --status)')
  .option('-v, --verbose', 'Show detailed backfill progress')
  .action(projectBackfillCommand);

// Optimize command
program
  .command('optimize <feature> [goal]')
  .description('Generate optimization plan and add to GitHub project')
  .option('--project <number>', 'GitHub project number (default: 1)', '1')
  .option('--dry-run', 'Preview optimization plan without creating issues')
  .action(optimizeCommand);

// Epic command
program
  .command('epic <subcommand> [args...]')
  .description('Manage epic workflows and phased projects')
  .option('--name <name>', 'Epic name (required for create subcommand)')
  .option('--design-file <path>', 'Path to design output file')
  .action((subcommand, args, options) => epicCommand(subcommand, args, options));

// Item command
const item = program
  .command('item')
  .description('Manage GitHub issue items');

item
  .command('log <issue-number>')
  .description('Show realtime logs for an issue')
  .option('-v, --verbose', 'Enable verbose output')
  .action(itemLogCommand);

item
  .command('review <issue-number>')
  .description('Review a specific issue with multi-persona evaluation')
  .option('--pass <status>', 'Status to set if review passes (e.g., "Dev Complete")')
  .option('--fail <status>', 'Status to set if review fails (e.g., "Failed Review")')
  .option('--branch <branch>', 'Branch to review (default: assignment branch)')
  .option('--persona <name>', 'Persona to run (architect, product-manager, senior-engineer, qa-engineer, security-engineer, all). Can be specified multiple times. Default: architect', (value: string, previous: string[]) => previous ? [...previous, value] : [value])
  .option('-v, --verbose', 'Enable verbose output')
  .action(itemReviewCommand);

item
  .command('label <issue-number> <label-name>')
  .description('Toggle a label on a GitHub issue (e.g., BLOCK_ALL)')
  .option('-v, --verbose', 'Enable verbose output')
  .action(itemCommand);

// Merge commands
program
  .command('merge-to-main')
  .description('Merge stage branch to main (manual approval step)')
  .option('--dry-run', 'Show what would be merged without actually merging')
  .option('-v, --verbose', 'Enable verbose output')
  .action(mergeToMainCommand);

program
  .command('stage-diff')
  .description('Show diff between stage and main branches')
  .option('-v, --verbose', 'Show full diff')
  .action(showStageDiffCommand);

// Review command
program
  .command('review')
  .description('Review assignments by status with multi-persona evaluation')
  .option('--status <status>', 'Status to filter by (default: "In Review")')
  .option('--pass <status>', 'Status to set if review passes (e.g., "Dev Complete")')
  .option('--fail <status>', 'Status to set if review fails (e.g., "Failed Review")')
  .option('--branch <branch>', 'Branch to review (default: assignment branch)')
  .option('--persona <name>', 'Persona to run (architect, product-manager, senior-engineer, qa-engineer, security-engineer, all). Can be specified multiple times. Default: architect', (value: string, previous: string[]) => previous ? [...previous, value] : [value])
  .option('--max-concurrent <number>', 'Max concurrent reviews (default: 3)', parseInt)
  .option('-v, --verbose', 'Enable verbose output')
  .action(reviewCommand);

// Clarify command
program
  .command('clarify')
  .description('Attempt to answer clarification questions for "Needs More Info" issues')
  .option('-v, --verbose', 'Enable verbose output')
  .action(clarifyCommand);

// Update command
program
  .command('update')
  .description('Run migrations to update autonomous system to latest version')
  .option('-v, --verbose', 'Show detailed migration output')
  .action(updateCommand);

// Persona command
program.addCommand(personaCommand);

// Handle unknown commands
program.on('command:*', () => {
  console.error(`\nError: Unknown command '${program.args.join(' ')}'`);
  console.error(`Run 'autonomous --help' to see available commands\n`);
  process.exit(1);
});

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
  process.exit(0);
}

// Parse arguments
program.parse();
