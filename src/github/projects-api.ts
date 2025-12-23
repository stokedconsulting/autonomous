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
  'assigned': 'Todo',              // Just assigned, ready to work
  'in-progress': 'In Progress',    // LLM is working
  'in-review': 'In Review',        // PR created, awaiting review
  'dev-complete': 'Dev Complete',  // Dev work done, awaiting merge worker
  'merge-review': 'Merge Review',  // Merge worker reviewing changes
  'stage-ready': 'Stage Ready',    // Merged to stage, ready for main
  'merged': 'Done',                // Merged to main
};

/**
 * Reverse mapping for reading from project
 *
 * IMPORTANT: This is ONLY for syncing status of ALREADY ASSIGNED issues.
 * Pre-assignment statuses (Todo, Evaluated) are NOT included
 * because they represent "assignable" issues, not assigned ones.
 */
const REVERSE_STATUS_MAPPING: Record<string, AssignmentStatus> = {
  'In Progress': 'in-progress',    // Actively being worked on by LLM
  'In Review': 'in-review',        // PR created, awaiting review
  'Dev Complete': 'dev-complete',  // Dev work done, awaiting merge worker
  'Merge Review': 'merge-review',  // Merge worker reviewing changes
  'Stage Ready': 'stage-ready',    // Merged to stage, ready for main
  'Done': 'merged',                // Merged to main, completed
};

/**
 * Export reverse mapping for use by AssignmentManager
 */
export { REVERSE_STATUS_MAPPING };

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
   * Uses pagination to search through all items
   */
  async getProjectItemId(issueNumber: number): Promise<string | null> {
    let hasNextPage = true;
    let cursor: string | undefined = undefined;

    while (hasNextPage) {
      const afterClause: string = cursor ? `, after: "${cursor}"` : '';

      const query: string = `
        query {
          node(id: "${this.projectId}") {
            ... on ProjectV2 {
              items(first: 100${afterClause}) {
                pageInfo {
                  hasNextPage
                  endCursor
                }
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
            pageInfo: {
              hasNextPage: boolean;
              endCursor: string;
            };
            nodes: Array<{
              id: string;
              content: { number?: number };
            }>;
          };
        };
      }>(query);

      // Check if issue is in this page
      const item = result.node.items.nodes.find((i) => i.content?.number === issueNumber);
      if (item) {
        return item.id;
      }

      // Move to next page
      hasNextPage = result.node.items.pageInfo.hasNextPage;
      cursor = result.node.items.pageInfo.endCursor;
    }

    return null;
  }

  /**
   * Get the Status field value for a project item
   *
   * Returns null for unmapped statuses:
   * - Pre-assignment: Todo, Ready, Backlog, Evaluated (assignable but not assigned yet)
   * - Blocked: Needs More Info
   */
  async getItemStatus(projectItemId: string): Promise<AssignmentStatus | null> {
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
      // No status set - treat as assignable
      return null;
    }

    // Map project status to AssignmentStatus
    // Returns null for unmapped statuses (pre-assignment states, blocked states)
    return REVERSE_STATUS_MAPPING[statusValue] || null;
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
   * Update the Status field to a specific value (by name)
   * This is used for evaluation statuses like "Evaluated" or "Needs More Info"
   */
  async updateItemStatusByValue(projectItemId: string, statusValue: string): Promise<void> {
    const statusFieldId = await this.getFieldId(this.config.fields.status.fieldName);

    if (!statusFieldId) {
      throw new Error(`Status field "${this.config.fields.status.fieldName}" not found in project`);
    }

    // Get option ID for the status value
    const optionId = await this.getFieldOptionId(
      this.config.fields.status.fieldName,
      statusValue
    );

    if (!optionId) {
      throw new Error(`Status option "${statusValue}" not found in project. Please add it to the Status field options.`);
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
   * Get project item ID for an issue number
   * Returns null if the issue is not in the project
   *
   * This method delegates to getProjectItemId() to ensure pagination is used.
   */
  async getProjectItemIdByIssue(issueNumber: number): Promise<string | null> {
    return this.getProjectItemId(issueNumber);
  }

  /**
   * Query project items with filters
   */
  async queryItems(filters?: {
    status?: string[];
    limit?: number;
    cursor?: string;
    includeNoStatus?: boolean; // If true, include items with no status set
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
      filteredItems = items.filter((item) => {
        const statusValue = item.fieldValues[statusFieldName];

        // If includeNoStatus is true, include items with no status OR matching status
        if (filters.includeNoStatus) {
          return !statusValue || filters.status!.includes(statusValue);
        }

        // Otherwise, include ONLY if status matches one of the desired statuses
        return statusValue && filters.status!.includes(statusValue);
      });
    }

    return {
      items: filteredItems,
      totalCount: result.node.items.totalCount,
      hasNextPage: result.node.items.pageInfo.hasNextPage,
      endCursor: result.node.items.pageInfo.endCursor,
    };
  }

  /**
   * Get ALL items from the project with pagination
   * Fetches all pages automatically
   * Public method for use by Orchestrator and other components
   */
  async getAllItems(filters?: {
    status?: string[];
    includeNoStatus?: boolean;
  }): Promise<ProjectItem[]> {
    const allItems: ProjectItem[] = [];
    let hasNextPage = true;
    let cursor: string | undefined = undefined;

    while (hasNextPage) {
      const result = await this.queryItems({
        ...filters,
        limit: 100,
        cursor,
      });

      allItems.push(...result.items);
      hasNextPage = result.hasNextPage;
      cursor = result.endCursor;
    }

    return allItems;
  }

  /**
   * Get all "ready" items (based on config)
   * Includes items with status: Ready, Todo, Evaluated, Failed Review, and NO STATUS
   * Items with no status are considered ready to start
   * Paginates through ALL items to ensure nothing is missed
   */
  async getReadyItems(): Promise<ProjectItem[]> {
    const readyStatuses = [
      ...this.config.fields.status.readyValues,
      this.config.fields.status.evaluatedValue,
    ];

    return this.getAllItems({
      status: readyStatuses,
      includeNoStatus: true, // Items with no status are ready to start
    });
  }

  /**
   * Get items in a specific sprint/iteration
   * Paginates through ALL items to ensure complete sprint coverage
   */
  async getItemsBySprint(sprintTitle: string): Promise<ProjectItem[]> {
    const sprintFieldName = this.config.fields.sprint?.fieldName;
    if (!sprintFieldName) {
      return [];
    }

    // Get ALL items with pagination
    const allItems = await this.getAllItems();

    // Filter by sprint field
    return allItems.filter(item => {
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
   * Paginates through ALL items to discover all sprints
   */
  async getAllSprints(): Promise<Array<{id: string, title: string, startDate: string, duration?: number}>> {
    const sprintFieldName = this.config.fields.sprint?.fieldName;
    if (!sprintFieldName) {
      return [];
    }

    // Get ALL items with pagination
    const allItems = await this.getAllItems();

    // Extract unique sprints
    const sprintsMap = new Map<string, any>();
    allItems.forEach(item => {
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
   * Ensure a text field exists in the project, creating it if necessary
   */
  async ensureTextField(fieldName: string): Promise<string> {
    // Check if field already exists
    const existingFieldId = await this.getFieldId(fieldName);
    if (existingFieldId) {
      return existingFieldId;
    }

    // Create the field
    console.log(`  Creating "${fieldName}" text field in project...`);
    const mutation = `
      mutation {
        createProjectV2Field(input: {
          projectId: "${this.projectId}"
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

    const result = await this.graphql<{
      createProjectV2Field: {
        projectV2Field: {
          id: string;
          name: string;
        };
      };
    }>(mutation);

    const newFieldId = result.createProjectV2Field.projectV2Field.id;

    // Update caches
    this.fieldIdCache.set(fieldName, newFieldId);
    this.fieldCache.set(fieldName, {
      id: newFieldId,
      name: fieldName,
      dataType: 'TEXT',
    });

    console.log(`  ✓ Created "${fieldName}" field`);
    return newFieldId;
  }

  /**
   * Update a text field value
   */
  async updateItemTextField(
    projectItemId: string,
    fieldName: string,
    value: string | null
  ): Promise<void> {
    // Ensure field exists before trying to update
    const fieldId = await this.ensureTextField(fieldName);

    if (!fieldId) {
      throw new Error(`Field "${fieldName}" not found in project and could not be created`);
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
   * Update a number field on a project item
   */
  async updateItemNumberField(
    projectItemId: string,
    fieldName: string,
    value: number | null
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
            number: ${value !== null ? value : 'null'}
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
   * Get a single-select field value
   */
  async getItemSelectFieldValue(
    projectItemId: string,
    fieldName: string
  ): Promise<string | null> {
    const query = `
      query {
        node(id: "${projectItemId}") {
          ... on ProjectV2Item {
            fieldValueByName(name: "${fieldName}") {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
              }
            }
          }
        }
      }
    `;

    try {
      const result = await this.graphql<{
        node: {
          fieldValueByName: {
            name: string;
          } | null;
        };
      }>(query);

      return result.node.fieldValueByName?.name || null;
    } catch (error) {
      return null;
    }
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

    // Check if Complexity and Impact fields exist
    await this.ensureComplexityImpactFields();

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
   * Create a project view via Playwright browser automation
   */
  private async createViewViaBrowser(
    projectUrl: string,
    viewName: string,
    _claudeConfig?: { cliPath: string; cliArgs?: string[] }
  ): Promise<void> {
    const { chromium } = await import('playwright');
    const readline = await import('readline');
    const { homedir } = await import('os');
    const { join } = await import('path');

    console.log('\n🤖 Using Playwright to create the view...\n');

    // Launch browser with user data dir to preserve login
    const userDataDir = join(homedir(), '.autonomous', 'browser-profile');
    const browser = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      viewport: { width: 1280, height: 720 },
    });

    const page = await browser.newPage();

    try {
      console.log('🔍 Navigating to project...');
      await page.goto(projectUrl, { waitUntil: 'networkidle' });

      // Check if login required
      const isLoginPage = await page.locator('input[name="login"], input[name="password"]').count() > 0;

      if (isLoginPage) {
        console.log('\n⏸️  GitHub login required!');
        console.log('   Please log into GitHub in the browser window.');
        console.log('   Press ENTER when you\'re logged in and can see the project...\n');

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

        // Reload page after login
        await page.reload({ waitUntil: 'networkidle' });
      }

      console.log('🎨 Creating view with all fields...');

      // Click the + button to create new view
      const newViewButton = page.locator('button[aria-label*="New view"], button:has-text("New view"), [data-testid="new-view-button"]').first();
      await newViewButton.click();
      await page.waitForTimeout(500);

      // Enter view name
      const nameInput = page.locator('input[placeholder*="View name"], input[name="name"]').first();
      await nameInput.fill(viewName);

      // Select Table layout if prompted
      const tableOption = page.locator('button:has-text("Table"), [role="radio"]:has-text("Table")').first();
      if (await tableOption.count() > 0) {
        await tableOption.click();
      }

      // Click Create/Save
      const createButton = page.locator('button:has-text("Create"), button:has-text("Save")').first();
      await createButton.click();
      await page.waitForTimeout(1000);

      console.log('✓ View created, now adding fields...');

      // Add all required fields
      const requiredFields = [
        'Title',
        'Assignees',
        'Labels',
        this.config.fields.complexity?.fieldName || 'Complexity',
        this.config.fields.impact?.fieldName || 'Impact',
        this.config.fields.status.fieldName,
        this.config.fields.priority?.fieldName,
        this.config.fields.size?.fieldName,
        this.config.fields.sprint?.fieldName,
        this.config.fields.assignedInstance?.fieldName,
        'Area',
        'Work Type',
        'Target Date',
        'Effort',
        'Milestone',
        'Repository',
      ].filter(Boolean);

      // Look for field customization button (+ or Fields button)
      const fieldsButton = page.locator('button:has-text("Fields"), button[aria-label*="Fields"], button[aria-label*="column"]').first();
      if (await fieldsButton.count() > 0) {
        await fieldsButton.click();
        await page.waitForTimeout(500);

        // Select each field
        for (const field of requiredFields) {
          const fieldCheckbox = page.locator(`[role="checkbox"]:near(:text("${field}")), label:has-text("${field}")`).first();
          if (await fieldCheckbox.count() > 0) {
            await fieldCheckbox.click();
            await page.waitForTimeout(100);
          }
        }

        // Close field selector
        const closeButton = page.locator('button:has-text("Done"), button:has-text("Close"), button[aria-label="Close"]').first();
        if (await closeButton.count() > 0) {
          await closeButton.click();
        }
      }

      console.log('✓ View created successfully!\n');

    } finally {
      await browser.close();
    }
  }

  /**
   * Ensure Complexity, Impact, and Assigned Instance fields exist in the project
   */
  async ensureComplexityImpactFields(): Promise<void> {
    const fields = await this.getFields();

    const complexityFieldName = this.config.fields.complexity?.fieldName || 'Complexity';
    const impactFieldName = this.config.fields.impact?.fieldName || 'Impact';
    const assignedInstanceFieldName = this.config.fields.assignedInstance?.fieldName || 'Assigned Instance';

    const complexityField = fields.find(f => f.name === complexityFieldName);
    const impactField = fields.find(f => f.name === impactFieldName);
    const assignedInstanceField = fields.find(f => f.name === assignedInstanceFieldName);

    if (!complexityField) {
      console.log(`⚠️  ${complexityFieldName} field not found in project.`);
      console.log(`   Please create a "${complexityFieldName}" single-select field with options: Low, Medium, High`);
    }

    if (!impactField) {
      console.log(`⚠️  ${impactFieldName} field not found in project.`);
      console.log(`   Please create an "${impactFieldName}" single-select field with options: Low, Medium, High`);
    }

    if (!assignedInstanceField) {
      console.log(`⚠️  ${assignedInstanceFieldName} field not found in project.`);
      console.log(`   Please create a "${assignedInstanceFieldName}" TEXT field to track which LLM instance is working on each issue.`);
      console.log(`   This is CRITICAL for preventing duplicate work!`);
    }
  }

  /**
   * Parse complexity and impact from issue labels
   * Labels like "complexity:high" become { complexity: "High" }
   */
  private parseComplexityImpactLabels(labels: Array<{ name: string }>): {
    complexity?: string;
    impact?: string;
    typeLabels: string[];
  } {
    const result: { complexity?: string; impact?: string; typeLabels: string[] } = { typeLabels: [] };

    for (const label of labels) {
      const name = label.name.toLowerCase();

      if (name.startsWith('complexity:')) {
        const value = name.split(':')[1];
        // Capitalize first letter
        result.complexity = value.charAt(0).toUpperCase() + value.slice(1);
      } else if (name.startsWith('impact:')) {
        const value = name.split(':')[1];
        // Capitalize first letter
        result.impact = value.charAt(0).toUpperCase() + value.slice(1);
      } else {
        // Keep other labels (enhancement, bug, documentation, etc.)
        result.typeLabels.push(label.name);
      }
    }

    return result;
  }

  /**
   * Sync issue labels to Complexity and Impact project fields
   * Parses complexity:* and impact:* labels and sets the corresponding project fields
   */
  async syncIssueLabelsToFields(
    issueNumber: number,
    labels: Array<{ name: string }>
  ): Promise<void> {
    const projectItemId = await this.getProjectItemIdByIssue(issueNumber);
    if (!projectItemId) {
      return; // Issue not in project
    }

    const { complexity, impact } = this.parseComplexityImpactLabels(labels);

    const complexityFieldName = this.config.fields.complexity?.fieldName || 'Complexity';
    const impactFieldName = this.config.fields.impact?.fieldName || 'Impact';

    // Update Complexity field if value found
    if (complexity) {
      try {
        await this.updateItemFieldValue(projectItemId, complexityFieldName, complexity);
      } catch (error) {
        // Field might not exist, silently skip
        console.warn(`Could not update ${complexityFieldName} field for issue #${issueNumber}`);
      }
    }

    // Update Impact field if value found
    if (impact) {
      try {
        await this.updateItemFieldValue(projectItemId, impactFieldName, impact);
      } catch (error) {
        // Field might not exist, silently skip
        console.warn(`Could not update ${impactFieldName} field for issue #${issueNumber}`);
      }
    }
  }

  /**
   * Sync Work Type field from issue labels
   * Maps labels like "bug", "enhancement", "documentation" to Work Type field
   */
  async syncWorkTypeFromLabels(
    issueNumber: number,
    labels: Array<{ name: string }>
  ): Promise<void> {
    const projectItemId = await this.getProjectItemIdByIssue(issueNumber);
    if (!projectItemId) {
      return;
    }

    const workTypeFieldName = this.config.fields.issueType?.fieldName || 'Work Type';

    // Map common labels to work types
    const labelToWorkType: Record<string, string> = {
      'bug': 'Bug',
      'enhancement': 'Feature',
      'feature': 'Feature',
      'documentation': 'Documentation',
      'docs': 'Documentation',
      'refactor': 'Refactor',
      'refactoring': 'Refactor',
      'chore': 'Chore',
      'test': 'Test',
      'tests': 'Test',
    };

    // Find the first matching label
    for (const label of labels) {
      const workType = labelToWorkType[label.name.toLowerCase()];
      if (workType) {
        try {
          await this.updateItemFieldValue(projectItemId, workTypeFieldName, workType);
          return; // Stop after first match
        } catch (error) {
          // Field might not exist or value not in options
        }
      }
    }
  }

  /**
   * Sync Effort field from estimated effort string
   * Takes effort like "2-4 hours" or "1-2 days" and converts to hours (number)
   */
  async syncEffortField(
    issueNumber: number,
    estimatedEffort?: string
  ): Promise<void> {
    if (!estimatedEffort) {
      return;
    }

    const projectItemId = await this.getProjectItemIdByIssue(issueNumber);
    if (!projectItemId) {
      return;
    }

    const effortFieldName = this.config.fields.effort?.fieldName || 'Effort';

    try {
      // Parse effort string to number (convert to hours)
      const effortHours = this.parseEffortToHours(estimatedEffort);
      if (effortHours !== null) {
        await this.updateItemNumberField(projectItemId, effortFieldName, effortHours);
      }
    } catch (error) {
      // Field might not exist or parsing failed
    }
  }

  /**
   * Parse effort string to hours
   * Examples: "2-4 hours" -> 3, "1-2 days" -> 12, "30 minutes" -> 0.5
   */
  private parseEffortToHours(effort: string): number | null {
    const lowerEffort = effort.toLowerCase();

    // Extract numbers
    const numbers = lowerEffort.match(/\d+(\.\d+)?/g);
    if (!numbers || numbers.length === 0) {
      return null;
    }

    // Calculate average if range (e.g., "2-4 hours" -> 3)
    const average = numbers.reduce((sum, n) => sum + parseFloat(n), 0) / numbers.length;

    // Convert to hours based on unit
    if (lowerEffort.includes('day')) {
      return average * 8; // 1 day = 8 hours
    } else if (lowerEffort.includes('week')) {
      return average * 40; // 1 week = 40 hours
    } else if (lowerEffort.includes('minute')) {
      return average / 60; // Convert minutes to hours
    } else {
      // Assume hours if no unit or "hour" mentioned
      return average;
    }
  }

  /**
   * Sync Area field from labels
   * Looks for labels like "area:frontend", "area:backend", etc.
   */
  async syncAreaFromLabels(
    issueNumber: number,
    labels: Array<{ name: string }>
  ): Promise<void> {
    const projectItemId = await this.getProjectItemIdByIssue(issueNumber);
    if (!projectItemId) {
      return;
    }

    const areaFieldName = 'Area';

    // Look for area:* labels
    for (const label of labels) {
      const name = label.name.toLowerCase();
      if (name.startsWith('area:')) {
        const area = name.split(':')[1];
        // Capitalize first letter
        const areaValue = area.charAt(0).toUpperCase() + area.slice(1);

        try {
          await this.updateItemFieldValue(projectItemId, areaFieldName, areaValue);
          return;
        } catch (error) {
          // Might be a text field instead of single-select
          try {
            await this.updateItemTextField(projectItemId, areaFieldName, areaValue);
            return;
          } catch {
            // Field doesn't exist or value not in options
          }
        }
      }
    }
  }

  /**
   * Clear all stale "Assigned Instance" values for items in pre-assignment statuses
   * Pre-assignment statuses are: Todo, Ready, Evaluated
   * These items should NEVER have an Assigned Instance set
   * Paginates through ALL items to ensure complete cleanup
   */
  async clearStaleAssignments(): Promise<{ cleared: number; errors: number }> {
    const assignedInstanceFieldName = this.config.fields.assignedInstance?.fieldName;
    if (!assignedInstanceFieldName) {
      throw new Error('Assigned Instance field not configured');
    }

    // Get ALL items with pre-assignment statuses (with pagination)
    const preAssignmentStatuses = this.config.fields.status.readyValues;
    const items = await this.getAllItems({
      status: preAssignmentStatuses,
    });

    let cleared = 0;
    let errors = 0;

    for (const item of items) {
      try {
        const assignedInstance = await this.getItemFieldValue(item.id, assignedInstanceFieldName);

        if (assignedInstance) {
          // Clear the stale assignment
          await this.updateItemTextField(item.id, assignedInstanceFieldName, null);
          cleared++;
        }
      } catch (error) {
        errors++;
      }
    }

    return { cleared, errors };
  }

  /**
   * Clear field cache (useful for testing or when fields change)
   */
  clearCache(): void {
    this.fieldCache.clear();
    this.fieldIdCache.clear();
  }
}
