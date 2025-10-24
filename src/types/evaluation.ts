/**
 * Types for issue evaluation and prioritization
 *
 * SYNC STRATEGY:
 * - AI-only fields: Cached here (clarity, importance, feasibility, complexity, impact)
 * - Project fields: Read fresh from project, never cached (Priority, Area, Issue Type, Size, Sprint)
 * - Hybrid: AI priority score cached for comparison, but project Priority is source of truth
 */

export type Complexity = 'low' | 'medium' | 'high';
export type Impact = 'low' | 'medium' | 'high' | 'critical';

export interface IssueClassification {
  // NOTE: Area and Issue Type removed - read from project fields instead (Phase 0)
  // AI assessments (not in project)
  complexity: Complexity;  // AI's technical complexity assessment (different from project Size)
  impact: Impact;          // AI's business impact assessment (informs project Priority)

  // Deprecated fields (kept for backward compatibility with old cached evaluations)
  types?: string[];  // DEPRECATED: Now read from project "Issue Type" field
  area?: string | null;  // DEPRECATED: Now read from project "Area" field
}

export interface IssueScores {
  clarity: number;       // 1-10: How well-defined is the issue (AI-only)
  importance: number;    // 1-10: Business value and impact (AI-only)
  feasibility: number;   // 1-10: Can it be implemented with available info (AI-only)
  aiPriorityScore: number;  // Calculated AI score (30% weight in hybrid prioritization)

  // Deprecated fields (kept for backward compatibility with old cached evaluations)
  priority?: number;  // DEPRECATED: Renamed to aiPriorityScore
}

export interface IssueEvaluation {
  issueNumber: number;
  issueTitle: string;
  lastModified: string; // ISO date from GitHub
  lastEvaluated: string; // ISO date when we evaluated
  contentHash: string; // Hash of title, body, labels - used to detect actual content changes
  classification: IssueClassification;
  scores: IssueScores;
  hasEnoughDetail: boolean;
  reasoning: string; // Why this score/classification
  suggestedQuestions?: string[]; // Questions to add if detail lacking
  estimatedEffort?: string; // e.g., "2-4 hours", "1-2 days"
}

export interface EvaluationCache {
  version: string;
  projectName: string;
  lastUpdated: string;
  evaluations: Record<number, IssueEvaluation>; // key is issue number
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
