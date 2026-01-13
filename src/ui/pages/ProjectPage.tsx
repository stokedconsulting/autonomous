/**
 * ProjectPage - Comprehensive GitHub Project browser with phase hierarchy
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { Spinner, TextInput } from '@inkjs/ui';
import { Header } from '../organisms/Header.js';
import { HelpOverlay } from '../organisms/HelpOverlay.js';
import { Divider } from '../atoms/Divider.js';
import { useUIStore } from '../stores/ui-store.js';
import { useAssignmentStore } from '../stores/assignment-store.js';
import { useKeyboardNav } from '../hooks/useKeyboardNav.js';
import { ProjectCreator } from '../components/ProjectCreator.js';
import { ProjectCreationApp } from '../apps/ProjectCreationApp.js';
import { ProjectDiscovery } from '../../github/project-discovery.js';
import { GitHubProjectsAPI } from '../../github/projects-api.js';
import { isPhaseMaster, groupItemsByPhase } from '../../utils/phase-dependencies.js';
import type { ProjectItem } from '../../github/projects-api.js';
import { debugLog, clearDebugLog } from '../../utils/debug-logger.js';

interface GitHubProject {
  id: string;
  title: string;
  number: number;
  url: string;
  items: ProjectItem[];
}

interface PhaseGroup {
  phaseName: string;
  phaseNumber: number;
  masterItem: ProjectItem | null;
  workItems: ProjectItem[];
}

interface ProjectHierarchy {
  project: GitHubProject;
  phases: PhaseGroup[];
  totalItems: number;
  completedItems: number;
  inProgressItems: number;
  loading?: boolean;
}

type SelectableItem =
  | { type: 'project'; projectNumber: number }
  | { type: 'phase-master'; projectNumber: number; phaseNumber: number; item: ProjectItem }
  | { type: 'phase-item'; projectNumber: number; phaseNumber: number; item: ProjectItem };

export function ProjectPage(): React.ReactElement {
  const [projects, setProjects] = useState<GitHubProject[]>([]);
  const [projectHierarchies, setProjectHierarchies] = useState<Map<number, ProjectHierarchy>>(new Map());
  const [loading, setLoading] = useState(true);
  const [expandedProjects, setExpandedProjects] = useState<Set<number>>(new Set());
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set()); // "projectNum-phaseNum"
  const [createMode, setCreateMode] = useState(false);
  const [reviewedMode, setReviewedMode] = useState(false);
  const [reviewedDescription, setReviewedDescription] = useState('');
  const [reviewedDescriptionSubmitted, setReviewedDescriptionSubmitted] = useState(false);
  const [config, setConfig] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCompletedProjects, setShowCompletedProjects] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<GitHubProject | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0); // Trigger to reload projects

  const setTextInputActive = useUIStore((s) => s.setTextInputActive);
  const selectedIndex = useUIStore((s) => s.selectedIndex);
  const navigate = useUIStore((s) => s.navigate);
  const notify = useUIStore((s) => s.notify);
  const assignmentManager = useAssignmentStore((s) => s.assignmentManager);

  // Clear debug log on mount
  useEffect(() => {
    clearDebugLog();
    debugLog('ProjectPage mounted');
  }, []);

  const [adapter, setAdapter] = useState<any>(null); // LLMAdapter type

  // Load config and create adapter
  useEffect(() => {
    async function loadConfig() {
      try {
        const { ConfigManager } = await import('../../core/config-manager.js');
        const { LLMFactory } = await import('../../llm/llm-factory.js');

        const configManager = new ConfigManager(process.cwd());
        await configManager.initialize();
        const conf = configManager.getConfig();
        setConfig(conf);

        if (conf.llms) {
          try {
            // Determine available providers
            const providers = Object.keys(conf.llms);

            // Pick a default: prefer 'stoked', then 'claude', then any enabled
            let defaultProvider = 'claude';
            const llmsAny = conf.llms as any;

            if (llmsAny['stoked']?.enabled) {
              defaultProvider = 'stoked';
            } else if (llmsAny['claude']?.enabled) {
              defaultProvider = 'claude';
            } else {
              const firstEnabled = providers.find(p => llmsAny[p]?.enabled);
              if (firstEnabled) defaultProvider = firstEnabled;
            }

            // Create adapter (verbose=false to avoid log spam in TUI)
            const dataDir = process.cwd();
            // Cast defaultProvider to any to satisfy LLMProvider type
            const createdAdapter = LLMFactory.create([defaultProvider as any], conf.llms, dataDir, false);
            setAdapter(createdAdapter);
          } catch (err) {
            console.error("Failed to create adapter:", err);
          }
        }
      } catch (error) {
        setError('Failed to load config');
      }
    }
    loadConfig();
  }, []);

  // Load projects list from GitHub (lightweight)
  useEffect(() => {
    // Early exit if no config - don't change loading state
    if (!config) {
      debugLog('[ProjectPage] No config, skipping project load');
      return;
    }

    // Track if effect is still active (not cleaned up)
    let isCancelled = false;

    async function loadProjects() {
      debugLog('[ProjectPage] Loading projects...');
      setLoading(true);
      setError(null);

      try {
        const discovery = new ProjectDiscovery(config.github.owner, config.github.repo);
        const discoveredProjects = await discovery.getLinkedProjects();
        debugLog(`[ProjectPage] Discovered ${discoveredProjects.length} projects`);

        // Only update state if effect is still active
        if (isCancelled) {
          debugLog('[ProjectPage] Effect cancelled, skipping state update');
          return;
        }

        // Map to GitHubProject (add items array)
        const projectsWithItems: GitHubProject[] = discoveredProjects.map(p => ({
          ...p,
          items: [],
        }));

        setProjects(projectsWithItems);
        debugLog('[ProjectPage] Projects loaded successfully');
      } catch (err) {
        debugLog(`[ProjectPage] Error loading projects: ${err instanceof Error ? err.message : String(err)}`);
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load projects');
        }
      } finally {
        // Always set loading to false when done, unless cancelled
        if (!isCancelled) {
          setLoading(false);
          debugLog('[ProjectPage] Loading state set to false');
        }
      }
    }

    loadProjects();

    // Cleanup function to prevent state updates after unmount/re-run
    return () => {
      isCancelled = true;
      debugLog('[ProjectPage] Effect cleanup - cancelled');
    };
  }, [config, refreshKey]);

  // Load project items when expanded
  useEffect(() => {
    async function loadProjectItems(projectNumber: number) {
      debugLog(`[ProjectPage] loadProjectItems called for project #${projectNumber}`);

      // Skip if already loaded or currently loading
      const existing = projectHierarchies.get(projectNumber);
      if (existing) {
        debugLog(`[ProjectPage] Project #${projectNumber} already has hierarchy, skipping`);
        return; // Already started or completed
      }

      const project = projects.find(p => p.number === projectNumber);
      if (!project || !config) {
        debugLog(`[ProjectPage] Project #${projectNumber} not found or no config`);
        return;
      }

      debugLog(`[ProjectPage] Marking project #${projectNumber} as loading`);
      // Mark as loading
      setProjectHierarchies(prev => new Map(prev).set(projectNumber, {
        project: { ...project, items: [] },
        phases: [],
        totalItems: 0,
        completedItems: 0,
        inProgressItems: 0,
        loading: true,
      }));

      try {
        debugLog(`[ProjectPage] Fetching items for project #${projectNumber} (${project.id})`);
        const api = new GitHubProjectsAPI(project.id, config.project);
        const items = await api.getAllItems();
        debugLog(`[ProjectPage] Fetched ${items.length} items for project #${projectNumber}`);

        // Group by phases
        const phaseMap = groupItemsByPhase(items);
        const phases: PhaseGroup[] = Array.from(phaseMap.values())
          .sort((a, b) => a.phaseNumber - b.phaseNumber)
          .map(phase => ({
            phaseName: phase.phaseName,
            phaseNumber: phase.phaseNumber,
            masterItem: phase.masterItem,
            workItems: phase.workItems.sort((a, b) => {
              const aNum = a.content.number || 0;
              const bNum = b.content.number || 0;
              return aNum - bNum;
            }),
          }));

        // Calculate completion stats
        const totalItems = items.length;
        const completedStatuses = ['Done', 'Dev Complete', 'Completed', 'Merged'];
        const inProgressStatuses = ['In Progress', 'In Review'];
        const completedItems = items.filter(item => {
          const status = item.fieldValues['Status'];
          return status && completedStatuses.includes(status);
        }).length;
        const inProgressItems = items.filter(item => {
          const status = item.fieldValues['Status'];
          return status && inProgressStatuses.includes(status);
        }).length;

        setProjectHierarchies(prev => new Map(prev).set(projectNumber, {
          project: { ...project, items },
          phases,
          totalItems,
          completedItems,
          inProgressItems,
          loading: false,
        }));
      } catch (err) {
        debugLog(`Failed to load items for project #${projectNumber}: ${err instanceof Error ? err.message : String(err)}`);

        // Mark as failed
        setProjectHierarchies(prev => new Map(prev).set(projectNumber, {
          project: { ...project, items: [] },
          phases: [],
          totalItems: 0,
          completedItems: 0,
          inProgressItems: 0,
          loading: false,
        }));
      }
    }

    // Load items for all expanded projects
    expandedProjects.forEach(projectNumber => {
      loadProjectItems(projectNumber);
    });
  }, [expandedProjects, projects, config]); // Removed projectHierarchies to prevent infinite loop

  // Build flat list of selectable items
  const flatItems: SelectableItem[] = [];
  projects
    .filter((project) => {
      const hierarchy = projectHierarchies.get(project.number);
      // Hide completed projects (all items Done)
      const isComplete = hierarchy &&
        hierarchy.totalItems > 0 &&
        hierarchy.completedItems === hierarchy.totalItems;
      return !isComplete;
    })
    .forEach(project => {
      const projectNumber = project.number;

      flatItems.push({ type: 'project', projectNumber });

      if (expandedProjects.has(projectNumber)) {
        const hierarchy = projectHierarchies.get(projectNumber);
        if (hierarchy && !hierarchy.loading) {
          hierarchy.phases.forEach(phase => {
            // Phase master
            if (phase.masterItem) {
              flatItems.push({
                type: 'phase-master',
                projectNumber,
                phaseNumber: phase.phaseNumber,
                item: phase.masterItem,
              });
            }

            // Phase work items (if phase is expanded)
            const phaseKey = `${projectNumber}-${phase.phaseNumber}`;
            if (expandedPhases.has(phaseKey)) {
              phase.workItems.forEach(item => {
                flatItems.push({
                  type: 'phase-item',
                  projectNumber,
                  phaseNumber: phase.phaseNumber,
                  item,
                });
              });
            }
          });
        }
      }
    });

  // Log flatItems state
  useEffect(() => {
    debugLog(`[ProjectPage] flatItems count: ${flatItems.length}, selectedIndex: ${selectedIndex}`);
  }, [flatItems.length, selectedIndex]);

  // Keyboard navigation
  useKeyboardNav({
    enableVimNav: true,
    maxItems: flatItems.length,
    handlers: [
      {
        key: 'n',
        handler: () => {
          if (config && !createMode && !reviewedMode) {
            setCreateMode(true);
          }
        },
      },
      {
        key: 'r',
        handler: () => {
          if (config && !createMode && !reviewedMode) {
            setReviewedMode(true);
          }
        },
      },
      {
        key: 'c',
        handler: () => {
          if (!createMode && !reviewedMode && !deleteConfirm) {
            setShowCompletedProjects(prev => !prev);
          }
        },
      },
      {
        key: 'D', // Shift+d for delete
        handler: () => {
          if (createMode || reviewedMode || deleteConfirm || deleting) return;

          const item = flatItems[selectedIndex];
          if (!item || item.type !== 'project') {
            notify('Select a project to delete', 'info');
            return;
          }

          const project = projects.find(p => p.number === item.projectNumber);
          if (project) {
            setDeleteConfirm(project);
          }
        },
      },
      {
        key: 'y', // Confirm delete
        handler: async () => {
          if (!deleteConfirm || deleting) return;

          setDeleting(true);
          try {
            const discovery = new ProjectDiscovery(config.github.owner, config.github.repo);
            await discovery.deleteProject(deleteConfirm.id);
            notify(`✓ Deleted project: ${deleteConfirm.title}`, 'success');

            // Remove from local state
            setProjects(prev => prev.filter(p => p.id !== deleteConfirm.id));
            setProjectHierarchies(prev => {
              const next = new Map(prev);
              next.delete(deleteConfirm.number);
              return next;
            });
          } catch (err) {
            notify(`Failed to delete: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
          } finally {
            setDeleting(false);
            setDeleteConfirm(null);
          }
        },
      },
      {
        key: 'n', // Cancel delete
        handler: () => {
          if (deleteConfirm) {
            setDeleteConfirm(null);
          }
        },
      },
      {
        key: 'escape',
        handler: () => {
          if (deleteConfirm) {
            setDeleteConfirm(null);
          }
        },
      },
      {
        key: 'space',
        handler: () => {
          const item = flatItems[selectedIndex];
          if (!item) return;

          if (item.type === 'project') {
            // Toggle project expansion
            setExpandedProjects(prev => {
              const next = new Set(prev);
              if (next.has(item.projectNumber)) {
                next.delete(item.projectNumber);
              } else {
                next.add(item.projectNumber);
              }
              return next;
            });
          } else if (item.type === 'phase-master') {
            // Toggle phase expansion
            const phaseKey = `${item.projectNumber}-${item.phaseNumber}`;
            setExpandedPhases(prev => {
              const next = new Set(prev);
              if (next.has(phaseKey)) {
                next.delete(phaseKey);
              } else {
                next.add(phaseKey);
              }
              return next;
            });
          }
        },
      },
      {
        key: 'return',  // Ink uses key.return, not input="enter"
        handler: () => {
          debugLog(`[ProjectPage] Enter key pressed, selectedIndex=${selectedIndex}, flatItems.length=${flatItems.length}`);
          const item = flatItems[selectedIndex];
          if (!item) {
            debugLog('[ProjectPage] No item at selectedIndex');
            return;
          }

          debugLog(`[ProjectPage] Item type=${item.type}, projectNumber=${item.projectNumber}`);

          if (item.type === 'project') {
            // Toggle project expansion
            setExpandedProjects(prev => {
              const next = new Set(prev);
              if (next.has(item.projectNumber)) {
                debugLog(`[ProjectPage] Collapsing project #${item.projectNumber}`);
                next.delete(item.projectNumber);
              } else {
                debugLog(`[ProjectPage] Expanding project #${item.projectNumber}`);
                next.add(item.projectNumber);
              }
              return next;
            });
          } else if (item.type === 'phase-master') {
            // Toggle phase expansion
            const phaseKey = `${item.projectNumber}-${item.phaseNumber}`;
            setExpandedPhases(prev => {
              const next = new Set(prev);
              if (next.has(phaseKey)) {
                next.delete(phaseKey);
              } else {
                next.add(phaseKey);
              }
              return next;
            });
          }
        },
      },
      {
        key: 'A', // Shift+a
        handler: async () => {
          const item = flatItems[selectedIndex];
          if (!item || !assignmentManager) return;

          let assignedCount = 0;

          if (item.type === 'project') {
            // Assign entire project
            const hierarchy = projectHierarchies.get(item.projectNumber);
            if (!hierarchy) return;

            // Assign all items in project
            for (const phase of hierarchy.phases) {
              if (phase.masterItem) {
                const assigned = await assignItem(phase.masterItem, item.projectNumber);
                if (assigned) assignedCount++;
              }
              for (const workItem of phase.workItems) {
                const assigned = await assignItem(workItem, item.projectNumber);
                if (assigned) assignedCount++;
              }
            }

            if (assignedCount > 0) {
              notify(`✓ Assigned ${assignedCount} item(s) from project`, 'success');
              // Navigate to orchestrator view to start processing
              navigate('orchestrator');
            } else {
              notify('All items already assigned', 'info');
            }
          } else if (item.type === 'phase-master') {
            // Assign entire phase (master + work items)
            const hierarchy = projectHierarchies.get(item.projectNumber);
            if (!hierarchy) return;

            const phase = hierarchy.phases.find(p => p.phaseNumber === item.phaseNumber);
            if (!phase) return;

            if (phase.masterItem) {
              const assigned = await assignItem(phase.masterItem, item.projectNumber);
              if (assigned) assignedCount++;
            }
            for (const workItem of phase.workItems) {
              const assigned = await assignItem(workItem, item.projectNumber);
              if (assigned) assignedCount++;
            }

            if (assignedCount > 0) {
              notify(`✓ Assigned ${assignedCount} item(s) from phase ${item.phaseNumber}`, 'success');
              navigate('orchestrator');
            } else {
              notify('All items already assigned', 'info');
            }
          } else if (item.type === 'phase-item') {
            // Assign single item
            const assigned = await assignItem(item.item, item.projectNumber);
            if (assigned) {
              notify(`✓ Assigned: ${item.item.content.title}`, 'success');
              navigate('orchestrator');
            } else {
              notify('Item already assigned', 'info');
            }
          }
        },
      },
    ],
  });

  // Helper to assign an item - returns true if assignment was created, false if already assigned
  async function assignItem(item: ProjectItem, projectNumber: number): Promise<boolean> {
    if (!assignmentManager || !config) return false;

    const issueNumber = item.content.number;
    if (!issueNumber) return false;

    // Check if already assigned
    const existing = assignmentManager.getAssignmentByIssue(issueNumber);
    if (existing) return false; // Already assigned

    // Create assignment
    const isMaster = isPhaseMaster(item.content.title);

    await assignmentManager.createAssignment({
      issueNumber,
      issueTitle: item.content.title,
      issueBody: '',
      issueUrl: item.content.url,
      llmProvider: config.llms?.defaultProvider || 'claude',
      worktreePath: '', // Will be set by orchestrator
      branchName: '', // Will be set by orchestrator
      projectNumber: projectNumber, // GitHub Project number
      requiresTests: true,
      requiresCI: true,
    });

    // Update assignment with phase master flag
    const assignment = assignmentManager.getAssignmentByIssue(issueNumber);
    if (assignment && isMaster) {
      await assignmentManager.updateAssignment(assignment.id, {
        metadata: { ...assignment.metadata, isPhaseMaster: true },
      } as any);
    }

    return true;
  }

  // Manage text input blocking
  useEffect(() => {
    setTextInputActive(createMode || reviewedMode);
    return () => setTextInputActive(false);
  }, [createMode, reviewedMode, setTextInputActive]);

  // Get status icon
  function getStatusIcon(status: string | undefined): string {
    if (!status) return '⭕';
    const completedStatuses = ['Done', 'Dev Complete', 'Completed', 'Merged'];
    if (completedStatuses.includes(status)) return '✅';
    if (status === 'In Progress') return '🔄';
    if (status === 'In Review') return '👀';
    return '⭕';
  }

  // Get status color
  function getStatusColor(status: string | undefined, isSelected: boolean): string {
    if (isSelected) {
      return 'cyan'; // Selected items always cyan for visibility
    }
    if (!status) return 'gray';
    const completedStatuses = ['Done', 'Dev Complete', 'Completed', 'Merged'];
    if (completedStatuses.includes(status)) return 'green';
    if (status === 'In Progress') return 'yellow';
    if (status === 'In Review') return 'magenta';
    return 'white';
  }

  const handleCreateComplete = () => {
    setCreateMode(false);
    setProjectHierarchies(new Map()); // Clear cached hierarchies
    setRefreshKey(prev => prev + 1); // Trigger project reload
  };

  const handleCreateCancel = () => {
    setCreateMode(false);
  };

  const handleReviewedComplete = async (implementationPlanPath: string) => {
    setReviewedMode(false);

    // Read the implementation plan
    const fs = await import('fs/promises');
    const planContent = await fs.readFile(implementationPlanPath, 'utf-8');

    // Parse plan into structured items
    const { parseProjectPlan, createProjectIssues } = await import('../../services/project-creation.js');
    const { projectTitle, items } = parseProjectPlan(planContent);

    // Create GitHub project
    const discovery = new ProjectDiscovery(config.github.owner, config.github.repo);
    const newProject = await discovery.createProject(projectTitle);
    await discovery.linkProjectToRepo(newProject.id);

    // Create issues and setup all template fields
    const api = new GitHubProjectsAPI(newProject.id, config.project);
    await api.ensureAllTemplateFields();

    await createProjectIssues(
      items,
      projectTitle,
      config.github.owner,
      config.github.repo,
      api,
      newProject.number,
      () => { } // No progress callback for now
    );

    setProjectHierarchies(new Map()); // Clear cached hierarchies
    setRefreshKey(prev => prev + 1); // Trigger project reload
  };

  const handleReviewedCancel = () => {
    setReviewedMode(false);
    setReviewedDescription('');
    setReviewedDescriptionSubmitted(false);
  };

  // Ensure we have an adapter before rendering create apps
  if ((createMode || reviewedMode) && !adapter) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="yellow">Initializing AI Adapter...</Text>
      </Box>
    );
  }

  // Render ProjectCreator when in create mode
  if (createMode && config && adapter) {
    return (
      <ProjectCreator
        owner={config.github.owner}
        repo={config.github.repo}
        // claudePath={config.llms?.claude?.cliPath || 'claude'}
        adapter={adapter}
        workingDirectory={process.cwd()}
        projectConfig={config.project}
        onComplete={handleCreateComplete}
        onCancel={handleCreateCancel}
      />
    );
  }

  // Render ProjectCreationApp when in reviewed mode
  if (reviewedMode && config && adapter) {
    if (!reviewedDescriptionSubmitted) {
      return (
        <Box flexDirection="column">
          <Header />
          <Box flexDirection="column" padding={1}>
            <Divider title="Create New Project (Reviewed)" />
            <Box marginBottom={1} marginTop={1}>
              <Text color="cyan">Describe your new project:</Text>
            </Box>
            <Box marginBottom={1}>
              <Text dimColor>
                Example: "Build a REST API with authentication and user management"
              </Text>
            </Box>
            <Box marginBottom={1}>
              <TextInput
                placeholder="Enter project description..."
                onSubmit={(value: string) => {
                  setReviewedDescription(value);
                  setReviewedDescriptionSubmitted(true);
                }}
              />
            </Box>
            <Box marginTop={1}>
              <Text dimColor>
                Press Enter to submit │ Esc: cancel
              </Text>
            </Box>
          </Box>
        </Box>
      );
    }

    return (
      <ProjectCreationApp
        description={reviewedDescription}
        // claudePath={config.llms?.claude?.cliPath || 'claude'}
        adapter={adapter}
        workingDirectory={process.cwd()}
        onComplete={handleReviewedComplete}
        onCancel={handleReviewedCancel}
      />
    );
  }

  return (
    <Box flexDirection="column">
      <Header />
      <HelpOverlay />

      <Box flexDirection="column" padding={1}>
        <Divider title="GitHub Projects" />

        {loading ? (
          <Box gap={1}>
            <Spinner label="Loading projects..." />
          </Box>
        ) : error ? (
          <Box flexDirection="column" padding={1}>
            <Text color="red">✗ Error: {error}</Text>
            <Text dimColor>Configure project with 'auto config'</Text>
          </Box>
        ) : projects.length === 0 ? (
          <Box padding={1}>
            <Text dimColor>No projects found. Press 'n' to create one.</Text>
          </Box>
        ) : (
          <Box flexDirection="column">
            {/* Render project hierarchies */}
            {projects
              .filter((project) => {
                // If showing completed projects, show all
                if (showCompletedProjects) {
                  return true;
                }
                // Otherwise, hide projects starting with [Done]
                return !project.title.startsWith('[Done]');
              })
              .map((project) => {
                const projectNumber = project.number;
                const hierarchy = projectHierarchies.get(projectNumber);
                const isProjectExpanded = expandedProjects.has(projectNumber);
                const projectIndex = flatItems.findIndex(
                  item => item.type === 'project' && item.projectNumber === projectNumber
                );
                const isProjectSelected = selectedIndex === projectIndex;

                // Check if project is 100% complete
                const isComplete = hierarchy &&
                  hierarchy.totalItems > 0 &&
                  hierarchy.completedItems === hierarchy.totalItems;

                // Check if project has items in progress
                const hasInProgress = hierarchy &&
                  hierarchy.inProgressItems &&
                  hierarchy.inProgressItems > 0;

                // Auto-prefix projects based on status
                let displayTitle = project.title;
                if (isComplete && !project.title.startsWith('[Done]')) {
                  // Remove [In Progress] if present and add [Done]
                  const baseTitle = project.title.replace('[In Progress] - ', '');
                  displayTitle = `[Done] - ${baseTitle}`;
                } else if (hasInProgress && !isComplete &&
                  !project.title.startsWith('[Done]') &&
                  !project.title.startsWith('[In Progress]')) {
                  displayTitle = `[In Progress] - ${project.title}`;
                }

                return (
                  <Box key={project.id} flexDirection="column" marginBottom={1}>
                    {/* Project Header */}
                    <Box
                      borderStyle="single"
                      borderColor={isProjectSelected ? 'cyan' : 'blue'}
                      paddingX={1}
                    >
                      <Text color={isProjectSelected ? 'cyan' : 'blue'} bold>
                        {isProjectSelected ? '▶ ' : '  '}{isProjectExpanded ? '📂' : '📁'} {displayTitle}
                      </Text>
                      <Text dimColor> (#{projectNumber})</Text>
                    </Box>

                    {/* Phases (when project expanded) */}
                    {isProjectExpanded && hierarchy && !hierarchy.loading && (
                      <Box flexDirection="column" marginLeft={2}>
                        {hierarchy.phases.map(phase => {
                          const phaseKey = `${projectNumber}-${phase.phaseNumber}`;
                          const isPhaseExpanded = expandedPhases.has(phaseKey);

                          return (
                            <Box key={phaseKey} flexDirection="column" marginTop={1}>
                              {/* Phase Master */}
                              {phase.masterItem && (() => {
                                const masterIndex = flatItems.findIndex(
                                  item => item.type === 'phase-master' &&
                                    item.projectNumber === projectNumber &&
                                    item.phaseNumber === phase.phaseNumber
                                );
                                const isMasterSelected = selectedIndex === masterIndex;
                                const status = phase.masterItem.fieldValues['Status'];
                                const icon = getStatusIcon(status);
                                const color = getStatusColor(status, isMasterSelected);
                                // Remove " - MASTER" suffix from title
                                const displayTitle = phase.masterItem.content.title.replace(/ - MASTER$/, '');

                                return (
                                  <Box
                                    borderStyle="single"
                                    borderColor={isMasterSelected ? 'cyan' : 'gray'}
                                    paddingX={1}
                                  >
                                    <Text color={color}>
                                      {isMasterSelected ? '▶ ' : '  '}{icon} {isPhaseExpanded ? '▼' : '▶'} {displayTitle}
                                    </Text>
                                  </Box>
                                );
                              })()}

                              {/* Phase Work Items (when phase expanded) */}
                              {isPhaseExpanded && (
                                <Box flexDirection="column" marginLeft={2}>
                                  {phase.workItems.map(workItem => {
                                    const itemIndex = flatItems.findIndex(
                                      item => item.type === 'phase-item' &&
                                        item.projectNumber === projectNumber &&
                                        item.phaseNumber === phase.phaseNumber &&
                                        item.item.id === workItem.id
                                    );
                                    const isItemSelected = selectedIndex === itemIndex;
                                    const status = workItem.fieldValues['Status'];
                                    const icon = getStatusIcon(status);
                                    const color = getStatusColor(status, isItemSelected);

                                    return (
                                      <Box key={workItem.id} marginTop={0.5}>
                                        <Text color={color}>
                                          {isItemSelected ? '▶ ' : '  '}{icon} {workItem.content.title}
                                        </Text>
                                      </Box>
                                    );
                                  })}
                                </Box>
                              )}
                            </Box>
                          );
                        })}
                      </Box>
                    )}
                  </Box>
                );
              })}
          </Box>
        )}

        {/* Delete Confirmation Dialog */}
        {deleteConfirm && (
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor="red"
            paddingX={2}
            paddingY={1}
            marginY={1}
          >
            <Text color="red" bold>⚠️  Delete Project?</Text>
            <Text>
              Are you sure you want to delete{' '}
              <Text color="cyan" bold>#{deleteConfirm.number}</Text>{' '}
              <Text bold>{deleteConfirm.title}</Text>?
            </Text>
            <Text dimColor>This action cannot be undone.</Text>
            <Box marginTop={1}>
              {deleting ? (
                <Box>
                  <Spinner label="Deleting..." />
                </Box>
              ) : (
                <Text>
                  Press <Text color="green" bold>y</Text> to confirm, <Text color="yellow" bold>n</Text> or <Text color="yellow" bold>Esc</Text> to cancel
                </Text>
              )}
            </Box>
          </Box>
        )}

        <Box marginTop={1} flexDirection="column">
          <Text dimColor>
            n: new project │ r: reviewed project │ c: toggle completed ({showCompletedProjects ? 'shown' : 'hidden'}) │ j/k: navigate ({selectedIndex + 1}/{flatItems.length}) │ Enter: open │ A: assign │ D: delete │ q: back │ ?: help
          </Text>
          {flatItems.length > 0 && flatItems[selectedIndex] && (
            <Text dimColor>
              Selected: {flatItems[selectedIndex].type} - {
                flatItems[selectedIndex].type === 'project'
                  ? `Project #${flatItems[selectedIndex].projectNumber}`
                  : flatItems[selectedIndex].type === 'phase-master'
                    ? `Phase ${flatItems[selectedIndex].phaseNumber} Master`
                    : `Phase ${flatItems[selectedIndex].phaseNumber} Item`
              }
            </Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}