# Ink Component Implementation Examples

This document provides concrete implementation examples for key components in the autonomous CLI's Ink-based UI.

---

## Atoms

### StatusBadge.tsx

```tsx
import React from 'react';
import { Box, Text } from 'ink';

type Status = 'assigned' | 'in-progress' | 'dev-complete' | 'merge-review' | 'stage-ready' | 'merged' | 'failed';

interface StatusBadgeProps {
  status: Status;
  showLabel?: boolean;
}

const STATUS_CONFIG: Record<Status, { icon: string; color: string; label: string }> = {
  'assigned': { icon: '○', color: 'gray', label: 'Assigned' },
  'in-progress': { icon: '◐', color: 'cyan', label: 'In Progress' },
  'dev-complete': { icon: '◕', color: 'greenBright', label: 'Dev Complete' },
  'merge-review': { icon: '◑', color: 'magenta', label: 'Merge Review' },
  'stage-ready': { icon: '◔', color: 'blue', label: 'Stage Ready' },
  'merged': { icon: '●', color: 'green', label: 'Merged' },
  'failed': { icon: '✕', color: 'red', label: 'Failed' },
};

export function StatusBadge({ status, showLabel = true }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status];

  return (
    <Box>
      <Text color={config.color}>{config.icon}</Text>
      {showLabel && <Text color={config.color}> {config.label}</Text>}
    </Box>
  );
}
```

### TimeAgo.tsx

```tsx
import React, { useState, useEffect } from 'react';
import { Text } from 'ink';

interface TimeAgoProps {
  date: Date | string;
  live?: boolean;
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function TimeAgo({ date, live = true }: TimeAgoProps) {
  const parsedDate = typeof date === 'string' ? new Date(date) : date;
  const [timeAgo, setTimeAgo] = useState(() => formatTimeAgo(parsedDate));

  useEffect(() => {
    if (!live) return;

    const interval = setInterval(() => {
      setTimeAgo(formatTimeAgo(parsedDate));
    }, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [parsedDate, live]);

  return <Text dimColor>{timeAgo}</Text>;
}
```

### Hotkey.tsx

```tsx
import React from 'react';
import { Box, Text } from 'ink';

interface HotkeyProps {
  keys: string;
  label: string;
}

export function Hotkey({ keys, label }: HotkeyProps) {
  return (
    <Box>
      <Text color="cyan" bold>[{keys}]</Text>
      <Text dimColor> {label}</Text>
    </Box>
  );
}

// Usage: <Hotkey keys="j/k" label="Navigate" />
```

---

## Molecules

### AssignmentCard.tsx

```tsx
import React from 'react';
import { Box, Text } from 'ink';
import { Sparkline } from '@pppp606/ink-chart';
import { StatusBadge } from '../atoms/StatusBadge.js';
import { TimeAgo } from '../atoms/TimeAgo.js';

interface Assignment {
  issueNumber: number;
  issueTitle: string;
  status: Status;
  llmProvider: string;
  branchName: string;
  prUrl?: string;
  lastActivity: Date;
  cpuHistory?: number[];
}

interface AssignmentCardProps {
  assignment: Assignment;
  isFocused?: boolean;
}

export function AssignmentCard({ assignment, isFocused = false }: AssignmentCardProps) {
  const focusIndicator = isFocused ? '▸ ' : '  ';

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={isFocused ? 'cyan' : 'gray'}
      paddingX={1}
    >
      {/* Header */}
      <Box>
        <Text color={isFocused ? 'cyan' : 'white'}>
          {focusIndicator}
        </Text>
        <Text bold>#{assignment.issueNumber}</Text>
        <Text> </Text>
        <Text>{assignment.issueTitle}</Text>
        <Box flexGrow={1} />
        <StatusBadge status={assignment.status} />
      </Box>

      {/* Details */}
      <Box marginLeft={2}>
        <Text dimColor>LLM: {assignment.llmProvider}</Text>
        <Text dimColor> | Branch: {assignment.branchName}</Text>
        <Box flexGrow={1} />
        <TimeAgo date={assignment.lastActivity} />
      </Box>

      {/* CPU Sparkline (if running) */}
      {assignment.cpuHistory && assignment.status === 'in-progress' && (
        <Box marginLeft={2} marginTop={1}>
          <Sparkline
            data={assignment.cpuHistory}
            width={30}
            colorScheme="blue"
          />
          <Text dimColor> CPU</Text>
        </Box>
      )}

      {/* PR Link */}
      {assignment.prUrl && (
        <Box marginLeft={2}>
          <Text color="blue" underline>{assignment.prUrl}</Text>
        </Box>
      )}
    </Box>
  );
}
```

### LogStream.tsx

```tsx
import React, { useEffect, useRef } from 'react';
import { Box, Text, useStdout } from 'ink';

interface LogEntry {
  timestamp: Date;
  message: string;
  level: 'info' | 'warn' | 'error' | 'debug';
}

interface LogStreamProps {
  logs: LogEntry[];
  maxLines?: number;
  follow?: boolean;
}

const LEVEL_COLORS = {
  info: 'white',
  warn: 'yellow',
  error: 'red',
  debug: 'gray',
};

export function LogStream({ logs, maxLines = 20, follow = true }: LogStreamProps) {
  const displayLogs = follow ? logs.slice(-maxLines) : logs.slice(0, maxLines);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray">
      <Box paddingX={1} borderBottom>
        <Text bold>Claude Output</Text>
        {follow && <Text dimColor> (following)</Text>}
      </Box>

      <Box flexDirection="column" paddingX={1} paddingY={0}>
        {displayLogs.map((log, i) => (
          <Box key={i}>
            <Text dimColor>
              [{log.timestamp.toLocaleTimeString()}]
            </Text>
            <Text color={LEVEL_COLORS[log.level]}> {log.message}</Text>
          </Box>
        ))}

        {/* Cursor indicator when following */}
        {follow && (
          <Text color="cyan">▌</Text>
        )}
      </Box>
    </Box>
  );
}
```

### ProgressTracker.tsx

```tsx
import React from 'react';
import { Box, Text } from 'ink';

interface Step {
  label: string;
  status: 'pending' | 'active' | 'complete' | 'error';
}

interface ProgressTrackerProps {
  steps: Step[];
  currentStep: number;
}

const STEP_ICONS = {
  pending: '○',
  active: '◐',
  complete: '●',
  error: '✕',
};

const STEP_COLORS = {
  pending: 'gray',
  active: 'cyan',
  complete: 'green',
  error: 'red',
};

export function ProgressTracker({ steps, currentStep }: ProgressTrackerProps) {
  return (
    <Box flexDirection="row" gap={1}>
      {steps.map((step, index) => (
        <React.Fragment key={index}>
          <Box>
            <Text color={STEP_COLORS[step.status]}>
              {STEP_ICONS[step.status]}
            </Text>
            <Text
              color={step.status === 'active' ? 'cyan' : 'white'}
              bold={step.status === 'active'}
            >
              {' '}{step.label}
            </Text>
          </Box>

          {/* Connector line */}
          {index < steps.length - 1 && (
            <Text dimColor>→</Text>
          )}
        </React.Fragment>
      ))}
    </Box>
  );
}
```

---

## Organisms

### Dashboard.tsx

```tsx
import React from 'react';
import { Box, Text } from 'ink';
import { ProgressBar } from '@inkjs/ui';
import { BarChart } from '@pppp606/ink-chart';
import { AssignmentCard } from '../molecules/AssignmentCard.js';
import { useLiveAssignments } from '../hooks/useLiveAssignments.js';
import { useUIStore } from '../stores/ui-store.js';

export function Dashboard() {
  const assignments = useLiveAssignments();
  const { selectedIndex } = useUIStore();

  // Group by status
  const inProgress = assignments.filter(a => a.status === 'in-progress');
  const devComplete = assignments.filter(a => a.status === 'dev-complete');
  const merged = assignments.filter(a => a.status === 'merged');

  // Calculate progress
  const totalComplete = merged.length + devComplete.length;
  const progressPercent = assignments.length > 0
    ? Math.round((totalComplete / assignments.length) * 100)
    : 0;

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box borderStyle="double" borderColor="cyan" paddingX={2}>
        <Text bold color="cyan">🤖 AUTONOMOUS</Text>
        <Box flexGrow={1} />
        <Text color="cyan">◐ Running</Text>
        <Text dimColor>  [?] Help</Text>
      </Box>

      {/* Summary */}
      <Box
        flexDirection="column"
        borderStyle="round"
        marginTop={1}
        paddingX={1}
      >
        <Text bold>Summary</Text>
        <Box gap={2}>
          <Text>Total: {assignments.length}</Text>
          <Text color="cyan">In Progress: {inProgress.length}</Text>
          <Text color="green">Complete: {devComplete.length}</Text>
          <Text color="greenBright">Merged: {merged.length}</Text>
        </Box>
        <Box marginTop={1}>
          <ProgressBar value={progressPercent} />
          <Text dimColor> {progressPercent}% pipeline</Text>
        </Box>
      </Box>

      {/* Active Instances */}
      <Box flexDirection="column" borderStyle="round" marginTop={1}>
        <Box paddingX={1}>
          <Text bold>Active Instances</Text>
        </Box>
        {inProgress.map((assignment, index) => (
          <AssignmentCard
            key={assignment.issueNumber}
            assignment={assignment}
            isFocused={index === selectedIndex}
          />
        ))}
        {inProgress.length === 0 && (
          <Box paddingX={1}>
            <Text dimColor>No active instances. Press [s] to start.</Text>
          </Box>
        )}
      </Box>

      {/* Keyboard hints */}
      <Box marginTop={1} gap={2}>
        <Text dimColor>[j/k] Navigate</Text>
        <Text dimColor>[Enter] Details</Text>
        <Text dimColor>[s] Start</Text>
        <Text dimColor>[x] Stop</Text>
        <Text dimColor>[r] Refresh</Text>
      </Box>
    </Box>
  );
}
```

### ReviewPanel.tsx

```tsx
import React from 'react';
import { Box, Text } from 'ink';
import { Spinner, ProgressBar } from '@inkjs/ui';
import { StatusBadge } from '../atoms/StatusBadge.js';

interface PersonaReview {
  persona: string;
  icon: string;
  status: 'pending' | 'reviewing' | 'passed' | 'failed';
  score?: number;
  findings?: string[];
  progress?: number;
}

interface ReviewPanelProps {
  issueNumber: number;
  issueTitle: string;
  reviews: PersonaReview[];
}

export function ReviewPanel({ issueNumber, issueTitle, reviews }: ReviewPanelProps) {
  const completedCount = reviews.filter(
    r => r.status === 'passed' || r.status === 'failed'
  ).length;

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box borderStyle="double" borderColor="magenta" paddingX={2}>
        <Text bold color="magenta">🔍 CODE REVIEW</Text>
        <Text> - #{issueNumber} {issueTitle}</Text>
        <Box flexGrow={1} />
        <Text>[{completedCount}/{reviews.length} Personas]</Text>
      </Box>

      {/* Persona Results */}
      <Box flexDirection="column" borderStyle="round" marginTop={1}>
        <Box paddingX={1}>
          <Text bold>Persona Results</Text>
        </Box>

        {reviews.map((review, index) => (
          <Box
            key={review.persona}
            flexDirection="column"
            borderStyle="single"
            borderColor={
              review.status === 'passed' ? 'green' :
              review.status === 'failed' ? 'red' :
              review.status === 'reviewing' ? 'cyan' : 'gray'
            }
            marginX={1}
            marginY={0}
            paddingX={1}
          >
            {/* Persona Header */}
            <Box>
              <Text>{review.icon} {review.persona}</Text>
              <Box flexGrow={1} />
              {review.status === 'pending' && (
                <Text dimColor>○ Pending</Text>
              )}
              {review.status === 'reviewing' && (
                <Box>
                  <Spinner />
                  <Text color="cyan"> REVIEWING...</Text>
                </Box>
              )}
              {review.status === 'passed' && (
                <Text color="green">✓ PASSED</Text>
              )}
              {review.status === 'failed' && (
                <Text color="red">✕ FAILED</Text>
              )}
              {review.score !== undefined && (
                <Text dimColor> Score: {review.score}/10</Text>
              )}
            </Box>

            {/* Progress bar for active reviews */}
            {review.status === 'reviewing' && review.progress !== undefined && (
              <Box marginTop={1}>
                <ProgressBar value={review.progress} />
                <Text dimColor> {review.progress}% complete</Text>
              </Box>
            )}

            {/* Findings */}
            {review.findings && review.findings.length > 0 && (
              <Box flexDirection="column" marginTop={1}>
                {review.findings.map((finding, i) => (
                  <Box key={i}>
                    <Text color={finding.startsWith('✓') ? 'green' : 'yellow'}>
                      {finding}
                    </Text>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        ))}
      </Box>

      {/* Actions */}
      <Box marginTop={1} gap={2}>
        <Text dimColor>[y] Approve All</Text>
        <Text dimColor>[n] Reject</Text>
        <Text dimColor>[c] Comment</Text>
        <Text dimColor>[d] Full Diff</Text>
        <Text dimColor>[r] Re-run</Text>
      </Box>
    </Box>
  );
}
```

---

## Hooks

### useKeyboardNav.ts

```tsx
import { useInput, useFocusManager } from 'ink';
import { useUIStore } from '../stores/ui-store.js';

interface KeyHandler {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  handler: () => void;
}

interface UseKeyboardNavOptions {
  handlers?: KeyHandler[];
  enableVimNav?: boolean;
}

export function useKeyboardNav(options: UseKeyboardNavOptions = {}) {
  const { enableVimNav = true, handlers = [] } = options;
  const { focusNext, focusPrevious } = useFocusManager();
  const { toggleHelp, goBack } = useUIStore();

  useInput((input, key) => {
    // Global handlers
    if (input === '?') {
      toggleHelp();
      return;
    }

    if (input === 'q' || key.escape) {
      goBack();
      return;
    }

    // Vim-style navigation
    if (enableVimNav) {
      if (input === 'j' || key.downArrow) {
        focusNext();
        return;
      }
      if (input === 'k' || key.upArrow) {
        focusPrevious();
        return;
      }
    }

    // Custom handlers
    for (const handler of handlers) {
      const keyMatch = input === handler.key;
      const ctrlMatch = handler.ctrl ? key.ctrl : !key.ctrl;
      const shiftMatch = handler.shift ? key.shift : true;

      if (keyMatch && ctrlMatch && shiftMatch) {
        handler.handler();
        return;
      }
    }
  });
}
```

### useLiveAssignments.ts

```tsx
import { useState, useEffect } from 'react';
import { eventBus } from '../core/event-bus.js';
import { AssignmentManager } from '../../core/assignment-manager.js';

export function useLiveAssignments() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);

  useEffect(() => {
    // Load initial data
    const manager = new AssignmentManager(process.cwd());
    manager.initialize().then(() => {
      setAssignments(manager.getAllAssignments());
    });

    // Subscribe to updates
    const unsubscribe = eventBus.on('assignment:update', (update) => {
      setAssignments(prev =>
        prev.map(a => a.id === update.id ? { ...a, ...update } : a)
      );
    });

    return unsubscribe;
  }, []);

  return assignments;
}
```

### useLogStream.ts

```tsx
import { useState, useEffect } from 'react';
import { eventBus } from '../core/event-bus.js';

interface LogEntry {
  timestamp: Date;
  message: string;
  level: 'info' | 'warn' | 'error' | 'debug';
}

export function useLogStream(instanceId: string, maxEntries = 100) {
  const [logs, setLogs] = useState<LogEntry[]>([]);

  useEffect(() => {
    const unsubscribe = eventBus.on(`instance:log:${instanceId}`, (entry: LogEntry) => {
      setLogs(prev => {
        const next = [...prev, entry];
        // Ring buffer - keep last N entries
        return next.slice(-maxEntries);
      });
    });

    return unsubscribe;
  }, [instanceId, maxEntries]);

  return logs;
}
```

---

## Stores

### ui-store.ts

```tsx
import { create } from 'zustand';

type ViewType = 'status' | 'orchestrator' | 'project' | 'review' | 'config' | 'help';

interface Notification {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  timestamp: Date;
}

interface UIState {
  // Navigation
  currentView: ViewType;
  breadcrumbs: string[];
  history: ViewType[];

  // UI State
  showHelp: boolean;
  selectedIndex: number;
  notifications: Notification[];

  // Actions
  navigate: (view: ViewType) => void;
  goBack: () => void;
  toggleHelp: () => void;
  setSelectedIndex: (index: number) => void;
  notify: (message: string, type: Notification['type']) => void;
  dismissNotification: (id: string) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  currentView: 'status',
  breadcrumbs: ['Status'],
  history: [],
  showHelp: false,
  selectedIndex: 0,
  notifications: [],

  navigate: (view) => set((state) => ({
    currentView: view,
    history: [...state.history, state.currentView],
    breadcrumbs: [...state.breadcrumbs, viewToLabel(view)],
    selectedIndex: 0,
  })),

  goBack: () => set((state) => {
    if (state.history.length === 0) return state;
    const newHistory = [...state.history];
    const previousView = newHistory.pop()!;
    return {
      currentView: previousView,
      history: newHistory,
      breadcrumbs: state.breadcrumbs.slice(0, -1),
      selectedIndex: 0,
    };
  }),

  toggleHelp: () => set((state) => ({ showHelp: !state.showHelp })),

  setSelectedIndex: (index) => set({ selectedIndex: index }),

  notify: (message, type) => set((state) => ({
    notifications: [
      ...state.notifications,
      {
        id: Date.now().toString(),
        message,
        type,
        timestamp: new Date(),
      },
    ],
  })),

  dismissNotification: (id) => set((state) => ({
    notifications: state.notifications.filter(n => n.id !== id),
  })),
}));

function viewToLabel(view: ViewType): string {
  const labels: Record<ViewType, string> = {
    status: 'Status',
    orchestrator: 'Orchestrator',
    project: 'Projects',
    review: 'Review',
    config: 'Config',
    help: 'Help',
  };
  return labels[view];
}
```

---

## Usage Example

### StatusPage.tsx (Complete)

```tsx
import React, { useEffect } from 'react';
import { Box } from 'ink';
import { Dashboard } from '../organisms/Dashboard.js';
import { useKeyboardNav } from '../hooks/useKeyboardNav.js';
import { useUIStore } from '../stores/ui-store.js';
import { useOrchestratorStore } from '../stores/orchestrator-store.js';

export function StatusPage() {
  const { navigate, notify } = useUIStore();
  const { start, stop, status } = useOrchestratorStore();

  // Keyboard navigation with custom handlers
  useKeyboardNav({
    enableVimNav: true,
    handlers: [
      {
        key: 's',
        handler: async () => {
          if (status === 'idle') {
            await start({});
            notify('Orchestrator started', 'success');
          }
        },
      },
      {
        key: 'x',
        handler: async () => {
          if (status === 'running') {
            await stop();
            notify('Orchestrator stopped', 'info');
          }
        },
      },
      {
        key: 'r',
        handler: () => {
          // Trigger refresh
          notify('Refreshing...', 'info');
        },
      },
      {
        key: 'Enter',
        handler: () => {
          // Open details for selected item
          navigate('review');
        },
      },
    ],
  });

  return (
    <Box flexDirection="column" width="100%">
      <Dashboard />
    </Box>
  );
}
```

---

*These examples demonstrate the practical implementation of the Ink UI specification for the autonomous CLI.*
