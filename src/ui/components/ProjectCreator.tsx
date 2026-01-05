/**
 * ProjectCreator - TUI component for creating GitHub Projects
 *
 * Provides interactive workflow for:
 * 1. Entering project description
 * 2. Generating project plan using Claude
 * 3. Reviewing and refining plan
 * 4. Creating GitHub Project and issues
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { Spinner } from '@inkjs/ui';
import { Divider } from '../atoms/Divider.js';
import { TextArea } from './TextArea.js';
import { Header } from '../organisms/Header.js';
import {
  generateProjectPlan,
  refineProjectPlan,
  parseProjectPlan,
  createProjectIssues,
  ProjectPlan
} from '../../services/project-creation.js';
import { ProjectDiscovery } from '../../github/project-discovery.js';
import { GitHubProjectsAPI } from '../../github/projects-api.js';
import { ProjectConfig } from '../../types/config.js';
import { useUIStore } from '../stores/ui-store.js';

type WorkflowStage =
  | 'description'      // Getting project description
  | 'planning'         // Generating plan with Claude
  | 'review'           // Reviewing plan
  | 'feedback'         // Getting feedback for refinement
  | 'creating-project' // Creating GitHub Project
  | 'creating-issues'  // Creating issues
  | 'complete'         // Success
  | 'error';           // Error state

interface ProjectCreatorProps {
  owner: string;
  repo: string;
  claudePath: string;
  workingDirectory: string;
  projectConfig: ProjectConfig;
  onComplete: () => void;
  onCancel: () => void;
}

export function ProjectCreator({
  owner,
  repo,
  claudePath,
  workingDirectory,
  projectConfig,
  onComplete,
  onCancel,
}: ProjectCreatorProps): React.ReactElement {
  const [stage, setStage] = useState<WorkflowStage>('description');
  const [currentPlan, setCurrentPlan] = useState<string>('');
  const [parsedPlan, setParsedPlan] = useState<ProjectPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>('');
  const [issueProgress, setIssueProgress] = useState<{ current: number; total: number } | null>(null);
  const [createdProjectNumber, setCreatedProjectNumber] = useState<number | null>(null);
  const setTextInputActive = useUIStore((s) => s.setTextInputActive);

  /**
   * Manage global text input blocking based on current stage
   * Block global shortcuts during: description, feedback, AND review stages
   */
  useEffect(() => {
    const isInputStage = stage === 'description' || stage === 'feedback' || stage === 'review';
    setTextInputActive(isInputStage);

    // Cleanup on unmount
    return () => setTextInputActive(false);
  }, [stage, setTextInputActive]);

  /**
   * Keyboard handling for different stages
   * NOTE: TextArea handles its own input in description/feedback stages
   */
  useInput((input, key) => {
    // TextArea handles all input in description/feedback stages (including escape)
    const isInputStage = stage === 'description' || stage === 'feedback';
    if (isInputStage) {
      return;
    }

    // Handle Esc in review stage
    if (key.escape) {
      if (stage === 'review') {
        onCancel();
      }
    }

    // Handle review stage shortcuts
    if (stage === 'review') {
      if (input === 'a' || input === 'A' || input === 'y' || input === 'Y') {
        handleApprovePlan();
      } else if (input === 'f' || input === 'F') {
        setStage('feedback');
      } else if (input === 'c' || input === 'C') {
        onCancel();
      }
    }

    // Handle complete/error stages - any key goes back
    if (stage === 'complete' || stage === 'error') {
      onComplete();
    }
  });

  /**
   * Generate initial project plan
   */
  const handleGeneratePlan = async (projectDescription: string) => {
    setStage('planning');
    setProgress('Generating project plan with Claude...');

    try {
      const plan = await generateProjectPlan(projectDescription, claudePath, workingDirectory);
      setCurrentPlan(plan);
      // Skip review - go directly to creating project
      await handleApprovePlan(plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage('error');
    }
  };

  /**
   * Refine plan based on user feedback
   */
  const handleRefinePlan = async (feedback: string) => {
    setStage('planning');
    setProgress('Refining plan based on your feedback...');

    try {
      const refinedPlan = await refineProjectPlan(currentPlan, feedback, claudePath, workingDirectory);
      setCurrentPlan(refinedPlan);
      setStage('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage('error');
    }
  };

  /**
   * Approve plan and create project
   */
  const handleApprovePlan = async (planToUse?: string) => {
    setStage('creating-project');
    setProgress('Parsing project plan...');

    try {
      // Parse the plan (use provided plan or current plan)
      const parsed = parseProjectPlan(planToUse || currentPlan);
      setParsedPlan(parsed);

      // Create GitHub Project
      setProgress(`Creating GitHub Project: "${parsed.projectTitle}"...`);
      const discovery = new ProjectDiscovery(owner, repo);
      const newProject = await discovery.createProject(parsed.projectTitle);
      setCreatedProjectNumber(newProject.number);

      // Link project to repository
      setProgress('Linking project to repository...');
      await discovery.linkProjectToRepo(newProject.id);

      // Create issues
      setStage('creating-issues');
      setProgress(`Creating ${parsed.items.length} issues...`);

      const projectsAPI = new GitHubProjectsAPI(newProject.id, projectConfig);
      await projectsAPI.ensureAllTemplateFields();

      await createProjectIssues(
        parsed.items,
        parsed.projectTitle,
        owner,
        repo,
        projectsAPI,
        newProject.number,
        (current, total) => {
          setIssueProgress({ current, total });
        }
      );

      setStage('complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage('error');
    }
  };

  // Render description input stage
  if (stage === 'description') {
    return (
      <Box flexDirection="column">
        <Header />
        <Box flexDirection="column" padding={1}>
          <Divider title="Create New Project" />

          <Box marginBottom={1} marginTop={1}>
            <Text color="cyan">Describe your new project:</Text>
          </Box>

          <Box marginBottom={1}>
            <Text dimColor>
              Example: "Build a REST API with authentication and user management"
            </Text>
          </Box>

          <TextArea
            placeholder="Describe your project (multiple lines supported)..."
            minHeight={5}
            onSubmit={handleGeneratePlan}
            onCancel={onCancel}
          />

          <Box marginTop={1}>
            <Text dimColor>
              Tab: submit │ Enter: new line │ Esc: cancel
            </Text>
          </Box>
        </Box>
      </Box>
    );
  }

  // Render planning stage
  if (stage === 'planning') {
    return (
      <Box flexDirection="column">
        <Header />
        <Box flexDirection="column" padding={1}>
          <Divider title="Creating Project Plan" />
          <Box marginTop={1}>
            <Spinner label={progress} />
          </Box>
        </Box>
      </Box>
    );
  }

  // Render review stage
  if (stage === 'review') {
    return (
      <Box flexDirection="column">
        <Header />
        <Box flexDirection="column" padding={1}>
          <Divider title="Review Project Plan" />

          <Box marginTop={1} marginBottom={1} borderStyle="round" borderColor="cyan" padding={1}>
            <Text>{currentPlan}</Text>
          </Box>

          <Box flexDirection="column" marginTop={1}>
            <Text bold color="yellow">
              Review Options:
            </Text>
            <Text dimColor>  [a/y] - Approve and create project</Text>
            <Text dimColor>  [f] - Provide feedback to refine plan</Text>
            <Text dimColor>  [c] - Cancel and go back</Text>
          </Box>

          <Box marginTop={1}>
            <Text dimColor>
              Choose an option to continue...
            </Text>
          </Box>
        </Box>
      </Box>
    );
  }

  // Render feedback stage
  if (stage === 'feedback') {
    return (
      <Box flexDirection="column">
        <Header />
        <Box flexDirection="column" padding={1}>
          <Divider title="Refine Project Plan" />

          <Box marginTop={1} marginBottom={1}>
            <Text color="cyan">
              Provide feedback to refine the plan:
            </Text>
          </Box>

          <Box marginBottom={1}>
            <Text dimColor>
              Example: "Add more detail to Phase 2" or "Split Phase 1 into two phases"
            </Text>
          </Box>

          <TextArea
            placeholder="Enter your feedback..."
            minHeight={3}
            onSubmit={handleRefinePlan}
            onCancel={() => setStage('review')}
          />

          <Box marginTop={1}>
            <Text dimColor>
              Tab: submit │ Enter: new line │ Esc: go back to review
            </Text>
          </Box>
        </Box>
      </Box>
    );
  }

  // Render project creation stage
  if (stage === 'creating-project') {
    return (
      <Box flexDirection="column">
        <Header />
        <Box flexDirection="column" padding={1}>
          <Divider title="Creating Project" />
          <Box marginTop={1}>
            <Spinner label={progress} />
          </Box>
        </Box>
      </Box>
    );
  }

  // Render issue creation stage
  if (stage === 'creating-issues') {
    return (
      <Box flexDirection="column">
        <Header />
        <Box flexDirection="column" padding={1}>
          <Divider title="Creating Issues" />
          <Box marginTop={1}>
            {issueProgress ? (
              <Box flexDirection="column">
                <Text color="cyan">
                  Creating issue {issueProgress.current} of {issueProgress.total}...
                </Text>
                <Box marginTop={1}>
                  <Text dimColor>
                    {Math.round((issueProgress.current / issueProgress.total) * 100)}% complete
                  </Text>
                </Box>
              </Box>
            ) : (
              <Spinner label={progress} />
            )}
          </Box>
        </Box>
      </Box>
    );
  }

  // Render complete stage
  if (stage === 'complete') {
    return (
      <Box flexDirection="column">
        <Header />
        <Box flexDirection="column" padding={1}>
          <Divider title="Project Created Successfully" />
          <Box marginTop={1} flexDirection="column">
            <Text color="green" bold>
              ✅ Project "{parsedPlan?.projectTitle}" created successfully!
            </Text>
            {createdProjectNumber && (
              <Box marginTop={1}>
                <Text>
                  Project Number: <Text color="cyan" bold>#{createdProjectNumber}</Text>
                </Text>
              </Box>
            )}
            <Box marginTop={1}>
              <Text dimColor>
                Created {parsedPlan?.items.length} issues across {parsedPlan ? Math.max(...parsedPlan.items.map(i => i.phaseNumber)) : 0} phases
              </Text>
            </Box>
            <Box marginTop={2}>
              <Text dimColor>
                Press any key to return to project list...
              </Text>
            </Box>
          </Box>
        </Box>
      </Box>
    );
  }

  // Render error stage
  if (stage === 'error') {
    return (
      <Box flexDirection="column">
        <Header />
        <Box flexDirection="column" padding={1}>
          <Divider title="Error Creating Project" />
          <Box marginTop={1} flexDirection="column">
            <Text color="red" bold>
              ✗ Error: {error}
            </Text>
            <Box marginTop={2}>
              <Text dimColor>
                Press any key to go back...
              </Text>
            </Box>
          </Box>
        </Box>
      </Box>
    );
  }

  return <Box />;
}
