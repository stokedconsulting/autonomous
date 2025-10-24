#!/usr/bin/env node
/**
 * Phase 0 Data Migration Script
 *
 * Migrates existing autonomous data to Phase 0 schema:
 * 1. Updates evaluation cache: removes classification.area and .types, renames priority to aiPriorityScore
 * 2. Updates assignments: ensures labels are removed from metadata
 * 3. Links assignments to project items (if project API available)
 *
 * Usage:
 *   npx tsx scripts/migrate-phase0.ts [--dry-run] [--link-project]
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

interface OldIssueClassification {
  types?: string[];
  area?: string | null;
  complexity: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high' | 'critical';
}

interface NewIssueClassification {
  complexity: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high' | 'critical';
}

interface OldIssueScores {
  clarity: number;
  importance: number;
  feasibility: number;
  priority: number;
}

interface NewIssueScores {
  clarity: number;
  importance: number;
  feasibility: number;
  aiPriorityScore: number;
}

interface OldIssueEvaluation {
  issueNumber: number;
  issueTitle: string;
  lastModified: string;
  lastEvaluated: string;
  classification: OldIssueClassification;
  scores: OldIssueScores;
  hasEnoughDetail: boolean;
  reasoning: string;
  suggestedQuestions?: string[];
  estimatedEffort?: string;
}

interface NewIssueEvaluation {
  issueNumber: number;
  issueTitle: string;
  lastModified: string;
  lastEvaluated: string;
  classification: NewIssueClassification;
  scores: NewIssueScores;
  hasEnoughDetail: boolean;
  reasoning: string;
  suggestedQuestions?: string[];
  estimatedEffort?: string;
}

interface OldEvaluationCache {
  version: string;
  projectName: string;
  lastUpdated: string;
  evaluations: Record<number, OldIssueEvaluation>;
}

interface NewEvaluationCache {
  version: string;
  projectName: string;
  lastUpdated: string;
  evaluations: Record<number, NewIssueEvaluation>;
}

interface OldAssignmentMetadata {
  requiresTests: boolean;
  requiresCI: boolean;
  labels?: string[];
  estimatedComplexity?: 'low' | 'medium' | 'high';
}

interface NewAssignmentMetadata {
  requiresTests: boolean;
  requiresCI: boolean;
  estimatedComplexity?: 'low' | 'medium' | 'high';
}

interface OldAssignment {
  id: string;
  issueNumber: number;
  issueTitle: string;
  metadata?: OldAssignmentMetadata;
  projectItemId?: string;
  [key: string]: any;
}

interface NewAssignment {
  id: string;
  issueNumber: number;
  issueTitle: string;
  metadata?: NewAssignmentMetadata;
  projectItemId?: string;
  [key: string]: any;
}

interface AssignmentsFile {
  version: string;
  projectName: string;
  projectPath: string;
  createdAt: string;
  updatedAt: string;
  assignments: OldAssignment[];
}

const PROJECT_ID = 'PVT_kwDOBW_6Ns4BGTch';
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const shouldLinkProject = args.includes('--link-project');

async function main() {
  console.log('🚀 Phase 0 Data Migration\n');

  if (isDryRun) {
    console.log('⚠️  DRY RUN MODE - No files will be modified\n');
  }

  const projectPath = process.cwd();

  // Migrate evaluation cache
  await migrateEvaluationCache(projectPath);

  // Migrate assignments
  await migrateAssignments(projectPath);

  console.log('\n✅ Migration complete!\n');

  if (isDryRun) {
    console.log('To apply changes, run without --dry-run flag\n');
  }
}

async function migrateEvaluationCache(projectPath: string) {
  const cachePath = join(projectPath, '.autonomous', 'issue-evaluations.json');

  console.log('📊 Migrating evaluation cache...');

  try {
    const content = await fs.readFile(cachePath, 'utf-8');
    const oldCache: OldEvaluationCache = JSON.parse(content);

    let migratedCount = 0;
    const newEvaluations: Record<number, NewIssueEvaluation> = {};

    for (const [issueNum, oldEval] of Object.entries(oldCache.evaluations)) {
      const issueNumber = parseInt(issueNum);

      // Migrate classification: remove types and area
      const newClassification: NewIssueClassification = {
        complexity: oldEval.classification.complexity,
        impact: oldEval.classification.impact,
      };

      // Log removed fields
      if (oldEval.classification.types || oldEval.classification.area) {
        console.log(
          `  #${issueNumber}: Removing cached fields (types: ${oldEval.classification.types?.join(', ') || 'none'}, area: ${oldEval.classification.area || 'none'})`
        );
      }

      // Migrate scores: rename priority to aiPriorityScore
      const newScores: NewIssueScores = {
        clarity: oldEval.scores.clarity,
        importance: oldEval.scores.importance,
        feasibility: oldEval.scores.feasibility,
        aiPriorityScore: oldEval.scores.priority, // Rename
      };

      // Create migrated evaluation
      const newEval: NewIssueEvaluation = {
        issueNumber: oldEval.issueNumber,
        issueTitle: oldEval.issueTitle,
        lastModified: oldEval.lastModified,
        lastEvaluated: oldEval.lastEvaluated,
        classification: newClassification,
        scores: newScores,
        hasEnoughDetail: oldEval.hasEnoughDetail,
        reasoning: oldEval.reasoning,
        suggestedQuestions: oldEval.suggestedQuestions,
        estimatedEffort: oldEval.estimatedEffort,
      };

      newEvaluations[issueNumber] = newEval;
      migratedCount++;
    }

    const newCache: NewEvaluationCache = {
      version: '2.0.0', // Bump version
      projectName: oldCache.projectName,
      lastUpdated: new Date().toISOString(),
      evaluations: newEvaluations,
    };

    if (!isDryRun) {
      // Backup old cache
      const backupPath = cachePath + '.phase0-backup';
      await fs.writeFile(backupPath, content, 'utf-8');
      console.log(`  ✓ Backed up old cache to ${backupPath}`);

      // Write new cache
      await fs.writeFile(cachePath, JSON.stringify(newCache, null, 2), 'utf-8');
      console.log(`  ✓ Migrated ${migratedCount} evaluations`);
    } else {
      console.log(`  [DRY RUN] Would migrate ${migratedCount} evaluations`);
    }
  } catch (error) {
    if ((error as any).code === 'ENOENT') {
      console.log('  ℹ️  No evaluation cache found, skipping');
    } else {
      throw error;
    }
  }
}

async function migrateAssignments(projectPath: string) {
  const assignmentsPath = join(projectPath, 'autonomous-assignments.json');

  console.log('\n📝 Migrating assignments...');

  try {
    const content = await fs.readFile(assignmentsPath, 'utf-8');
    const assignmentsFile: AssignmentsFile = JSON.parse(content);

    let migratedCount = 0;
    let linkedCount = 0;

    for (const assignment of assignmentsFile.assignments) {
      let modified = false;

      // Remove labels from metadata
      if (assignment.metadata?.labels) {
        console.log(
          `  #${assignment.issueNumber}: Removing cached labels [${assignment.metadata.labels.join(', ')}]`
        );
        delete assignment.metadata.labels;
        modified = true;
        migratedCount++;
      }

      // Link to project if requested and not already linked
      if (shouldLinkProject && !assignment.projectItemId) {
        try {
          const projectItemId = await getProjectItemId(assignment.issueNumber);
          if (projectItemId) {
            assignment.projectItemId = projectItemId;
            console.log(`  #${assignment.issueNumber}: Linked to project item ${projectItemId}`);
            modified = true;
            linkedCount++;
          }
        } catch (error) {
          console.warn(
            `  ⚠️  Failed to link #${assignment.issueNumber}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }

    if (migratedCount > 0 || linkedCount > 0) {
      if (!isDryRun) {
        // Backup old assignments
        const backupPath = assignmentsPath + '.phase0-backup';
        await fs.writeFile(backupPath, content, 'utf-8');
        console.log(`  ✓ Backed up old assignments to ${backupPath}`);

        // Update version and write
        assignmentsFile.version = '2.0.0';
        assignmentsFile.updatedAt = new Date().toISOString();
        await fs.writeFile(assignmentsPath, JSON.stringify(assignmentsFile, null, 2), 'utf-8');
        console.log(
          `  ✓ Migrated ${migratedCount} assignments, linked ${linkedCount} to project`
        );
      } else {
        console.log(
          `  [DRY RUN] Would migrate ${migratedCount} assignments, link ${linkedCount} to project`
        );
      }
    } else {
      console.log('  ℹ️  No changes needed');
    }
  } catch (error) {
    if ((error as any).code === 'ENOENT') {
      console.log('  ℹ️  No assignments file found, skipping');
    } else {
      throw error;
    }
  }
}

async function getProjectItemId(issueNumber: number): Promise<string | null> {
  const query = `
    query {
      node(id: "${PROJECT_ID}") {
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

  try {
    const result = execSync(`gh api graphql -f query='${query}'`, { encoding: 'utf-8' });
    const data = JSON.parse(result);

    const items = data.data.node.items.nodes;
    const item = items.find((i: any) => i.content?.number === issueNumber);

    return item?.id || null;
  } catch (error) {
    throw new Error(`GraphQL query failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

main().catch((error) => {
  console.error('\n❌ Migration failed:', error);
  process.exit(1);
});
