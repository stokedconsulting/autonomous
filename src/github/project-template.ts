/**
 * Autonomous Project Template
 *
 * Defines the standard field structure for new projects created by the autonomous CLI.
 * Based on the "Desirable Platform Development" project structure.
 */

export interface FieldOption {
  name: string;
  color: 'GRAY' | 'BLUE' | 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' | 'PINK' | 'PURPLE';
  description?: string;
}

export interface SingleSelectFieldDefinition {
  name: string;
  type: 'SINGLE_SELECT';
  options: FieldOption[];
}

export interface TextFieldDefinition {
  name: string;
  type: 'TEXT';
}

export interface NumberFieldDefinition {
  name: string;
  type: 'NUMBER';
}

export type FieldDefinition = SingleSelectFieldDefinition | TextFieldDefinition | NumberFieldDefinition;

/**
 * Autonomous Project Template - Standard field definitions
 */
export const AUTONOMOUS_PROJECT_TEMPLATE: {
  name: string;
  description: string;
  fields: FieldDefinition[];
} = {
  name: 'Autonomous Project Template',
  description: 'Standard project structure for autonomous CLI workflows',
  fields: [
    // Status field - core workflow states
    {
      name: 'Status',
      type: 'SINGLE_SELECT',
      options: [
        { name: 'Backlog', color: 'GREEN' },
        { name: 'Todo', color: 'GREEN' },
        { name: 'Evaluate', color: 'GREEN' },
        { name: 'Evaluated', color: 'ORANGE' },
        { name: 'Ready', color: 'BLUE' },
        { name: 'In Progress', color: 'YELLOW' },
        { name: 'Needs More Info', color: 'RED' },
        { name: 'In Review', color: 'GRAY' },
        { name: 'Failed Review', color: 'RED' },
        { name: 'Dev Complete', color: 'PINK' },
        { name: 'Merge Review', color: 'YELLOW' },
        { name: 'Stage Ready', color: 'BLUE' },
        { name: 'Done', color: 'PURPLE' },
      ],
    },
    // Priority field
    {
      name: 'Priority',
      type: 'SINGLE_SELECT',
      options: [
        { name: '🔴 Critical', color: 'GRAY' },
        { name: '🟠 High', color: 'GRAY' },
        { name: '🟡 Medium', color: 'GRAY' },
        { name: '🟢 Low', color: 'GRAY' },
      ],
    },
    // Area field - technical domains
    {
      name: 'Area',
      type: 'SINGLE_SELECT',
      options: [
        { name: '🎨 Frontend', color: 'GRAY' },
        { name: '⚙️ Backend', color: 'GRAY' },
        { name: '📹 WebRTC', color: 'GRAY' },
        { name: '☁️ Infrastructure', color: 'GRAY' },
        { name: '🗄️ Database', color: 'GRAY' },
        { name: '🚀 DevOps', color: 'GRAY' },
        { name: '📚 Documentation', color: 'GRAY' },
      ],
    },
    // Size field - effort estimation
    {
      name: 'Size',
      type: 'SINGLE_SELECT',
      options: [
        { name: 'XS', color: 'GRAY' },
        { name: 'S', color: 'GRAY' },
        { name: 'M', color: 'GRAY' },
        { name: 'L', color: 'GRAY' },
        { name: 'XL', color: 'GRAY' },
      ],
    },
    // Work Type field
    {
      name: 'Work Type',
      type: 'SINGLE_SELECT',
      options: [
        { name: '✨ Feature', color: 'GRAY' },
        { name: '🐛 Bug', color: 'GRAY' },
        { name: '🔧 Enhancement', color: 'GRAY' },
        { name: '♻️ Refactor', color: 'GRAY' },
        { name: '📝 Docs', color: 'GRAY' },
        { name: '🧹 Chore', color: 'GRAY' },
        { name: 'Phase Master', color: 'BLUE' },
        { name: 'Phase Work Item', color: 'GREEN' },
      ],
    },
    // Complexity field
    {
      name: 'Complexity',
      type: 'SINGLE_SELECT',
      options: [
        { name: 'Low', color: 'GRAY' },
        { name: 'Medium', color: 'GRAY' },
        { name: 'High', color: 'GRAY' },
      ],
    },
    // Impact field
    {
      name: 'Impact',
      type: 'SINGLE_SELECT',
      options: [
        { name: 'Low', color: 'GRAY' },
        { name: 'Medium', color: 'GRAY' },
        { name: 'High', color: 'GRAY' },
        { name: 'Critical', color: 'GRAY' },
      ],
    },
    // Epic field - for grouping related issues
    {
      name: 'Epic',
      type: 'SINGLE_SELECT',
      options: [], // Empty by default - populated per-project
    },
    // Assigned Instance field - for tracking which LLM instance is working on it
    {
      name: 'Assigned Instance',
      type: 'TEXT',
    },
    // Effort field - numeric effort points
    {
      name: 'Effort',
      type: 'NUMBER',
    },
  ],
};

/**
 * Get the template field definitions
 */
export function getTemplateFields(): FieldDefinition[] {
  return AUTONOMOUS_PROJECT_TEMPLATE.fields;
}

/**
 * Get required Status options for autonomous workflow
 */
export function getRequiredStatusOptions(): string[] {
  const statusField = AUTONOMOUS_PROJECT_TEMPLATE.fields.find(
    f => f.name === 'Status' && f.type === 'SINGLE_SELECT'
  ) as SingleSelectFieldDefinition | undefined;

  return statusField?.options.map(o => o.name) ?? [];
}
