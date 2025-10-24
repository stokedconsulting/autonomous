#!/usr/bin/env ts-node
/**
 * Migrate from custom "Work Type" field to built-in "Type" field
 *
 * Steps:
 * 1. Get all project items with their Work Type values
 * 2. Map Work Type values to Type values
 * 3. Update Type field for each item
 * 4. Verify migration
 * 5. (Manual) Delete Work Type field after verification
 */

import { execSync } from 'child_process';

const REPO_OWNER = 'stokedconsulting';
const REPO_NAME = 'des.irable.v3';

// Mapping from Work Type → Type
const TYPE_MAPPING: Record<string, string> = {
  '✨ Feature': 'Feature',
  '🐛 Bug': 'Bug',
  '🔧 Enhancement': 'Feature', // Map Enhancement to Feature (or we could add Enhancement option)
  '♻️ Refactor': 'Task',       // Map Refactor to Task (or we could add Refactor option)
  '📝 Docs': 'Task',            // Map Docs to Task (or we could add Docs option)
  '🧹 Chore': 'Task',           // Map Chore to Task (or we could add Chore option)
};

interface ProjectItem {
  id: string;
  number: number;
  title: string;
  workType: string | null;
  type: string | null;
}

async function main() {
  console.log('🔄 Migrating Work Type → Type\n');

  // Step 1: Get project ID
  console.log('1️⃣  Fetching project...');
  const projectQuery = `
    query {
      repository(owner: "${REPO_OWNER}", name: "${REPO_NAME}") {
        projectsV2(first: 1) {
          nodes {
            id
            number
            title
          }
        }
      }
    }
  `;

  const projectResult = JSON.parse(
    execSync(`gh api graphql -f query='${projectQuery}'`, { encoding: 'utf-8' })
  );

  const project = projectResult.data.repository.projectsV2.nodes[0];
  if (!project) {
    console.error('❌ No project found');
    process.exit(1);
  }

  console.log(`   ✓ Found: Project #${project.number} - ${project.title}`);
  console.log(`   Project ID: ${project.id}\n`);

  // Step 2: Get field IDs
  console.log('2️⃣  Fetching field IDs...');
  const fieldsQuery = `
    query {
      node(id: "${project.id}") {
        ... on ProjectV2 {
          fields(first: 50) {
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

  const fieldsResult = JSON.parse(
    execSync(`gh api graphql -f query='${fieldsQuery}'`, { encoding: 'utf-8' })
  );

  const fields = fieldsResult.data.node.fields.nodes;
  const workTypeField = fields.find((f: any) => f.name === 'Work Type');
  const typeField = fields.find((f: any) => f.name === 'Type');

  if (!workTypeField || !typeField) {
    console.error('❌ Could not find Work Type or Type fields');
    process.exit(1);
  }

  console.log(`   ✓ Work Type field ID: ${workTypeField.id}`);
  console.log(`   ✓ Type field ID: ${typeField.id}\n`);

  // Step 3: Get all items with Work Type set
  console.log('3️⃣  Fetching project items...');
  const itemsQuery = `
    query {
      node(id: "${project.id}") {
        ... on ProjectV2 {
          items(first: 100) {
            nodes {
              id
              content {
                ... on Issue {
                  number
                  title
                }
              }
              fieldValueByName(name: "Work Type") {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                }
              }
              typeValue: fieldValueByName(name: "Type") {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                }
              }
            }
          }
        }
      }
    }
  `;

  const itemsResult = JSON.parse(
    execSync(`gh api graphql -f query='${itemsQuery.replace(/\n/g, ' ')}'`, { encoding: 'utf-8' })
  );

  const items: ProjectItem[] = itemsResult.data.node.items.nodes
    .filter((item: any) => item.content)
    .map((item: any) => ({
      id: item.id,
      number: item.content.number,
      title: item.content.title,
      workType: item.fieldValueByName?.name || null,
      type: item.typeValue?.name || null,
    }));

  console.log(`   ✓ Found ${items.length} items\n`);

  // Step 4: Migrate items
  console.log('4️⃣  Migrating items...\n');

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const item of items) {
    if (!item.workType) {
      console.log(`   ⊘ #${item.number}: No Work Type set - skipping`);
      skipped++;
      continue;
    }

    const targetType = TYPE_MAPPING[item.workType];
    if (!targetType) {
      console.log(`   ⚠️  #${item.number}: Unknown Work Type "${item.workType}" - skipping`);
      skipped++;
      continue;
    }

    // Find the Type option ID
    const typeOption = typeField.options.find((opt: any) => opt.name === targetType);
    if (!typeOption) {
      console.log(`   ❌ #${item.number}: Type option "${targetType}" not found - skipping`);
      errors++;
      continue;
    }

    try {
      // Update the Type field
      const updateMutation = `
        mutation {
          updateProjectV2ItemFieldValue(input: {
            projectId: "${project.id}"
            itemId: "${item.id}"
            fieldId: "${typeField.id}"
            value: {
              singleSelectOptionId: "${typeOption.id}"
            }
          }) {
            projectV2Item {
              id
            }
          }
        }
      `;

      execSync(`gh api graphql -f query='${updateMutation.replace(/\n/g, ' ')}'`, {
        encoding: 'utf-8',
      });

      console.log(`   ✓ #${item.number}: ${item.workType} → ${targetType}`);
      migrated++;
    } catch (error: any) {
      console.log(`   ❌ #${item.number}: Failed - ${error.message}`);
      errors++;
    }
  }

  // Summary
  console.log(`\n📊 Migration Summary:`);
  console.log(`   ✓ Migrated: ${migrated}`);
  console.log(`   ⊘ Skipped: ${skipped}`);
  console.log(`   ❌ Errors: ${errors}`);

  if (errors === 0 && migrated > 0) {
    console.log(`\n✅ Migration complete!`);
    console.log(`\n⚠️  Manual steps remaining:`);
    console.log(`   1. Verify Type values are correct in the project`);
    console.log(`   2. Delete the "Work Type" field from project settings`);
    console.log(`   3. Update .autonomous-config.json if needed`);
  }
}

main().catch((error) => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});
