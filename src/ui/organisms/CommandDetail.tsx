/**
 * CommandDetail - Comprehensive command documentation display
 *
 * Displays full command documentation including syntax with highlighted
 * required/optional parts, options table, usage examples, and related commands.
 * Supports keyboard navigation for related commands and back navigation.
 *
 * @example
 * ```tsx
 * <CommandDetail
 *   command={{
 *     name: 'init',
 *     summary: 'Initialize a new project',
 *     arguments: [
 *       { name: 'name', description: 'Project name', required: true }
 *     ],
 *     options: [
 *       { short: '-t', long: '--template', description: 'Template to use', paramName: 'name' }
 *     ],
 *     examples: [
 *       { description: 'Create a new project', command: 'cli init my-project' }
 *     ]
 *   }}
 *   onBack={() => console.log('Back pressed')}
 *   onSelectRelated={(cmd) => console.log('Selected:', cmd)}
 * />
 * ```
 */

import { useState, useCallback, type ReactElement } from 'react';
import { Box, Text, useInput } from 'ink';
import type {
  CommandDefinition,
  CommandOption,
  CommandArgument,
  CommandExample,
  RelatedCommand,
} from './types.js';

/**
 * Props for CommandDetail component
 */
export interface CommandDetailProps {
  /**
   * Command definition to display
   */
  command: CommandDefinition;

  /**
   * Callback when back navigation is triggered (Escape)
   */
  onBack?: () => void;

  /**
   * Callback when a related command is selected
   */
  onSelectRelated?: (command: RelatedCommand) => void;

  /**
   * Whether the component is active (accepting input)
   * @default true
   */
  isActive?: boolean;

  /**
   * Whether to show keyboard hints
   * @default true
   */
  showHints?: boolean;

  /**
   * Whether to show borders around sections
   * @default false
   */
  bordered?: boolean;

  /**
   * Maximum width for the options table
   * @default 80
   */
  maxWidth?: number;
}

/**
 * Renders a single command argument with highlighting
 */
function ArgumentDisplay({
  arg,
}: {
  arg: CommandArgument;
}): ReactElement {
  const isRequired = arg.required !== false;
  const isVariadic = arg.variadic === true;

  const name = isVariadic ? `${arg.name}...` : arg.name;
  const formatted = isRequired ? `<${name}>` : `[${name}]`;

  return (
    <Text color={isRequired ? 'cyan' : 'gray'} bold={isRequired}>
      {formatted}
    </Text>
  );
}

/**
 * Renders the command syntax line with highlighted parts
 */
function CommandSyntax({
  command,
  parent,
}: {
  command: CommandDefinition;
  parent?: string;
}): ReactElement {
  const args = command.arguments || [];
  const options = command.options || [];
  const hasOptions = options.length > 0;
  const hasRequiredOptions = options.some((opt) => opt.required);

  // Build the base command path
  const baseName = parent ? `${parent} ${command.name}` : command.name;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color="yellow" bold>
          Usage:{' '}
        </Text>
        <Text bold>{baseName}</Text>

        {/* Arguments */}
        {args.map((arg) => (
          <Box key={arg.name} marginLeft={1}>
            <ArgumentDisplay arg={arg} />
          </Box>
        ))}

        {/* Options indicator */}
        {hasOptions && (
          <Box marginLeft={1}>
            <Text color={hasRequiredOptions ? 'cyan' : 'gray'}>
              {hasRequiredOptions ? '<options>' : '[options]'}
            </Text>
          </Box>
        )}
      </Box>

      {/* Aliases */}
      {command.aliases && command.aliases.length > 0 && (
        <Box marginTop={1}>
          <Text color="gray">Aliases: </Text>
          <Text color="gray" dimColor>
            {command.aliases.join(', ')}
          </Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Renders a single option row
 */
function OptionRow({
  option,
  maxFlagWidth,
}: {
  option: CommandOption;
  maxFlagWidth: number;
}): ReactElement {
  // Build flag string
  let flags = '';
  if (option.short) {
    flags = `${option.short}, ${option.long}`;
  } else {
    flags = `    ${option.long}`;
  }

  // Add parameter if present
  if (option.paramName) {
    flags += option.required ? ` <${option.paramName}>` : ` [${option.paramName}]`;
  }

  // Pad to align descriptions
  const paddedFlags = flags.padEnd(maxFlagWidth);

  return (
    <Box>
      <Text color={option.required ? 'cyan' : 'green'}>{paddedFlags}</Text>
      <Text>  </Text>
      <Text>{option.description}</Text>
      {option.defaultValue !== undefined && (
        <Text color="gray" dimColor>
          {' '}
          (default: {option.defaultValue})
        </Text>
      )}
      {option.required && (
        <Text color="red" dimColor>
          {' '}
          [required]
        </Text>
      )}
    </Box>
  );
}

/**
 * Renders the options table
 */
function OptionsTable({
  options,
  maxWidth,
}: {
  options: CommandOption[];
  maxWidth: number;
}): ReactElement {
  if (options.length === 0) {
    return (
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          No options available
        </Text>
      </Box>
    );
  }

  // Calculate max flag width for alignment
  const maxFlagWidth = options.reduce((max, opt) => {
    let len = opt.short ? 4 : 4; // "-x, " or "    "
    len += opt.long.length;
    if (opt.paramName) {
      len += opt.paramName.length + 3; // " <x>" or " [x]"
    }
    return Math.max(max, len);
  }, 0);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box marginBottom={1}>
        <Text color="yellow" bold>
          Options:
        </Text>
      </Box>
      {options.map((option) => (
        <OptionRow
          key={option.long}
          option={option}
          maxFlagWidth={Math.min(maxFlagWidth, maxWidth - 40)}
        />
      ))}
    </Box>
  );
}

/**
 * Renders the arguments section
 */
function ArgumentsSection({
  args,
}: {
  args: CommandArgument[];
}): ReactElement {
  if (args.length === 0) {
    return <></>;
  }

  // Calculate max name width for alignment
  const maxNameWidth = args.reduce((max, arg) => {
    let name = arg.variadic ? `${arg.name}...` : arg.name;
    name = arg.required !== false ? `<${name}>` : `[${name}]`;
    return Math.max(max, name.length);
  }, 0);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box marginBottom={1}>
        <Text color="yellow" bold>
          Arguments:
        </Text>
      </Box>
      {args.map((arg) => {
        const isRequired = arg.required !== false;
        let name = arg.variadic ? `${arg.name}...` : arg.name;
        name = isRequired ? `<${name}>` : `[${name}]`;
        const paddedName = name.padEnd(maxNameWidth);

        return (
          <Box key={arg.name}>
            <Text color={isRequired ? 'cyan' : 'gray'}>{paddedName}</Text>
            <Text>  </Text>
            <Text>{arg.description}</Text>
            {arg.defaultValue !== undefined && (
              <Text color="gray" dimColor>
                {' '}
                (default: {arg.defaultValue})
              </Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * Renders a single example with syntax highlighting
 */
function ExampleDisplay({
  example,
}: {
  example: CommandExample;
}): ReactElement {
  // Simple syntax highlighting for command parts
  const highlightCommand = (cmd: string): ReactElement[] => {
    const parts = cmd.split(' ');
    return parts.map((part, idx) => {
      let color: string | undefined;
      let dimColor = false;

      if (idx === 0) {
        // Command binary
        color = 'white';
      } else if (part.startsWith('--')) {
        // Long option
        color = 'green';
      } else if (part.startsWith('-')) {
        // Short option
        color = 'green';
      } else if (part.startsWith('<') || part.startsWith('[')) {
        // Placeholder
        color = 'cyan';
      } else if (part.includes('=')) {
        // Value assignment
        color = 'magenta';
      } else if (/^["']/.test(part)) {
        // Quoted string
        color = 'yellow';
      } else if (idx === 1 && !part.startsWith('-')) {
        // Subcommand
        color = 'white';
      } else {
        // Arguments/values
        color = 'cyan';
        dimColor = false;
      }

      return (
        <Text key={idx} color={color} dimColor={dimColor}>
          {part}
          {idx < parts.length - 1 ? ' ' : ''}
        </Text>
      );
    });
  };

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color="gray" dimColor>
          # {example.description}
        </Text>
      </Box>
      <Box marginLeft={2}>
        <Text color="gray">$ </Text>
        {highlightCommand(example.command)}
      </Box>
      {example.output && (
        <Box marginLeft={4}>
          <Text color="gray" dimColor>
            {example.output}
          </Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Renders the examples section
 */
function ExamplesSection({
  examples,
}: {
  examples: CommandExample[];
}): ReactElement {
  if (examples.length === 0) {
    return <></>;
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box marginBottom={1}>
        <Text color="yellow" bold>
          Examples:
        </Text>
      </Box>
      {examples.map((example, idx) => (
        <ExampleDisplay key={idx} example={example} />
      ))}
    </Box>
  );
}

/**
 * Renders the related commands section with navigation
 */
function RelatedCommandsSection({
  commands,
  focusedIndex,
}: {
  commands: RelatedCommand[];
  focusedIndex: number;
}): ReactElement {
  if (commands.length === 0) {
    return <></>;
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box marginBottom={1}>
        <Text color="yellow" bold>
          Related Commands:
        </Text>
      </Box>
      {commands.map((cmd, idx) => {
        const isFocused = idx === focusedIndex;
        return (
          <Box key={cmd.name}>
            <Text color={isFocused ? 'cyan' : undefined}>
              {isFocused ? '› ' : '  '}
            </Text>
            <Text color={isFocused ? 'cyan' : 'green'} bold={isFocused}>
              {cmd.name}
            </Text>
            <Text color="gray"> - </Text>
            <Text color={isFocused ? undefined : 'gray'}>{cmd.description}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * Comprehensive command documentation display component
 *
 * Keyboard controls:
 * - Up/k: Move focus up in related commands
 * - Down/j: Move focus down in related commands
 * - Enter: Select focused related command
 * - Escape/q: Go back to command list
 */
export function CommandDetail({
  command,
  onBack,
  onSelectRelated,
  isActive = true,
  showHints = true,
  bordered = false,
  maxWidth = 80,
}: CommandDetailProps): ReactElement {
  const relatedCommands = command.relatedCommands || [];
  const [focusedRelatedIndex, setFocusedRelatedIndex] = useState(0);

  const handleSelectRelated = useCallback(() => {
    if (relatedCommands.length > 0 && onSelectRelated) {
      onSelectRelated(relatedCommands[focusedRelatedIndex]);
    }
  }, [relatedCommands, focusedRelatedIndex, onSelectRelated]);

  useInput(
    (input, key) => {
      if (!isActive) return;

      // Navigation for related commands
      if (relatedCommands.length > 0) {
        if (key.upArrow || input === 'k') {
          setFocusedRelatedIndex((prev) =>
            prev > 0 ? prev - 1 : relatedCommands.length - 1
          );
          return;
        }

        if (key.downArrow || input === 'j') {
          setFocusedRelatedIndex((prev) =>
            prev < relatedCommands.length - 1 ? prev + 1 : 0
          );
          return;
        }

        if (key.return && onSelectRelated) {
          handleSelectRelated();
          return;
        }
      }

      // Back navigation
      if (key.escape || input === 'q') {
        onBack?.();
        return;
      }
    },
    { isActive }
  );

  const content = (
    <Box flexDirection="column" width={maxWidth}>
      {/* Command header */}
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text color="cyan" bold>
            {command.parent ? `${command.parent} ` : ''}
          </Text>
          <Text color="white" bold>
            {command.name}
          </Text>
          <Text> - </Text>
          <Text>{command.summary}</Text>
        </Box>

        {/* Category badge */}
        {command.category && (
          <Box marginTop={1}>
            <Text color="gray">[</Text>
            <Text color="magenta">{command.category}</Text>
            <Text color="gray">]</Text>
          </Box>
        )}
      </Box>

      {/* Detailed description */}
      {command.description && (
        <Box marginBottom={1}>
          <Text>{command.description}</Text>
        </Box>
      )}

      {/* Syntax */}
      <CommandSyntax command={command} parent={command.parent} />

      {/* Arguments */}
      <ArgumentsSection args={command.arguments || []} />

      {/* Options table */}
      <OptionsTable options={command.options || []} maxWidth={maxWidth} />

      {/* Examples */}
      <ExamplesSection examples={command.examples || []} />

      {/* Related commands */}
      <RelatedCommandsSection
        commands={relatedCommands}
        focusedIndex={focusedRelatedIndex}
      />

      {/* Keyboard hints */}
      {showHints && (
        <Box marginTop={1}>
          <Text color="gray" dimColor>
            (
            {relatedCommands.length > 0 && '↑↓ to navigate related, enter to select, '}
            {onBack ? 'esc/q to go back' : 'q to quit'}
            )
          </Text>
        </Box>
      )}
    </Box>
  );

  if (bordered) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
      >
        {content}
      </Box>
    );
  }

  return content;
}

export default CommandDetail;
