/**
 * Types for Organism Components
 *
 * Type definitions for complex, composed UI components that combine
 * multiple molecules and atoms to create complete interfaces.
 */

/**
 * Command option definition
 */
export interface CommandOption {
  /**
   * Short flag form (e.g., '-v')
   */
  short?: string;

  /**
   * Long flag form (e.g., '--verbose')
   */
  long: string;

  /**
   * Description of the option
   */
  description: string;

  /**
   * Whether the option is required
   * @default false
   */
  required?: boolean;

  /**
   * Parameter name for options that take values (e.g., '--output <file>')
   */
  paramName?: string;

  /**
   * Default value if any
   */
  defaultValue?: string;

  /**
   * Allowed values for enum-like options
   */
  choices?: string[];
}

/**
 * Command argument definition
 */
export interface CommandArgument {
  /**
   * Name of the argument
   */
  name: string;

  /**
   * Description of the argument
   */
  description: string;

  /**
   * Whether the argument is required
   * @default true
   */
  required?: boolean;

  /**
   * Whether multiple values are accepted
   * @default false
   */
  variadic?: boolean;

  /**
   * Default value if any
   */
  defaultValue?: string;
}

/**
 * Usage example for a command
 */
export interface CommandExample {
  /**
   * Brief description of what this example demonstrates
   */
  description: string;

  /**
   * The command line to execute
   */
  command: string;

  /**
   * Optional output or result description
   */
  output?: string;
}

/**
 * Related command reference
 */
export interface RelatedCommand {
  /**
   * Command name
   */
  name: string;

  /**
   * Brief description of the relationship
   */
  description: string;
}

/**
 * Full command definition for display
 */
export interface CommandDefinition {
  /**
   * Command name (e.g., 'init', 'push', 'deploy')
   */
  name: string;

  /**
   * Brief one-line description
   */
  summary: string;

  /**
   * Detailed description (optional)
   */
  description?: string;

  /**
   * Command arguments in order
   */
  arguments?: CommandArgument[];

  /**
   * Available options/flags
   */
  options?: CommandOption[];

  /**
   * Usage examples
   */
  examples?: CommandExample[];

  /**
   * Related commands
   */
  relatedCommands?: RelatedCommand[];

  /**
   * Parent command for subcommands (e.g., 'project' for 'project init')
   */
  parent?: string;

  /**
   * Aliases for this command
   */
  aliases?: string[];

  /**
   * Category/group for organization
   */
  category?: string;
}
