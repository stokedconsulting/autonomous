/**
 * GitHub API Client
 */

import { Octokit } from '@octokit/rest';
import {
  GitHubIssue,
  GitHubPullRequest,
  GitHubCIStatus,
  GitHubRepository,
  CreatePROptions,
  MergePROptions,
} from '../types/index.js';
import { IssueRelationshipParser } from '../utils/issue-relationship-parser.js';

export class GitHubAPI {
  private octokit: Octokit;
  private owner: string;
  private repo: string;

  constructor(token: string, owner: string, repo: string) {
    this.octokit = new Octokit({ auth: token });
    this.owner = owner;
    this.repo = repo;
  }

  /**
   * Get repository information
   */
  async getRepository(): Promise<GitHubRepository> {
    const { data } = await this.octokit.repos.get({
      owner: this.owner,
      repo: this.repo,
    });

    return {
      name: data.name,
      fullName: data.full_name,
      owner: {
        login: data.owner.login,
        id: data.owner.id,
        avatarUrl: data.owner.avatar_url,
        htmlUrl: data.owner.html_url,
      },
      private: data.private,
      htmlUrl: data.html_url,
      defaultBranch: data.default_branch,
    };
  }

  /**
   * Get issues with optional filters
   */
  async getIssues(filters?: {
    state?: 'open' | 'closed' | 'all';
    labels?: string[];
    assignee?: string;
  }): Promise<GitHubIssue[]> {
    // Build query parameters - only include labels if array has items
    const queryParams: any = {
      owner: this.owner,
      repo: this.repo,
      state: filters?.state || 'open',
      per_page: 100,
    };

    // Only add labels filter if there are actually labels to filter by
    if (filters?.labels && filters.labels.length > 0) {
      queryParams.labels = filters.labels.join(',');
    }

    if (filters?.assignee) {
      queryParams.assignee = filters.assignee;
    }

    const { data } = await this.octokit.issues.listForRepo(queryParams);

    return data
      .filter((issue) => !issue.pull_request) // Filter out PRs
      .map((issue) => this.mapIssue(issue));
  }

  /**
   * Get a single issue
   */
  async getIssue(issueNumber: number): Promise<GitHubIssue> {
    const { data } = await this.octokit.issues.get({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
    });

    return this.mapIssue(data);
  }

  /**
   * Create a pull request
   */
  async createPullRequest(options: CreatePROptions): Promise<GitHubPullRequest> {
    const { data } = await this.octokit.pulls.create({
      owner: this.owner,
      repo: this.repo,
      title: options.title,
      body: options.body,
      head: options.head,
      base: options.base,
      draft: options.draft,
    });

    return this.mapPullRequest(data);
  }

  /**
   * Get a pull request
   */
  async getPullRequest(prNumber: number): Promise<GitHubPullRequest> {
    const { data } = await this.octokit.pulls.get({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
    });

    return this.mapPullRequest(data);
  }

  /**
   * Update a pull request
   */
  async updatePullRequest(
    prNumber: number,
    updates: { title?: string; body?: string; state?: 'open' | 'closed' }
  ): Promise<GitHubPullRequest> {
    const { data } = await this.octokit.pulls.update({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
      ...updates,
    });

    return this.mapPullRequest(data);
  }

  /**
   * Merge a pull request
   */
  async mergePullRequest(options: MergePROptions): Promise<void> {
    await this.octokit.pulls.merge({
      owner: this.owner,
      repo: this.repo,
      pull_number: options.prNumber,
      commit_title: options.commitTitle,
      commit_message: options.commitMessage,
      merge_method: options.mergeMethod || 'merge',
      sha: options.sha,
    });
  }

  /**
   * Get CI status for a commit
   */
  async getCommitStatus(ref: string): Promise<GitHubCIStatus> {
    const { data } = await this.octokit.repos.getCombinedStatusForRef({
      owner: this.owner,
      repo: this.repo,
      ref,
    });

    return {
      state: data.state as 'pending' | 'success' | 'failure' | 'error',
      totalCount: data.total_count,
      statuses: data.statuses.map((status) => ({
        id: status.id,
        state: status.state as 'pending' | 'success' | 'failure' | 'error',
        description: status.description || null,
        targetUrl: status.target_url || null,
        context: status.context,
        createdAt: status.created_at,
        updatedAt: status.updated_at,
      })),
    };
  }

  /**
   * Get check runs for a commit (GitHub Actions)
   */
  async getCheckRuns(ref: string): Promise<{
    totalCount: number;
    conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'timed_out' | 'action_required' | null;
  }> {
    const { data } = await this.octokit.checks.listForRef({
      owner: this.owner,
      repo: this.repo,
      ref,
    });

    // Determine overall conclusion
    let conclusion: GitHubCIStatus['state'] = 'success';
    if (data.check_runs.some((run) => run.status === 'in_progress' || run.status === 'queued')) {
      conclusion = 'pending';
    } else if (data.check_runs.some((run) => run.conclusion === 'failure')) {
      conclusion = 'failure';
    } else if (data.check_runs.some((run) => run.conclusion === 'action_required')) {
      conclusion = 'error';
    }

    return {
      totalCount: data.total_count,
      conclusion: conclusion as any,
    };
  }

  /**
   * Comment on an issue
   */
  async createComment(issueNumber: number, body: string): Promise<string> {
    const response = await this.octokit.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      body,
    });
    return response.data.html_url;
  }

  /**
   * Get all comments for an issue
   */
  async getComments(issueNumber: number): Promise<Array<{ id: number; body: string; user: { login: string } }>> {
    const response = await this.octokit.issues.listComments({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
    });

    return response.data.map((comment) => ({
      id: comment.id,
      body: comment.body || '',
      user: {
        login: comment.user?.login || 'unknown',
      },
    }));
  }

  /**
   * Delete a comment by ID
   */
  async deleteComment(commentId: number): Promise<void> {
    await this.octokit.issues.deleteComment({
      owner: this.owner,
      repo: this.repo,
      comment_id: commentId,
    });
  }

  /**
   * Add labels to an issue
   */
  async addLabels(issueNumber: number, labels: string[]): Promise<void> {
    await this.octokit.issues.addLabels({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      labels,
    });
  }

  /**
   * Remove a label from an issue
   */
  async removeLabel(issueNumber: number, label: string): Promise<void> {
    await this.octokit.issues.removeLabel({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      name: label,
    });
  }

  /**
   * Get files changed in a pull request
   */
  async getPullRequestFiles(prNumber: number): Promise<Array<{ filename: string; status: string }>> {
    const { data } = await this.octokit.pulls.listFiles({
      owner: this.owner,
      repo: this.repo,
      pull_number: prNumber,
      per_page: 100,
    });

    return data.map(file => ({
      filename: file.filename,
      status: file.status,
    }));
  }

  /**
   * Close an issue
   */
  async closeIssue(issueNumber: number): Promise<void> {
    await this.octokit.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      state: 'closed',
    });
  }

  /**
   * Assign users to an issue
   */
  async assignIssue(issueNumber: number, assignees: string[]): Promise<void> {
    await this.octokit.issues.addAssignees({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      assignees,
    });
  }

  /**
   * Get issue with full relationship context
   */
  async getIssueWithContext(issueNumber: number, depth: number = 1): Promise<{
    issue: GitHubIssue;
    relatedIssues: Map<number, GitHubIssue>;
  }> {
    const issue = await this.getIssue(issueNumber);
    const relatedIssues = new Map<number, GitHubIssue>();

    if (depth > 0 && issue.relationships) {
      // Fetch all related issues
      const relatedNumbers = new Set<number>();

      issue.relationships.forEach((rel) => {
        relatedNumbers.add(rel.issueNumber);
      });

      // Fetch related issues in parallel
      const fetches = Array.from(relatedNumbers).map(async (num) => {
        try {
          const related = await this.getIssue(num);
          relatedIssues.set(num, related);
        } catch (error) {
          // Issue might not exist or be inaccessible
          console.warn(`Could not fetch related issue #${num}`);
        }
      });

      await Promise.all(fetches);

      // If depth > 1, recursively fetch parent's context
      if (depth > 1 && issue.parentIssue) {
        try {
          const parentContext = await this.getIssueWithContext(issue.parentIssue, depth - 1);
          // Add parent and its related issues
          relatedIssues.set(issue.parentIssue, parentContext.issue);
          parentContext.relatedIssues.forEach((relatedIssue, num) => {
            relatedIssues.set(num, relatedIssue);
          });
        } catch (error) {
          console.warn(`Could not fetch parent issue #${issue.parentIssue}`);
        }
      }
    }

    return { issue, relatedIssues };
  }

  /**
   * Map GitHub API issue to our type
   */
  private mapIssue(issue: any): GitHubIssue {
    // Parse relationships from issue body
    const parsed = IssueRelationshipParser.parse(issue.body, issue.number);

    return {
      number: issue.number,
      title: issue.title,
      body: issue.body,
      state: issue.state,
      labels: issue.labels.map((label: any) => ({
        id: label.id,
        name: label.name,
        color: label.color,
        description: label.description,
      })),
      assignees: issue.assignees.map((user: any) => ({
        login: user.login,
        id: user.id,
        avatarUrl: user.avatar_url,
        htmlUrl: user.html_url,
      })),
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      htmlUrl: issue.html_url,
      user: {
        login: issue.user.login,
        id: issue.user.id,
        avatarUrl: issue.user.avatar_url,
        htmlUrl: issue.user.html_url,
      },
      // Relationship fields
      relationships: parsed.relationships,
      parentIssue: parsed.parent,
      childIssues: parsed.children,
    };
  }

  /**
   * Map GitHub API PR to our type
   */
  private mapPullRequest(pr: any): GitHubPullRequest {
    return {
      number: pr.number,
      title: pr.title,
      body: pr.body,
      state: pr.state,
      draft: pr.draft,
      merged: pr.merged,
      mergedAt: pr.merged_at,
      htmlUrl: pr.html_url,
      head: {
        ref: pr.head.ref,
        sha: pr.head.sha,
      },
      base: {
        ref: pr.base.ref,
        sha: pr.base.sha,
      },
      user: {
        login: pr.user.login,
        id: pr.user.id,
        avatarUrl: pr.user.avatar_url,
        htmlUrl: pr.user.html_url,
      },
    };
  }
}
