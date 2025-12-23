# Ink UI Design Summary

## Overview
Complete redesign of autonomous CLI from Commander.js to React-based Ink terminal UI.

## Philosophy: "Think Big, Be Bold"
- THINK: Intelligent visualizations of LLM orchestration
- BIG: Enterprise scale (100+ issues, multiple projects)  
- BE: Confident real-time status with immediate feedback
- BOLD: Decisive keyboard-first navigation

## Key Technologies
- Ink 4.x (React for terminal)
- @inkjs/ui (UI components)
- @pppp606/ink-chart (Sparklines, bar charts)
- Zustand (State management)

## Architecture Layers
1. Atoms: StatusBadge, TimeAgo, Hotkey, Divider
2. Molecules: AssignmentCard, InstanceCard, LogStream, ProgressTracker
3. Organisms: Dashboard, AssignmentPipeline, ProjectBrowser, ReviewPanel
4. Pages: StatusPage, OrchestratorPage, ProjectPage, ReviewPage, ConfigPage

## State Stores
- assignment-store: Issue tracking and lifecycle
- orchestrator-store: LLM instance management
- project-store: GitHub Projects integration
- ui-store: Navigation and UI state

## Key Features
- Real-time event streaming
- Vim-inspired keyboard navigation (j/k, h/l, g/G)
- Multi-panel dashboard layouts
- Progressive disclosure (summary → details)
- Full accessibility (ARIA, keyboard-only)

## Documentation
See claudedocs/INK_UI_SPECIFICATION.md for full spec
See claudedocs/INK_COMPONENT_EXAMPLES.md for code examples
