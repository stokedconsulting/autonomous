/**
 * Issue Relationship Parser
 * Extracts parent/child and dependency relationships from issue bodies
 */

import { IssueRelationship } from '../types/index.js';

export interface ParsedRelationships {
  parent?: number;
  children: number[];
  relationships: IssueRelationship[];
}

export class IssueRelationshipParser {
  /**
   * Parse all relationships from an issue body
   */
  static parse(issueBody: string | null, issueNumber: number): ParsedRelationships {
    if (!issueBody) {
      return { children: [], relationships: [] };
    }

    const relationships: IssueRelationship[] = [];
    let parent: number | undefined;
    const childrenSet = new Set<number>();

    // 1. Parse tasklists (most common pattern for sub-issues)
    const tasklistRefs = this.parseTasklists(issueBody);
    tasklistRefs.forEach((ref) => {
      childrenSet.add(ref.issueNumber);
      relationships.push(ref);
    });

    // 2. Parse keyword relationships
    const keywordRefs = this.parseKeywords(issueBody);
    keywordRefs.forEach((ref) => {
      if (ref.type === 'parent') {
        parent = ref.issueNumber;
      } else if (ref.type === 'child' || ref.type === 'subtask') {
        childrenSet.add(ref.issueNumber);
      }
      relationships.push(ref);
    });

    // 3. Parse general issue references (for context)
    const generalRefs = this.parseIssueReferences(issueBody);
    generalRefs.forEach((refNum) => {
      // Only add if not already categorized
      const exists = relationships.some((r) => r.issueNumber === refNum);
      if (!exists && refNum !== issueNumber) {
        relationships.push({
          type: 'related',
          issueNumber: refNum,
          source: 'body-reference',
        });
      }
    });

    return {
      parent,
      children: Array.from(childrenSet),
      relationships,
    };
  }

  /**
   * Parse tasklist items
   * Patterns: - [ ] #123, - [x] #123, * [ ] #123
   */
  private static parseTasklists(body: string): IssueRelationship[] {
    const relationships: IssueRelationship[] = [];
    const tasklistPattern = /^[\s]*[-*]\s*\[([ xX])\]\s*#(\d+)(?:\s*[-:]?\s*(.+?))?$/gm;

    let match;
    while ((match = tasklistPattern.exec(body)) !== null) {
      const completed = match[1].toLowerCase() === 'x';
      const issueNumber = parseInt(match[2], 10);
      const title = match[3]?.trim();

      relationships.push({
        type: 'subtask',
        issueNumber,
        issueTitle: title,
        completed,
        source: 'tasklist',
      });
    }

    return relationships;
  }

  /**
   * Parse keyword-based relationships
   * Patterns: Parent: #123, Depends on: #45, Blocks: #67, Related to: #89
   */
  private static parseKeywords(body: string): IssueRelationship[] {
    const relationships: IssueRelationship[] = [];

    const patterns = [
      { regex: /parent(?:\s+issue)?:\s*#(\d+)/gi, type: 'parent' as const },
      { regex: /child(?:\s+issue)?s?:\s*#(\d+)/gi, type: 'child' as const },
      { regex: /sub-?task(?:s)?:\s*#(\d+)/gi, type: 'subtask' as const },
      { regex: /depends\s+on:\s*#(\d+)/gi, type: 'blocked-by' as const },
      { regex: /blocks:\s*#(\d+)/gi, type: 'blocks' as const },
      { regex: /blocked\s+by:\s*#(\d+)/gi, type: 'blocked-by' as const },
      { regex: /related\s+to:\s*#(\d+)/gi, type: 'related' as const },
    ];

    patterns.forEach(({ regex, type }) => {
      let match;
      while ((match = regex.exec(body)) !== null) {
        relationships.push({
          type,
          issueNumber: parseInt(match[1], 10),
          source: 'keyword',
        });
      }
    });

    return relationships;
  }

  /**
   * Parse all issue number references
   * Pattern: #123
   */
  private static parseIssueReferences(body: string): number[] {
    const references = new Set<number>();
    const pattern = /#(\d+)/g;

    let match;
    while ((match = pattern.exec(body)) !== null) {
      references.add(parseInt(match[1], 10));
    }

    return Array.from(references);
  }

  /**
   * Determine if an issue is likely a parent/epic based on content
   */
  static isLikelyParent(issueBody: string | null, issueTitle: string): boolean {
    if (!issueBody) return false;

    // Check for common parent/epic indicators
    const epicIndicators = [
      /^#{1,3}\s*epic/im,
      /^#{1,3}\s*parent/im,
      /^#{1,3}\s*overview/im,
      /task\s*list:/i,
      /sub-?tasks?:/i,
      /implementation\s+plan:/i,
    ];

    const titleIndicators = [
      /epic:/i,
      /parent:/i,
      /\[epic\]/i,
      /\[parent\]/i,
    ];

    // Check body for indicators
    const hasBodyIndicator = epicIndicators.some((regex) => regex.test(issueBody));

    // Check title for indicators
    const hasTitleIndicator = titleIndicators.some((regex) => regex.test(issueTitle));

    // Check if it has multiple tasklist items (likely parent)
    const tasklistCount = (issueBody.match(/^[\s]*[-*]\s*\[[ xX]\]\s*#\d+/gm) || []).length;
    const hasMultipleSubtasks = tasklistCount >= 2;

    return hasBodyIndicator || hasTitleIndicator || hasMultipleSubtasks;
  }

  /**
   * Determine if an issue is likely a leaf/implementation issue
   */
  static isLikelyLeaf(parsedRelationships: ParsedRelationships): boolean {
    // Has a parent but no children
    return !!parsedRelationships.parent && parsedRelationships.children.length === 0;
  }
}
