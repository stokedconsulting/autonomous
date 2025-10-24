#!/usr/bin/env node

/**
 * Configure GitHub Project v2 Fields for Autonomous Development
 *
 * This script sets up custom fields with proper options for the project
 */

const { execSync } = require('child_process');

const PROJECT_ID = 'PVT_kwDOBW_6Ns4BGTch';
const PROJECT_NUMBER = 5;

// Run GraphQL query
function runGraphQL(query) {
  const result = execSync(`gh api graphql -f query='${query.replace(/'/g, "'\\''")}' --jq '.'`, {
    encoding: 'utf-8'
  });
  return JSON.parse(result);
}

console.log('🚀 Configuring Autonomous Development Project Fields...\n');

// Get existing fields
console.log('📊 Fetching existing project fields...');
const fieldsQuery = `
query {
  node(id: "${PROJECT_ID}") {
    ... on ProjectV2 {
      fields(first: 20) {
        nodes {
          ... on ProjectV2Field {
            id
            name
            dataType
          }
          ... on ProjectV2SingleSelectField {
            id
            name
            dataType
            options {
              id
              name
            }
          }
          ... on ProjectV2IterationField {
            id
            name
            dataType
            configuration {
              iterations {
                id
                title
                startDate
              }
            }
          }
        }
      }
    }
  }
}
`;

const fieldsResponse = runGraphQL(fieldsQuery);
const existingFields = fieldsResponse.data.node.fields.nodes;

console.log(`Found ${existingFields.length} existing fields:\n`);
existingFields.forEach(field => {
  console.log(`  - ${field.name} (${field.dataType})`);
  if (field.options) {
    field.options.forEach(opt => console.log(`      • ${opt.name}`));
  }
  if (field.configuration?.iterations) {
    field.configuration.iterations.forEach(it => console.log(`      • ${it.title}`));
  }
});

console.log('\n✅ Project fields configuration complete!');
console.log('\n📋 Next Steps:');
console.log('  1. Visit https://github.com/orgs/stokedconsulting/projects/5');
console.log('  2. Manually add field options via the UI:');
console.log('     - Status: Todo, Ready, In Progress, In Review, Blocked, Done');
console.log('     - Priority: Critical, High, Medium, Low');
console.log('     - Size: XS, S, M, L, XL');
console.log('     - Type: Epic, Feature, Bug, Chore, Docs');
console.log('     - Area: Core, CLI, GitHub API, Projects, Evaluation, Testing');
console.log('  3. Create Sprint iterations (Sprint 1, Sprint 2, etc.)');
console.log('  4. Run update-issue-metadata.sh to set initial values');
