import { Command } from 'commander';
import { $ } from 'zx';
import chalk from 'chalk';
import { PersonaDefinition } from '../../core/persona-reviewer.js';

/**
 * Default persona definitions
 */
const DEFAULT_PERSONAS: PersonaDefinition[] = [
  {
    name: 'architect',
    role: 'Software Architect',
    focusAreas: [
      'Requirements coverage',
      'System design',
      'Implementation completeness',
      'Technical correctness',
    ],
    passingCriteria: [
      'All requirements are properly designed',
      'The architecture is sound',
      'Technical decisions are justified',
      'No major technical gaps',
    ],
  },
  {
    name: 'product-manager',
    role: 'Product Manager',
    focusAreas: [
      'User experience',
      'Product requirements',
      'User value delivery',
      'Feature usability',
    ],
    passingCriteria: [
      'Changes improve user experience',
      'Product requirements are met',
      'User-facing text is clear and friendly',
      'Features are intuitive',
    ],
  },
  {
    name: 'senior-engineer',
    role: 'Senior Software Engineer',
    focusAreas: [
      'Code quality',
      'Architecture',
      'Maintainability',
      'Best practices',
    ],
    passingCriteria: [
      'Code follows best practices',
      'Architecture is clean',
      'Code is maintainable',
      'No code smells',
    ],
  },
  {
    name: 'qa-engineer',
    role: 'QA Engineer',
    focusAreas: [
      'Test coverage',
      'Edge cases',
      'Error scenarios',
      'Quality assurance',
    ],
    passingCriteria: [
      'Critical paths are tested',
      'Edge cases are considered',
      'Error scenarios are handled',
      'Quality standards are met',
    ],
  },
  {
    name: 'security-engineer',
    role: 'Security Engineer',
    focusAreas: [
      'Security vulnerabilities',
      'Data validation',
      'Authentication/Authorization',
      'Sensitive data handling',
    ],
    passingCriteria: [
      'No security vulnerabilities',
      'Input is validated',
      'Secrets are secure',
      'Access control is proper',
    ],
  },
  {
    name: 'ux-designer',
    role: 'UX Designer',
    focusAreas: [
      'User interface design',
      'User experience flow',
      'Accessibility',
      'Visual consistency',
    ],
    passingCriteria: [
      'UI is intuitive and user-friendly',
      'Visual design is consistent',
      'Accessibility standards are met',
      'User flow is smooth',
    ],
  },
  {
    name: 'tech-writer',
    role: 'Technical Writer',
    focusAreas: [
      'Documentation clarity',
      'User-facing text',
      'Error messages',
      'Help content',
    ],
    passingCriteria: [
      'Text is clear and concise',
      'Documentation is helpful',
      'Error messages are user-friendly',
      'Content is well-organized',
    ],
  },
];

/**
 * Build prompt for a persona
 */
function buildPersonaPrompt(persona: PersonaDefinition, userPrompt: string): string {
  return `<persona>
You are a **${persona.role}** providing guidance and feedback.

Your role focuses on: ${persona.focusAreas.join(', ')}

Your standards:
${persona.passingCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}
</persona>

**User Request:**
${userPrompt}

**Instructions:**
1. Approach this task from your perspective as a ${persona.role}
2. Apply your expertise in: ${persona.focusAreas.join(', ')}
3. Provide specific, actionable guidance
4. Focus on your area of expertise

Respond naturally and help the user accomplish their goal.`;
}

export const personaCommand = new Command('persona')
  .description('Invoke Claude with a specific persona (e.g., product-manager, architect, senior-engineer)')
  .argument('[persona]', 'Persona to use (product-manager, architect, senior-engineer, qa-engineer, security-engineer, ux-designer, tech-writer)')
  .argument('[prompt...]', 'Prompt to send to Claude')
  .option('--list', 'List available personas')
  .option('--claude-path <path>', 'Path to Claude CLI executable', 'claude')
  .option('--no-skip-permissions', 'Do not skip permissions (default: skips permissions)')
  .action(async (persona: string | undefined, promptParts: string[] | undefined, options: any) => {
    // Handle --list option
    if (options.list) {
      console.log(chalk.blue('\n📋 Available Personas:\n'));
      for (const p of DEFAULT_PERSONAS) {
        console.log(chalk.green(`  ${p.name}`));
        console.log(chalk.gray(`    Role: ${p.role}`));
        console.log(chalk.gray(`    Focus: ${p.focusAreas.join(', ')}\n`));
      }
      return;
    }

    // Validate required arguments
    if (!persona) {
      console.error(chalk.red('\n✗ Please provide a persona name\n'));
      console.error(chalk.gray(`Available personas: ${DEFAULT_PERSONAS.map(p => p.name).join(', ')}`));
      console.error(chalk.gray(`Use --list to see details\n`));
      process.exit(1);
    }

    // Find the persona
    const personaDef = DEFAULT_PERSONAS.find(p => p.name === persona);
    if (!personaDef) {
      console.error(chalk.red(`\n✗ Unknown persona: ${persona}`));
      console.error(chalk.gray(`\nAvailable personas: ${DEFAULT_PERSONAS.map(p => p.name).join(', ')}`));
      console.error(chalk.gray(`Use --list to see details\n`));
      process.exit(1);
    }

    // Build the user prompt from parts
    const userPrompt = promptParts ? promptParts.join(' ') : '';
    if (!userPrompt.trim()) {
      console.error(chalk.red('\n✗ Please provide a prompt\n'));
      process.exit(1);
    }

    // Build the full prompt with persona context
    const fullPrompt = buildPersonaPrompt(personaDef, userPrompt);

    console.log(chalk.blue(`\n🎭 Invoking Claude as ${chalk.bold(personaDef.role)}...\n`));

    try {
      $.verbose = true;

      // Build Claude command
      const claudeArgs = [options.claudePath];

      if (options.skipPermissions !== false) {
        claudeArgs.push('--dangerously-skip-permissions');
      }

      claudeArgs.push('-c', fullPrompt);

      // Execute Claude command
      await $`${claudeArgs}`;

      // Output is already shown by verbose mode
      console.log(chalk.green('\n✓ Done\n'));
    } catch (error: any) {
      console.error(chalk.red('\n✗ Command failed\n'));
      if (error.stderr) {
        console.error(chalk.gray(error.stderr));
      }
      process.exit(error.exitCode || 1);
    }
  });
