#!/usr/bin/env node

/**
 * Backfill evaluation status to GitHub Project
 *
 * This script reads cached issue evaluations and updates the project status field
 * based on evaluation results:
 * - Issues with hasEnoughDetail: true → "Evaluated"
 * - Issues with hasEnoughDetail: false → "Needs More Info"
 *
 * Usage:
 *   node scripts/backfill-evaluation-status.mjs <project-path>
 *
 * Example:
 *   node scripts/backfill-evaluation-status.mjs /Users/stoked/work/v3
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { execSync } from 'child_process';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

if (!GITHUB_TOKEN) {
  console.error('Error: GITHUB_TOKEN or GH_TOKEN environment variable required');
  process.exit(1);
}

const projectPath = process.argv[2];
if (!projectPath) {
  console.error('Usage: node scripts/backfill-evaluation-status.mjs <project-path>');
  console.error('Example: node scripts/backfill-evaluation-status.mjs /Users/stoked/work/v3');
  process.exit(1);
}

console.log(`\n📊 Backfilling Evaluation Status\n`);
console.log(`Project: ${projectPath}\n`);

// Load config
const configPath = join(projectPath, '.autonomous-config.json');
let config;
try {
  const configData = await readFile(configPath, 'utf-8');
  config = JSON.parse(configData);
} catch (error) {
  console.error(`Error loading config from ${configPath}:`, error.message);
  process.exit(1);
}

if (!config.project?.enabled) {
  console.error('Error: Project integration is not enabled in config');
  process.exit(1);
}

// Load evaluation cache
const cachePath = join(projectPath, '.autonomous', 'issue-evaluations.json');
let cache;
try {
  const cacheData = await readFile(cachePath, 'utf-8');
  cache = JSON.parse(cacheData);
} catch (error) {
  console.error(`Error loading cache from ${cachePath}:`, error.message);
  process.exit(1);
}

const evaluations = Object.values(cache.evaluations);
console.log(`Found ${evaluations.length} cached evaluations\n`);

if (evaluations.length === 0) {
  console.log('No evaluations to backfill');
  process.exit(0);
}

// Get project ID
console.log('Looking up project ID...');
const projectIdQuery = `
  query {
    repository(owner: "${config.github.owner}", name: "${config.github.repo}") {
      projectsV2(first: 10) {
        nodes {
          id
          number
          title
        }
      }
    }
  }
`;

let projectId;
try {
  const result = JSON.parse(
    execSync(`gh api graphql -f query='${projectIdQuery}'`, {
      env: { ...process.env, GITHUB_TOKEN },
      encoding: 'utf-8',
    })
  );

  const project = result.data.repository.projectsV2.nodes.find(
    (p) => p.number === config.project.projectNumber
  );

  if (!project) {
    console.error(`Error: Project #${config.project.projectNumber} not found`);
    process.exit(1);
  }

  projectId = project.id;
  console.log(`✓ Found project: ${project.title} (${projectId})\n`);
} catch (error) {
  console.error('Error looking up project:', error.message);
  process.exit(1);
}

// Get all project items and build issue -> projectItemId map
console.log('Fetching project items...');
const itemsQuery = `
  query {
    node(id: "${projectId}") {
      ... on ProjectV2 {
        items(first: 100) {
          nodes {
            id
            content {
              ... on Issue {
                number
              }
            }
          }
        }
      }
    }
  }
`;

let issueToItemMap = new Map();
try {
  const result = JSON.parse(
    execSync(`gh api graphql -f query='${itemsQuery}'`, {
      env: { ...process.env, GITHUB_TOKEN },
      encoding: 'utf-8',
    })
  );

  result.data.node.items.nodes.forEach((node) => {
    if (node.content && node.content.number) {
      issueToItemMap.set(node.content.number, node.id);
    }
  });

  console.log(`✓ Found ${issueToItemMap.size} items in project\n`);
} catch (error) {
  console.error('Error fetching project items:', error.message);
  process.exit(1);
}

// Get Status field ID and option IDs
console.log('Looking up Status field...');
const statusFieldName = config.project.fields.status.fieldName;
const evaluatedValue = config.project.fields.status.evaluatedValue;
const needsMoreInfoValue = config.project.fields.status.needsMoreInfoValue;

const fieldsQuery = `
  query {
    node(id: "${projectId}") {
      ... on ProjectV2 {
        fields(first: 20) {
          nodes {
            ... on ProjectV2SingleSelectField {
              id
              name
              options {
                id
                name
              }
            }
          }
        }
      }
    }
  }
`;

let statusFieldId;
let evaluatedOptionId;
let needsMoreInfoOptionId;
try {
  const result = JSON.parse(
    execSync(`gh api graphql -f query='${fieldsQuery}'`, {
      env: { ...process.env, GITHUB_TOKEN },
      encoding: 'utf-8',
    })
  );

  const statusField = result.data.node.fields.nodes.find(
    (f) => f.name === statusFieldName
  );

  if (!statusField) {
    console.error(`Error: Status field "${statusFieldName}" not found`);
    process.exit(1);
  }

  statusFieldId = statusField.id;

  evaluatedOptionId = statusField.options.find((o) => o.name === evaluatedValue)?.id;
  needsMoreInfoOptionId = statusField.options.find((o) => o.name === needsMoreInfoValue)?.id;

  if (!evaluatedOptionId) {
    console.error(`Error: Status option "${evaluatedValue}" not found. Please add it to the Status field in your GitHub Project.`);
    process.exit(1);
  }

  if (!needsMoreInfoOptionId) {
    console.error(`Error: Status option "${needsMoreInfoValue}" not found. Please add it to the Status field in your GitHub Project.`);
    process.exit(1);
  }

  console.log(`✓ Found Status field with options\n`);
} catch (error) {
  console.error('Error looking up Status field:', error.message);
  process.exit(1);
}

// Update each evaluation
console.log('Updating project statuses...\n');
let updated = 0;
let skipped = 0;
let errors = 0;

for (const evaluation of evaluations) {
  const issueNumber = evaluation.issueNumber;
  const projectItemId = issueToItemMap.get(issueNumber);

  if (!projectItemId) {
    console.log(`⊘ #${issueNumber} - Not in project, skipping`);
    skipped++;
    continue;
  }

  const statusValue = evaluation.hasEnoughDetail ? evaluatedValue : needsMoreInfoValue;
  const optionId = evaluation.hasEnoughDetail ? evaluatedOptionId : needsMoreInfoOptionId;

  try {
    const mutation = `
      mutation {
        updateProjectV2ItemFieldValue(input: {
          projectId: "${projectId}"
          itemId: "${projectItemId}"
          fieldId: "${statusFieldId}"
          value: {
            singleSelectOptionId: "${optionId}"
          }
        }) {
          projectV2Item {
            id
          }
        }
      }
    `;

    execSync(`gh api graphql -f query='${mutation}'`, {
      env: { ...process.env, GITHUB_TOKEN },
      encoding: 'utf-8',
    });

    console.log(`✓ #${issueNumber} - ${statusValue}`);
    updated++;
  } catch (error) {
    console.error(`✗ #${issueNumber} - Error: ${error.message}`);
    errors++;
  }

  // Small delay to avoid rate limiting
  await new Promise((resolve) => setTimeout(resolve, 100));
}

console.log(`\n📊 Backfill Summary:`);
console.log(`  ✓ Updated: ${updated}`);
if (skipped > 0) {
  console.log(`  ⊘ Skipped: ${skipped}`);
}
if (errors > 0) {
  console.log(`  ✗ Errors: ${errors}`);
}

console.log('\n✓ Backfill complete!\n');
