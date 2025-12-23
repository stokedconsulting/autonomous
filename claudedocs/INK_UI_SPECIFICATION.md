# Ink UI Specification: Autonomous CLI

> **"Think Big, Be Bold"** - A comprehensive design specification for transforming the autonomous CLI into a modern, React-based terminal interface using Ink.

---

## Executive Summary

This specification outlines the complete redesign of the `autonomous` CLI from a Commander.js-based static interface to a dynamic, React-powered terminal UI using Ink. The design philosophy centers on **"Think Big, Be Bold"**:

- **THINK**: Show intelligent decision-making with real-time visualizations
- **BIG**: Scale to enterprise workflows (100+ issues, multiple projects)
- **BE**: Present confident, real-time status with clear indicators
- **BOLD**: Take decisive automated actions with immediate feedback

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Component Hierarchy](#component-hierarchy)
3. [State Management](#state-management)
4. [Real-Time Data Streaming](#real-time-data-streaming)
5. [Keyboard Navigation](#keyboard-navigation)
6. [Visual Theme System](#visual-theme-system)
7. [Page Designs](#page-designs)
8. [Technical Implementation](#technical-implementation)
9. [Testing Strategy](#testing-strategy)
10. [Migration Plan](#migration-plan)

---

## Architecture Overview

### Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| UI Framework | Ink 4.x | React renderer for terminal |
| Components | @inkjs/ui | Pre-built UI primitives |
| Charts | @pppp606/ink-chart | Sparklines, bar charts |
| State | Zustand | Lightweight state management |
| Testing | ink-testing-library | Component testing |

### Design Principles

1. **Declarative UI**: React components describing terminal output
2. **Real-time Updates**: Event-driven data streaming
3. **Keyboard-First**: Vim-inspired navigation
4. **Progressive Disclosure**: Summary views expanding to details
5. **Accessibility**: Screen reader support via ARIA

---

## Component Hierarchy

```
src/ui/
├── index.tsx                  # Entry point
├── App.tsx                    # Root with routing
│
├── atoms/                     # Primitives
│   ├── StatusBadge.tsx        # Status indicator
│   ├── TimeAgo.tsx            # Relative time
│   ├── Hotkey.tsx             # Keyboard shortcut
│   ├── Divider.tsx            # Separators
│   ├── Shimmer.tsx            # Loading skeleton
│   └── Truncate.tsx           # Text truncation
│
├── molecules/                 # Composites
│   ├── AssignmentCard.tsx     # Assignment display
│   ├── InstanceCard.tsx       # LLM instance
│   ├── LogStream.tsx          # Real-time logs
│   ├── ProgressTracker.tsx    # Multi-step progress
│   ├── ReviewScore.tsx        # Persona result
│   └── GitBranch.tsx          # Branch visualization
│
├── organisms/                 # Complex components
│   ├── Dashboard.tsx          # Main dashboard
│   ├── AssignmentPipeline.tsx # Pipeline stages
│   ├── InstanceGrid.tsx       # Instance grid
│   ├── ProjectBrowser.tsx     # Project/issue tree
│   ├── ReviewPanel.tsx        # Multi-persona review
│   ├── ConfigEditor.tsx       # Configuration form
│   └── MergeWizard.tsx        # Merge confirmation
│
├── pages/                     # Full views
│   ├── StatusPage.tsx         # Watch mode
│   ├── OrchestratorPage.tsx   # Start mode
│   ├── ProjectPage.tsx        # Project browser
│   ├── ReviewPage.tsx         # Review dashboard
│   ├── ConfigPage.tsx         # Setup wizard
│   └── HelpPage.tsx           # Interactive help
│
├── hooks/                     # Custom hooks
│   ├── useKeyboardNav.ts      # Navigation
│   ├── useEventStream.ts      # Real-time events
│   ├── useLiveAssignments.ts  # Live data
│   ├── useLogStream.ts        # Log streaming
│   └── useTerminalSize.ts     # Responsive
│
├── stores/                    # State stores
│   ├── assignment-store.ts
│   ├── orchestrator-store.ts
│   ├── project-store.ts
│   └── ui-store.ts
│
└── themes/                    # Theming
    ├── bold-theme.ts
    └── icons.ts
```

---

## State Management

### Store Architecture (Zustand)

```typescript
// Assignment Store
interface AssignmentStore {
  assignments: Map<number, Assignment>
  selectedIssue: number | null
  filter: AssignmentFilter

  // Selectors
  getByStatus: (status: AssignmentStatus) => Assignment[]
  getActive: () => Assignment[]

  // Actions
  loadAssignments: () => Promise<void>
  updateAssignment: (id: number, update: Partial<Assignment>) => void
  selectIssue: (id: number | null) => void
}

// Orchestrator Store
interface OrchestratorStore {
  instances: Map<string, LLMInstance>
  logs: Map<string, LogEntry[]>
  status: 'idle' | 'starting' | 'running' | 'stopping'

  // Real-time subscriptions
  subscribeToLogs: (instanceId: string) => void
  unsubscribeLogs: () => void

  // Actions
  start: (options: StartOptions) => Promise<void>
  stop: (force?: boolean) => Promise<void>
}

// UI Store
interface UIStore {
  currentView: ViewType
  breadcrumbs: string[]
  showHelp: boolean
  notifications: Notification[]
  confirmDialog: ConfirmDialogState | null

  navigate: (view: ViewType) => void
  notify: (message: string, type: NotificationType) => void
  confirm: (options: ConfirmOptions) => Promise<boolean>
}
```

---

## Real-Time Data Streaming

### Event Bus Architecture

```typescript
type EventType =
  | 'instance:log'
  | 'instance:status'
  | 'assignment:update'
  | 'github:webhook'
  | 'git:operation'
  | 'process:health';

class EventBus {
  emit<T>(event: EventType, data: T): void
  on<T>(event: EventType, handler: (data: T) => void): () => void
  once<T>(event: EventType, handler: (data: T) => void): void
}
```

### React Integration Hooks

```typescript
// Generic event stream hook
function useEventStream<T>(eventType: EventType): T[] {
  const [events, setEvents] = useState<T[]>([]);

  useEffect(() => {
    const unsubscribe = eventBus.on(eventType, (data) => {
      setEvents(prev => [...prev.slice(-100), data]); // Ring buffer
    });
    return unsubscribe;
  }, [eventType]);

  return events;
}

// Specialized hooks
function useLogStream(instanceId: string): LogEntry[]
function useLiveAssignments(): Assignment[]
function useInstanceHealth(instanceId: string): HealthMetrics
```

---

## Keyboard Navigation

### Global Hotkeys

| Key | Action |
|-----|--------|
| `?` | Show help overlay |
| `q` | Quit / Back |
| `Esc` | Cancel / Close modal |
| `:` | Command palette |
| `/` | Search / Filter |
| `Tab` | Next focusable |
| `S-Tab` | Previous focusable |
| `Enter` | Select / Confirm |
| `Space` | Toggle / Expand |

### Navigation Keys (Vim-style)

| Key | Action |
|-----|--------|
| `j` / `↓` | Move down |
| `k` / `↑` | Move up |
| `h` / `←` | Move left / Collapse |
| `l` / `→` | Move right / Expand |
| `g` | Go to top |
| `G` | Go to bottom |
| `Ctrl+d` | Page down |
| `Ctrl+u` | Page up |

### Context-Specific Shortcuts

**Dashboard:**
| Key | Action |
|-----|--------|
| `r` | Refresh |
| `s` | Start orchestrator |
| `x` | Stop orchestrator |
| `1-9` | Jump to assignment |

**Review Mode:**
| Key | Action |
|-----|--------|
| `y` | Approve |
| `n` | Reject |
| `c` | Comment |
| `d` | View diff |

---

## Visual Theme System

### Color Palette

```typescript
const BoldTheme = {
  // Primary Brand
  primary: '#00D9FF',    // Cyan - "Think"
  secondary: '#FF6B6B',  // Coral - "Bold"
  accent: '#FFD93D',     // Gold - success

  // Status Colors
  status: {
    assigned: '#6C7A89',
    inProgress: '#00D9FF',
    devComplete: '#4ECDC4',
    mergeReview: '#9B59B6',
    stageReady: '#3498DB',
    merged: '#2ECC71',
    failed: '#E74C3C',
  },

  // Semantic
  success: '#2ECC71',
  warning: '#F39C12',
  error: '#E74C3C',
  info: '#3498DB',
};
```

### Iconography (Unicode)

```typescript
const Icons = {
  // Status
  pending: '○',
  inProgress: '◐',
  complete: '●',
  failed: '✕',

  // Actions
  start: '▶',
  stop: '■',
  pause: '⏸',

  // Navigation
  expand: '▸',
  collapse: '▾',
  breadcrumb: '›',

  // Semantic
  success: '✓',
  warning: '⚠',
  error: '✗',
  info: 'ℹ',

  // Entities
  issue: '#',
  branch: '⎇',
  pr: '⎔',
  llm: '🤖',
};
```

---

## Page Designs

### 1. Dashboard (StatusPage)

```
╔═══════════════════════════════════════════════════════════════════════╗
║  🤖 AUTONOMOUS                              ◐ Running    [?] Help     ║
╚═══════════════════════════════════════════════════════════════════════╝

┌─ Summary ──────────────────────────────────────────────────────────────┐
│  Total: 12    Assigned: 2    In Progress: 3    Complete: 5    Merged: 2│
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  42% pipeline fill │
└────────────────────────────────────────────────────────────────────────┘

┌─ Active Instances ─────────────────────────────────────────────────────┐
│ 🤖 claude-1 │ #42 Add auth middleware │ ◐ In Progress │ 12m ago       │
│   ▁▂▃▄▅▆▇█▇▅▃▂▁▂▃▄  CPU: 45%  Memory: 2.1GB                           │
└────────────────────────────────────────────────────────────────────────┘

┌─ Pipeline ─────────────────────────────────────────────────────────────┐
│   Ready     In Progress   Dev Complete   Merge Review   Merged         │
│    [2]    →    [3]      →     [2]      →    [1]       →  [4]          │
└────────────────────────────────────────────────────────────────────────┘

[j/k] Navigate  [Enter] Details  [s] Start  [x] Stop  [r] Refresh
```

### 2. Multi-Persona Review

```
╔═══════════════════════════════════════════════════════════════════════╗
║  🔍 CODE REVIEW - #42 Add auth middleware            [2/5 Personas]   ║
╚═══════════════════════════════════════════════════════════════════════╝

┌─ Persona Results ──────────────────────────────────────────────────────┐
│ 🏛️ Architect          ✓ PASSED                          Score: 8/10   │
│   ✓ Clean separation of concerns                                       │
│   ⚠ Consider adding rate limiting layer                                │
├────────────────────────────────────────────────────────────────────────┤
│ 🛡️ Security Engineer   ◐ REVIEWING...                                 │
│   ▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░  45% complete                             │
├────────────────────────────────────────────────────────────────────────┤
│ 👤 Product Manager     ○ Pending                                       │
│ 🧑‍💻 Senior Engineer    ○ Pending                                       │
│ 🧪 QA Engineer         ○ Pending                                       │
└────────────────────────────────────────────────────────────────────────┘

[y] Approve All   [n] Reject   [c] Comment   [d] Full Diff
```

### 3. Project Browser

```
╔═══════════════════════════════════════════════════════════════════════╗
║  📋 PROJECT BROWSER                          stoked/autonomous       ║
╚═══════════════════════════════════════════════════════════════════════╝

┌─ Projects ─────────────────────────────────────────────────────────────┐
│ 🔎 Search projects...                                                 │
│                                                                        │
│ ▾ 📋 Bug Bash Q4 (8 items)                           Active           │
│     ├─ ● #42 Add auth middleware              In Progress   High      │
│     ├─ ● #38 Fix API rate limit               In Progress   High      │
│     ├─ ○ #45 Optimize queries                 Ready         Medium    │
│     ├─ ✓ #41 Fix login redirect               Merged        Low       │
│     └─ ✓ #39 Update deps                      Merged        Low       │
│                                                                        │
│ ▸ 📋 v2.0 Release (12 items)                         In Progress      │
│ ▸ 📋 Tech Debt (15 items)                            Backlog          │
└────────────────────────────────────────────────────────────────────────┘

[/] Search  [n] New  [a] Assign  [Enter] Open  [h/l] Collapse/Expand
```

### 4. Configuration Wizard

```
╔═══════════════════════════════════════════════════════════════════════╗
║  ⚙️ SETUP WIZARD                              Step 2 of 4 ▓▓▓▓░░░░   ║
╚═══════════════════════════════════════════════════════════════════════╝

┌─ LLM Provider Configuration ───────────────────────────────────────────┐
│                                                                        │
│  Select LLM providers to enable:                                       │
│                                                                        │
│     [✓] Claude (Anthropic)           ✓ Detected: /usr/local/bin/claude│
│         └─ Additional args: [--dangerously-skip-permissions        ]  │
│                                                                        │
│     [ ] Gemini (Google)              ⚠ Not detected                   │
│     [ ] Codex (OpenAI)               ⚠ Not detected                   │
│                                                                        │
│  Hooks:  [✓] Enable Claude hooks for status updates                   │
│  Max concurrent instances: [3           ]                              │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘

                    [←] Back   [→] Next   [Esc] Cancel
```

---

## Technical Implementation

### Dependencies

```json
{
  "dependencies": {
    "ink": "^4.4.1",
    "@inkjs/ui": "^2.0.0",
    "@pppp606/ink-chart": "^1.0.0",
    "zustand": "^4.5.0",
    "react": "^18.2.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "ink-testing-library": "^3.0.0"
  }
}
```

### Entry Point

```typescript
// src/ui/index.tsx
#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import { App } from './App.js';

const program = new Command();

program.command('status').action(() => renderApp('status'));
program.command('start').action((opts) => renderApp('orchestrator', opts));
program.command('project').action(() => renderApp('project'));
program.command('review').action((opts) => renderApp('review', opts));
program.command('config').action(() => renderApp('config'));

function renderApp(view: ViewType, options = {}) {
  render(<App initialView={view} options={options} />);
}
```

### App Root

```typescript
// src/ui/App.tsx
import React, { useEffect } from 'react';
import { Box, useApp, useInput } from 'ink';
import { useUIStore } from './stores/ui-store.js';

export function App({ initialView, options }) {
  const { exit } = useApp();
  const { currentView, showHelp, navigate } = useUIStore();

  useEffect(() => {
    navigate(initialView);
  }, [initialView]);

  useInput((input, key) => {
    if (input === 'q') exit();
    if (input === '?') useUIStore.getState().toggleHelp();
  });

  return (
    <ErrorBoundary>
      <Box flexDirection="column" width="100%">
        <Router currentView={currentView} options={options} />
        <NotificationBar />
        {showHelp && <HelpOverlay />}
      </Box>
    </ErrorBoundary>
  );
}
```

---

## Testing Strategy

### Component Testing

```typescript
// tests/atoms/StatusBadge.test.tsx
import { render } from 'ink-testing-library';
import { StatusBadge } from '../src/ui/atoms/StatusBadge.js';

describe('StatusBadge', () => {
  it('renders in-progress status', () => {
    const { lastFrame } = render(<StatusBadge status="in-progress" />);
    expect(lastFrame()).toContain('◐');
    expect(lastFrame()).toContain('In Progress');
  });

  it('renders with correct colors', () => {
    const { lastFrame } = render(<StatusBadge status="merged" />);
    expect(lastFrame()).toContain('✓');
  });
});
```

### Integration Testing

```typescript
describe('StatusPage', () => {
  it('displays assignments grouped by status', async () => {
    const { lastFrame } = render(<StatusPage />);

    await waitFor(() => {
      expect(lastFrame()).toContain('In Progress');
      expect(lastFrame()).toContain('#42');
    });
  });
});
```

### Keyboard Navigation Testing

```typescript
describe('Keyboard Navigation', () => {
  it('navigates with j/k keys', () => {
    const { stdin, lastFrame } = render(<ProjectBrowser />);

    stdin.write('j');
    expect(lastFrame()).toContain('▸ #42');

    stdin.write('k');
    expect(lastFrame()).toContain('▸ #41');
  });
});
```

---

## Migration Plan

### Phase 1: Infrastructure (Week 1-2)
- [ ] Add Ink dependencies
- [ ] Create `src/ui/` directory structure
- [ ] Set up Zustand stores
- [ ] Implement event bus

### Phase 2: Atoms & Molecules (Week 2-3)
- [ ] Build primitive components (StatusBadge, TimeAgo, etc.)
- [ ] Build composite components (AssignmentCard, InstanceCard, etc.)
- [ ] Write unit tests for all components

### Phase 3: Organisms & Pages (Week 3-4)
- [ ] Build Dashboard organism
- [ ] Build StatusPage
- [ ] Build OrchestratorPage
- [ ] Build ProjectPage

### Phase 4: Integration (Week 4-5)
- [ ] Wire UI to existing core logic
- [ ] Implement real-time streaming
- [ ] Add keyboard navigation
- [ ] Integration testing

### Phase 5: Polish (Week 5-6)
- [ ] Accessibility audit
- [ ] Performance optimization
- [ ] Documentation
- [ ] Deprecate Commander.js code

---

## Accessibility Checklist

- [ ] All interactive elements are keyboard accessible
- [ ] Focus indicators are visible
- [ ] ARIA roles and labels are applied
- [ ] Color contrast meets WCAG AA (4.5:1)
- [ ] Status information conveyed without color alone
- [ ] Screen reader announces state changes
- [ ] `--no-color` flag supported
- [ ] Animation respects `prefers-reduced-motion`

---

## Conclusion

This specification provides a complete blueprint for transforming the autonomous CLI into a modern, React-based terminal interface. The **"Think Big, Be Bold"** philosophy drives every design decision:

- **Think**: Intelligent visualizations of LLM orchestration
- **Big**: Enterprise-scale with 100+ issues and multiple projects
- **Be**: Confident, real-time status with immediate feedback
- **Bold**: Decisive keyboard-first navigation and actions

The Ink-based architecture enables:
- Declarative, maintainable UI code
- Real-time data streaming
- Component reusability
- Comprehensive testing
- Accessibility by default

---

*Generated with Claude Code - Think Big, Be Bold*
