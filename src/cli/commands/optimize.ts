/**
 * Optimize command - Generate optimization plan and add to GitHub project
 */

import chalk from 'chalk';
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { OptimizationPrompt } from '../../utils/optimizationPromptForGH.js';

const execAsync = promisify(exec);

interface OptimizeOptions {
  feature: string;
  goal?: string;
  project?: string;
  dryRun?: boolean;
}

interface PersonaSelectionResponse {
  architect: boolean;
  test: boolean;
  mongo: boolean;
  reasoning: string;
}

/**
 * Call Claude CLI with a prompt and return parsed JSON response
 */
async function callClaude(prompt: string, claudePath: string = 'claude'): Promise<any> {
  // Use a temp file for the prompt to avoid echo/pipe issues with long prompts
  const tempFile = join(tmpdir(), `claude-optimize-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);

  try {
    // Write prompt to temp file
    await writeFile(tempFile, prompt, 'utf-8');

    // Call Claude CLI with the temp file
    // Note: Not using --output-format json as it may truncate long responses
    const claudeResult = await execAsync(`cat "${tempFile}" | ${claudePath} --dangerously-skip-permissions chat 2>&1`);

    let responseText = claudeResult.stdout.trim();

    // Write raw output to debug file
    const debugFile = tempFile.replace('.txt', '-response.txt');
    await writeFile(debugFile, responseText, 'utf-8');

    // Extract JSON if it's wrapped in markdown code blocks
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      responseText = jsonMatch[1].trim();
    } else if (responseText.startsWith('```')) {
      // Handle plain code blocks without json tag
      responseText = responseText.replace(/^```\n/, '').replace(/\n```$/, '');
    }

    // Look specifically for JSON arrays [...]
    // This handles cases where Claude outputs explanatory text before the JSON
    const arrayMatch = responseText.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      responseText = arrayMatch[0];
    } else {
      // Fallback: Find the first [ and last ] to extract array
      const firstBracket = responseText.indexOf('[');
      const lastBracket = responseText.lastIndexOf(']');

      if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
        responseText = responseText.substring(firstBracket, lastBracket + 1);
      } else {
        console.error(chalk.yellow('\n⚠️  No JSON array found in response'));
        console.error(chalk.dim('Debug file saved to: ' + debugFile));
      }
    }

    // Handle double-escaped JSON
    if (responseText.includes('\\n') && responseText.includes('\\"')) {
      responseText = responseText
        .replace(/\\\\"/g, '__ESCAPED_QUOTE__')
        .replace(/\\"/g, '"')
        .replace(/__ESCAPED_QUOTE__/g, '\\"')
        .replace(/\\\\n/g, '__ESCAPED_N__')
        .replace(/\\n/g, '\n')
        .replace(/__ESCAPED_N__/g, '\\n')
        .replace(/\\\\\\\\/g, '\\\\')
        .replace(/\\t/g, '\t');
    }

    // Validate JSON with jq before parsing (if jq is available)
    let validatedJson = responseText;
    try {
      // Use jq to validate and pretty-print the JSON
      // This will fail if JSON is incomplete or malformed
      const jqResult = await execAsync(`echo '${responseText.replace(/'/g, "'\\''")}' | jq -c .`);
      validatedJson = jqResult.stdout.trim();
    } catch (jqError) {
      // jq not available or JSON is invalid - try parsing anyway and show better error
      console.error(chalk.yellow('\n⚠️  jq validation failed (JSON may be incomplete)'));
    }

    // Try to parse the JSON
    try {
      return JSON.parse(validatedJson);
    } catch (parseError) {
      // JSON parsing failed - show the raw response for debugging
      console.error(chalk.red('\nFailed to parse JSON response from Claude'));
      console.error(chalk.yellow('\nRaw response (first 1000 chars):'));
      console.error(chalk.dim(responseText.substring(0, 1000)));
      console.error(chalk.yellow('\n...'));
      console.error(chalk.yellow('\nLast 500 chars (likely where truncation occurred):'));
      console.error(chalk.dim(responseText.substring(Math.max(0, responseText.length - 500))));
      throw parseError;
    }
  } catch (error) {
    console.error(chalk.red('\nFailed to call Claude CLI'));

    if (error && typeof error === 'object') {
      const err = error as any;

      // Show stdout (combined with stderr due to 2>&1)
      if (err.stdout) {
        console.error(chalk.yellow('\nClaude CLI output:'));
        console.error(chalk.dim(err.stdout));
      }

      // Show stderr if separate
      if (err.stderr) {
        console.error(chalk.yellow('\nClaude CLI stderr:'));
        console.error(chalk.dim(err.stderr));
      }

      // Show the error message
      if (err.message && !err.stdout) {
        console.error(chalk.red(`\nError: ${err.message}`));
      }

      // Show exit code if available
      if (err.code !== undefined) {
        console.error(chalk.dim(`Exit code: ${err.code}`));
      }
    }

    throw error;
  } finally {
    // Clean up temp files
    try {
      await unlink(tempFile);
    } catch {
      // Ignore cleanup errors
    }
    // Keep debug response file for troubleshooting - will be in /tmp
  }
}

export async function optimizeCommand(
  feature: string,
  goal?: string,
  options: OptimizeOptions = {} as OptimizeOptions
): Promise<void> {
  console.log(chalk.blue.bold('\n🔧 Generating Optimization Plan\n'));

  try {
    // Use the goal from the second parameter or options
    const optimizationGoal = goal || options.goal || 'Improve generally';
    const projectNumber = options.project || '1';
    const isDryRun = options.dryRun || false;
    const claudePath = 'claude'; // Use local Claude CLI

    if (isDryRun) {
      console.log(chalk.yellow('🔍 DRY RUN MODE - No issues will be created\n'));
    }

    console.log(chalk.dim(`Feature: ${feature}`));
    console.log(chalk.dim(`Goal: ${optimizationGoal}`));
    console.log(chalk.dim(`Project: #${projectNumber}\n`));

    // Initialize prompt generator
    const prompt = new OptimizationPrompt(feature, optimizationGoal);

    // Step 1: Determine which personas to involve using Claude CLI
    console.log('Analyzing feature requirements...');
    const personaSelectionPrompt = `
You are analyzing a feature optimization request to determine which expert personas should be involved.

Feature: ${feature}
Optimization Goal: ${optimizationGoal}

Available personas:
- **architect**: Software architect and performance engineer (ALWAYS included)
- **test**: Expert-level test engineer for QA and testing strategy
- **mongo**: MongoDB optimization specialist for database performance

Respond with a JSON object indicating which personas should be consulted:
{
  "architect": true,
  "test": boolean (true if testing/QA is relevant),
  "mongo": boolean (true if this involves MongoDB or database optimization),
  "reasoning": "brief explanation"
}

Return ONLY the JSON object, no other text.
`;

    const personaSelection: PersonaSelectionResponse = await callClaude(personaSelectionPrompt, claudePath);
    console.log(chalk.green('✓ Analysis complete'));
    console.log(chalk.dim(`  Reasoning: ${personaSelection.reasoning}\n`));

    // Ensure architect is always included
    personaSelection.architect = true;

    const personasToQuery: Array<{ name: string; method: () => string }> = [];

    if (personaSelection.architect) {
      personasToQuery.push({ name: 'Architect', method: () => prompt.architect() });
    }
    if (personaSelection.test) {
      personasToQuery.push({ name: 'Test Engineer', method: () => prompt.test() });
    }
    if (personaSelection.mongo) {
      personasToQuery.push({ name: 'MongoDB Expert', method: () => prompt.mongo() });
    }

    console.log(chalk.blue(`Consulting ${personasToQuery.length} expert persona(s):\n`));
    personasToQuery.forEach(p => console.log(chalk.dim(`  - ${p.name}`)));
    console.log();

    // Step 2: Query each persona and collect tasks
    const allTasks: any[] = [];

    for (const persona of personasToQuery) {
      console.log(chalk.dim(`Consulting ${persona.name}...`));

      const personaPrompt = persona.method();
      const tasks = await callClaude(personaPrompt, claudePath);

      console.log(chalk.green(`  ✓ Received ${Array.isArray(tasks) ? tasks.length : 'unknown'} recommendation(s)`));

      // Tag each task with the persona that created it
      if (Array.isArray(tasks)) {
        tasks.forEach((task: any) => {
          task._persona = persona.name;
        });
        allTasks.push(...tasks);
      } else {
        console.log(chalk.yellow(`  ⚠️  Unexpected response format from ${persona.name}`));
      }
    }

    console.log(chalk.green(`\n✓ Total recommendations: ${allTasks.length}\n`));

    // Step 3: Normalize tasks to GitHub issue format
    const normalizedTasks = allTasks.map(task => {
      // If it's already in GitHub format, use it as-is
      if (task.Title) {
        return task;
      }

      // Otherwise, convert from persona-specific format to GitHub format
      return {
        Title: task['Suite Name'] || task['Optimization Area'] || task['Milestone Name'] || 'Unknown Task',
        Assignees: [],
        Status: 'Todo',
        Labels: [task._persona?.toLowerCase().replace(' ', '-') || 'optimization'],
        Milestone: task.Milestone || 'Optimization',
        Repository: '', // Will be set to current repo later
        'Parent issue': task.Dependencies || undefined,
        'Sub-issues progress': 0,
        Impact: task.Impact || task.Priority || 'Medium',
        Complexity: task.Complexity || 'Medium',
        Effort: task.Effort || task.Timeline || '1 week',
        Size: task.Size || 'M',
        _originalData: task
      };
    });

    // Verify gh CLI is available (skip in dry run mode)
    let owner = 'your-username';
    if (!isDryRun) {
      try {
        await execAsync('gh --version');
      } catch (error) {
        throw new Error('GitHub CLI (gh) is not installed. Please install it first: https://cli.github.com/');
      }

      // Get GitHub username
      const { stdout: username } = await execAsync('gh api user -q .login');
      owner = username.trim();
    }

    // Step 4: Create issues using gh CLI (or preview in dry run mode)
    if (isDryRun) {
      console.log(chalk.blue('📋 Preview of issues that would be created:\n'));
    } else {
      console.log(chalk.blue('Creating GitHub issues...\n'));
    }

    for (let i = 0; i < normalizedTasks.length; i++) {
      const task = normalizedTasks[i];
      const taskNum = i + 1;

      // Build issue body with all metadata
      const originalData = task._originalData;
      let bodyDetails = '';

      if (originalData) {
        // Format the original data nicely
        bodyDetails = Object.entries(originalData)
          .filter(([key]) => !key.startsWith('_'))
          .map(([key, value]) => {
            if (Array.isArray(value)) {
              return `**${key}:** ${value.join(', ')}`;
            } else if (typeof value === 'object') {
              return `**${key}:** ${JSON.stringify(value, null, 2)}`;
            }
            return `**${key}:** ${value}`;
          })
          .join('\n');
      }

      const body = `## Optimization Recommendation

**Persona:** ${task._persona || 'Unknown'}
**Impact:** ${task.Impact}
**Complexity:** ${task.Complexity}
**Effort:** ${task.Effort}
**Size:** ${task.Size}

${task['Parent issue'] ? `**Dependencies:** ${task['Parent issue']}\n` : ''}
---

${bodyDetails}

---

_Auto-generated optimization task for: ${feature}_
_Goal: ${optimizationGoal}_
`;

      if (isDryRun) {
        // Dry run mode: just display the issue details
        console.log(chalk.cyan(`\n[${taskNum}/${normalizedTasks.length}] ${task.Title}`));
        console.log(chalk.dim('─'.repeat(80)));
        console.log(chalk.dim(`Persona:     ${task._persona || 'Unknown'}`));
        console.log(chalk.dim(`Repository:  ${task.Repository}`));
        console.log(chalk.dim(`Labels:      ${task.Labels.join(', ')}`));
        console.log(chalk.dim(`Milestone:   ${task.Milestone || 'None'}`));
        console.log(chalk.dim(`Impact:      ${task.Impact}`));
        console.log(chalk.dim(`Complexity:  ${task.Complexity}`));
        console.log(chalk.dim(`Effort:      ${task.Effort}`));
        console.log(chalk.dim(`Size:        ${task.Size}`));
        if (task['Parent issue']) {
          console.log(chalk.dim(`Dependencies: ${task['Parent issue']}`));
        }
        console.log(chalk.dim('\nBody preview:'));
        console.log(chalk.dim(body.split('\n').slice(0, 10).join('\n')));
        if (body.split('\n').length > 10) {
          console.log(chalk.dim(`... (${body.split('\n').length - 10} more lines)`));
        }
      } else {
        // Normal mode: create the issue
        process.stdout.write(chalk.dim(`[${taskNum}/${normalizedTasks.length}] Creating: ${task.Title}... `));

        // Build gh issue create command
        // Note: Not using --repo flag - gh will use the current directory's repository
        const labels = task.Labels.join(',');
        const assignees = task.Assignees.length > 0 ? task.Assignees.join(',') : '';

        let cmd = `gh issue create --title "${task.Title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}"`;

        if (labels) {
          cmd += ` --label "${labels}"`;
        }
        if (assignees) {
          cmd += ` --assignee "${assignees}"`;
        }
        if (task.Milestone) {
          cmd += ` --milestone "${task.Milestone}"`;
        }

        try {
          const { stdout } = await execAsync(cmd);
          const issueUrl = stdout.trim();
          console.log(chalk.green('✓'));

          // Add to project if specified
          if (projectNumber) {
            try {
              await execAsync(`gh project item-add ${projectNumber} --owner ${owner} --url "${issueUrl}"`);
              console.log(chalk.dim(`    Added to project #${projectNumber}`));
            } catch (projectError) {
              console.log(chalk.yellow(`    Warning: Could not add to project`));
            }
          }
        } catch (error) {
          console.log(chalk.red('✗'));
          console.error(chalk.red(`    Error creating issue: ${error}`));
        }
      }
    }

    if (isDryRun) {
      console.log(chalk.green('\n✓ Dry run complete!'));
      console.log(chalk.yellow(`\n${normalizedTasks.length} issue(s) would be created.`));
      console.log(chalk.dim('\nTo create these issues for real, run the command without --dry-run'));
    } else {
      console.log(chalk.green('\n✓ Optimization plan created successfully!'));
      console.log(chalk.dim(`\nView your issues: gh issue list`));
      if (projectNumber) {
        console.log(chalk.dim(`View project: gh project view ${projectNumber} --owner ${owner}`));
      }
    }

  } catch (error) {
    console.error(chalk.red('\n✗ Optimization failed:'));
    console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
    if (error instanceof Error && error.stack) {
      console.error(chalk.dim(error.stack));
    }
    process.exit(1);
  }
}
