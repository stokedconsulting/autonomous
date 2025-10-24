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
  'assigned': 'Ready',             // Just assigned, ready to work
  'in-progress': 'In progress',    // LLM is working
  'llm-complete': 'In review',     // LLM done, PR created, awaiting review
  'merged': 'Done',                // PR merged
};

/**
 * Reverse mapping for reading from project
 * Note: "Needs more info" and "Evaluated" are intentionally omitted
 * as they don't map to active assignment statuses
 */
const REVERSE_STATUS_MAPPING: Record<string, AssignmentStatus> = {
  'Todo': 'assigned',              // Todo - ready to be assigned
  'Backlog': 'assigned',           // Backlog items treated as ready to assign
  'Ready': 'assigned',             // Ready to be picked up
  'In progress': 'in-progress',    // Actively being worked on
  'In review': 'llm-complete',     // In review after LLM completion
  'Done': 'merged',                // Completed
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
   * Returns null if status is not mapped (e.g., "Needs more info", "Evaluated")
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
      // Default to assigned if no status set
      return 'assigned';
    }

    // Map project status to AssignmentStatus
    // Return null for unmapped statuses (Needs more info, Evaluated, etc)
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
   * This is used for evaluation statuses like "Evaluated" or "Needs more info"
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
   */
  async getProjectItemIdByIssue(issueNumber: number): Promise<string | null> {
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
            content: {
              number: number;
            } | null;
          }>;
        };
      };
    }>(query);

    const item = result.node.items.nodes.find(
      (node) => node.content && node.content.number === issueNumber
    );

    return item?.id || null;
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
   * Includes items with status: Ready, Todo, and Evaluated
   */
  async getReadyItems(): Promise<ProjectItem[]> {
    const readyStatuses = [
      ...this.config.fields.status.readyValues,
      this.config.fields.status.evaluatedValue,
    ];

    const result = await this.queryItems({
      status: readyStatuses,
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
   * Clear field cache (useful for testing or when fields change)
   */
  clearCache(): void {
    this.fieldCache.clear();
    this.fieldIdCache.clear();
  }
}
