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
   * Clear field cache (useful for testing or when fields change)
   */
  clearCache(): void {
    this.fieldCache.clear();
    this.fieldIdCache.clear();
  }
}
