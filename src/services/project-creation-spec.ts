/**
 * Project Creation from Specification Files
 *
 * Enhanced project creation supporting:
 * - Specification file input (YAML/JSON/Markdown)
 * - Comprehensive validation
 * - Gap analysis and enrichment
 * - Review workflow for auto-filled changes
 */

import { resolve, extname } from 'path';
import { existsSync } from 'fs';
import chalk from 'chalk';
import type {
  ProjectSpecification,
  ProjectInput,
  ValidationResult,
  // GapAnalysisResult,
  EnrichmentResult,
} from '../types/project-spec.js';
import { parseProjectInput } from './project-specification.js';
import { validateProjectSpecification } from './project-validation.js';
import { enrichProjectSpecification } from './project-enrichment.js';

/**
 * Detect if input is a file path or text description
 */
export function detectInputType(input: string): 'file' | 'description' {
  // Check if input looks like a file path
  const possiblePath = resolve(input);

  // File exists - definitely a file
  if (existsSync(possiblePath)) {
    return 'file';
  }

  // Has file extension - likely a file path
  const ext = extname(input).toLowerCase();
  if (['.yaml', '.yml', '.json', '.md', '.markdown'].includes(ext)) {
    return 'file';
  }

  // Relative or absolute path format
  if (input.match(/^[./]|^[A-Za-z]:[/\\]/)) {
    return 'file';
  }

  // Otherwise, treat as description
  return 'description';
}

/**
 * Create ProjectInput from raw input string
 */
export function createProjectInput(input: string): ProjectInput {
  const inputType = detectInputType(input);

  if (inputType === 'file') {
    // For file input, we need to parse it to get the specification
    // This will be handled by parseProjectInput
    throw new Error('File input should be processed through parseProjectInput directly');
  }

  // For description input, we need to parse it to create a specification
  // This will be handled by the LLM to convert description to spec
  throw new Error('Description input should be processed through LLM to create specification');
}

/**
 * Process specification file workflow
 */
export async function processSpecificationFile(
  filePath: string,
  config: {
    claudePath: string;
    workingDirectory: string;
    autoFill?: boolean;
    review?: boolean;
  }
): Promise<{
  specification: ProjectSpecification;
  wasEnriched: boolean;
  enrichmentChanges?: EnrichmentResult['changes'];
}> {
  console.log(chalk.cyan('📄 Reading specification file...\n'));

  const input = {
    filePath: filePath,
    format: (extname(filePath).toLowerCase().includes('json') ? 'json' : 'yaml') as 'json' | 'yaml',
  };

  // Parse specification
  const parseResult = await parseProjectInput(input);

  if (!parseResult.specification) {
    throw new Error('Failed to parse specification file');
  }

  console.log(chalk.green('✓ Specification parsed successfully'));
  console.log(chalk.gray(`  Project: ${parseResult.specification.project.title}`));
  console.log(chalk.gray(`  Phases: ${parseResult.specification.phases.length}`));

  const totalItems = parseResult.specification.phases.reduce((sum, p) => sum + p.items.length, 0);
  console.log(chalk.gray(`  Items: ${totalItems}\n`));

  // Validate specification
  console.log(chalk.cyan('🔍 Validating specification...\n'));

  const validation = validateProjectSpecification(parseResult.specification);

  // Show validation results
  displayValidationResults(validation.syntaxResult, 'Syntax');
  displayValidationResults(validation.structureResult, 'Structure');
  displayValidationResults(validation.dependencyResult, 'Dependencies');

  // Show completeness analysis
  console.log(chalk.blue('\n📊 Completeness Analysis:\n'));
  console.log(chalk.gray(`  Overall Score: ${validation.gapAnalysis.overallCompleteness}/100`));
  const completeItemsCount = validation.gapAnalysis.incompleteItems.length;
  console.log(chalk.gray(`  Complete Items: ${totalItems - completeItemsCount}/${totalItems}`));
  console.log(chalk.gray(`  Items Needing Enrichment: ${completeItemsCount}`));

  if (!validation.overallValid) {
    console.error(chalk.red('\n✗ Specification validation failed. Please fix errors before proceeding.\n'));
    process.exit(1);
  }

  // Check if enrichment is needed
  const needsEnrichment = validation.gapAnalysis.hasGaps && config.autoFill !== false;

  if (!needsEnrichment) {
    console.log(chalk.green('\n✓ Specification is complete and valid!\n'));
    return {
      specification: parseResult.specification,
      wasEnriched: false,
    };
  }

  // Enrichment workflow
  console.log(chalk.yellow('\n⚠️  Specification has gaps that can be auto-filled\n'));

  // Ask for confirmation if review is enabled
  if (config.review) {
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise<string>((resolve) => {
      rl.question(chalk.cyan('Auto-fill missing details with Claude? (y/N): '), resolve);
    });

    rl.close();

    if (answer.toLowerCase() !== 'y') {
      console.log(chalk.yellow('\n✓ Proceeding without enrichment\n'));
      return {
        specification: parseResult.specification,
        wasEnriched: false,
      };
    }
  }

  // Perform enrichment
  console.log(chalk.cyan('\n🤖 Enriching specification with Claude...\n'));

  const enrichmentConfig = {
    claudePath: config.claudePath,
    workingDirectory: config.workingDirectory,
    confidenceThreshold: 0.7,
    enrichLowScoreItems: true,
    minScoreForEnrichment: 70,
  };

  const enrichmentResult = await enrichProjectSpecification(
    parseResult.specification,
    validation.gapAnalysis,
    enrichmentConfig
  );

  // Show enrichment results
  console.log(chalk.green('\n✓ Enrichment complete!'));
  const fieldsAdded = enrichmentResult.changes.fields_added;
  const itemsEnriched = enrichmentResult.changes.items_enriched;
  console.log(chalk.gray(`  Fields added: ${fieldsAdded}`));
  console.log(chalk.gray(`  Items enriched: ${itemsEnriched}`));
  console.log(chalk.gray(`  Total changes: ${fieldsAdded}\n`));

  // Review enriched specification if requested
  if (config.review && enrichmentResult.changes.fields_added > 0) {
    console.log(chalk.blue('━'.repeat(60)));
    console.log(chalk.yellow('\n📋 Review Enriched Specification:\n'));

    // Show suggestions that were applied
    const highPrioritySuggestions = enrichmentResult.suggestions.filter(s => s.priority === 'high');
    highPrioritySuggestions.forEach(suggestion => {
      console.log(chalk.cyan(`  ${suggestion.itemId ?? suggestion.item_id ?? 'unknown'}`));
      console.log(chalk.gray(`    Type: ${suggestion.type ?? 'unknown'}`));
      console.log(chalk.gray(`    Priority: ${suggestion.priority ?? 'unknown'}`));
      console.log(chalk.gray(`    ${suggestion.suggestion?.substring(0, 80) ?? ''}${(suggestion.suggestion?.length ?? 0) > 80 ? '...' : ''}`));
      console.log('');
    });

    console.log(chalk.blue('━'.repeat(60)));

    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise<string>((resolve) => {
      rl.question(chalk.cyan('\nAccept enriched specification? (Y/n): '), resolve);
    });

    rl.close();

    if (answer.toLowerCase() === 'n') {
      console.log(chalk.yellow('\n✓ Using original specification without enrichment\n'));
      return {
        specification: parseResult.specification,
        wasEnriched: false,
      };
    }
  }

  return {
    specification: enrichmentResult.enriched,
    wasEnriched: true,
    enrichmentChanges: enrichmentResult.changes,
  };
}

/**
 * Display validation results
 */
function displayValidationResults(result: ValidationResult, category: string): void {
  const icon = result.valid ? '✓' : '✗';
  const color = result.valid ? 'green' : 'red';

  console.log(chalk[color](`  ${icon} ${category}: ${result.errors.length} errors, ${result.warnings.length} warnings`));

  // Show first 3 issues
  const allIssues = [...result.errors, ...result.warnings];
  const issuesToShow = allIssues.slice(0, 3);
  issuesToShow.forEach(issue => {
    const prefix = issue.severity === 'error' ? chalk.red('    ✗') : chalk.yellow('    ⚠');
    console.log(`${prefix} ${issue.message}`);
    if (issue.location) {
      const loc = issue.location;
      const parts = [loc.phase, loc.item, loc.field].filter(Boolean);
      if (parts.length > 0) {
        console.log(chalk.gray(`      Location: ${parts.join(' → ')}`));
      }
    }
  });

  if (allIssues.length > 3) {
    console.log(chalk.gray(`    ... and ${allIssues.length - 3} more`));
  }
}

/**
 * Convert ProjectSpecification to legacy format for GitHub creation
 *
 * This bridges the new spec system with the existing project creation infrastructure
 */
export function convertSpecificationToLegacyFormat(spec: ProjectSpecification): {
  projectTitle: string;
  items: Array<{
    issueNumber?: number;
    phaseNumber: number;
    phaseName: string;
    title: string;
    body: string;
    labels: string[];
    isMaster: boolean;
    dependencies: string[];
  }>;
} {
  const items: any[] = [];

  spec.phases.forEach((phase, phaseIdx) => {
    const phaseNumber = phaseIdx + 1;

    // Create phase master item
    items.push({
      phaseNumber,
      phaseName: phase.name,
      title: `[PHASE ${phaseNumber}] ${phase.name}`,
      body: phase.description || `Phase ${phaseNumber}: ${phase.name}`,
      labels: ['epic', `phase-${phaseNumber}`],
      isMaster: true,
      dependencies: [],
    });

    // Create work items for this phase
    phase.items.forEach(item => {
      const body = buildItemBody(item);

      items.push({
        phaseNumber,
        phaseName: phase.name,
        title: item.title,
        body,
        labels: buildItemLabels(item),
        isMaster: false,
        dependencies: buildItemDependencies(item, spec),
      });
    });
  });

  return {
    projectTitle: spec.project.title,
    items,
  };
}

/**
 * Build item body from specification
 */
function buildItemBody(item: any): string {
  const parts: string[] = [];

  // Description
  parts.push(item.description || 'No description provided.');
  parts.push('');

  // Acceptance Criteria
  if (item.acceptance_criteria && item.acceptance_criteria.length > 0) {
    parts.push('## Acceptance Criteria');
    item.acceptance_criteria.forEach((criterion: string) => {
      parts.push(`- [ ] ${criterion}`);
    });
    parts.push('');
  }

  // Technical Details
  if (item.technical_details) {
    parts.push('## Technical Details');
    parts.push(item.technical_details);
    parts.push('');
  }

  // Function Specifications
  if (item.functions && item.functions.length > 0) {
    parts.push('## Function Specifications');
    item.functions.forEach((fn: any) => {
      parts.push(`### ${fn.name}`);
      parts.push(`**Status**: ${fn.is_new ? 'New' : 'Modified'}`);
      parts.push(`**Inputs**: ${fn.inputs?.map((i: any) => `${i.name}: ${i.type}`).join(', ') || 'none'}`);
      parts.push(`**Output**: ${fn.outputs?.[0]?.type || 'unknown'}`);
      if (fn.modifications) {
        parts.push(`**Modifications**: ${fn.modifications}`);
      }
      parts.push('');
    });
  }

  // Modified Files
  if (item.modified_files && item.modified_files.length > 0) {
    parts.push('## Files to Modify');
    item.modified_files.forEach((file: string) => {
      parts.push(`- \`${file}\``);
    });
    parts.push('');
  }

  // Metadata
  const metadata: string[] = [];
  if (item.size) metadata.push(`Size: ${item.size}`);
  if (item.complexity) metadata.push(`Complexity: ${item.complexity}`);
  if (item.estimate) metadata.push(`Estimate: ${item.estimate}h`);

  if (metadata.length > 0) {
    parts.push('---');
    parts.push(metadata.join(' | '));
  }

  return parts.join('\n');
}

/**
 * Build labels for item
 */
function buildItemLabels(item: any): string[] {
  const labels: string[] = [];

  if (item.size) labels.push(`size:${item.size.toLowerCase()}`);
  if (item.complexity) labels.push(`complexity:${item.complexity.toLowerCase()}`);

  return labels;
}

/**
 * Build dependency references
 */
function buildItemDependencies(item: any, spec: ProjectSpecification): string[] {
  if (!item.dependencies || item.dependencies.length === 0) {
    return [];
  }

  const depRefs: string[] = [];

  item.dependencies.forEach((dep: any) => {
    // Find the referenced phase
    const phaseIdx = spec.phases.findIndex(p => p.id === dep.phase_id);
    if (phaseIdx === -1) return;

    if (dep.type === 'phase' || dep.type === 'master') {
      depRefs.push(`phase-${phaseIdx + 1}`);
    } else if (dep.item_id) {
      const itemIdx = spec.phases[phaseIdx].items.findIndex((i: any) => i.id === dep.item_id);
      if (itemIdx !== -1) {
        depRefs.push(`${phaseIdx + 1}.${itemIdx + 1}`);
      }
    }
  });

  return depRefs;
}
