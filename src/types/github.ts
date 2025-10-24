/**
 * GitHub API and issue-related types
 */

export interface IssueRelationship {
  type: 'parent' | 'child' | 'blocks' | 'blocked-by' | 'related' | 'subtask';
  issueNumber: number;
  issueTitle?: string;
  completed?: boolean;
  source: 'tasklist' | 'body-reference' | 'keyword' | 'timeline';
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  labels: GitHubLabel[];
  assignees: GitHubUser[];
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  user: GitHubUser;
  // Relationship tracking
  relationships?: IssueRelationship[];
  parentIssue?: number;
  childIssues?: number[];
}

export interface GitHubLabel {
  id: number;
  name: string;
  color: string;
  description: string | null;
}

export interface GitHubUser {
  login: string;
  id: number;
  avatarUrl: string;
  htmlUrl: string;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  draft: boolean;
  merged: boolean;
  mergedAt: string | null;
  htmlUrl: string;
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
    sha: string;
  };
  user: GitHubUser;
}

export interface GitHubCIStatus {
  state: 'pending' | 'success' | 'failure' | 'error';
  statuses: GitHubStatusCheck[];
  totalCount: number;
}

export interface GitHubStatusCheck {
  id: number;
  state: 'pending' | 'success' | 'failure' | 'error';
  description: string | null;
  targetUrl: string | null;
  context: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePROptions {
  title: string;
  body: string;
  head: string;
  base: string;
  draft?: boolean;
}

export interface MergePROptions {
  prNumber: number;
  commitTitle?: string;
  commitMessage?: string;
  mergeMethod?: 'merge' | 'squash' | 'rebase';
  sha?: string;
}

export interface GitHubRepository {
  name: string;
  fullName: string;
  owner: GitHubUser;
  private: boolean;
  htmlUrl: string;
  defaultBranch: string;
}

// Alias for backwards compatibility
export type Issue = GitHubIssue;
