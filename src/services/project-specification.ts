/**
 * Project Specification Parser
 *
 * Parses project specification files in YAML, JSON, or Markdown formats
 * and converts them into typed ProjectSpecification objects.
 *
 * NOTE: Requires 'js-yaml' dependency - add to package.json:
 *   pnpm add js-yaml
 *   pnpm add -D @types/js-yaml
 */

import { readFile } from 'fs/promises';
import { resolve, extname } from 'path';
import type {
  ProjectSpecification,
  ValidationResult,
  ValidationIssue,
  ProjectInput,
} from '../types/project-spec.js';

// TODO: Add js-yaml to dependencies
// import yaml from 'js-yaml';

/**
 * Supported specification file formats
 */
export type SpecFileFormat = 'yaml' | 'json' | 'markdown' | 'text';

/**
 * Parser error with context
 */
export class SpecificationParseError extends Error {
  constructor(
    message: string,
    public readonly filePath: string,
    public readonly format: SpecFileFormat,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'SpecificationParseError';
  }
}

/**
 * Detect file format from extension
 */
function detectFormat(filePath: string): SpecFileFormat {
  const ext = extname(filePath).toLowerCase();

  switch (ext) {
    case '.yaml':
    case '.yml':
      return 'yaml';
    case '.json':
      return 'json';
    case '.md':
    case '.markdown':
      return 'markdown';
    default:
      throw new Error(`Unsupported file format: ${ext}. Supported: .yaml, .yml, .json, .md, .markdown`);
  }
}

/**
 * Read and resolve file path
 */
async function readSpecFile(input: ProjectInput): Promise<{ content: string; format: SpecFileFormat; path: string }> {
  if (input.type === 'description') {
    throw new Error('readSpecFile called with description input - use parseProjectInput instead');
  }

  // Resolve relative paths
  const absolutePath = resolve(input.path || input.filePath || '');

  try {
    const content = await readFile(absolutePath, 'utf-8');
    const format = input.format || detectFormat(absolutePath);

    return { content, format, path: absolutePath };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new SpecificationParseError(
        `Specification file not found: ${absolutePath}`,
        absolutePath,
        input.format || detectFormat(absolutePath)
      );
    }
    throw error;
  }
}

/**
 * Parse YAML specification file
 */
function parseYaml(_content: string, filePath: string): ProjectSpecification {
  try {
    // TODO: Uncomment when js-yaml is added
    // const parsed = yaml.load(_content);

    // Temporary: throw error until dependency is added
    throw new Error('YAML parsing requires js-yaml dependency - run: pnpm add js-yaml @types/js-yaml');

    // TODO: Validate parsed object structure
    // if (!parsed || typeof parsed !== 'object') {
    //   throw new Error('Invalid YAML: expected object');
    // }
    //
    // return parsed as ProjectSpecification;
  } catch (error) {
    throw new SpecificationParseError(
      `Failed to parse YAML: ${error instanceof Error ? error.message : String(error)}`,
      filePath,
      'yaml',
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Parse JSON specification file
 */
function parseJson(content: string, filePath: string): ProjectSpecification {
  try {
    const parsed = JSON.parse(content);

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid JSON: expected object');
    }

    return parsed as ProjectSpecification;
  } catch (error) {
    throw new SpecificationParseError(
      `Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`,
      filePath,
      'json',
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Parse Markdown specification file (simplified format)
 *
 * Expected format:
 * # Project: Title
 * Description text
 *
 * ## Phase 1: Phase Name
 * Phase description
 *
 * ### Item 1.1: Item Title
 * Item description
 *
 * **Acceptance Criteria:**
 * - Criterion 1
 * - Criterion 2
 *
 * **Technical Details:**
 * Implementation notes
 *
 * **Dependencies:**
 * - Phase 1, Item 1.2 (item)
 * - Phase 2 (phase)
 */
function parseMarkdown(content: string, filePath: string): ProjectSpecification {
  try {
    const lines = content.split('\n');
    const spec: ProjectSpecification = {
      project: {
        title: '',
        description: '',
      },
      phases: [],
    };

    let currentPhase: any = null;
    let currentItem: any = null;
    let currentSection: 'description' | 'acceptance' | 'technical' | 'dependencies' | null = null;
    let currentSectionContent: string[] = [];

    const flushSection = () => {
      if (!currentItem || !currentSection || currentSectionContent.length === 0) return;

      const content = currentSectionContent.join('\n').trim();

      switch (currentSection) {
        case 'description':
          currentItem.description = content;
          break;
        case 'acceptance':
          currentItem.acceptance_criteria = content
            .split('\n')
            .filter(line => line.trim().startsWith('-'))
            .map(line => line.replace(/^-\s*/, '').trim());
          break;
        case 'technical':
          currentItem.technical_details = content;
          break;
        case 'dependencies':
          currentItem.dependencies = parseDependenciesFromMarkdown(content);
          break;
      }

      currentSectionContent = [];
    };

    for (const line of lines) {
      const trimmed = line.trim();

      // Project title
      if (trimmed.startsWith('# Project:')) {
        spec.project.title = trimmed.replace('# Project:', '').trim();
        continue;
      }

      // Phase header
      if (trimmed.match(/^## Phase \d+:/)) {
        flushSection();

        const match = trimmed.match(/^## Phase (\d+): (.+)$/);
        if (match) {
          currentPhase = {
            id: `phase-${match[1]}`,
            name: match[2].trim(),
            items: [],
          };
          spec.phases.push(currentPhase);
          currentItem = null;
        }
        continue;
      }

      // Item header
      if (trimmed.match(/^### Item \d+\.\d+:/)) {
        flushSection();

        const match = trimmed.match(/^### Item (\d+)\.(\d+): (.+)$/);
        if (match && currentPhase) {
          currentItem = {
            id: `item-${match[1]}-${match[2]}`,
            title: match[3].trim(),
            description: '',
          };
          currentPhase.items.push(currentItem);
          currentSection = 'description';
        }
        continue;
      }

      // Section headers
      if (trimmed === '**Acceptance Criteria:**') {
        flushSection();
        currentSection = 'acceptance';
        continue;
      }

      if (trimmed === '**Technical Details:**') {
        flushSection();
        currentSection = 'technical';
        continue;
      }

      if (trimmed === '**Dependencies:**') {
        flushSection();
        currentSection = 'dependencies';
        continue;
      }

      // Project description (before first phase)
      if (!currentPhase && spec.project.title && trimmed) {
        spec.project.description += (spec.project.description ? '\n' : '') + trimmed;
        continue;
      }

      // Section content
      if (currentSection && trimmed) {
        currentSectionContent.push(line);
      }
    }

    // Flush final section
    flushSection();

    if (!spec.project.title) {
      throw new Error('Missing project title (# Project: ...)');
    }

    if (spec.phases.length === 0) {
      throw new Error('No phases found (## Phase N: ...)');
    }

    return spec;
  } catch (error) {
    throw new SpecificationParseError(
      `Failed to parse Markdown: ${error instanceof Error ? error.message : String(error)}`,
      filePath,
      'markdown',
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Parse dependencies from markdown list format
 * Format: "- Phase 1, Item 2 (item) - reason"
 *         "- Phase 2 (phase) - reason"
 */
function parseDependenciesFromMarkdown(content: string): any[] {
  const deps: any[] = [];
  const lines = content.split('\n').filter(line => line.trim().startsWith('-'));

  for (const line of lines) {
    const cleaned = line.replace(/^-\s*/, '').trim();

    // Match: "Phase 1, Item 2 (item) - reason" or "Phase 2 (phase) - reason"
    const match = cleaned.match(/^Phase (\d+)(?:, Item (\d+))?\s*\((\w+)\)(?:\s*-\s*(.+))?$/);

    if (match) {
      const [, phaseNum, itemNum, type, reason] = match;

      deps.push({
        phase_id: `phase-${phaseNum}`,
        item: itemNum ? `item-${phaseNum}-${itemNum}` : undefined,
        type: type as any,
        reason: reason?.trim(),
      });
    }
  }

  return deps;
}

/**
 * Parse specification file based on format
 */
export async function parseSpecificationFile(input: ProjectInput): Promise<ProjectSpecification> {
  if (input.type === 'description') {
    throw new Error('Cannot parse specification file from description - use parseProjectInput instead');
  }

  const { content, format, path } = await readSpecFile(input);

  switch (format) {
    case 'yaml':
      return parseYaml(content, path);
    case 'json':
      return parseJson(content, path);
    case 'markdown':
      return parseMarkdown(content, path);
    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}

/**
 * Parse project input (either description or file)
 */
export async function parseProjectInput(input: ProjectInput): Promise<{
  specification: ProjectSpecification | null;
  description: string | null;
  sourceFile: string | null;
}> {
  if (input.type === 'description') {
    return {
      specification: null,
      description: input.content || null,
      sourceFile: null,
    };
  }

  // File input
  const specification = await parseSpecificationFile(input);
  const absolutePath = resolve(input.path || input.filePath || '');

  return {
    specification,
    description: null,
    sourceFile: absolutePath,
  };
}

/**
 * Basic syntax validation (structure checks handled by validation engine)
 */
export function validateSyntax(spec: ProjectSpecification): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Check required top-level fields
  if (!spec.project) {
    issues.push({
      severity: 'error',
      message: 'Missing required field: project',
      suggestion: 'Add project metadata with at least a title',
    });
  }

  if (!spec.phases || !Array.isArray(spec.phases)) {
    issues.push({
      severity: 'error',
      message: 'Missing or invalid phases array',
      suggestion: 'Add phases array with at least one phase',
    });
  }

  // Check project metadata
  if (spec.project && !spec.project.title) {
    issues.push({
      severity: 'error',
      message: 'Missing required field: project.title',
      location: { field: 'project.title' },
      suggestion: 'Add a title for your project',
    });
  }

  // Check phases structure
  if (spec.phases && Array.isArray(spec.phases)) {
    if (spec.phases.length === 0) {
      issues.push({
        severity: 'error',
        message: 'Project must have at least one phase',
        suggestion: 'Add at least one phase with work items',
      });
    }

    spec.phases.forEach((phase, phaseIdx) => {
      if (!phase.id) {
        issues.push({
          severity: 'error',
          message: `Phase ${phaseIdx + 1} missing required field: id`,
          location: { phase: String(phaseIdx) },
          suggestion: 'Add unique ID for phase',
        });
      }

      if (!phase.name) {
        issues.push({
          severity: 'error',
          message: `Phase ${phaseIdx + 1} missing required field: name`,
          location: { phase: phase.id },
          suggestion: 'Add descriptive name for phase',
        });
      }

      if (!phase.items || !Array.isArray(phase.items)) {
        issues.push({
          severity: 'error',
          message: `Phase ${phase.id} missing or invalid items array`,
          location: { phase: phase.id },
          suggestion: 'Add items array with work items',
        });
      } else if (phase.items.length === 0) {
        issues.push({
          severity: 'warning',
          message: `Phase ${phase.id} has no work items`,
          location: { phase: phase.id },
          suggestion: 'Add at least one work item to this phase',
        });
      }

      // Check items structure
      phase.items?.forEach((item, itemIdx) => {
        if (!item.id) {
          issues.push({
            severity: 'error',
            message: `Item ${itemIdx + 1} in phase ${phase.id} missing required field: id`,
            location: { phase: phase.id, item: String(itemIdx) },
            suggestion: 'Add unique ID for work item',
          });
        }

        if (!item.title) {
          issues.push({
            severity: 'error',
            message: `Item ${item.id || itemIdx + 1} in phase ${phase.id} missing required field: title`,
            location: { phase: phase.id, item: item.id },
            suggestion: 'Add descriptive title for work item',
          });
        }

        if (!item.description) {
          issues.push({
            severity: 'warning',
            message: `Item ${item.id} missing description`,
            location: { phase: phase.id, item: item.id },
            suggestion: 'Add detailed description for implementation guidance',
          });
        }
      });
    });
  }

  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');
  const info = issues.filter(i => i.severity === 'info');

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    info,
  };
}
