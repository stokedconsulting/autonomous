/**
 * Specification Generator
 *
 * Generates structured Markdown project specifications from text descriptions
 * using Claude CLI. Converts user descriptions into the format expected by
 * the specification parser.
 */

import execa from 'execa';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import chalk from 'chalk';

/**
 * Generate Markdown specification from text description
 */
export async function generateSpecificationFromDescription(
  description: string,
  claudePath: string,
  workingDirectory: string
): Promise<string> {
  const prompt = buildSpecificationPrompt(description);

  try {
    const result = await execa(claudePath, ['--no-stream'], {
      input: prompt,
      cwd: workingDirectory,
      timeout: 60000, // 60 second timeout
    });

    const markdown = result.stdout.trim();

    // Basic validation - ensure it has the required structure
    if (!markdown.includes('# Project:') || !markdown.includes('## Phase')) {
      throw new Error('Generated specification is missing required structure (Project title or Phases)');
    }

    return markdown;
  } catch (error) {
    throw new Error(`Failed to generate specification: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Build prompt for Claude to generate specification
 */
function buildSpecificationPrompt(description: string): string {
  return `You are a project planning assistant. Generate a structured project specification in Markdown format based on the following description.

User Description:
${description}

Generate a project specification following this EXACT format:

# Project: [Clear Project Title]
[1-2 paragraph project description explaining what will be built and why]

## Phase 1: [Phase Name]
[Brief phase description]

### Item 1.1: [Work Item Title]
[Detailed description of what needs to be implemented - at least 2-3 sentences providing enough detail for a medium-level programmer]

**Acceptance Criteria:**
- [Specific, measurable criterion 1]
- [Specific, measurable criterion 2]
- [Specific, measurable criterion 3]

**Technical Details:**
[Implementation approach, architecture notes, key technical decisions - 2-3 sentences]

**Dependencies:**
[Only if this item depends on other items - format: "- Phase N, Item N.M (item) - reason"]

### Item 1.2: [Work Item Title]
[Description...]

**Acceptance Criteria:**
- [Criterion 1]
- [Criterion 2]

**Technical Details:**
[Details...]

## Phase 2: [Phase Name]
[Phase description]

### Item 2.1: [Work Item Title]
[Description...]

**Acceptance Criteria:**
- [Criterion 1]
- [Criterion 2]

**Technical Details:**
[Details...]

**Dependencies:**
- Phase 1, Item 1.1 (item) - Needs X to be implemented first
- Phase 1 (phase) - All Phase 1 work must complete first

---

IMPORTANT GUIDELINES:
1. Break the project into 2-5 logical phases representing major milestones
2. Each phase should have 2-8 work items
3. Each work item should be completable in 2-16 hours
4. Every work item MUST have:
   - Clear title (what)
   - Detailed description (what and why)
   - 2-4 acceptance criteria (how we know it's done)
   - Technical details (how to implement)
5. Add dependencies ONLY when truly needed (don't over-specify)
6. Use "Dependencies: Phase N (phase)" for phase-level dependencies
7. Use "Dependencies: Phase N, Item N.M (item)" for item-level dependencies
8. Keep descriptions concrete and actionable
9. Focus on WHAT needs to be built, not HOW to build it (unless critical)

Generate ONLY the specification in the format above. Do not include any explanatory text before or after.`;
}

/**
 * Refine existing specification based on user feedback
 */
export async function refineSpecification(
  currentSpec: string,
  feedback: string,
  claudePath: string,
  workingDirectory: string
): Promise<string> {
  const prompt = buildRefinementPrompt(currentSpec, feedback);

  try {
    const result = await execa(claudePath, ['--no-stream'], {
      input: prompt,
      cwd: workingDirectory,
      timeout: 60000,
    });

    const markdown = result.stdout.trim();

    if (!markdown.includes('# Project:') || !markdown.includes('## Phase')) {
      throw new Error('Refined specification is missing required structure');
    }

    return markdown;
  } catch (error) {
    throw new Error(`Failed to refine specification: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Build prompt for refinement
 */
function buildRefinementPrompt(currentSpec: string, feedback: string): string {
  return `You are a project planning assistant. Refine the following project specification based on user feedback.

Current Specification:
${currentSpec}

User Feedback:
${feedback}

Generate an UPDATED specification that addresses the feedback while maintaining the same Markdown format:

# Project: [Title]
[Description]

## Phase N: [Name]
[Description]

### Item N.M: [Title]
[Description]

**Acceptance Criteria:**
- [Criteria]

**Technical Details:**
[Details]

**Dependencies:**
[If needed]

---

IMPORTANT:
1. Keep the same format as the original
2. Address ALL points in the user feedback
3. Maintain logical phase/item structure
4. Keep work items actionable and concrete
5. Preserve any good elements from the original
6. Update dependencies if phase/item structure changes

Generate ONLY the updated specification. Do not include explanatory text.`;
}

/**
 * Save specification to file
 */
export async function saveSpecification(
  specification: string,
  outputPath: string
): Promise<string> {
  await writeFile(outputPath, specification, 'utf-8');
  return outputPath;
}

/**
 * Generate specification and save to claudedocs directory
 */
export async function generateAndSaveSpecification(
  description: string,
  claudePath: string,
  workingDirectory: string,
  projectName?: string
): Promise<string> {
  console.log(chalk.cyan('🤖 Generating project specification...\n'));

  const specification = await generateSpecificationFromDescription(
    description,
    claudePath,
    workingDirectory
  );

  // Extract project title from specification
  const titleMatch = specification.match(/^# Project: (.+)$/m);
  const title = titleMatch ? titleMatch[1] : projectName || 'project';

  // Create filename from title
  const filename = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  const outputPath = join(workingDirectory, 'claudedocs', `${filename}-spec.md`);

  await saveSpecification(specification, outputPath);

  console.log(chalk.green('✓ Specification generated'));
  console.log(chalk.gray(`  Saved to: ${outputPath}\n`));

  return outputPath;
}

/**
 * Interactive refinement workflow
 */
export async function interactiveSpecificationRefinement(
  initialSpec: string,
  claudePath: string,
  workingDirectory: string
): Promise<string> {
  const readline = await import('readline');
  let currentSpec = initialSpec;
  let approved = false;

  while (!approved) {
    // Display current spec
    console.log(chalk.blue('━'.repeat(60)));
    console.log(currentSpec);
    console.log(chalk.blue('━'.repeat(60)));

    // Ask for feedback
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log(chalk.yellow('\n📋 Review Options:'));
    console.log(chalk.gray('  [Enter] - Approve and continue'));
    console.log(chalk.gray('  [c]     - Cancel'));
    console.log(chalk.gray('  [text]  - Provide feedback to refine the spec'));

    const input = await new Promise<string>((resolve) => {
      rl.question(chalk.cyan('\n> '), resolve);
    });

    rl.close();

    if (input.toLowerCase() === 'c' || input.toLowerCase() === 'cancel') {
      throw new Error('Project creation cancelled by user');
    } else if (input.trim() === '') {
      approved = true;
    } else {
      // Refine based on feedback
      console.log(chalk.cyan('\n🔄 Refining specification...\n'));
      currentSpec = await refineSpecification(currentSpec, input, claudePath, workingDirectory);
    }
  }

  return currentSpec;
}
