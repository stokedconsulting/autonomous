/**
 * ConflictResolver - Uses Claude to automatically resolve merge conflicts
 */

import { $ } from 'zx';
import { promises as fs } from 'fs';
import { join } from 'path';
import chalk from 'chalk';

export interface ConflictResolutionResult {
  success: boolean;
  resolvedFiles: string[];
  error?: string;
}

export class ConflictResolver {
  private projectPath: string;
  private claudePath: string;

  constructor(projectPath: string, claudePath: string = 'claude') {
    this.projectPath = projectPath;
    this.claudePath = claudePath;
  }

  /**
   * Resolve merge conflicts using Claude
   */
  async resolveConflicts(conflictFiles: string[], context: {
    branchName: string;
    issueNumber: number;
    issueTitle: string;
  }): Promise<ConflictResolutionResult> {
    const resolvedFiles: string[] = [];

    try {
      for (const file of conflictFiles) {
        const resolved = await this.resolveFile(file, context);
        if (resolved) {
          resolvedFiles.push(file);
        } else {
          return {
            success: false,
            resolvedFiles,
            error: `Failed to resolve conflicts in ${file}`,
          };
        }
      }

      return {
        success: true,
        resolvedFiles,
      };
    } catch (error) {
      return {
        success: false,
        resolvedFiles,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Resolve conflicts in a single file
   */
  private async resolveFile(filePath: string, context: {
    branchName: string;
    issueNumber: number;
    issueTitle: string;
  }): Promise<boolean> {
    $.cwd = this.projectPath;
    $.verbose = false;

    try {
      const fullPath = join(this.projectPath, filePath);

      // Read the conflicted file
      const conflictedContent = await fs.readFile(fullPath, 'utf-8');

      // Build prompt for Claude
      const prompt = this.buildResolutionPrompt(filePath, conflictedContent, context);

      // Save prompt to temporary file
      const tempPromptFile = join(this.projectPath, '.autonomous', 'conflict-resolution-prompt.txt');
      await fs.writeFile(tempPromptFile, prompt, 'utf-8');

      // Call Claude to resolve
      console.log(chalk.blue(`  Resolving conflicts in ${filePath}...`));

      // Use Claude in chat mode with the file
      const result = await $`${this.claudePath} chat --file ${fullPath} < ${tempPromptFile}`;

      // Claude should output the resolved content
      // Parse the response to extract the resolved file content
      const resolvedContent = this.extractResolvedContent(result.stdout);

      if (!resolvedContent) {
        console.error(chalk.red(`  Failed to extract resolved content for ${filePath}`));
        return false;
      }

      // Write the resolved content back to the file
      await fs.writeFile(fullPath, resolvedContent, 'utf-8');

      // Stage the resolved file
      await $`git add ${filePath}`;

      console.log(chalk.green(`  ✓ Resolved ${filePath}`));
      return true;
    } catch (error) {
      console.error(chalk.red(`  Failed to resolve ${filePath}:`), error);
      return false;
    }
  }

  /**
   * Build prompt for Claude to resolve conflicts
   */
  private buildResolutionPrompt(filePath: string, conflictedContent: string, context: {
    branchName: string;
    issueNumber: number;
    issueTitle: string;
  }): string {
    return `You are helping resolve merge conflicts in a file during automated code integration.

**Context:**
- File: ${filePath}
- Feature Branch: ${context.branchName}
- Issue: #${context.issueNumber} - ${context.issueTitle}
- Integration Branch: merge_stage (based on main)

**Task:**
The file below contains merge conflict markers (<<<<<<< HEAD, =======, >>>>>>>).

Your goal is to resolve the conflicts by:
1. Understanding what the feature branch is trying to accomplish (related to issue #${context.issueNumber})
2. Preserving the intent of both the main branch (HEAD) and the feature branch
3. Creating a clean, conflict-free version that combines both changes intelligently
4. Maintaining code quality and consistency

**Conflict Resolution Strategy:**
- If both changes are additive (new features), keep both
- If there's a clear override (feature replaces old code), use the feature version
- If there's ambiguity, prefer the feature branch (it's the new work)
- Maintain consistent formatting and style
- Preserve all imports, types, and dependencies from both sides

**Output Format:**
Respond with ONLY the complete, resolved file content. No explanations, no markdown code blocks, just the raw file content.
Start your response with the exact first line of the file, and end with the exact last line.

**File with Conflicts:**

${conflictedContent}

**Resolved File (output only the resolved content):**`;
  }

  /**
   * Extract resolved content from Claude's response
   */
  private extractResolvedContent(claudeOutput: string): string | null {
    // Claude should output the resolved content directly
    // Remove any potential markdown code blocks if present
    let content = claudeOutput.trim();

    // Remove markdown code blocks if present
    const codeBlockRegex = /```(?:[\w]+)?\n([\s\S]*?)\n```/;
    const match = content.match(codeBlockRegex);
    if (match) {
      content = match[1];
    }

    // Verify there are no conflict markers left
    if (content.includes('<<<<<<<') || content.includes('>>>>>>>') || content.includes('=======')) {
      return null;
    }

    return content;
  }

  /**
   * Check if Claude CLI is available
   */
  async isClaudeAvailable(): Promise<boolean> {
    try {
      await $`which ${this.claudePath}`;
      return true;
    } catch {
      return false;
    }
  }
}
