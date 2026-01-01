#!/usr/bin/env node

/**
 * Reset Project - Clear all assignments and set issues to Ready
 */

import { ConfigManager } from '../dist/core/config-manager.js';
import { GitHubProjectsAPI } from '../dist/github/projects-api.js';
import { getGitHubToken } from '../dist/utils/github-token.js';
import { graphql } from '@octokit/graphql';
import { promises as fs } from 'fs';
import { join } from 'path';
import chalk from 'chalk';

async function resetProject() {
  try {
    console.log(chalk.blue('\n🔄 Resetting Project...\n'));

    // Load configuration
    const configManager = new ConfigManager(process.cwd());
    await configManager.initialize();
    const config = configManager.getConfig();

    if (!config.project?.enabled) {
      throw new Error('Project integration not enabled');
    }

    // Get GitHub token
    const githubToken = await getGitHubToken(config.github.token);

    // Query for organization project
    console.log(chalk.blue('🔍 Finding organization project...'));
    const projectNumber = config.project.projectNumber;
    const orgName = config.github.owner;

    const gql = graphql.defaults({
      headers: {
        authorization: `token ${githubToken}`,
      },
    });

    const projectQuery = `
      query($org: String!, $number: Int!) {
        organization(login: $org) {
          projectV2(number: $number) {
            id
            title
            number
          }
        }
      }
    `;

    const { organization } = await gql(projectQuery, {
      org: orgName,
      number: projectNumber,
    });

    if (!organization?.projectV2) {
      throw new Error(`Could not find project #${projectNumber} in organization ${orgName}`);
    }

    const project = organization.projectV2;
    const projectId = project.id;

    console.log(chalk.green(`   ✓ Found project: ${project.title} (#${project.number})`));
    console.log(chalk.gray(`   Project ID: ${projectId}\n`));

    // Initialize Projects API
    const projectsAPI = new GitHubProjectsAPI(projectId, config.project);

    // Get all items
    console.log(chalk.blue(`📋 Getting all items from project #${project.number}...`));
    const allItems = await projectsAPI.getAllItems();
    console.log(chalk.gray(`   Found ${allItems.length} items\n`));

    // Set all items to Ready status
    console.log(chalk.blue('✨ Setting all items to Ready status...'));
    const readyStatus = config.project.fields.status.readyValues?.[0] || 'Ready';
    let updatedCount = 0;

    for (const item of allItems) {
      try {
        const currentStatus = item.fieldValues?.['Status'] || '';

        // Set to Ready
        await projectsAPI.updateItemStatusByValue(item.id, readyStatus);
        console.log(chalk.green(`   ✓ #${item.content.number}: ${currentStatus} → ${readyStatus}`));
        updatedCount++;

        // Clear assigned instance if it exists
        const assignedInstance = item.fieldValues?.['Assigned Instance'];
        if (assignedInstance) {
          await projectsAPI.updateAssignedInstance(item.id, null);
          console.log(chalk.gray(`      Cleared assigned instance: ${assignedInstance}`));
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(chalk.red(`   ✗ Failed to update #${item.content.number}:`), error.message);
      }
    }

    console.log(chalk.green(`\n✓ Updated ${updatedCount}/${allItems.length} items to Ready status\n`));

    // Remove local assignments.json file
    console.log(chalk.blue('🗑️  Removing local assignments file...'));
    const assignmentsFile = join(process.cwd(), '.autonomous', 'assignments.json');
    try {
      await fs.unlink(assignmentsFile);
      console.log(chalk.green('   ✓ Removed assignments.json\n'));
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log(chalk.gray('   ℹ No assignments.json file found\n'));
      } else {
        console.error(chalk.yellow(`   ⚠ Failed to remove assignments.json: ${error.message}\n`));
      }
    }

    // Check for project worktree
    console.log(chalk.blue('📁 Checking for project worktree...'));
    const worktreePath = join('..', `${config.github.repo}-project-${project.number}`);
    try {
      await fs.access(worktreePath);
      console.log(chalk.yellow(`   ⚠ Project worktree exists at: ${worktreePath}`));
      console.log(chalk.gray(`   Run this to remove it manually:`));
      console.log(chalk.gray(`   git worktree remove ${worktreePath}\n`));
    } catch {
      console.log(chalk.gray('   ℹ No project worktree found\n'));
    }

    console.log(chalk.green(`✅ Project #${project.number} reset complete!\n`));
    console.log(chalk.blue('Next steps:'));
    console.log(chalk.gray('   1. Go to Project Browser (auto ui)'));
    console.log(chalk.gray(`   2. Press A to assign project #${project.number}`));
    console.log(chalk.gray('   3. Start the orchestrator\n'));

  } catch (error) {
    console.error(chalk.red('\n❌ Failed to reset project:'), error.message);
    if (error.stack) {
      console.error(chalk.gray(error.stack));
    }
    process.exit(1);
  }
}

resetProject();
