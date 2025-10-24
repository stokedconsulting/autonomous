/**
 * Project Field Mapper
 *
 * Maps GitHub Projects v2 field values to typed metadata.
 * Always reads fresh from project (no caching).
 */

import { GitHubProjectsAPI, ProjectItem } from './projects-api.js';
import { ProjectConfig } from '../types/config.js';
import {
  ProjectItemMetadata,
  ProjectItemWithMetadata,
  SprintFieldValue,
} from '../types/project.js';

export class ProjectFieldMapper {
  private projectsAPI: GitHubProjectsAPI;
  private config: ProjectConfig;

  constructor(projectsAPI: GitHubProjectsAPI, config: ProjectConfig) {
    this.projectsAPI = projectsAPI;
    this.config = config;
  }

  /**
   * Map a ProjectItem to ProjectItemMetadata
   */
  mapItemToMetadata(item: ProjectItem): ProjectItemMetadata {
    const fieldValues = item.fieldValues;

    return {
      projectItemId: item.id,
      issueNumber: item.content.number,
      issueTitle: item.content.title,
      status: this.getFieldValue(fieldValues, this.config.fields.status.fieldName),
      priority: this.getFieldValue(fieldValues, this.config.fields.priority?.fieldName),
      size: this.getFieldValue(fieldValues, this.config.fields.size?.fieldName),
      type: this.getFieldValue(fieldValues, 'Type') || this.getFieldValue(fieldValues, 'Issue Type'),
      area: this.getFieldValue(fieldValues, 'Area'),
      sprint: this.getSprintValue(fieldValues, this.config.fields.sprint?.fieldName),
      blockedBy: this.getFieldValue(fieldValues, 'Blocked By'),
      effortEstimate: this.getNumberValue(fieldValues, 'Effort Estimate'),
    };
  }

  /**
   * Map a ProjectItem to ProjectItemWithMetadata
   */
  mapItemWithMetadata(item: ProjectItem): ProjectItemWithMetadata {
    return {
      projectItemId: item.id,
      issueNumber: item.content.number,
      issueTitle: item.content.title,
      issueState: item.content.state,
      issueUrl: item.content.url,
      metadata: this.mapItemToMetadata(item),
    };
  }

  /**
   * Get metadata for a specific issue
   */
  async getMetadataForIssue(issueNumber: number): Promise<ProjectItemMetadata | null> {
    const projectItemId = await this.projectsAPI.getProjectItemId(issueNumber);

    if (!projectItemId) {
      return null;
    }

    // Query the full item with field values
    const result = await this.projectsAPI.queryItems({
      limit: 100,
    });

    const item = result.items.find((i) => i.content.number === issueNumber);

    if (!item) {
      return null;
    }

    return this.mapItemToMetadata(item);
  }

  /**
   * Get metadata for multiple issues
   */
  async getMetadataForIssues(issueNumbers: number[]): Promise<Map<number, ProjectItemMetadata>> {
    const result = await this.projectsAPI.queryItems({
      limit: 100,
    });

    const metadataMap = new Map<number, ProjectItemMetadata>();

    result.items.forEach((item) => {
      if (issueNumbers.includes(item.content.number)) {
        metadataMap.set(item.content.number, this.mapItemToMetadata(item));
      }
    });

    return metadataMap;
  }

  /**
   * Get all ready items with metadata
   */
  async getReadyItemsWithMetadata(): Promise<ProjectItemWithMetadata[]> {
    const items = await this.projectsAPI.getReadyItems();
    return items.map((item) => this.mapItemWithMetadata(item));
  }

  /**
   * Get Priority weight from config
   */
  getPriorityWeight(priority: string | null): number {
    if (!priority || !this.config.fields.priority?.values) {
      return 0;
    }

    const lowerPriority = priority.toLowerCase();
    const value = this.config.fields.priority.values[lowerPriority];

    return value?.weight || 0;
  }

  /**
   * Get Size preference score
   */
  getSizePreferenceScore(size: string | null): number {
    if (!size || !this.config.fields.size?.preferredSizes) {
      return 5; // Default neutral score
    }

    const preferredSizes = this.config.fields.size.preferredSizes;

    if (preferredSizes.includes(size)) {
      return 10; // Preferred size gets high score
    }

    // Map non-preferred sizes to lower scores
    const sizeOrder = ['XS', 'S', 'M', 'L', 'XL'];
    const index = sizeOrder.indexOf(size);

    if (index === -1) return 5;

    // Smaller tasks generally preferred over huge ones
    return 10 - index * 2; // XS=10, S=8, M=6, L=4, XL=2
  }

  /**
   * Check if issue is in current sprint
   */
  isInCurrentSprint(sprint: SprintFieldValue | null): boolean {
    if (!sprint || !this.config.fields.sprint?.currentSprint) {
      return false;
    }

    return sprint.title === this.config.fields.sprint.currentSprint;
  }

  // Helper methods

  private getFieldValue(fieldValues: Record<string, any>, fieldName: string | undefined): string | null {
    if (!fieldName) return null;
    const value = fieldValues[fieldName];
    return typeof value === 'string' ? value : null;
  }

  private getNumberValue(fieldValues: Record<string, any>, fieldName: string): number | null {
    const value = fieldValues[fieldName];
    return typeof value === 'number' ? value : null;
  }

  private getSprintValue(
    fieldValues: Record<string, any>,
    fieldName: string | undefined
  ): SprintFieldValue | null {
    if (!fieldName) return null;

    const value = fieldValues[fieldName];

    if (value && typeof value === 'object' && value.title && value.startDate) {
      return {
        title: value.title,
        startDate: value.startDate,
      };
    }

    return null;
  }
}
