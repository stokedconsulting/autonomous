#!/usr/bin/env node
import projectsApiPkg from '../dist/github/projects-api.js';
const { ProjectsAPI } = projectsApiPkg;
import { Octokit } from '@octokit/rest';

const issueNumber = parseInt(process.argv[2]);
if (!issueNumber) {
  console.error('Usage: node clear-assignment-field.mjs <issue-number>');
  process.exit(1);
}

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN || process.env.GH_TOKEN });
const projectsAPI = new ProjectsAPI(octokit, 'stokedconsulting', 'v3', true);
await projectsAPI.initialize(5);

console.log(`Looking for issue #${issueNumber}...`);
const result = await projectsAPI.queryItems({ limit: 200 });
const item = result.items.find(item => item.content.number === issueNumber);

if (item) {
  console.log(`Found: ${item.content.title}`);
  console.log('Clearing Assigned Instance field...');
  await projectsAPI.updateItemTextField(item.id, 'Assigned Instance', null);
  console.log('✓ Cleared Assigned Instance field from GitHub Project');
} else {
  console.log(`Issue #${issueNumber} not found in project`);
}
