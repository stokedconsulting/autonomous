/**
 * HelpPage - Interactive help page with categorized commands
 *
 * Displays commands organized by category with collapsible sections
 * and detailed command views. Supports full keyboard navigation.
 *
 * @example
 * ```tsx
 * <HelpPage
 *   categories={[
 *     {
 *       name: 'workflow',
 *       label: 'Workflow Commands',
 *       commands: [
 *         {
 *           name: 'start',
 *           description: 'Start a new workflow',
 *           options: [{ flag: '--force', description: 'Force start' }],
 *           examples: ['auto start', 'auto start --force'],
 *         },
 *       ],
 *     },
 *   ]}
 *   onExit={() => process.exit(0)}
 * />
 * ```
 */

import { useState, useCallback, type ReactElement } from 'react';
import { Box, Text, useInput, useApp } from 'ink';

/**
 * Command option definition
 */
export interface CommandOption {
  /**
   * The flag/option name (e.g., '--force', '-f')
   */
  flag: string;

  /**
   * Description of what the option does
   */
  description: string;

  /**
   * Whether this option is required
   * @default false
   */
  required?: boolean;

  /**
   * Default value if any
   */
  defaultValue?: string;
}

/**
 * Command information
 */
export interface CommandInfo {
  /**
   * Command name (e.g., 'start', 'status')
   */
  name: string;

  /**
   * Brief description of the command
   */
  description: string;

  /**
   * Detailed usage instructions
   */
  usage?: string;

  /**
   * Available options/flags
   */
  options?: CommandOption[];

  /**
   * Example command invocations
   */
  examples?: string[];

  /**
   * Aliases for this command
   */
  aliases?: string[];
}

/**
 * Command category grouping
 */
export interface CommandCategory {
  /**
   * Category identifier (e.g., 'workflow', 'git')
   */
  name: string;

  /**
   * Display label for the category
   */
  label: string;

  /**
   * Optional category description
   */
  description?: string;

  /**
   * Commands in this category
   */
  commands: CommandInfo[];
}

/**
 * Props for the HelpPage component
 */
export interface HelpPageProps {
  /**
   * Categorized commands to display
   */
  categories: CommandCategory[];

  /**
   * Callback when user exits help
   */
  onExit?: () => void;

  /**
   * Application title shown in header
   * @default 'Help'
   */
  title?: string;

  /**
   * Whether the component is active (accepting input)
   * @default true
   */
  isActive?: boolean;

  /**
   * Initially expanded categories
   * @default all categories expanded
   */
  initialExpanded?: Set<string>;

  /**
   * Maximum height for scrollable content
   */
  maxHeight?: number;
}

/**
 * View mode for the help page
 */
type ViewMode = 'list' | 'detail';

/**
 * Category header component
 */
function CategoryHeader({
  category,
  isExpanded,
  isFocused,
  commandCount,
}: {
  category: CommandCategory;
  isExpanded: boolean;
  isFocused: boolean;
  commandCount: number;
}): ReactElement {
  return (
    <Box>
      <Text color={isFocused ? 'cyan' : 'yellow'} bold>
        {isExpanded ? '▼' : '▶'}{' '}
      </Text>
      <Text color={isFocused ? 'cyan' : undefined} bold={isFocused}>
        {category.label}
      </Text>
      <Text color="gray" dimColor>
        {' '}
        ({commandCount} commands)
      </Text>
    </Box>
  );
}

/**
 * Command list item component
 */
function CommandItem({
  command,
  isFocused,
  indicator = '›',
}: {
  command: CommandInfo;
  isFocused: boolean;
  indicator?: string;
}): ReactElement {
  return (
    <Box flexDirection="column" marginLeft={2}>
      <Box>
        <Text color={isFocused ? 'cyan' : undefined}>
          {isFocused ? indicator : ' '}{' '}
        </Text>
        <Text color={isFocused ? 'cyan' : 'green'} bold={isFocused}>
          {command.name}
        </Text>
        {command.aliases && command.aliases.length > 0 && (
          <Text color="gray" dimColor>
            {' '}
            ({command.aliases.join(', ')})
          </Text>
        )}
      </Box>
      <Box marginLeft={3}>
        <Text color="gray" dimColor={!isFocused}>
          {command.description}
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Command detail view component
 */
function CommandDetail({
  command,
  categoryLabel,
}: {
  command: CommandInfo;
  categoryLabel: string;
}): ReactElement {
  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          {command.name}
        </Text>
        <Text color="gray" dimColor>
          {' '}
          - {categoryLabel}
        </Text>
      </Box>

      {/* Description */}
      <Box marginBottom={1}>
        <Text>{command.description}</Text>
      </Box>

      {/* Usage */}
      {command.usage && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="yellow" bold>
            Usage:
          </Text>
          <Box marginLeft={2}>
            <Text color="gray">{command.usage}</Text>
          </Box>
        </Box>
      )}

      {/* Aliases */}
      {command.aliases && command.aliases.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="yellow" bold>
            Aliases:
          </Text>
          <Box marginLeft={2}>
            <Text color="gray">{command.aliases.join(', ')}</Text>
          </Box>
        </Box>
      )}

      {/* Options */}
      {command.options && command.options.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="yellow" bold>
            Options:
          </Text>
          {command.options.map((opt, idx) => (
            <Box key={idx} marginLeft={2} flexDirection="column">
              <Box>
                <Text color="green">{opt.flag}</Text>
                {opt.required && (
                  <Text color="red"> (required)</Text>
                )}
                {opt.defaultValue && (
                  <Text color="gray" dimColor>
                    {' '}
                    [default: {opt.defaultValue}]
                  </Text>
                )}
              </Box>
              <Box marginLeft={2}>
                <Text color="gray" dimColor>
                  {opt.description}
                </Text>
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {/* Examples */}
      {command.examples && command.examples.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="yellow" bold>
            Examples:
          </Text>
          {command.examples.map((ex, idx) => (
            <Box key={idx} marginLeft={2}>
              <Text color="gray">$ </Text>
              <Text>{ex}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Back hint */}
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          (press Escape or Backspace to go back)
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Interactive help page with categorized commands
 *
 * Keyboard controls:
 * - Up/Down arrows or k/j: Navigate between commands
 * - Enter: View command details
 * - Space: Toggle category expansion
 * - Tab: Move to next category
 * - Shift+Tab: Move to previous category
 * - q or Escape: Exit (or go back from detail view)
 * - g: Jump to first item
 * - G: Jump to last item
 */
export function HelpPage({
  categories,
  onExit,
  title = 'Help',
  isActive = true,
  initialExpanded,
  // maxHeight is available for future scrolling enhancements
  maxHeight: _maxHeight,
}: HelpPageProps): ReactElement {
  const { exit } = useApp();

  // Initialize expanded categories (all expanded by default)
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    () => initialExpanded ?? new Set(categories.map((c) => c.name))
  );

  // View mode and selected command
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedCommand, setSelectedCommand] = useState<{
    command: CommandInfo;
    categoryLabel: string;
  } | null>(null);

  // Navigation indices
  const [focusedCategoryIndex, setFocusedCategoryIndex] = useState(0);
  const [focusedCommandIndex, setFocusedCommandIndex] = useState(0);

  // Focus type: 'category' or 'command'
  const [focusType, setFocusType] = useState<'category' | 'command'>('category');

  // Note: flatCommands and getFlatIndex are available for advanced navigation
  // features like unified linear navigation across all expanded commands.
  // Currently using category-based navigation for better UX with collapsible sections.

  // Toggle category expansion
  const toggleCategory = useCallback(
    (categoryName: string) => {
      setExpandedCategories((prev) => {
        const next = new Set(prev);
        if (next.has(categoryName)) {
          next.delete(categoryName);
        } else {
          next.add(categoryName);
        }
        return next;
      });
    },
    []
  );

  // Handle viewing command detail
  const viewCommandDetail = useCallback(
    (command: CommandInfo, categoryLabel: string) => {
      setSelectedCommand({ command, categoryLabel });
      setViewMode('detail');
    },
    []
  );

  // Handle going back from detail view
  const goBack = useCallback(() => {
    setViewMode('list');
    setSelectedCommand(null);
  }, []);

  // Handle exit
  const handleExit = useCallback(() => {
    if (onExit) {
      onExit();
    } else {
      exit();
    }
  }, [onExit, exit]);

  // Keyboard input handler
  useInput(
    (input, key) => {
      if (!isActive) return;

      // Handle detail view
      if (viewMode === 'detail') {
        if (key.escape || key.backspace || input === 'q') {
          goBack();
        }
        return;
      }

      // List view navigation
      if (key.upArrow || input === 'k') {
        if (focusType === 'category') {
          // Navigate categories
          setFocusedCategoryIndex((prev) =>
            prev > 0 ? prev - 1 : categories.length - 1
          );
          setFocusedCommandIndex(0);
        } else {
          // Navigate commands within expanded categories
          if (focusedCommandIndex > 0) {
            setFocusedCommandIndex((prev) => prev - 1);
          } else {
            // Move to previous category's last command or category header
            let prevCatIdx = focusedCategoryIndex - 1;
            while (prevCatIdx >= 0) {
              if (expandedCategories.has(categories[prevCatIdx].name)) {
                setFocusedCategoryIndex(prevCatIdx);
                setFocusedCommandIndex(categories[prevCatIdx].commands.length - 1);
                return;
              }
              prevCatIdx--;
            }
            // No previous expanded category, move to category header
            setFocusType('category');
          }
        }
        return;
      }

      if (key.downArrow || input === 'j') {
        if (focusType === 'category') {
          const currentCat = categories[focusedCategoryIndex];
          if (expandedCategories.has(currentCat.name) && currentCat.commands.length > 0) {
            // Enter command list
            setFocusType('command');
            setFocusedCommandIndex(0);
          } else {
            // Move to next category
            setFocusedCategoryIndex((prev) =>
              prev < categories.length - 1 ? prev + 1 : 0
            );
          }
        } else {
          // Navigate commands
          const currentCat = categories[focusedCategoryIndex];
          if (focusedCommandIndex < currentCat.commands.length - 1) {
            setFocusedCommandIndex((prev) => prev + 1);
          } else {
            // Move to next category
            let nextCatIdx = focusedCategoryIndex + 1;
            if (nextCatIdx < categories.length) {
              setFocusedCategoryIndex(nextCatIdx);
              setFocusedCommandIndex(0);
              setFocusType('category');
            } else {
              // Wrap to first category
              setFocusedCategoryIndex(0);
              setFocusType('category');
            }
          }
        }
        return;
      }

      // Tab navigation between categories
      if (key.tab) {
        if (key.shift) {
          setFocusedCategoryIndex((prev) =>
            prev > 0 ? prev - 1 : categories.length - 1
          );
        } else {
          setFocusedCategoryIndex((prev) =>
            prev < categories.length - 1 ? prev + 1 : 0
          );
        }
        setFocusedCommandIndex(0);
        setFocusType('category');
        return;
      }

      // Space to toggle category expansion
      if (input === ' ' && focusType === 'category') {
        toggleCategory(categories[focusedCategoryIndex].name);
        return;
      }

      // Enter to view command detail or toggle category
      if (key.return) {
        if (focusType === 'category') {
          toggleCategory(categories[focusedCategoryIndex].name);
        } else {
          const currentCat = categories[focusedCategoryIndex];
          const command = currentCat.commands[focusedCommandIndex];
          if (command) {
            viewCommandDetail(command, currentCat.label);
          }
        }
        return;
      }

      // Jump to first/last
      if (input === 'g') {
        setFocusedCategoryIndex(0);
        setFocusedCommandIndex(0);
        setFocusType('category');
        return;
      }

      if (input === 'G') {
        const lastCatIdx = categories.length - 1;
        setFocusedCategoryIndex(lastCatIdx);
        const lastCat = categories[lastCatIdx];
        if (expandedCategories.has(lastCat.name) && lastCat.commands.length > 0) {
          setFocusType('command');
          setFocusedCommandIndex(lastCat.commands.length - 1);
        } else {
          setFocusType('category');
        }
        return;
      }

      // Left arrow to collapse current category and focus it
      if (key.leftArrow) {
        const currentCat = categories[focusedCategoryIndex];
        if (expandedCategories.has(currentCat.name)) {
          toggleCategory(currentCat.name);
        }
        setFocusType('category');
        return;
      }

      // Right arrow to expand current category
      if (key.rightArrow) {
        const currentCat = categories[focusedCategoryIndex];
        if (!expandedCategories.has(currentCat.name)) {
          toggleCategory(currentCat.name);
        } else if (currentCat.commands.length > 0) {
          setFocusType('command');
          setFocusedCommandIndex(0);
        }
        return;
      }

      // Exit
      if (input === 'q' || key.escape) {
        handleExit();
        return;
      }
    },
    { isActive }
  );

  // Render detail view
  if (viewMode === 'detail' && selectedCommand) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1} paddingX={1}>
          <Text color="cyan" bold>
            ◀ {title}
          </Text>
          <Text color="gray"> / </Text>
          <Text bold>{selectedCommand.command.name}</Text>
        </Box>
        <CommandDetail
          command={selectedCommand.command}
          categoryLabel={selectedCommand.categoryLabel}
        />
      </Box>
    );
  }

  // Render list view
  return (
    <Box flexDirection="column" paddingY={1}>
      {/* Header */}
      <Box marginBottom={1} paddingX={1}>
        <Text color="cyan" bold>
          {title}
        </Text>
        <Text color="gray" dimColor>
          {' '}
          - {categories.reduce((sum, c) => sum + c.commands.length, 0)} commands
        </Text>
      </Box>

      {/* Category list */}
      <Box flexDirection="column" paddingX={1}>
        {categories.map((category, catIdx) => {
          const isExpanded = expandedCategories.has(category.name);
          const isCategoryFocused =
            focusType === 'category' && catIdx === focusedCategoryIndex;

          return (
            <Box key={category.name} flexDirection="column" marginBottom={1}>
              {/* Category header */}
              <CategoryHeader
                category={category}
                isExpanded={isExpanded}
                isFocused={isCategoryFocused}
                commandCount={category.commands.length}
              />

              {/* Category description */}
              {category.description && isExpanded && (
                <Box marginLeft={2} marginBottom={1}>
                  <Text color="gray" dimColor>
                    {category.description}
                  </Text>
                </Box>
              )}

              {/* Commands */}
              {isExpanded &&
                category.commands.map((command, cmdIdx) => {
                  const isCommandFocused =
                    focusType === 'command' &&
                    catIdx === focusedCategoryIndex &&
                    cmdIdx === focusedCommandIndex;

                  return (
                    <CommandItem
                      key={command.name}
                      command={command}
                      isFocused={isCommandFocused}
                    />
                  );
                })}
            </Box>
          );
        })}
      </Box>

      {/* Keyboard hints */}
      <Box marginTop={1} paddingX={1}>
        <Text color="gray" dimColor>
          (↑↓ navigate, ←→ collapse/expand, Enter to view details, Tab switch
          categories, q to exit)
        </Text>
      </Box>
    </Box>
  );
}

export default HelpPage;
