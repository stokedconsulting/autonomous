/**
 * Project Creation Service
 *
 * Two-stage project creation workflow:
 * 1. Product Manager perspective - creates product strategy document
 * 2. Senior Engineer perspective - creates implementation plan from strategy
 *
 * Used by both CLI and TUI implementations.
 */

import { GitHubProjectsAPI } from '../github/projects-api.js';
import { ProductStrategy, ImplementationPlan } from '../types/project-spec.js';
import { LLMAdapter } from '../llm/adapter.js';
import { StokedAdapter } from '../llm/stoked-adapter.js';
import { execSync } from 'child_process';
import { join } from 'path';
import { promises as fs } from 'fs';

export interface ParsedPhaseItem {
  title: string;
  body: string;
  isMaster: boolean;
  phase: string;
  phaseNumber: number;
  workNumber?: number;
}

export interface ProjectPlan {
  projectTitle: string;
  items: ParsedPhaseItem[];
  planText: string;
}

export interface ProjectCreationProgress {
  stage: 'planning' | 'parsing' | 'creating' | 'complete' | 'error';
  message: string;
  currentPlan?: string;
  parsedPlan?: ProjectPlan;
  error?: string;
}

/**
 * Generate a project plan using Claude CLI
 */
export async function generateProjectPlan(
  description: string,
  adapter: LLMAdapter,
  _workingDirectory: string
): Promise<string> {


  // If using Stoked adapter, use the two-pass flow
  if (adapter instanceof StokedAdapter) {
    const strategy = await adapter.generateProductStrategy(description);
    return adapter.generateImplementationPlan(strategy);
  }

  const prompt = `You are a project planning assistant. Create a detailed phased project plan based on the following description.

PROJECT DESCRIPTION:
${description}

Create a structured project plan with:
- 2-5 logical phases (depending on complexity)
- Each phase should have a clear goal and 2-6 concrete work items
- Each work item should be specific and actionable
- Include technical details and acceptance criteria

Format your response EXACTLY as follows:

# Project Plan: [Project Title]

## Overview
[Brief summary of the project]

## Phase 1: [Phase Name]
**Goal:** [What this phase achieves]

### 1.1) [Work Item Title]
[Description with acceptance criteria]

### 1.2) [Work Item Title]
[Description with acceptance criteria]

## Phase 2: [Phase Name]
**Goal:** [What this phase achieves]

### 2.1) [Work Item Title]
[Description with acceptance criteria]

[Continue with additional phases as needed...]

## Success Criteria
[Overall project completion criteria]`;

  return adapter.prompt(prompt);
}

/**
 * Refine a project plan based on user feedback
 */
export async function refineProjectPlan(
  currentPlan: string,
  feedback: string,
  adapter: LLMAdapter,
  _workingDirectory: string
): Promise<string> {
  const prompt = `You are a project planning assistant. Refine the following project plan based on user feedback.

CURRENT PLAN:
${currentPlan}

USER FEEDBACK:
${feedback}

Please update the plan according to the feedback while maintaining the same format structure. If the feedback asks for clarification, provide it along with any suggested improvements.

Output the complete updated plan in the same format.`;

  return adapter.prompt(prompt);
}

/**
 * Parse a project plan into structured phase items
 */
export function parseProjectPlan(planText: string): ProjectPlan {
  const items: ParsedPhaseItem[] = [];

  // Extract project title from header
  const titleMatch = planText.match(/^#\s*Project Plan:\s*(.+)$/m);
  const projectTitle = titleMatch ? titleMatch[1].trim() : 'Untitled Project';

  // Extract phase sections
  const phasePattern = /## Phase (\d+):?\s*(.+?)\n([\s\S]*?)(?=\n## Phase \d+|## Success Criteria|$)/gi;
  let match;

  while ((match = phasePattern.exec(planText)) !== null) {
    const phaseNumber = parseInt(match[1]);
    const phaseName = match[2].trim();
    const phaseContent = match[3];

    // Extract goal from phase content
    const goalMatch = phaseContent.match(/\*\*Goal:\*\*\s*(.+?)(?:\n|$)/);
    const phaseGoal = goalMatch ? goalMatch[1].trim() : '';

    // Create phase master item
    items.push({
      title: `Phase ${phaseNumber}: ${phaseName} - MASTER`,
      body: `# Phase ${phaseNumber}: ${phaseName}\n\n**Goal:** ${phaseGoal}\n\nThis is the phase master issue. All work items in this phase must complete before this issue can be resolved.`,
      isMaster: true,
      phase: `Phase ${phaseNumber}`,
      phaseNumber,
    });

    // Extract work items from phase content
    const workPattern = /###\s*(?:\d+\.)?\s*(\d+)\)\s*(.+?)\n([\s\S]*?)(?=\n###\s*(?:\d+\.)?\s*\d+\)|$)/gi;
    let workMatch;

    while ((workMatch = workPattern.exec(phaseContent)) !== null) {
      const workNumber = parseInt(workMatch[1]);
      const workTitle = workMatch[2].trim();
      const workBody = workMatch[3].trim();

      items.push({
        title: `(Phase ${phaseNumber}.${workNumber}) ${workTitle}`,
        body: workBody || `Work item for Phase ${phaseNumber}: ${phaseName}`,
        isMaster: false,
        phase: `Phase ${phaseNumber}`,
        phaseNumber,
        workNumber,
      });
    }
  }

  return { projectTitle, items, planText };
}

/**
 * Create GitHub issues from parsed plan items
 */
export async function createProjectIssues(
  items: ParsedPhaseItem[],
  projectTitle: string,
  owner: string,
  repo: string,
  projectsAPI: GitHubProjectsAPI,
  projectNumber: number,
  onProgress?: (current: number, total: number, itemTitle: string) => void
): Promise<void> {
  const total = items.length;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    if (onProgress) {
      onProgress(i + 1, total, item.title);
    }

    // Create GitHub issue using gh CLI
    // Use --body-file - to read body from stdin (more reliable for complex markdown)
    const escapedTitle = item.title.replace(/"/g, '\\"');

    // gh issue create outputs the URL: https://github.com/owner/repo/issues/123
    const issueUrl = execSync(`gh issue create --repo ${owner}/${repo} --title "${escapedTitle}" --body-file -`, {
      encoding: 'utf-8',
      input: item.body || '',  // Pass body via stdin
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    // Extract issue number from URL
    const issueNumberMatch = issueUrl.match(/\/issues\/(\d+)$/);
    if (!issueNumberMatch) {
      throw new Error(`Failed to parse issue number from URL: ${issueUrl}`);
    }
    const issue = {
      number: parseInt(issueNumberMatch[1], 10),
      url: issueUrl,
    };

    // Add to project using gh CLI and get project item ID from response
    const addResult = execSync(`gh project item-add ${projectNumber} --owner ${owner} --url "${issueUrl}" --format json`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    // Parse the JSON response to get the project item ID directly
    const addedItem = JSON.parse(addResult);
    const projectItemId = addedItem.id;

    if (!projectItemId) {
      throw new Error(`Could not get project item ID for issue #${issue.number}`);
    }

    // Set Epic field (text field) - use project title
    await projectsAPI.updateItemTextField(projectItemId, 'Epic', projectTitle);

    // Set Phase field (text field)
    await projectsAPI.updateItemTextField(projectItemId, 'Phase', item.phase);

    // Set Type field for master items
    if (item.isMaster) {
      await projectsAPI.updateItemFieldValue(projectItemId, 'Work Type', 'Phase Master');
    }

    // Set status to Ready
    await projectsAPI.updateItemStatusByValue(projectItemId, 'Ready');
  }
}

/**
 * Generate product strategy using Product Manager prompt
 */
export async function generateProductStrategy(
  description: string,
  adapter: LLMAdapter,
  _workingDirectory: string
): Promise<ProductStrategy> {
  const prompt = `You are a Staff-level Product Manager working on a complex social platform that includes user profiles, media uploads, posting, messaging, live streaming, notifications, and privacy controls.

Your job is to create a deeply thought-out, hypothesis-driven product plan that will be handed off to a senior software engineer for implementation planning. You must think strategically AND operationally — defining the "why", "what", and measurable impact, not the code.

Before writing your final response, internally perform structured reasoning steps such as brainstorming and risk assessment if available in this environment. Do NOT show that internal thinking — ONLY output the final structured plan.

========================
PROJECT REQUEST
${description}
========================

## CRITICAL CONTEXT — ABOUT THE PLATFORM
Assume this platform includes:
- profile discovery
- media search and viewing (photos & videos)
- profile timelines/posts
- real-time chat & messaging
- live streaming
- notifications
- strong privacy & content controls
- adult content gates
- team/role permissions
- paid and private media support
- profile-centric navigation
- large real-time WebSocket footprint

You must design the product strategy so it *fits naturally inside this existing ecosystem*.

========================
OUTPUT REQUIREMENTS
Structure your response EXACTLY using the sections below. Be specific. Avoid generic PM fluff. Write like you own results.

# Product Strategy: [Feature Title]

## 1. Problem Definition
Describe the core user problems this feature solves. Write 3–6 user-centric problem statements. Include different roles (casual users, creators, power users, streamers, moderators, safety teams).

Explain what happens if we do nothing.

## 2. Target Users & Segments
Define the key user segments and explain how each will use this feature. Include:
- motivations
- behaviors
- success definitions
- risks if misused

## 3. Hypotheses (Must Be Measurable)
Write 4–6 hypotheses in this format:

"We believe that [specific user group] who [context/behavior] will achieve [measurable outcome] by using [this feature], which will result in [business impact]. We'll know this is true when [metric movement + timeframe]."

At least one hypothesis should target:
- engagement
- retention
- creator value
- safety/abuse outcomes
- revenue/monetization (even if future phase)

## 4. Success Metrics
Define:
### Primary Success Metrics
(leading behavioral metrics indicating the feature is working)

### Secondary Metrics
(lagging / business metrics)

### Guardrail Metrics
(metrics that MUST NOT degrade — abuse, performance, UX complexity, moderation cost, etc.)

Provide target ranges when reasonable — do not be vague.

## 5. MVP Scope — What Is In vs Out
Define the smallest viable release that tests core value. Describe:

- Included capabilities
- Explicit non-goals for MVP
- Dependencies on existing systems
- Compromises for learning speed

Be concrete about feature boundaries.

## 6. Key Product Decisions Required
List the critical decisions the team MUST make early. Examples:
- privacy model
- who can post
- media visibility rules
- moderation authority
- streaming inside groups
- how group chat interacts with existing chat

For each decision:
- list options
- pros/cons
- your recommendation

## 7. User Journeys and Behavior Loops
Describe the core loops that must exist for the feature to retain value. Include:

- create loop
- join loop
- post/share loop
- return loop
- notify loop

Each should be described step-by-step.

## 8. Risks & Abuse Scenarios
Identify:
- technical risks
- user adoption risks
- privacy/legal risks
- child safety/adult content risks
- harassment risks
- financial scam risks
- growth & spam risks

For each:
- define mitigation strategies
- define monitoring signals

## 9. Rollout & Experiment Plan
Describe:

- rollout phases
- who gets access first
- whether an A/B control group exists
- exposure gating
- how long each phase should run
- how decisions will be made post-experiment

Describe clearly what would:
- validate the idea
- require iteration
- trigger rollback or sunset

## 10. Post-Launch Evaluation Plan
Explain:
- how we will evaluate outcomes at 2 weeks, 4 weeks, 8 weeks
- what dashboards must exist
- how segmentation should be applied (power users vs casual, paid vs free, etc.)

## 11. Future Expansion Roadmap (If MVP Succeeds)
List sequenced follow-up phases such as:
- deeper discovery tooling
- private & paid groups
- admin tooling
- safety automation
- creator tools
- monetization paths
Explain WHY each should come later — tie to learning & risk reduction.

========================
STYLE REQUIREMENTS
- Avoid buzzwords — be concrete and specific
- Assume this plan will drive real engineering priorities
- Do not describe implementation details — that will be done by Engineering in the next stage
- Think deeply about safety, privacy, and failure cases
- Use examples grounded in social/community platforms
========================`;

  let rawOutput: string;

  if (adapter instanceof StokedAdapter) {
    rawOutput = await adapter.generateProductStrategy(description);
  } else {
    rawOutput = await adapter.prompt(prompt);
  }
  const validation = validateProductStrategy(rawOutput);

  return {
    title: extractTitle(rawOutput, 'Product Strategy:'),
    rawOutput,
    validated: validation.valid,
    validationErrors: validation.errors,
  };
}

/**
 * Generate implementation plan using Senior Engineer prompt
 */
export async function generateImplementationPlan(
  productStrategy: ProductStrategy,
  adapter: LLMAdapter,
  workingDirectory: string
): Promise<ImplementationPlan> {
  const prompt = `You are a senior staff-level software engineer and systems architect responsible for turning high-level ideas into concrete, implementable work for an experienced engineering team.

Your goal is to produce a project plan that reads like it was written by someone who deeply understands software architecture, implementation trade-offs, and delivery risk — not a generic "planning assistant".

Before drafting the final answer, if available in this environment, internally use the following system commands (do NOT print their intermediate outputs, only integrate the insights into the final plan):
- /sc:brainstorm on the PROJECT DESCRIPTION to explore multiple implementation approaches and identify key constraints.
- /sc:risks (or similar) to enumerate technical and product risks for the project.
- /sc:tests (or similar) to think through how the feature should be validated end-to-end.
You must ONLY output the final project plan in the format specified below.

PROJECT DESCRIPTION:
${productStrategy.rawOutput}

Assume there is an existing application and codebase. As you plan, explicitly think about:
- Which existing layers will be impacted (API, services, domain layer, data access, frontend components, background jobs, infra).
- What new modules, tables, queues, or services will need to be created.
- What design patterns and data structures should be used (and why) for each major work item.
- How to keep changes incremental and safe for rollout.

Create a structured project plan with:
- 2–5 logical phases (depending on complexity)
- Each phase has a clear goal and 2–6 concrete work items
- Each work item is specific, actionable, and grounded in implementation detail
- Each work item includes:
  - What needs to be built or changed
  - Where in the existing architecture it lives (modules, layers, or example file paths)
  - Design patterns / data structures that should be used where applicable
  - Acceptance criteria that are testable and unambiguous

Format your response EXACTLY as follows (keep the headings and numbering structure, but fill in all placeholders and details):

# Project Plan: [Project Title]

## Overview
[Brief summary of the project, including key technical themes and any major architectural decisions or constraints.]

## Phase 1: [Phase Name]
**Goal:** [What this phase achieves in terms of user value and system evolution.]

### 1.1) [Work Item Title]
**Description:**  
- [Describe precisely what is being built or changed, including any relevant assumptions.]  
- [Mention impacted areas of the existing system: e.g., "Modify existing REST endpoint X", "Add new domain service Y", "Extend table Z with new column", "Add new React component A", etc.]

**Implementation Details:**  
- [List concrete implementation steps, e.g., "Introduce new interface …", "Refactor service … to follow pattern …", "Add new table with columns …", "Wire up background job via queue …".]  
- [Reference example module or file names where appropriate, e.g., \`api/group/group.controller.ts\`, \`frontend/components/GroupList.tsx\`. Use generic but realistic paths if you don't know the actual repo layout.]  
- [Call out any important validation, error-handling, or concurrency concerns.]

**Design Patterns / Data Structures:**  
- [Name specific patterns where relevant: e.g., Repository pattern, CQRS, Saga, Pub/Sub, Strategy, State machine, Adapter, etc.]  
- [Mention key data structures and shapes: e.g., "Use a normalized relational schema for…", "Use a map keyed by … for quick lookup", "Use append-only event log for …".]  
- [Explain briefly why the chosen pattern/structure fits the problem.]

**Acceptance Criteria:**  
- [Bullet list of clear, testable outcomes. For example:  
  - "Given X input to endpoint /api/…, the response includes fields … and persists record in table …"  
  - "New UI state is reflected after Y action and persists across refresh."  
  - "Feature is covered by unit tests for edge cases A/B/C and at least one integration test for the happy path."]

### 1.2) [Work Item Title]
**Description:**  
[Same structure as 1.1: description grounded in concrete changes.]

**Implementation Details:**  
[Concrete steps, references to layers/modules, migrations, feature flags, etc.]

**Design Patterns / Data Structures:**  
[As above.]

**Acceptance Criteria:**  
[As above.]

[Continue 1.3, 1.4, etc. for Phase 1 work items…]

## Phase 2: [Phase Name]
**Goal:** [What this phase achieves and how it builds on Phase 1.]

### 2.1) [Work Item Title]
**Description:**  
[Concrete description tied to actual implementation work.]

**Implementation Details:**  
[Detailed steps; call out interaction with Phase 1 artifacts, data migrations, or refactors.]

**Design Patterns / Data Structures:**  
[Explicitly name patterns, structures, and relevant trade-offs.]

**Acceptance Criteria:**  
[Clear, testable conditions.]

[Continue with additional work items and phases as needed, up to 5 phases total.]

## Success Criteria
[Overall completion criteria that combine product outcomes and technical quality. Include:  
- Key user-visible behaviors that must work reliably.  
- Technical invariants that must hold (e.g., data consistency, performance targets, error budgets).  
- Testing and observability expectations (coverage for critical paths, metrics/alerts added, dashboards updated).  
- Any migration or rollout criteria (e.g., "old path fully deprecated", "no data loss during cutover").]`;

  let rawOutput: string;

  if (adapter instanceof StokedAdapter) {
    // We pass the raw output of the strategy to the adapter
    rawOutput = await adapter.generateImplementationPlan(productStrategy.rawOutput);
  } else {
    rawOutput = await adapter.prompt(prompt);
  }
  const validation = validateImplementationPlan(rawOutput);

  // Save to docs/projects/
  const filePath = await saveImplementationPlan(rawOutput, workingDirectory);

  return {
    title: extractTitle(rawOutput, 'Project Plan:'),
    rawOutput,
    validated: validation.valid,
    validationErrors: validation.errors,
    filePath,
  };
}

/**
 * Refine product strategy based on user feedback
 */
export async function refineProductStrategy(
  currentStrategy: ProductStrategy,
  feedback: string,
  adapter: LLMAdapter,
  _workingDirectory: string
): Promise<ProductStrategy> {
  const prompt = `You are a Staff-level Product Manager. Refine the following product strategy based on user feedback.

CURRENT STRATEGY:
${currentStrategy.rawOutput}

USER FEEDBACK:
${feedback}

Please update the strategy according to the feedback while maintaining the same format structure. Address all concerns raised and provide additional detail where requested.

Output the complete updated strategy in the same format.`;

  const rawOutput = await adapter.prompt(prompt);
  const validation = validateProductStrategy(rawOutput);

  return {
    title: extractTitle(rawOutput, 'Product Strategy:'),
    rawOutput,
    validated: validation.valid,
    validationErrors: validation.errors,
  };
}

/**
 * Refine implementation plan based on user feedback
 */
export async function refineImplementationPlan(
  productStrategy: ProductStrategy,
  currentPlan: ImplementationPlan,
  feedback: string,
  adapter: LLMAdapter,
  workingDirectory: string
): Promise<ImplementationPlan> {
  const prompt = `You are a senior staff-level software engineer. Refine the following implementation plan based on user feedback.

PRODUCT STRATEGY:
${productStrategy.rawOutput}

CURRENT IMPLEMENTATION PLAN:
${currentPlan.rawOutput}

USER FEEDBACK:
${feedback}

Please update the implementation plan according to the feedback while maintaining the same format structure. Address all technical concerns and provide additional implementation detail where requested.

Output the complete updated plan in the same format.`;

  const rawOutput = await adapter.prompt(prompt);
  const validation = validateImplementationPlan(rawOutput);

  // Update saved file
  const filePath = await saveImplementationPlan(rawOutput, workingDirectory);

  return {
    title: extractTitle(rawOutput, 'Project Plan:'),
    rawOutput,
    validated: validation.valid,
    validationErrors: validation.errors,
    filePath,
  };
}

/**
 * Helper: Run Claude with a prompt and return output
 */


/**
 * Helper: Extract title from markdown output
 */
function extractTitle(markdown: string, prefix: string): string {
  const match = markdown.match(new RegExp(`^#\\s*${prefix}\\s*(.+)$`, 'm'));
  return match ? match[1].trim() : 'Untitled';
}

/**
 * Helper: Validate product strategy output format
 */
function validateProductStrategy(output: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check for required sections
  const requiredSections = [
    '# Product Strategy:',
    '## 1. Problem Definition',
    '## 2. Target Users & Segments',
    '## 3. Hypotheses',
    '## 4. Success Metrics',
    '## 5. MVP Scope',
    '## 6. Key Product Decisions Required',
    '## 7. User Journeys and Behavior Loops',
    '## 8. Risks & Abuse Scenarios',
    '## 9. Rollout & Experiment Plan',
    '## 10. Post-Launch Evaluation Plan',
    '## 11. Future Expansion Roadmap',
  ];

  for (const section of requiredSections) {
    if (!output.includes(section)) {
      errors.push(`Missing required section: ${section}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Helper: Validate implementation plan output format
 */
function validateImplementationPlan(output: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check for required sections
  if (!output.includes('# Project Plan:')) {
    errors.push('Missing required header: # Project Plan:');
  }

  if (!output.includes('## Overview')) {
    errors.push('Missing required section: ## Overview');
  }

  if (!output.includes('## Phase 1:')) {
    errors.push('Missing required section: ## Phase 1:');
  }

  if (!output.includes('## Success Criteria')) {
    errors.push('Missing required section: ## Success Criteria');
  }

  // Check for work items with proper structure
  const hasWorkItems = /###\s+\d+\.\d+\)/m.test(output);
  if (!hasWorkItems) {
    errors.push('No work items found (expected format: ### 1.1) Title)');
  }

  // Check for implementation subsections in work items
  const hasImplementationDetails = output.includes('**Implementation Details:**');
  const hasDesignPatterns = output.includes('**Design Patterns / Data Structures:**');
  const hasAcceptanceCriteria = output.includes('**Acceptance Criteria:**');

  if (!hasImplementationDetails) {
    errors.push('Work items missing Implementation Details sections');
  }
  if (!hasDesignPatterns) {
    errors.push('Work items missing Design Patterns / Data Structures sections');
  }
  if (!hasAcceptanceCriteria) {
    errors.push('Work items missing Acceptance Criteria sections');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Helper: Save implementation plan to docs/projects/
 */
async function saveImplementationPlan(
  plan: string, // Changed from ImplementationPlan to string to match rawOutput
  workingDirectory: string
): Promise<string> {
  // Extract title for filename
  const title = extractTitle(plan, 'Project Plan:');
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50) || 'project-plan';

  // Ensure docs/projects directory exists
  const docsDir = join(workingDirectory, 'docs', 'projects');
  await fs.mkdir(docsDir, { recursive: true });

  const filename = `${new Date().toISOString().split('T')[0]}-${slug}.md`;
  const filePath = join(docsDir, filename);

  await fs.writeFile(filePath, plan, 'utf-8');

  return filePath;
}