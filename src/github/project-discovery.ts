/**
 * GitHub Projects v2 Auto-Discovery
 *
 * Automatically discovers projects linked to a repository.
 * Only requires manual GITHUB_PROJECT_ID when:
 * - Multiple projects are linked (disambiguation needed)
 * - No projects are linked (manual override)
 */

import { execSync } from 'child_process';
import {
  AUTONOMOUS_PROJECT_TEMPLATE,
  SingleSelectFieldDefinition,
} from './project-template.js';

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

  /**
   * Create a new GitHub Project v2
   *
   * @param title Project title
   * @returns Created project details
   */
  async createProject(title: string): Promise<DiscoveredProject> {
    // First, get the organization ID
    const orgQuery = `
      query {
        repository(owner: "${this.owner}", name: "${this.repo}") {
          owner {
            ... on Organization {
              id
            }
            ... on User {
              id
            }
          }
        }
      }
    `;

    let ownerId: string;
    try {
      const orgResult = execSync(`gh api graphql -f query='${orgQuery}'`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const orgData = JSON.parse(orgResult);
      ownerId = orgData.data?.repository?.owner?.id;

      if (!ownerId) {
        throw new Error('Could not determine repository owner ID');
      }
    } catch (error) {
      throw new Error(`Failed to get owner ID: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Create the project
    const createQuery = `
      mutation {
        createProjectV2(input: { ownerId: "${ownerId}", title: "${title.replace(/"/g, '\\"')}" }) {
          projectV2 {
            id
            number
            title
            url
          }
        }
      }
    `;

    let project: DiscoveredProject;
    try {
      const result = execSync(`gh api graphql -f query='${createQuery}'`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const data = JSON.parse(result);
      const projectData = data.data?.createProjectV2?.projectV2;

      if (!projectData) {
        throw new Error('Project creation returned no data');
      }

      project = {
        id: projectData.id,
        number: projectData.number,
        title: projectData.title,
        url: projectData.url,
      };
    } catch (error) {
      throw new Error(`Failed to create project: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Apply the Autonomous Project Template
    console.log('  Applying Autonomous Project Template...');
    await this.applyProjectTemplate(project.id);

    return project;
  }

  /**
   * Apply the Autonomous Project Template to a project
   * Creates all standard fields with their options
   */
  private async applyProjectTemplate(projectId: string): Promise<void> {
    const template = AUTONOMOUS_PROJECT_TEMPLATE;

    for (const field of template.fields) {
      try {
        if (field.type === 'SINGLE_SELECT') {
          await this.createSingleSelectField(projectId, field as SingleSelectFieldDefinition);
        } else if (field.type === 'TEXT') {
          await this.createTextField(projectId, field.name);
        } else if (field.type === 'NUMBER') {
          await this.createNumberField(projectId, field.name);
        }
        console.log(`    ✓ Created field: ${field.name}`);
      } catch (error) {
        // Field might already exist, continue
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('already exists') || message.includes('Name has already been taken')) {
          console.log(`    ⏭ Field already exists: ${field.name}`);
        } else {
          console.log(`    ⚠ Could not create field ${field.name}: ${message}`);
        }
      }
    }
  }

  /**
   * Create a single-select field with options
   */
  private async createSingleSelectField(
    projectId: string,
    field: SingleSelectFieldDefinition
  ): Promise<void> {
    // GitHub requires at least one option for SINGLE_SELECT fields
    // Skip creation if no options provided (e.g., Epic field that gets populated later)
    if (field.options.length === 0) {
      console.log(`    ⏭ Skipping field "${field.name}" - requires at least one option (will be created when needed)`);
      return;
    }

    // Create the field with options (description is now required by GitHub API)
    const createFieldMutation = `
      mutation {
        createProjectV2Field(input: {
          projectId: "${projectId}"
          dataType: SINGLE_SELECT
          name: "${field.name}"
          singleSelectOptions: [${field.options.map(opt =>
            `{ name: "${opt.name.replace(/"/g, '\\"')}", color: ${opt.color}, description: "${(opt.description || '').replace(/"/g, '\\"')}" }`
          ).join(', ')}]
        }) {
          projectV2Field {
            ... on ProjectV2SingleSelectField {
              id
              name
            }
          }
        }
      }
    `;

    execSync(`gh api graphql -f query='${createFieldMutation}'`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  /**
   * Create a text field
   */
  private async createTextField(projectId: string, fieldName: string): Promise<void> {
    const mutation = `
      mutation {
        createProjectV2Field(input: {
          projectId: "${projectId}"
          dataType: TEXT
          name: "${fieldName}"
        }) {
          projectV2Field {
            ... on ProjectV2Field {
              id
              name
            }
          }
        }
      }
    `;

    execSync(`gh api graphql -f query='${mutation}'`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  /**
   * Create a number field
   */
  private async createNumberField(projectId: string, fieldName: string): Promise<void> {
    const mutation = `
      mutation {
        createProjectV2Field(input: {
          projectId: "${projectId}"
          dataType: NUMBER
          name: "${fieldName}"
        }) {
          projectV2Field {
            ... on ProjectV2Field {
              id
              name
            }
          }
        }
      }
    `;

    execSync(`gh api graphql -f query='${mutation}'`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  /**
   * Link a project to this repository
   *
   * @param projectId Project ID to link
   */
  async linkProjectToRepo(projectId: string): Promise<void> {
    // Get repo node ID
    const repoQuery = `
      query {
        repository(owner: "${this.owner}", name: "${this.repo}") {
          id
        }
      }
    `;

    let repoId: string;
    try {
      const repoResult = execSync(`gh api graphql -f query='${repoQuery}'`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const repoData = JSON.parse(repoResult);
      repoId = repoData.data?.repository?.id;

      if (!repoId) {
        throw new Error('Could not get repository ID');
      }
    } catch (error) {
      throw new Error(`Failed to get repo ID: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Link the project to the repository
    const linkQuery = `
      mutation {
        linkProjectV2ToRepository(input: { projectId: "${projectId}", repositoryId: "${repoId}" }) {
          repository {
            id
          }
        }
      }
    `;

    try {
      execSync(`gh api graphql -f query='${linkQuery}'`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      throw new Error(`Failed to link project to repo: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
