/**
 * Unified Project Creation Workflow
 *
 * Single workflow for both file and description inputs:
 * 1. File → Parse → Validate → Enhance → Review → Create
 * 2. Description → Generate .md → Parse → Validate → Enhance → Review → Create
 */

import chalk from 'chalk';
import { existsSync } from 'fs';
import { resolve, join } from 'path';
import type { ProjectSpecification } from '../types/project-spec.js';
import { interactiveSpecificationRefinement } from './spec-generator.js';
import { parseSpecificationFile } from './project-specification.js';
import { validateProjectSpecification } from './project-validation.js';
import { enrichProjectSpecification } from './project-enrichment.js';
import { convertSpecificationToLegacyFormat } from './project-creation-spec.js';

export interface UnifiedProjectCreationOptions {
  /** Path to Claude CLI */
  claudePath: string;

  /** Working directory for file operations */
  workingDirectory: string;

  /** Enable review workflow (default: true) */
  review?: boolean;

  /** Auto-fill gaps with Claude (default: true) */
  autoFill?: boolean;

  /** Verbose output (default: false) */
  verbose?: boolean;
}

export interface UnifiedProjectCreationResult {
  /** Final project specification */
  specification: ProjectSpecification;

  /** Path to the specification file (if generated or provided) */
  specFilePath?: string;

  /** Whether the spec was enriched */
  wasEnriched: boolean;

  /** Legacy format for GitHub creation */
  legacyFormat: {
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
  };
}

/**
 * Unified workflow for project creation
 *
 * Handles both file paths and text descriptions
 */
export async function unifiedProjectCreation(
  input: string,
  options: UnifiedProjectCreationOptions
): Promise<UnifiedProjectCreationResult> {
  const {
    claudePath,
    workingDirectory,
    review = true,
    autoFill = true,
    verbose = false,
  } = options;

  // Step 1: Determine input type and get specification file path
  const { specFilePath, isGenerated } = await getOrGenerateSpecification(
    input,
    claudePath,
    workingDirectory,
    review,
    verbose
  );

  // Step 2: Parse specification file
  console.log(chalk.cyan('📄 Reading specification...\n'));

  const parseResult = await parseSpecificationFile({
    filePath: specFilePath,
    format: 'markdown',
  });

  console.log(chalk.green('✓ Specification parsed'));
  console.log(chalk.gray(`  Project: ${parseResult.project.title}`));
  console.log(chalk.gray(`  Phases: ${parseResult.phases.length}`));

  const totalItems = parseResult.phases.reduce((sum, p) => sum + p.items.length, 0);
  console.log(chalk.gray(`  Items: ${totalItems}\n`));

  // Step 3: Validate specification
  console.log(chalk.cyan('🔍 Validating specification...\n'));

  const validation = validateProjectSpecification(parseResult);

  if (verbose) {
    displayValidationResults(validation, 'full');
  } else {
    displayValidationResults(validation, 'summary');
  }

  if (!validation.overallValid) {
    console.error(chalk.red('\n✗ Specification validation failed\n'));
    throw new Error('Specification validation failed. Please fix errors and try again.');
  }

  // Step 4: Enrichment (if needed)
  let finalSpec = parseResult;
  let wasEnriched = false;

  const needsEnrichment = validation.gapAnalysis.hasGaps && autoFill;

  if (needsEnrichment) {
    console.log(chalk.yellow('\n⚠️  Specification has gaps that can be auto-filled\n'));

    // Ask for confirmation if review is enabled
    if (review) {
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const answer = await new Promise<string>((resolve) => {
        rl.question(chalk.cyan('Auto-fill missing details with Claude? (Y/n): '), resolve);
      });

      rl.close();

      if (answer.toLowerCase() === 'n') {
        console.log(chalk.yellow('✓ Proceeding without enrichment\n'));
      } else {
        const enrichmentResult = await performEnrichment(
          parseResult,
          validation.gapAnalysis,
          { claudePath, workingDirectory },
          review,
          verbose
        );

        finalSpec = enrichmentResult.enriched;
        wasEnriched = true;
      }
    } else {
      // Auto-enrich without confirmation
      const enrichmentResult = await performEnrichment(
        parseResult,
        validation.gapAnalysis,
        { claudePath, workingDirectory },
        false,
        verbose
      );

      finalSpec = enrichmentResult.enriched;
      wasEnriched = true;
    }
  } else {
    console.log(chalk.green('\n✓ Specification is complete and ready!\n'));
  }

  // Step 5: Convert to legacy format
  const legacyFormat = convertSpecificationToLegacyFormat(finalSpec);

  return {
    specification: finalSpec,
    specFilePath: isGenerated ? specFilePath : undefined,
    wasEnriched,
    legacyFormat,
  };
}

/**
 * Get specification file path (existing file or generate from description)
 */
async function getOrGenerateSpecification(
  input: string,
  claudePath: string,
  workingDirectory: string,
  review: boolean,
  _verbose: boolean
): Promise<{ specFilePath: string; isGenerated: boolean }> {
  // Check if input is an existing file
  const resolvedPath = resolve(input);

  if (existsSync(resolvedPath)) {
    console.log(chalk.blue(`📁 Using existing specification file\n`));
    console.log(chalk.gray(`  File: ${resolvedPath}\n`));
    return { specFilePath: resolvedPath, isGenerated: false };
  }

  // Check if input looks like a file path (but doesn't exist)
  const looksLikeFilePath = input.match(/\.(md|yaml|yml|json)$/i) || input.match(/^[./]/);

  if (looksLikeFilePath) {
    throw new Error(`File not found: ${resolvedPath}`);
  }

  // Input is a description - generate specification
  console.log(chalk.blue('📝 Generating specification from description\n'));

  let specContent = await require('./spec-generator.js').generateSpecificationFromDescription(
    input,
    claudePath,
    workingDirectory
  );

  console.log(chalk.green('✓ Specification generated\n'));

  // Interactive refinement if review enabled
  if (review) {
    specContent = await interactiveSpecificationRefinement(
      specContent,
      claudePath,
      workingDirectory
    );
  }

  // Save to file
  const { saveSpecification } = await import('./spec-generator.js');

  // Extract project title for filename
  const titleMatch = specContent.match(/^# Project: (.+)$/m);
  const title = titleMatch ? titleMatch[1] : 'project';
  const filename = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  const specFilePath = join(workingDirectory, 'claudedocs', `${filename}-spec.md`);
  await saveSpecification(specContent, specFilePath);

  console.log(chalk.green('✓ Specification saved'));
  console.log(chalk.gray(`  File: ${specFilePath}\n`));

  return { specFilePath, isGenerated: true };
}

/**
 * Perform enrichment
 */
async function performEnrichment(
  spec: ProjectSpecification,
  gapAnalysis: any,
  config: { claudePath: string; workingDirectory: string },
  review: boolean,
  verbose: boolean
): Promise<any> {
  console.log(chalk.cyan('🤖 Enriching specification...\n'));

  const enrichmentConfig = {
    claudePath: config.claudePath,
    workingDirectory: config.workingDirectory,
    confidenceThreshold: 0.7,
    enrichLowScoreItems: true,
    minScoreForEnrichment: 70,
  };

  const enrichmentResult = await enrichProjectSpecification(
    spec,
    gapAnalysis,
    enrichmentConfig
  );

  console.log(chalk.green('✓ Enrichment complete'));
  const fieldsAdded = enrichmentResult.changes.fields_added;
  const itemsEnriched = enrichmentResult.changes.items_enriched;
  console.log(chalk.gray(`  Fields added: ${fieldsAdded}`));
  console.log(chalk.gray(`  Items enriched: ${itemsEnriched}`));
  console.log(chalk.gray(`  Total changes: ${fieldsAdded}\n`));

  // Review enriched specification if requested
  if (review && enrichmentResult.changes.fields_added > 0) {
    console.log(chalk.blue('━'.repeat(60)));
    console.log(chalk.yellow('📋 Review Enriched Specification:\n'));

    if (verbose) {
      // Show all suggestions
      enrichmentResult.suggestions.forEach((suggestion: any) => {
        console.log(chalk.cyan(`  ${suggestion.item_id ?? suggestion.itemId} → ${suggestion.field ?? 'unknown'}`));
        console.log(chalk.gray(`    Confidence: ${((suggestion.confidence ?? 0) * 100).toFixed(0)}%`));
        console.log(chalk.gray(`    ${suggestion.content?.substring(0, 100) ?? ''}${(suggestion.content?.length ?? 0) > 100 ? '...' : ''}`));
        console.log('');
      });
    } else {
      // Show summary
      const appliedCount = enrichmentResult.suggestions.filter((s: any) => (s.confidence ?? 0) >= 0.7).length;
      console.log(chalk.gray(`  ${appliedCount} high-confidence changes applied`));
      console.log(chalk.gray(`  Run with --verbose to see all changes\n`));
    }

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
      console.log(chalk.yellow('✓ Using original specification\n'));
      return { enriched: spec, changes: [], suggestions: [] };
    }
  }

  return enrichmentResult;
}

/**
 * Display validation results
 */
function displayValidationResults(validation: any, mode: 'summary' | 'full'): void {
  const { syntaxResult, structureResult, dependencyResult, gapAnalysis } = validation;

  // Syntax
  displaySingleResult(syntaxResult, 'Syntax');

  // Structure
  displaySingleResult(structureResult, 'Structure');

  // Dependencies
  displaySingleResult(dependencyResult, 'Dependencies');

  // Completeness
  const completeIcon = gapAnalysis.overall_score >= 70 ? '✓' : '⚠';
  const completeColor = gapAnalysis.overall_score >= 70 ? 'green' : 'yellow';
  console.log(chalk[completeColor](`  ${completeIcon} Completeness: ${gapAnalysis.overall_score}/100 (${gapAnalysis.summary.complete_items}/${gapAnalysis.summary.total_items} items complete)`));

  if (mode === 'full' && gapAnalysis.summary.critical_gaps > 0) {
    console.log(chalk.red(`    ⚠ ${gapAnalysis.summary.critical_gaps} items with critical gaps (<40% complete)`));
  }

  console.log('');
}

/**
 * Display single validation result
 */
function displaySingleResult(result: any, category: string): void {
  const icon = result.valid ? '✓' : '✗';
  const color = result.valid ? 'green' : 'red';

  console.log(chalk[color](`  ${icon} ${category}: ${result.summary.errors} errors, ${result.summary.warnings} warnings`));

  // Show first error if exists
  if (result.summary.errors > 0 && result.issues.length > 0) {
    const firstError = result.issues.find((i: any) => i.severity === 'error');
    if (firstError) {
      console.log(chalk.red(`    ✗ ${firstError.message}`));
      if (firstError.suggestion) {
        console.log(chalk.gray(`      → ${firstError.suggestion}`));
      }
    }
  }
}
