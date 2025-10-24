/**
 * GitHub Projects v2 API Client
 *
 * Uses GraphQL API via gh CLI for GitHub Projects v2 integration.
 * Implements ProjectAPI interface for conflict detection and sync.
 */

import { execSync } from 'child_process';
import { AssignmentStatus } from '../types/assignments.js';
import { ProjectAPI } from '../core/assignment-manager.js';
import { ProjectConfig } from '../types/config.js';

// Project field types
export interface ProjectField {
  id: string;
  name: string;
  dataType: 'SINGLE_SELECT' | 'TEXT' | 'NUMBER' | 'DATE' | 'ITERATION';
  options?: ProjectFieldOption[];
}

export interface ProjectFieldOption {
  id: string;
  name: string;
  color?: string;
  description?: string;
}

export interface ProjectItem {
  id: string;
  content: {
    number: number;
    title: string;
    state: string;
    url: string;
  };
  fieldValues: Record<string, any>;
}

export interface ProjectItemsQueryResult {
  items: ProjectItem[];
  totalCount: number;
  hasNextPage: boolean;
  endCursor?: string;
}

/**
 * Status field value mapping
 * Maps autonomous AssignmentStatus to project Status field values
 */
const STATUS_MAPPING: Record<AssignmentStatus, string> = {
  'assigned': 'Ready',        // Just assigned, ready to work
  'in-progress': 'In Progress', // LLM is working
  'llm-complete': 'In Review',  // LLM done, awaiting PR review
  'merged': 'Done',             // PR merged
};

/**
 * Reverse mapping for reading from project
 */
const REVERSE_STATUS_MAPPING: Record<string, AssignmentStatus> = {
  'Ready': 'assigned',
  'Todo': 'assigned',          // Also treat Todo as assigned
  'In Progress': 'in-progress',
  'In Review': 'llm-complete',
  'Done': 'merged',
  'Blocked': 'in-progress',    // Keep as in-progress but user should handle
};

export class GitHubProjectsAPI implements ProjectAPI {
  private projectId: string;
  private config: ProjectConfig;
  private fieldCache: Map<string, ProjectField> = new Map();
  private fieldIdCache: Map<string, string> = new Map();

  constructor(projectId: string, config: ProjectConfig) {
    this.projectId = projectId;
    this.config = config;
  }

  /**
   * Execute a GraphQL query via gh CLI
   */
  private async graphql<T = any>(query: string, variables?: Record<string, any>): Promise<T> {
    try {
      const variablesFlag = variables ? `-F ${Object.entries(variables).map(([k, v]) => `${k}=${v}`).join(' -F ')}` : '';

      const result = execSync(
        `gh api graphql -f query='${query.replace(/'/g, "'\\''")}' ${variablesFlag}`,
        { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
      );

      const data = JSON.parse(result);

      if (data.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
      }

      return data.data as T;
    } catch (error) {
      throw new Error(
        `GraphQL query failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get all fields for the project (with caching)
   */
  async getFields(): Promise<ProjectField[]> {
    if (this.fieldCache.size > 0) {
      return Array.from(this.fieldCache.values());
    }

    const query = `
      query {
        node(id: "${this.projectId}") {
          ... on ProjectV2 {
            fields(first: 20) {
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
                ... on ProjectV2IterationField {
                  id
                  name
                  dataType
                  configuration {
                    iterations {
                      id
                      title
                      startDate
                      duration
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const result = await this.graphql<{
      node: {
        fields: {
          nodes: any[];
        };
      };
    }>(query);

    const fields: ProjectField[] = result.node.fields.nodes.map((field: any) => ({
      id: field.id,
      name: field.name,
      dataType: field.dataType,
      options: field.options || field.configuration?.iterations,
    }));

    // Cache fields
    fields.forEach((field) => {
      this.fieldCache.set(field.name, field);
      this.fieldIdCache.set(field.name, field.id);
    });

    return fields;
  }

  /**
   * Get field ID by name (with caching)
   */
  async getFieldId(fieldName: string): Promise<string | null> {
    if (this.fieldIdCache.has(fieldName)) {
      return this.fieldIdCache.get(fieldName)!;
    }

    // Load fields to populate cache
    await this.getFields();

    return this.fieldIdCache.get(fieldName) || null;
  }

  /**
   * Get field option ID by field name and option name
   */
  async getFieldOptionId(fieldName: string, optionName: string): Promise<string | null> {
    const field = this.fieldCache.get(fieldName) || (await this.getFields()).find(f => f.name === fieldName);

    if (!field || !field.options) {
      return null;
    }

    const option = field.options.find((opt) => opt.name === optionName);
    return option?.id || null;
  }

  /**
   * Get project item ID for an issue
   */
  async getProjectItemId(issueNumber: number): Promise<string | null> {
    const query = `
      query {
        node(id: "${this.projectId}") {
          ... on ProjectV2 {
            items(first: 100) {
              nodes {
                id
                content {
                  ... on Issue {
                    number
                  }
                }
              }
            }
          }
        }
      }
    `;

    const result = await this.graphql<{
      node: {
        items: {
          nodes: Array<{
            id: string;
            content: { number?: number };
          }>;
        };
      };
    }>(query);

    const item = result.node.items.nodes.find((i) => i.content?.number === issueNumber);
    return item?.id || null;
  }

  /**
   * Get the Status field value for a project item
   */
  async getItemStatus(projectItemId: string): Promise<AssignmentStatus> {
    const statusFieldId = await this.getFieldId(this.config.fields.status.fieldName);

    if (!statusFieldId) {
      throw new Error(`Status field "${this.config.fields.status.fieldName}" not found in project`);
    }

    const query = `
      query {
        node(id: "${projectItemId}") {
          ... on ProjectV2Item {
            fieldValueByName(name: "${this.config.fields.status.fieldName}") {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
              }
            }
          }
        }
      }
    `;

    const result = await this.graphql<{
      node: {
        fieldValueByName: {
          name: string;
        } | null;
      };
    }>(query);

    const statusValue = result.node.fieldValueByName?.name;

    if (!statusValue) {
      // Default to assigned if no status set
      return 'assigned';
    }

    // Map project status to AssignmentStatus
    return REVERSE_STATUS_MAPPING[statusValue] || 'assigned';
  }

  /**
   * Update the Status field value for a project item
   */
  async updateItemStatus(projectItemId: string, status: AssignmentStatus): Promise<void> {
    const statusFieldId = await this.getFieldId(this.config.fields.status.fieldName);

    if (!statusFieldId) {
      throw new Error(`Status field "${this.config.fields.status.fieldName}" not found in project`);
    }

    // Map AssignmentStatus to project status value
    const projectStatusValue = STATUS_MAPPING[status];

    // Get option ID for the status value
    const optionId = await this.getFieldOptionId(
      this.config.fields.status.fieldName,
      projectStatusValue
    );

    if (!optionId) {
      throw new Error(`Status option "${projectStatusValue}" not found in project`);
    }

    const mutation = `
      mutation {
        updateProjectV2ItemFieldValue(input: {
          projectId: "${this.projectId}"
          itemId: "${projectItemId}"
          fieldId: "${statusFieldId}"
          value: {
            singleSelectOptionId: "${optionId}"
          }
        }) {
          projectV2Item {
            id
          }
        }
      }
    `;

    await this.graphql(mutation);
  }

  /**
   * Query project items with filters
   */
  async queryItems(filters?: {
    status?: string[];
    limit?: number;
    cursor?: string;
  }): Promise<ProjectItemsQueryResult> {
    const limit = filters?.limit || 100;
    const afterClause = filters?.cursor ? `, after: "${filters.cursor}"` : '';

    const query = `
      query {
        node(id: "${this.projectId}") {
          ... on ProjectV2 {
            items(first: ${limit}${afterClause}) {
              totalCount
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                id
                content {
                  ... on Issue {
                    number
                    title
                    state
                    url
                  }
                }
                fieldValues(first: 20) {
                  nodes {
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      field {
                        ... on ProjectV2SingleSelectField {
                          name
                        }
                      }
                      name
                    }
                    ... on ProjectV2ItemFieldTextValue {
                      field {
                        ... on ProjectV2Field {
                          name
                        }
                      }
                      text
                    }
                    ... on ProjectV2ItemFieldNumberValue {
                      field {
                        ... on ProjectV2Field {
                          name
                        }
                      }
                      number
                    }
                    ... on ProjectV2ItemFieldIterationValue {
                      field {
                        ... on ProjectV2IterationField {
                          name
                        }
                      }
                      title
                      startDate
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const result = await this.graphql<{
      node: {
        items: {
          totalCount: number;
          pageInfo: {
            hasNextPage: boolean;
            endCursor: string;
          };
          nodes: any[];
        };
      };
    }>(query);

    const items: ProjectItem[] = result.node.items.nodes
      .filter((node) => node.content) // Filter out items without content (e.g., draft issues)
      .map((node) => {
        const fieldValues: Record<string, any> = {};

        node.fieldValues.nodes.forEach((fv: any) => {
          const fieldName = fv.field?.name;
          if (fieldName) {
            if (fv.name !== undefined) {
              fieldValues[fieldName] = fv.name; // Single select
            } else if (fv.text !== undefined) {
              fieldValues[fieldName] = fv.text; // Text
            } else if (fv.number !== undefined) {
              fieldValues[fieldName] = fv.number; // Number
            } else if (fv.title !== undefined) {
              fieldValues[fieldName] = {
                title: fv.title,
                startDate: fv.startDate,
              }; // Iteration
            }
          }
        });

        return {
          id: node.id,
          content: {
            number: node.content.number,
            title: node.content.title,
            state: node.content.state,
            url: node.content.url,
          },
          fieldValues,
        };
      });

    // Filter by status if specified
    let filteredItems = items;
    if (filters?.status && filters.status.length > 0) {
      const statusFieldName = this.config.fields.status.fieldName;
      filteredItems = items.filter((item) =>
        filters.status!.includes(item.fieldValues[statusFieldName])
      );
    }

    return {
      items: filteredItems,
      totalCount: result.node.items.totalCount,
      hasNextPage: result.node.items.pageInfo.hasNextPage,
      endCursor: result.node.items.pageInfo.endCursor,
    };
  }

  /**
   * Get all "ready" items (based on config)
   */
  async getReadyItems(): Promise<ProjectItem[]> {
    const result = await this.queryItems({
      status: this.config.fields.status.readyValues,
    });

    return result.items;
  }

  /**
   * Get items in a specific sprint/iteration
   */
  async getItemsBySprint(sprintTitle: string): Promise<ProjectItem[]> {
    const result = await this.queryItems({
      limit: 100,
    });

    // Filter by sprint field
    const sprintFieldName = this.config.fields.sprint?.fieldName;
    if (!sprintFieldName) {
      return [];
    }

    return result.items.filter(item => {
      const sprint = item.fieldValues[sprintFieldName];
      return sprint && sprint.title === sprintTitle;
    });
  }

  /**
   * Get items in current sprint
   */
  async getCurrentSprintItems(): Promise<ProjectItem[]> {
    const currentSprint = this.config.fields.sprint?.currentSprint;
    if (!currentSprint) {
      return [];
    }

    return this.getItemsBySprint(currentSprint);
  }

  /**
   * Get all sprints/iterations in the project
   */
  async getAllSprints(): Promise<Array<{id: string, title: string, startDate: string, duration?: number}>> {
    const result = await this.queryItems({
      limit: 100,
    });

    const sprintFieldName = this.config.fields.sprint?.fieldName;
    if (!sprintFieldName) {
      return [];
    }

    // Extract unique sprints
    const sprintsMap = new Map<string, any>();
    result.items.forEach(item => {
      const sprint = item.fieldValues[sprintFieldName];
      if (sprint && sprint.id) {
        sprintsMap.set(sprint.id, sprint);
      }
    });

    return Array.from(sprintsMap.values());
  }

  /**
   * Get field value for a project item
   */
  async getItemFieldValue(projectItemId: string, fieldName: string): Promise<any> {
    const query = `
      query {
        node(id: "${projectItemId}") {
          ... on ProjectV2Item {
            fieldValueByName(name: "${fieldName}") {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
              }
              ... on ProjectV2ItemFieldTextValue {
                text
              }
              ... on ProjectV2ItemFieldNumberValue {
                number
              }
              ... on ProjectV2ItemFieldIterationValue {
                title
                startDate
              }
            }
          }
        }
      }
    `;

    const result = await this.graphql<{
      node: {
        fieldValueByName: any;
      };
    }>(query);

    const fieldValue = result.node.fieldValueByName;

    if (!fieldValue) {
      return null;
    }

    // Return the appropriate value based on type
    if (fieldValue.name !== undefined) return fieldValue.name;
    if (fieldValue.text !== undefined) return fieldValue.text;
    if (fieldValue.number !== undefined) return fieldValue.number;
    if (fieldValue.title !== undefined) {
      return {
        title: fieldValue.title,
        startDate: fieldValue.startDate,
      };
    }

    return null;
  }

  /**
   * Update a single-select field value
   */
  async updateItemFieldValue(
    projectItemId: string,
    fieldName: string,
    value: string
  ): Promise<void> {
    const fieldId = await this.getFieldId(fieldName);

    if (!fieldId) {
      throw new Error(`Field "${fieldName}" not found in project`);
    }

    const optionId = await this.getFieldOptionId(fieldName, value);

    if (!optionId) {
      throw new Error(`Option "${value}" not found for field "${fieldName}"`);
    }

    const mutation = `
      mutation {
        updateProjectV2ItemFieldValue(input: {
          projectId: "${this.projectId}"
          itemId: "${projectItemId}"
          fieldId: "${fieldId}"
          value: {
            singleSelectOptionId: "${optionId}"
          }
        }) {
          projectV2Item {
            id
          }
        }
      }
    `;

    await this.graphql(mutation);
  }

  /**
   * Update a text field value
   */
  async updateItemTextField(
    projectItemId: string,
    fieldName: string,
    value: string | null
  ): Promise<void> {
    const fieldId = await this.getFieldId(fieldName);

    if (!fieldId) {
      throw new Error(`Field "${fieldName}" not found in project`);
    }

    const mutation = `
      mutation {
        updateProjectV2ItemFieldValue(input: {
          projectId: "${this.projectId}"
          itemId: "${projectItemId}"
          fieldId: "${fieldId}"
          value: {
            text: ${value ? `"${value.replace(/"/g, '\\"')}"` : 'null'}
          }
        }) {
          projectV2Item {
            id
          }
        }
      }
    `;

    await this.graphql(mutation);
  }

  /**
   * Update assigned instance field (text or single-select)
   * Auto-detects field type and uses appropriate update method
   */
  async updateAssignedInstance(
    projectItemId: string,
    instanceId: string | null
  ): Promise<void> {
    const fieldName = this.config.fields.assignedInstance?.fieldName;
    if (!fieldName) {
      // Field not configured, skip silently
      return;
    }

    const fields = await this.getFields();
    const field = fields.find((f) => f.name === fieldName);

    if (!field) {
      console.warn(`Assigned instance field "${fieldName}" not found in project`);
      return;
    }

    // Handle based on field type
    if (field.dataType === 'TEXT') {
      await this.updateItemTextField(projectItemId, fieldName, instanceId);
    } else if (field.dataType === 'SINGLE_SELECT') {
      // For single-select, the instanceId must match an existing option
      if (instanceId) {
        await this.updateItemFieldValue(projectItemId, fieldName, instanceId);
      } else {
        // Cannot clear single-select fields directly, would need to implement clearFieldValue
        console.warn(`Cannot clear single-select field "${fieldName}"`);
      }
    } else {
      throw new Error(
        `Field "${fieldName}" has unsupported type ${field.dataType} for assigned instance tracking`
      );
    }
  }

  /**
   * Ensure autonomous view exists with all required fields
   * Creates view via browser automation if it doesn't exist
   */
  async ensureAutonomousView(claudeConfig?: { cliPath: string; cliArgs?: string[] }): Promise<void> {
    const viewName = 'Autonomous';

    // Check if view exists
    const query = `
      query {
        node(id: "${this.projectId}") {
          ... on ProjectV2 {
            number
            url
            views(first: 20) {
              nodes {
                id
                name
              }
            }
          }
        }
      }
    `;

    const result = await this.graphql<{
      node: {
        number: number;
        url: string;
        views: {
          nodes: Array<{ id: string; name: string }>;
        };
      };
    }>(query);

    const existingView = result.node.views.nodes.find(v => v.name === viewName);

    if (existingView) {
      console.log(`✓ Found existing "${viewName}" view`);
      return;
    }

    // View doesn't exist - try to create it via browser automation
    console.log(`\n📊 Creating "${viewName}" view via browser automation...`);

    try {
      await this.createViewViaBrowser(result.node.url, viewName, claudeConfig);
      console.log(`✓ Created "${viewName}" view successfully`);
    } catch (error) {
      console.warn(`⚠️  Could not auto-create "${viewName}" view`);
      console.log(`   Error: ${error instanceof Error ? error.message : String(error)}`);
      console.log('\n📋 To create the view manually:');
      console.log(`   1. Open: ${result.node.url}`);
      console.log('   2. Click the + button next to view tabs');
      console.log(`   3. Name it "${viewName}"`);
      console.log('   4. The system will work with any view!\n');
    }
  }

  /**
   * Create a project view via Claude + MCP browser automation
   */
  private async createViewViaBrowser(
    projectUrl: string,
    viewName: string,
    claudeConfig?: { cliPath: string; cliArgs?: string[] }
  ): Promise<void> {
    const { execSync } = await import('child_process');
    const readline = await import('readline');
    const { promises: fs } = await import('fs');
    const { tmpdir } = await import('os');
    const { join } = await import('path');

    // Build Claude CLI command with config
    const claudePath = claudeConfig?.cliPath || 'claude';
    const claudeArgs = claudeConfig?.cliArgs || [];
    const claudeCommand = `${claudePath} ${claudeArgs.join(' ')} chat`.trim();

    console.log('\n🤖 Using Claude to create the view via browser automation...\n');

    // Step 1: Navigate and check login status
    // Note: Claude's MCP browser tools will reuse existing browser session if open
    const checkLoginPrompt = `Please use MCP browser tools to navigate to ${projectUrl}.

The browser tools will reuse any existing browser session if one is already open.

Once you navigate to the page, check if you can see the GitHub project or if login is required.

If you see a login page, respond with exactly: NEED LOGIN FROM USER
If you can see the project content, respond with: READY TO CREATE VIEW`;

    const checkLoginFile = join(tmpdir(), 'claude-check-login.txt');
    await fs.writeFile(checkLoginFile, checkLoginPrompt, 'utf-8');

    console.log('🔍 Opening project in browser (or reusing existing session)...');
    let response = execSync(`cat "${checkLoginFile}" | ${claudeCommand}`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024
    });

    // Check if login needed
    if (response.includes('NEED LOGIN FROM USER')) {
      console.log('\n⏸️  GitHub login required!');
      console.log('   A browser window should be open. Please log into GitHub there.');
      console.log('   (If you\'re already logged in another tab, just switch to that profile)');
      console.log('   Press ENTER when you\'re logged in and can see the project...\n');

      // Wait for user
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      await new Promise<void>((resolve) => {
        rl.on('line', () => {
          rl.close();
          resolve();
        });
      });
    }

    // Step 2: Create the view with ALL fields we read or write
    console.log('🎨 Creating the view with all fields...');

    const requiredFields = [
      'Title',
      'Assignees',
      'Labels',
      this.config.fields.status.fieldName,
      this.config.fields.priority?.fieldName,
      this.config.fields.size?.fieldName,
      this.config.fields.sprint?.fieldName,
      this.config.fields.assignedInstance?.fieldName,
      'Area',  // Read by field mapper
      'Work Type',  // Read by field mapper
      'Target Date',
      'Effort',
      'Milestone',
      'Repository',
    ].filter(Boolean);

    const createViewPrompt = `You should now be on the GitHub project page at ${projectUrl}.

Please create a new view called "${viewName}" with all the required fields by following these steps:

1. Look for the view tabs at the top of the project (usually shows "View 1" or similar)
2. Click the + button next to the tabs
3. In the dialog that appears:
   - Enter the name "${viewName}"
   - Select "Table" layout
4. Click "Create" or "Save"
5. Once the view is created, you need to add these fields to the view:
   ${requiredFields.map(f => `   - ${f}`).join('\n')}

   To add fields:
   - Look for the "+" button in the table header or a "Fields" or "Customize" option
   - Click it to open the field selector
   - Select each of the fields listed above
   - Make sure they're all visible in the table

Once all fields are added and visible, respond with: VIEW CREATED SUCCESSFULLY

If there are any errors, describe what went wrong.`;

    const createViewFile = join(tmpdir(), 'claude-create-view.txt');
    await fs.writeFile(createViewFile, createViewPrompt, 'utf-8');

    response = execSync(`cat "${createViewFile}" | ${claudeCommand}`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024
    });

    if (response.includes('VIEW CREATED SUCCESSFULLY')) {
      console.log('✓ View created successfully!\n');
    } else {
      console.log('⚠️  View creation response:', response);
      throw new Error('View creation may have failed - please check the browser');
    }
  }

  /**
   * Clear field cache (useful for testing or when fields change)
   */
  clearCache(): void {
    this.fieldCache.clear();
    this.fieldIdCache.clear();
  }
}
