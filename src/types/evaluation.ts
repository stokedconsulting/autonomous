/**
 * Types for issue evaluation and prioritization
 *
 * On-demand AI evaluation of issues to assess:
 * - Technical complexity and business impact
 * - Clarity, importance, and feasibility scores
 * - AI priority score for intelligent work assignment
 */

export type Complexity = 'low' | 'medium' | 'high';
export type Impact = 'low' | 'medium' | 'high' | 'critical';

export interface IssueClassification {
  // AI assessments
  complexity: Complexity;  // AI's technical complexity assessment (different from project Size)
  impact: Impact;          // AI's business impact assessment (informs project Priority)
  priority?: string;       // AI-suggested priority (🔴 Critical, 🟠 High, 🟡 Medium, 🟢 Low)
  area?: string;           // AI-suggested area (Frontend, Backend, WebRTC, Infrastructure, Database, DevOps, Documentation)
  workType?: string;       // AI-suggested work type (✨ Feature, 🐛 Bug, 🔧 Enhancement, ♻️ Refactor, 📝 Docs, 🧹 Chore)
}

export interface IssueScores {
  clarity: number;       // 1-10: How well-defined is the issue
  importance: number;    // 1-10: Business value and impact
  feasibility: number;   // 1-10: Can it be implemented with available info
  aiPriorityScore: number;  // Calculated AI score (30% weight in hybrid prioritization)
}

export interface IssueEvaluation {
  issueNumber: number;
  issueTitle: string;
  lastModified: string; // ISO date from GitHub
  lastEvaluated: string; // ISO date when we evaluated
  classification: IssueClassification;
  scores: IssueScores;
  hasEnoughDetail: boolean;
  reasoning: string; // Why this score/classification
  suggestedQuestions?: string[]; // Questions to add if detail lacking
  estimatedEffort?: string; // e.g., "2-4 hours", "1-2 days"
}

export interface RelatedIssueContext {
  number: number;
  title: string;
  state: 'open' | 'closed';
  relationshipType: 'parent' | 'child' | 'blocks' | 'blocked-by' | 'related' | 'subtask';
  completed?: boolean;
  body?: string | null;
}

export interface EvaluationPromptContext {
  issueNumber: number;
  issueTitle: string;
  issueBody: string | null;
  labels: string[];
  createdAt: string;
  updatedAt: string;
  author: string;
  comments: number;
  // Relationship context
  parentIssue?: RelatedIssueContext;
  childIssues?: RelatedIssueContext[];
  relatedIssues?: RelatedIssueContext[];
  isLikelyParent?: boolean;
  isLikelyLeaf?: boolean;
}
