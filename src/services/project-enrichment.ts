/**
 * Project Specification Enrichment
 *
 * Uses Claude CLI to intelligently fill gaps in project specifications
 * - Analyzes completeness gaps
 * - Generates missing acceptance criteria
 * - Adds technical details
 * - Creates function specifications
 * - Estimates effort and complexity
 */

import execa from 'execa';
import type {
  ProjectSpecification,
  SpecWorkItem,
  GapAnalysisResult,
  EnrichmentResult,
  EnrichmentSuggestion,
  CompletenessAssessment,
  FunctionSignature,
} from '../types/project-spec.js';

/**
 * Enrichment configuration
 */
interface EnrichmentConfig {
  /** Path to Claude CLI executable */
  claudePath: string;

  /** Working directory for Claude CLI */
  workingDirectory: string;

  /** Confidence threshold for accepting suggestions (0-1) */
  confidenceThreshold: number;

  /** Whether to enrich items with low completeness scores */
  enrichLowScoreItems: boolean;

  /** Minimum completeness score to trigger enrichment */
  minScoreForEnrichment: number;
}

// Default enrichment configuration (defined but unused - reserved for future use)
// @ts-expect-error - Kept for future use
const DEFAULT_ENRICHMENT_CONFIG: Partial<EnrichmentConfig> = {
  confidenceThreshold: 0.7,
  enrichLowScoreItems: true,
  minScoreForEnrichment: 70,
};

/**
 * Enrich project specification by filling gaps
 */
export async function enrichProjectSpecification(
  spec: ProjectSpecification,
  gapAnalysis: GapAnalysisResult,
  config: EnrichmentConfig
): Promise<EnrichmentResult> {
  const enrichedSpec: ProjectSpecification = JSON.parse(JSON.stringify(spec)); // Deep clone
  const suggestions: EnrichmentSuggestion[] = [];
  let fieldsAdded = 0;
  let itemsEnriched = 0;
  let acceptanceCriteriaAdded = 0;
  let technicalDetailsAdded = 0;

  // Process items with low completeness scores
  for (const assessment of gapAnalysis.incompleteItems) {
    if (assessment.score >= config.minScoreForEnrichment) {
      continue; // Item is complete enough
    }

    // Find the item in the enriched spec
    const { item, phase } = findItemInSpec(enrichedSpec, assessment.itemId);
    if (!item || !phase) continue;

    // Generate enrichment suggestions for this item
    const itemSuggestions = await generateEnrichmentSuggestions(
      item,
      phase.name,
      assessment,
      spec.project,
      config
    );

    // Apply high-confidence suggestions
    let itemModified = false;

    for (const suggestion of itemSuggestions) {
      if ((suggestion.confidence ?? 0) >= config.confidenceThreshold) {
        applyEnrichmentSuggestion(item, suggestion);
        suggestions.push(suggestion);
        fieldsAdded++;
        itemModified = true;

        // Track specific field types
        if (suggestion.field === 'acceptance_criteria') {
          acceptanceCriteriaAdded++;
        } else if (suggestion.field === 'technical_details') {
          technicalDetailsAdded++;
        }
      } else {
        // Low confidence - add to suggestions but don't apply
        suggestions.push(suggestion);
      }
    }

    if (itemModified) {
      itemsEnriched++;
    }
  }

  return {
    original: spec,
    enriched: enrichedSpec,
    suggestions,
    changes: {
      fields_added: fieldsAdded,
      items_enriched: itemsEnriched,
      acceptance_criteria_added: acceptanceCriteriaAdded,
      technical_details_added: technicalDetailsAdded,
    },
  };
}

/**
 * Find item in specification
 */
function findItemInSpec(
  spec: ProjectSpecification,
  itemId: string
): { item: SpecWorkItem | null; phase: any | null } {
  for (const phase of spec.phases) {
    const item = phase.items.find(i => i.id === itemId);
    if (item) {
      return { item, phase };
    }
  }
  return { item: null, phase: null };
}

/**
 * Generate enrichment suggestions using Claude CLI
 */
async function generateEnrichmentSuggestions(
  item: SpecWorkItem,
  phaseName: string,
  assessment: CompletenessAssessment,
  projectMetadata: any,
  config: EnrichmentConfig
): Promise<EnrichmentSuggestion[]> {
  const suggestions: EnrichmentSuggestion[] = [];

  // Build context for Claude
  const context = buildEnrichmentContext(item, phaseName, assessment, projectMetadata);

  // Generate suggestions for each gap
  for (const gap of assessment.gaps || []) {
    try {
      const suggestion = await generateFieldSuggestion(
        item.id,
        gap.field,
        context,
        gap.reason,
        gap.suggestion,
        config
      );

      if (suggestion) {
        suggestions.push(suggestion);
      }
    } catch (error) {
      console.warn(`Failed to generate suggestion for ${gap.field}:`, error);
    }
  }

  return suggestions;
}

/**
 * Build context for enrichment prompt
 */
function buildEnrichmentContext(
  item: SpecWorkItem,
  phaseName: string,
  assessment: CompletenessAssessment,
  projectMetadata: any
): string {
  const parts: string[] = [];

  parts.push(`Project: ${projectMetadata.title}`);
  if (projectMetadata.description) {
    parts.push(`Project Description: ${projectMetadata.description}`);
  }
  parts.push('');

  parts.push(`Phase: ${phaseName}`);
  parts.push(`Work Item: ${item.title}`);
  parts.push('');

  if (item.description) {
    parts.push(`Description: ${item.description}`);
    parts.push('');
  }

  if (item.acceptance_criteria && item.acceptance_criteria.length > 0) {
    parts.push('Existing Acceptance Criteria:');
    item.acceptance_criteria.forEach(c => parts.push(`- ${c}`));
    parts.push('');
  }

  if (item.technical_details) {
    parts.push(`Technical Details: ${item.technical_details}`);
    parts.push('');
  }

  if (item.functions && item.functions.length > 0) {
    parts.push('Existing Functions:');
    item.functions.forEach(fn => {
      parts.push(`- ${fn.name}(${fn.inputs?.map(i => i.name).join(', ') || ''}) → ${fn.outputs?.[0]?.type || 'unknown'}`);
    });
    parts.push('');
  }

  if (item.modified_files && item.modified_files.length > 0) {
    parts.push(`Files to Modify: ${item.modified_files.join(', ')}`);
    parts.push('');
  }

  parts.push(`Completeness Score: ${assessment.score}/100`);

  return parts.join('\n');
}

/**
 * Generate suggestion for specific field using Claude CLI
 */
async function generateFieldSuggestion(
  itemId: string,
  field: string,
  context: string,
  reason: string,
  suggestedAction: string | undefined,
  config: EnrichmentConfig
): Promise<EnrichmentSuggestion | null> {
  const prompt = buildFieldPrompt(field, context, reason, suggestedAction);

  try {
    const result = await execa(config.claudePath, ['--no-stream'], {
      input: prompt,
      cwd: config.workingDirectory,
      timeout: 30000, // 30 second timeout
    });

    const content = parseClaudeResponse(result.stdout, field);

    if (!content) {
      return null;
    }

    return {
      item_id: itemId,
      field,
      content,
      confidence: calculateConfidence(content, field),
      reasoning: `Generated based on: ${reason}`,
    };
  } catch (error) {
    console.error(`Claude CLI error for ${field}:`, error);
    return null;
  }
}

/**
 * Build prompt for specific field enrichment
 */
function buildFieldPrompt(
  field: string,
  context: string,
  reason: string,
  suggestedAction: string | undefined
): string {
  const prompts: Record<string, string> = {
    acceptance_criteria: `Based on the following work item, generate 2-4 specific, measurable acceptance criteria that define when this work is complete. Each criterion should be testable and clear.

${context}

Gap: ${reason}
${suggestedAction ? `Suggestion: ${suggestedAction}` : ''}

Please provide ONLY the acceptance criteria as a numbered list, one per line:`,

    technical_details: `Based on the following work item, provide technical implementation details including approach, architecture considerations, and key technical decisions.

${context}

Gap: ${reason}
${suggestedAction ? `Suggestion: ${suggestedAction}` : ''}

Please provide technical details as a concise paragraph (100-200 words):`,

    description: `Expand the following work item description to provide clear implementation guidance for a medium-level programmer.

${context}

Gap: ${reason}
${suggestedAction ? `Suggestion: ${suggestedAction}` : ''}

Please provide an expanded description (150-300 words):`,

    functions: `Based on the following work item, identify 2-4 key functions that need to be created or modified. For each function, specify: name, inputs (with types), outputs (with type), and whether it's new or modified.

${context}

Gap: ${reason}
${suggestedAction ? `Suggestion: ${suggestedAction}` : ''}

Please provide function specifications in this format:
Function: functionName
Inputs: param1 (type), param2 (type)
Output: returnType
Status: new/modified
---`,

    estimate: `Based on the following work item, provide an effort estimate in hours for a medium-level programmer to complete this work, including implementation, testing, and documentation.

${context}

Gap: ${reason}
${suggestedAction ? `Suggestion: ${suggestedAction}` : ''}

Please provide ONLY a number (hours):`,

    size: `Based on the following work item, classify its size as S (Small, <4 hours), M (Medium, 4-16 hours), L (Large, 16-40 hours), or XL (Extra Large, 40+ hours).

${context}

Gap: ${reason}
${suggestedAction ? `Suggestion: ${suggestedAction}` : ''}

Please provide ONLY one letter: S, M, L, or XL:`,

    complexity: `Based on the following work item, classify its complexity as Low (straightforward, well-understood), Medium (some complexity, requires design), or High (complex architecture, significant unknowns).

${context}

Gap: ${reason}
${suggestedAction ? `Suggestion: ${suggestedAction}` : ''}

Please provide ONLY one word: Low, Medium, or High:`,
  };

  return prompts[field] || `Provide content for field "${field}":\n\n${context}`;
}

/**
 * Parse Claude CLI response
 */
function parseClaudeResponse(stdout: string, field: string): string | null {
  if (!stdout || stdout.trim().length === 0) {
    return null;
  }

  const trimmed = stdout.trim();

  // Field-specific parsing
  switch (field) {
    case 'acceptance_criteria':
      return trimmed; // Parse as list later

    case 'functions':
      return trimmed; // Parse as function specs later

    case 'estimate':
      const hours = parseInt(trimmed, 10);
      return isNaN(hours) ? null : String(hours);

    case 'size':
      const size = trimmed.toUpperCase();
      return ['S', 'M', 'L', 'XL'].includes(size) ? size : null;

    case 'complexity':
      const complexity = trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
      return ['Low', 'Medium', 'High'].includes(complexity) ? complexity : null;

    default:
      return trimmed;
  }
}

/**
 * Calculate confidence score for generated content
 */
function calculateConfidence(content: string, field: string): number {
  // Simple heuristics - can be improved with more sophisticated analysis
  const length = content.length;

  switch (field) {
    case 'acceptance_criteria':
      // Check if content looks like criteria (numbered list, bullet points)
      const hasList = /^(\d+\.|[-*])\s/.test(content);
      const hasMultiple = (content.match(/\n/g) || []).length >= 1;
      return hasList && hasMultiple ? 0.85 : 0.6;

    case 'technical_details':
      // Check for reasonable length
      return length >= 100 && length <= 500 ? 0.8 : 0.65;

    case 'description':
      // Check for reasonable length
      return length >= 150 && length <= 600 ? 0.8 : 0.65;

    case 'functions':
      // Check if content looks like function specs
      const hasFunctionFormat = /Function:|Inputs:|Output:|Status:/.test(content);
      return hasFunctionFormat ? 0.8 : 0.5;

    case 'estimate':
    case 'size':
    case 'complexity':
      // Parsed values - high confidence if valid
      return content ? 0.9 : 0.3;

    default:
      return 0.7;
  }
}

/**
 * Apply enrichment suggestion to work item
 */
function applyEnrichmentSuggestion(item: SpecWorkItem, suggestion: EnrichmentSuggestion): void {
  const { field, content } = suggestion;

  if (!content) return; // Skip if no content

  switch (field) {
    case 'description':
      item.description = content;
      break;

    case 'acceptance_criteria':
      item.acceptance_criteria = parseAcceptanceCriteria(content);
      break;

    case 'technical_details':
      item.technical_details = content;
      break;

    case 'functions':
      item.functions = parseFunctionSpecs(content);
      break;

    case 'estimate':
      item.estimate = parseInt(content, 10);
      break;

    case 'size':
      item.size = content as 'S' | 'M' | 'L' | 'XL';
      break;

    case 'complexity':
      item.complexity = content as 'Low' | 'Medium' | 'High';
      break;
  }
}

/**
 * Parse acceptance criteria from text
 */
function parseAcceptanceCriteria(text: string): string[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => line.replace(/^(\d+\.|[-*])\s*/, ''));
}

/**
 * Parse function specifications from text
 */
function parseFunctionSpecs(text: string): FunctionSignature[] {
  const functions: FunctionSignature[] = [];
  const blocks = text.split('---').map(b => b.trim());

  for (const block of blocks) {
    if (!block) continue;

    const lines = block.split('\n').map(l => l.trim());
    const fn: Partial<FunctionSignature> = {
      inputs: [],
      is_new: true,
    };

    for (const line of lines) {
      if (line.startsWith('Function:')) {
        fn.name = line.replace('Function:', '').trim();
      } else if (line.startsWith('Inputs:')) {
        const inputsStr = line.replace('Inputs:', '').trim();
        fn.inputs = parseInputs(inputsStr);
      } else if (line.startsWith('Output:')) {
        const outputType = line.replace('Output:', '').trim();
        fn.outputs = [{ name: 'result', type: outputType }];
      } else if (line.startsWith('Status:')) {
        const status = line.replace('Status:', '').trim().toLowerCase();
        fn.is_new = status !== 'modified';
        if (!fn.is_new) {
          fn.modifications = 'Modified as part of this work item';
        }
      }
    }

    if (fn.name && fn.inputs && fn.outputs) {
      functions.push(fn as FunctionSignature);
    }
  }

  return functions;
}

/**
 * Parse function inputs from text
 */
function parseInputs(inputsStr: string): Array<{ name: string; type: string }> {
  if (!inputsStr || inputsStr === 'none') return [];

  return inputsStr
    .split(',')
    .map(input => input.trim())
    .map(input => {
      const match = input.match(/^(\w+)\s*\(([^)]+)\)$/);
      if (match) {
        return {
          name: match[1],
          type: match[2],
        };
      }
      return { name: input, type: 'any' };
    });
}
