/**
 * GitHub Projects v2 Auto-Discovery
 *
 * Automatically discovers projects linked to a repository.
 * Only requires manual GITHUB_PROJECT_ID when:
 * - Multiple projects are linked (disambiguation needed)
 * - No projects are linked (manual override)
 */

import { execSync } from 'child_process';

export interface DiscoveredProject {
  id: string;
  number: number;
  title: string;
  url: string;
}

export class ProjectDiscovery {
  private owner: string;
  private repo: string;

  constructor(owner: string, repo: string) {
    this.owner = owner;
    this.repo = repo;
  }

  /**
   * Auto-discover project linked to this repository
   * Returns project ID if exactly one project found, null otherwise
   */
  async discoverProject(): Promise<DiscoveredProject | null> {
    try {
      const projects = await this.getLinkedProjects();

      if (projects.length === 0) {
        return null; // No projects linked
      }

      if (projects.length === 1) {
        return projects[0]; // Exactly one project - use it!
      }

      // Multiple projects - cannot auto-discover
      return null;
    } catch (error) {
      console.error('Error discovering projects:', error);
      return null;
    }
  }

  /**
   * Get all projects linked to this repository
   */
  async getLinkedProjects(): Promise<DiscoveredProject[]> {
    // Query repository's linked projects
    const query = `
      query {
        repository(owner: "${this.owner}", name: "${this.repo}") {
          projectsV2(first: 10) {
            nodes {
              id
              number
              title
              url
            }
          }
        }
      }
    `;

    try {
      const result = execSync(`gh api graphql -f query='${query}'`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const data = JSON.parse(result);
      const projects = data.data?.repository?.projectsV2?.nodes || [];

      return projects.map((p: any) => ({
        id: p.id,
        number: p.number,
        title: p.title,
        url: p.url,
      }));
    } catch (error) {
      // GraphQL query failed - might be permissions or no projects
      return [];
    }
  }

  /**
   * Resolve project ID with auto-discovery and fallback
   *
   * Priority:
   * 1. GITHUB_PROJECT_ID env var (if set)
   * 2. Single linked project (auto-discovered)
   * 3. Error with helpful message
   */
  async resolveProjectId(envProjectId?: string): Promise<{
    projectId: string | null;
    source: 'env' | 'auto-discovered' | 'none';
    message?: string;
  }> {
    // 1. Check environment variable first (explicit override)
    if (envProjectId) {
      return {
        projectId: envProjectId,
        source: 'env',
        message: 'Using project from GITHUB_PROJECT_ID environment variable',
      };
    }

    // 2. Try auto-discovery
    const discovered = await this.discoverProject();

    if (discovered) {
      return {
        projectId: discovered.id,
        source: 'auto-discovered',
        message: `Auto-discovered project: "${discovered.title}" (#${discovered.number})`,
      };
    }

    // 3. Check if multiple projects exist
    const allProjects = await this.getLinkedProjects();

    if (allProjects.length > 1) {
      const projectList = allProjects
        .map(p => `  - #${p.number}: ${p.title} (${p.id})`)
        .join('\n');

      return {
        projectId: null,
        source: 'none',
        message:
          `Multiple projects found. Set GITHUB_PROJECT_ID to specify which one:\n${projectList}\n\n` +
          `Example: export GITHUB_PROJECT_ID="${allProjects[0].id}"`,
      };
    }

    // 4. No projects found
    return {
      projectId: null,
      source: 'none',
      message:
        'No projects linked to this repository.\n' +
        'Either:\n' +
        '  1. Link a project to this repository in GitHub\n' +
        '  2. Set GITHUB_PROJECT_ID to use an organization project\n\n' +
        'To link a project: Go to your repo → Projects tab → Link a project',
    };
  }
}
