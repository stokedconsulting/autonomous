import { GitHubAPI } from '../github/api.js';

export interface FailedReviewFeedback {
  body: string;
  createdAt: string;
}

/**
 * Get the most recent failed review comment for an issue.
 * Looks for review worker comments that include the "Code Review: FAILED" header.
 */
export async function getLatestFailedReviewFeedback(
  githubAPI: GitHubAPI,
  issueNumber: number
): Promise<FailedReviewFeedback | null> {
  const comments = await githubAPI.getComments(issueNumber);

  const failedComments = comments
    .filter((comment) => /code review:\s*failed/i.test(comment.body))
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

  if (failedComments.length === 0) {
    return null;
  }

  const latest = failedComments[0];
  return {
    body: latest.body.trim(),
    createdAt: latest.created_at,
  };
}
