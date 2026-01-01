/**
 * ItemActionMenu - Action menu for project items
 */

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { Select } from '@inkjs/ui';
import { ProjectItem } from '../../github/projects-api.js';
import {
  checkPhaseDependencies,
  getBlockingReason,
  isPhaseMaster,
  getPhaseItems,
} from '../../utils/phase-dependencies.js';

export interface ItemAction {
  id: string;
  label: string;
  description: string;
  color?: string;
}

interface ItemActionMenuProps {
  item: ProjectItem;
  allItems: ProjectItem[]; // All project items for dependency checking
  onAction: (actionId: string) => void;
  onCancel: () => void;
}

export function ItemActionMenu({ item, allItems, onAction, onCancel }: ItemActionMenuProps): React.ReactElement {
  const status = item.fieldValues['Status'] || 'No Status';
  const priority = item.fieldValues['Priority'];
  const complexity = item.fieldValues['Complexity'];
  const epic = item.fieldValues['Epic'] || item.fieldValues['Phase'];

  // Check phase dependencies
  const dependencyCheck = useMemo(() => checkPhaseDependencies(item, allItems), [item, allItems]);
  const isBlocked = !dependencyCheck.canStart;
  const blockingReason = getBlockingReason(dependencyCheck);
  const isItemMaster = isPhaseMaster(item.content.title);
  const phaseItems = useMemo(() => getPhaseItems(item, allItems), [item, allItems]);

  // Define available actions based on current status
  const queueDescription = isItemMaster
    ? `Add this phase master and all ${phaseItems.length} work items to queue`
    : 'Add this item to the work queue';

  const queueDescriptionBlocked = isItemMaster
    ? `Queue for later - will start after: ${blockingReason}`
    : `Queue for later - will start after: ${blockingReason}`;

  const startDescription = isItemMaster
    ? `Start this phase master and all ${phaseItems.length} work items now`
    : 'Immediately start work on this item';

  const startDescriptionBlocked = `Cannot start yet - ${blockingReason}`;

  const actions: ItemAction[] = [
    {
      id: 'queue',
      label: '📋 Add to Queue',
      description: isBlocked ? queueDescriptionBlocked : queueDescription,
    },
    {
      id: 'start',
      label: isBlocked ? '⚠️  Start Work Now (Dependencies Not Met)' : '🚀 Start Work Now',
      description: isBlocked ? startDescriptionBlocked : startDescription,
    },
    {
      id: 'status',
      label: '📊 Change Status',
      description: 'Update item status',
    },
    {
      id: 'review',
      label: '👀 Start Review',
      description: 'Begin review process',
    },
    {
      id: 'evaluate',
      label: '🤔 Evaluate Item',
      description: 'Run AI evaluation on this item',
    },
    {
      id: 'details',
      label: '📋 View Details',
      description: 'Show full item information',
    },
    {
      id: 'browser',
      label: '🌐 Open in Browser',
      description: 'Open GitHub issue in browser',
    },
    {
      id: 'cancel',
      label: '← Cancel',
      description: 'Go back to item list',
    },
  ];

  const handleSelect = (value: string) => {
    if (value === 'cancel') {
      onCancel();
      return;
    }

    // Allow queuing even if blocked - work won't start until dependencies met
    // Only warn/block immediate "start" action if dependencies not met
    if (value === 'start' && isBlocked) {
      // User is trying to start work immediately on a blocked item
      // For now, we'll prevent it - later could show confirmation dialog
      // In future: show confirmation "Start anyway? Work will queue until dependencies met"
      return;
    }

    onAction(value);
  };

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
      {/* Item Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">#{item.content.number}</Text>
        <Text> </Text>
        <Text>{item.content.title}</Text>
      </Box>

      {/* Item Metadata */}
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text dimColor>Status: </Text>
          <Text color="yellow">{status}</Text>
          {priority && (
            <>
              <Text dimColor> │ Priority: </Text>
              <Text color="magenta">{priority}</Text>
            </>
          )}
        </Box>
        <Box>
          {complexity && (
            <>
              <Text dimColor>Complexity: </Text>
              <Text color="blue">{complexity}</Text>
            </>
          )}
          {epic && (
            <>
              <Text dimColor> │ Epic: </Text>
              <Text color="green">{epic}</Text>
            </>
          )}
        </Box>

        {/* Phase Master Indicator */}
        {isItemMaster && (
          <Box marginTop={1}>
            <Text color="cyan">📋 Phase Master: </Text>
            <Text dimColor>Will auto-assign {phaseItems.length} work item(s)</Text>
          </Box>
        )}

        {/* Blocked Indicator */}
        {isBlocked && blockingReason && (
          <Box marginTop={1} borderStyle="round" borderColor="yellow" paddingX={1}>
            <Text color="yellow">⏸️  Dependencies: </Text>
            <Text dimColor>{blockingReason}</Text>
            <Box marginTop={1}>
              <Text dimColor italic>Can queue now - work starts when ready</Text>
            </Box>
          </Box>
        )}
      </Box>

      {/* Action Menu */}
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold color="cyan">
            Available Actions:
          </Text>
        </Box>
        <Select
          options={actions.map(action => ({
            label: action.label,
            value: action.id,
          }))}
          onChange={handleSelect}
        />
      </Box>
    </Box>
  );
}
