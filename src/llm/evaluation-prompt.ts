/**
 * Prompt template for evaluating and classifying GitHub issues
 */

import { EvaluationPromptContext } from '../types/index.js';

export function buildEvaluationPrompt(context: EvaluationPromptContext): string {
  let relationshipSection = '';

  // Add parent context if available
  if (context.parentIssue) {
    relationshipSection += `
**Parent Issue:**
- **#${context.parentIssue.number}**: ${context.parentIssue.title} [${context.parentIssue.state}]
${context.parentIssue.body ? `  *Context*: ${context.parentIssue.body.slice(0, 300)}${context.parentIssue.body.length > 300 ? '...' : ''}` : ''}
`;
  }

  // Add child issues if this is a parent
  if (context.childIssues && context.childIssues.length > 0) {
    relationshipSection += `
**Child Issues/Subtasks:**
${context.childIssues.map((child) => `- [${child.completed ? 'x' : ' '}] #${child.number}: ${child.title} [${child.state}]`).join('\n')}
`;
  }

  // Add related issues
  if (context.relatedIssues && context.relatedIssues.length > 0) {
    relationshipSection += `
**Related Issues:**
${context.relatedIssues.map((rel) => `- #${rel.number}: ${rel.title} [${rel.state}] (${rel.relationshipType})`).join('\n')}
`;
  }

  // Add context flags
  if (context.isLikelyParent) {
    relationshipSection += `\n**Note**: This appears to be a **parent/epic issue** that tracks multiple sub-issues.`;
  } else if (context.isLikelyLeaf) {
    relationshipSection += `\n**Note**: This is a **leaf/implementation issue** with a parent issue for context.`;
  }

  return `You are an expert software architect and project manager evaluating GitHub issues for autonomous implementation.

**Issue Information:**
- **Number**: #${context.issueNumber}
- **Title**: ${context.issueTitle}
- **Author**: ${context.author}
- **Created**: ${context.createdAt}
- **Updated**: ${context.updatedAt}
- **Labels**: ${context.labels.length > 0 ? context.labels.join(', ') : 'None'}
- **Comments**: ${context.comments}

**Issue Body:**
${context.issueBody || '(No description provided)'}
${relationshipSection ? `\n---\n${relationshipSection}` : ''}

---

**Your Task:**
Analyze this issue and provide a structured evaluation in JSON format. Consider:
1. How well-defined is the issue? Are acceptance criteria clear?
2. What's the business impact and importance?
3. Can this be implemented with the information provided?
4. What's the estimated technical complexity?

**Using Relationship Context:**
- If this is a **parent/epic issue**: It likely coordinates child issues. It may be completable only after children are done. Evaluate based on whether it has a clear tracking structure and goals.
- If this is a **leaf/implementation issue**: Use the parent context to understand the broader goal. The parent provides important context about "why" even if this issue describes the specific "what".
- If there are **blocking relationships**: Consider whether blockers need to be resolved first. This affects feasibility.
- If there are **related issues**: Use them to understand the full picture and avoid evaluating in isolation.

**Response Format (RESPOND ONLY WITH JSON):**
\`\`\`json
{
  "classification": {
    "complexity": "medium",  // low, medium, high - Technical complexity assessment
    "impact": "high"  // low, medium, high, critical - Business impact assessment
  },
  "scores": {
    "clarity": 8,  // 1-10: How clear and well-defined (acceptance criteria, details)
    "importance": 7,  // 1-10: Business value, user impact, criticality
    "feasibility": 9  // 1-10: Can be implemented with provided information
  },
  "hasEnoughDetail": true,  // false if needs more info
  "reasoning": "This issue clearly defines the requirement to implement file upload functionality in the chat system. It has clear acceptance criteria, references specific files, and describes the expected behavior. The scope is well-bounded and implementable.",
  "suggestedQuestions": [],  // Array of questions to ask if hasEnoughDetail is false. Leave empty if true.
  "estimatedEffort": "4-8 hours"  // Rough estimate: "1-2 hours", "4-8 hours", "1-2 days", "2-5 days", "1-2 weeks"
}
\`\`\`

**Scoring Guidelines:**

**Clarity (1-10):**
- 1-3: Vague, no details, unclear what needs to be done
- 4-6: Some details but missing acceptance criteria or specifics
- 7-8: Well-defined with clear goals and context
- 9-10: Excellent detail, acceptance criteria, examples, and context

**Importance (1-10):**
- 1-3: Nice to have, low user impact
- 4-6: Moderate value, affects some users
- 7-8: Important feature or critical bug
- 9-10: Critical functionality, security issue, blocks other work

**Feasibility (1-10):**
- 1-3: Cannot be implemented without significant clarification
- 4-6: Can probably be done but needs some assumptions
- 7-8: Can be implemented with available information
- 9-10: Perfectly clear, all information provided

**hasEnoughDetail:**
- Set to false if feasibility < 6 or clarity < 5
- Set to true if there's enough information to start work

**suggestedQuestions:**
- Only include if hasEnoughDetail is false
- Ask specific, actionable questions that would help clarify the issue
- Focus on acceptance criteria, edge cases, and implementation details

Analyze the issue above and respond ONLY with the JSON object.`;
}
