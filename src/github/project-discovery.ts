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
      throw error;
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
      const stderr = (error as any)?.stderr?.toString?.() || '';
      const message = (error as Error)?.message || '';
      const combined = `${message}\n${stderr}`.trim();

      if (combined.includes('read:project')) {
        throw new Error(
          'GitHub CLI token is missing the read:project scope. Run `gh auth refresh -s read:project` (or re-auth with that scope) and retry.',
        );
      }

      throw new Error(
        `Failed to query linked projects via GitHub CLI. Ensure you are authenticated and have project access. Details: ${combined}`,
      );
    }
  }

  /**
   * Get organization-level projects (not linked to any specific repository)
   */
  async getOrganizationProjects(): Promise<DiscoveredProject[]> {
    const query = `
      query {
        organization(login: "${this.owner}") {
          projectsV2(first: 20) {
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
      const projects = data.data?.organization?.projectsV2?.nodes || [];

      return projects.map((p: any) => ({
        id: p.id,
        number: p.number,
        title: p.title,
        url: p.url,
      }));
    } catch (error) {
      // Organization query failed - might be a user account or permission issue
      return [];
    }
  }

  /**
   * Get a specific project by number from organization or repository
   */
  async getProjectByNumber(projectNumber: number): Promise<DiscoveredProject | null> {
    // Try organization project first
    const orgQuery = `
      query {
        organization(login: "${this.owner}") {
          projectV2(number: ${projectNumber}) {
            id
            number
            title
            url
          }
        }
      }
    `;

    try {
      const orgResult = execSync(`gh api graphql -f query='${orgQuery}'`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const orgData = JSON.parse(orgResult);
      const orgProject = orgData.data?.organization?.projectV2;

      if (orgProject) {
        return {
          id: orgProject.id,
          number: orgProject.number,
          title: orgProject.title,
          url: orgProject.url,
        };
      }
    } catch (error) {
      // Organization query failed - try repository project
    }

    // Try repository project
    const repoQuery = `
      query {
        repository(owner: "${this.owner}", name: "${this.repo}") {
          projectV2(number: ${projectNumber}) {
            id
            number
            title
            url
          }
        }
      }
    `;

    try {
      const repoResult = execSync(`gh api graphql -f query='${repoQuery}'`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const repoData = JSON.parse(repoResult);
      const repoProject = repoData.data?.repository?.projectV2;

      if (repoProject) {
        return {
          id: repoProject.id,
          number: repoProject.number,
          title: repoProject.title,
          url: repoProject.url,
        };
      }
    } catch (error) {
      // Repository query failed
    }

    return null;
  }

  /**
   * Get all projects: repo-linked first, then org-level (excluding duplicates)
   */
  async getAllProjects(): Promise<{
    repoLinked: DiscoveredProject[];
    orgLevel: DiscoveredProject[];
  }> {
    const repoLinked = await this.getLinkedProjects();
    const allOrgProjects = await this.getOrganizationProjects();

    // Filter out org projects that are already linked to this repo
    const linkedIds = new Set(repoLinked.map(p => p.id));
    const orgLevel = allOrgProjects.filter(p => !linkedIds.has(p.id));

    return { repoLinked, orgLevel };
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
          const existingField = await this.getFieldByName(projectId, field.name);
          if (existingField) {
            console.log(`    ⏭ Field already exists: ${field.name}`);
            await this.ensureSingleSelectOptions(projectId, existingField.id, field as SingleSelectFieldDefinition);
          } else {
            await this.createSingleSelectField(projectId, field as SingleSelectFieldDefinition);
            console.log(`    ✓ Created field: ${field.name}`);
          }
        } else if (field.type === 'TEXT') {
          await this.createTextField(projectId, field.name);
          console.log(`    ✓ Created field: ${field.name}`);
        } else if (field.type === 'NUMBER') {
          await this.createNumberField(projectId, field.name);
          console.log(`    ✓ Created field: ${field.name}`);
        }
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
   * Fetch a field by name (returns id and options if single-select)
   */
  private async getFieldByName(
    projectId: string,
    fieldName: string
  ): Promise<{ id: string; name: string; dataType: string; options?: Array<{ id: string; name: string; color?: string; description?: string }> } | null> {
    const query = `
      query {
        node(id: "${projectId}") {
          ... on ProjectV2 {
            fields(first: 50) {
              nodes {
                ... on ProjectV2Field {
                  id
                  name
                  dataType
                }
                ... on ProjectV2SingleSelectField {
                  id
                  name
                  dataType
                  options {
                    id
                    name
                    color
                    description
                  }
                }
              }
            }
          }
        }
      }
    `;

    const resultRaw = execSync(`gh api graphql -f query='${query}'`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const data = JSON.parse(resultRaw);
    const nodes = data.data?.node?.fields?.nodes || [];
    const match = nodes.find((f: any) => f.name === fieldName);
    return match || null;
  }

  /**
   * Ensure a single-select field has all required options (adds missing ones)
   */
  private async ensureSingleSelectOptions(
    projectId: string,
    fieldId: string,
    definition: SingleSelectFieldDefinition
  ): Promise<void> {
    // Fetch current options
    const field = await this.getFieldByName(projectId, definition.name);
    if (!field || field.dataType !== 'SINGLE_SELECT') {
      return;
    }

    const existingOptions: Array<{ id?: string; name: string; color?: string; description?: string }> =
      field.options || [];
    const existingNames = new Set(existingOptions.map((o) => o.name));

    const missing = definition.options.filter((opt) => !existingNames.has(opt.name));
    if (missing.length === 0) {
      return;
    }

    // Note: GitHub API doesn't accept 'id' field when updating options
    // Existing options are preserved by name, not by id
    const combinedOptions = [
      ...existingOptions.map((opt) => ({
        name: opt.name,
        color: opt.color || 'GRAY',
        description: opt.description || '',
      })),
      ...missing.map((opt) => ({
        name: opt.name,
        color: opt.color,
        description: opt.description || '',
      })),
    ];

    const optionsString = combinedOptions
      .map((opt) => {
        return `{ name: "${opt.name.replace(/"/g, '\\"')}", color: ${opt.color}, description: "${(opt.description || '').replace(/"/g, '\\"')}" }`;
      })
      .join(', ');

    const mutation = `
      mutation {
        updateProjectV2Field(input: {
          fieldId: "${fieldId}"
          name: "${definition.name}"
          singleSelectOptions: [${optionsString}]
        }) {
          projectV2Field {
            ... on ProjectV2SingleSelectField {
              id
              name
              options { id name }
            }
          }
        }
      }
    `;

    // Properly escape single quotes for shell by replacing ' with '"'"'
    const escapedMutation = mutation.replace(/'/g, "'\"'\"'");
    execSync(`gh api graphql -f query='${escapedMutation}'`, {
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

  /**
   * Update the title of a GitHub Project v2
   *
   * @param projectId The project's GraphQL ID
   * @param newTitle The new title for the project
   */
  async updateProjectTitle(projectId: string, newTitle: string): Promise<void> {
    const mutation = `
      mutation {
        updateProjectV2(input: { projectId: "${projectId}", title: "${newTitle.replace(/"/g, '\\"')}" }) {
          projectV2 {
            id
            title
          }
        }
      }
    `;

    try {
      execSync(`gh api graphql -f query='${mutation}'`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      throw new Error(`Failed to update project title: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Delete a GitHub Project
   */
  async deleteProject(projectId: string): Promise<void> {
    const mutation = `
      mutation {
        deleteProjectV2(input: { projectId: "${projectId}" }) {
          projectV2 {
            id
          }
        }
      }
    `;

    try {
      execSync(`gh api graphql -f query='${mutation}'`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      throw new Error(`Failed to delete project: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
