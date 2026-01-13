import { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput, Spinner } from '@inkjs/ui';
import type { ProjectCreationState, ReviewAction } from '../../types/project-spec.js';
import {
  generateProductStrategy,
  generateImplementationPlan,
  refineProductStrategy,
  refineImplementationPlan,
} from '../../services/project-creation.js';

import { LLMAdapter } from '../../llm/adapter.js';

interface ProjectCreationAppProps {
  description: string;
  adapter: LLMAdapter;
  workingDirectory: string;
  onComplete?: (implementationPlanPath: string) => void;
  onCancel?: () => void;
}

export function ProjectCreationApp({
  description,
  adapter,
  workingDirectory,
  onComplete,
  onCancel,
}: ProjectCreationAppProps) {
  const [state, setState] = useState<ProjectCreationState>({
    description,
    stage: 'initial',
  });

  const [reviewAction, setReviewAction] = useState<ReviewAction | null>(null);
  const [showFeedbackInput, setShowFeedbackInput] = useState(false);
  const [pendingFeedback, setPendingFeedback] = useState<string>('');
  const [scrollOffset, setScrollOffset] = useState(0);

  // Generate Product Strategy on mount
  useEffect(() => {
    if (state.stage === 'initial') {
      generateProductStrategy(description, adapter, workingDirectory)
        .then((productStrategy) => {
          setState({
            ...state,
            productStrategy,
            stage: 'pm-review',
          });
        })
        .catch((error) => {
          setState({
            ...state,
            stage: 'error',
            error: error.message,
          });
        });
    }
  }, [description, adapter, workingDirectory, state]);

  // Handle Product Strategy review actions
  useEffect(() => {
    if (state.stage === 'pm-review' && reviewAction === 'approve' && state.productStrategy) {
      setState({ ...state, stage: 'creating-project' });
      setScrollOffset(0); // Reset scroll for next stage

      generateImplementationPlan(state.productStrategy, adapter, workingDirectory)
        .then((implementationPlan) => {
          setState({
            ...state,
            implementationPlan,
            stage: 'eng-review',
          });
          setReviewAction(null);
        })
        .catch((error) => {
          setState({
            ...state,
            stage: 'error',
            error: error.message,
          });
        });
    } else if (state.stage === 'pm-review' && reviewAction === 'reject' && pendingFeedback && state.productStrategy) {
      setState({ ...state, stage: 'creating-project' });
      setScrollOffset(0); // Reset scroll

      refineProductStrategy(state.productStrategy, pendingFeedback, adapter, workingDirectory)
        .then((productStrategy) => {
          setState({
            ...state,
            productStrategy,
            stage: 'pm-review',
          });
          setReviewAction(null);
          setPendingFeedback('');
          setShowFeedbackInput(false);
        })
        .catch((error) => {
          setState({
            ...state,
            stage: 'error',
            error: error.message,
          });
        });
    }
  }, [reviewAction, pendingFeedback, state, adapter, workingDirectory]);

  // Handle Implementation Plan review actions
  useEffect(() => {
    if (state.stage === 'eng-review' && reviewAction === 'approve' && state.implementationPlan?.filePath) {
      setState({ ...state, stage: 'complete' });
      onComplete?.(state.implementationPlan.filePath);
    } else if (state.stage === 'eng-review' && reviewAction === 'reject' && pendingFeedback && state.productStrategy && state.implementationPlan) {
      setState({ ...state, stage: 'creating-project' });
      setScrollOffset(0); // Reset scroll

      refineImplementationPlan(
        state.productStrategy,
        state.implementationPlan,
        pendingFeedback,
        adapter,
        workingDirectory
      )
        .then((implementationPlan) => {
          setState({
            ...state,
            implementationPlan,
            stage: 'eng-review',
          });
          setReviewAction(null);
          setPendingFeedback('');
          setShowFeedbackInput(false);
        })
        .catch((error) => {
          setState({
            ...state,
            stage: 'error',
            error: error.message,
          });
        });
    }
  }, [reviewAction, pendingFeedback, state, adapter, workingDirectory, onComplete]);

  // Keyboard input handling with scrolling
  useInput((input, key) => {
    if (showFeedbackInput) {
      if (key.escape) {
        setShowFeedbackInput(false);
        setPendingFeedback('');
      }
      return;
    }

    if (key.escape || input === 'q') {
      setReviewAction('cancel');
      onCancel?.();
      return;
    }

    // Scroll controls for review stages
    if (state.stage === 'pm-review' || state.stage === 'eng-review') {
      if (key.downArrow || input === 'j') {
        setScrollOffset(prev => prev + 1);
      } else if (key.upArrow || input === 'k') {
        setScrollOffset(prev => Math.max(0, prev - 1));
      } else if (key.pageDown) {
        setScrollOffset(prev => prev + 10);
      } else if (key.pageUp) {
        setScrollOffset(prev => Math.max(0, prev - 10));
      } else if (input === 'g') {
        setScrollOffset(0); // Go to top
      } else if (input === 'G') {
        setScrollOffset(9999); // Go to bottom (will be clamped)
      } else if (input === 'a') {
        setReviewAction('approve');
      } else if (input === 'r') {
        setShowFeedbackInput(true);
      }
    }
  });

  const handleFeedbackSubmit = useCallback((feedback: string) => {
    if (feedback.trim()) {
      setPendingFeedback(feedback);
      setReviewAction('reject');
      setShowFeedbackInput(false);
    }
  }, []);

  const renderValidationErrors = (errors?: string[]) => {
    if (!errors || errors.length === 0) return null;

    return (
      <Box flexDirection="column" marginY={1}>
        <Text color="red" bold>⚠️  Validation Errors:</Text>
        {errors.map((error, idx) => (
          <Text key={idx} color="red">  • {error}</Text>
        ))}
      </Box>
    );
  };

  // Wrap text to fit within terminal width
  const wrapText = (text: string, maxWidth: number): string[] => {
    const lines: string[] = [];
    const textLines = text.split('\n');

    for (const line of textLines) {
      if (line.length <= maxWidth) {
        lines.push(line);
      } else {
        // Wrap long lines
        let currentLine = '';
        const words = line.split(' ');

        for (const word of words) {
          if ((currentLine + word).length <= maxWidth) {
            currentLine += (currentLine ? ' ' : '') + word;
          } else {
            if (currentLine) lines.push(currentLine);
            currentLine = word;
          }
        }
        if (currentLine) lines.push(currentLine);
      }
    }

    return lines;
  };

  const renderScrollableContent = (content: string, maxHeight: number = 20) => {
    const terminalWidth = process.stdout.columns || 80;
    const contentWidth = terminalWidth - 10; // Leave margin for borders/padding

    // Wrap all lines to fit terminal width
    const wrappedLines = wrapText(content, contentWidth);

    // Apply scrolling
    const visibleLines = wrappedLines.slice(scrollOffset, scrollOffset + maxHeight);
    const totalLines = wrappedLines.length;
    const hasMore = scrollOffset + maxHeight < totalLines;
    const hasPrevious = scrollOffset > 0;

    return (
      <Box flexDirection="column" marginY={1}>
        {visibleLines.map((line, idx) => {
          // Simple markdown-like rendering
          if (line.startsWith('# ')) {
            return <Text key={idx} bold color="cyan">{line.substring(2)}</Text>;
          } else if (line.startsWith('## ')) {
            return <Text key={idx} bold color="blue">{line.substring(3)}</Text>;
          } else if (line.startsWith('### ')) {
            return <Text key={idx} bold>{line.substring(4)}</Text>;
          } else if (line.startsWith('- ') || line.startsWith('* ')) {
            return <Text key={idx}>  {line}</Text>;
          } else if (line.startsWith('**') && line.endsWith('**')) {
            return <Text key={idx} bold>{line.substring(2, line.length - 2)}</Text>;
          } else {
            return <Text key={idx}>{line}</Text>;
          }
        })}

        <Box marginTop={1}>
          <Text dimColor>
            {hasPrevious && '↑ '}
            Line {scrollOffset + 1}-{Math.min(scrollOffset + maxHeight, totalLines)} of {totalLines}
            {hasMore && ' ↓'}
          </Text>
        </Box>

        {(hasPrevious || hasMore) && (
          <Box marginTop={1}>
            <Text dimColor>
              Scroll: ↑↓ or j/k │ Page: PgUp/PgDn │ Top: g │ Bottom: G
            </Text>
          </Box>
        )}
      </Box>
    );
  };

  const renderReviewActions = () => (
    <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">Review Actions:</Text>
      <Text>  <Text color="green">a</Text> - Approve and continue</Text>
      <Text>  <Text color="yellow">r</Text> - Reject and provide feedback</Text>
      <Text>  <Text color="red">q/ESC</Text> - Cancel</Text>
    </Box>
  );

  if (state.stage === 'error') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red" bold>❌ Error occurred:</Text>
        <Text color="red">{state.error}</Text>
        <Box marginTop={1}>
          <Text dimColor>Press q or ESC to exit</Text>
        </Box>
      </Box>
    );
  }

  if (state.stage === 'initial') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">📋 Project Creation - Generating Product Strategy</Text>
        <Box marginTop={1} gap={1}>
          <Spinner type="dots" />
          <Text>Generating product strategy...</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Description: {description}</Text>
        </Box>
      </Box>
    );
  }

  if (state.stage === 'pm-review' && state.productStrategy) {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" borderColor="cyan">
        <Text bold color="cyan">📋 Review Product Strategy</Text>
        <Box marginTop={1}>
          <Text bold>Title: {state.productStrategy.title}</Text>
        </Box>

        {state.productStrategy.validated ? (
          <Text color="green">✅ Format validation passed</Text>
        ) : (
          <Text color="yellow">⚠️  Format validation failed</Text>
        )}

        {renderValidationErrors(state.productStrategy.validationErrors)}

        {renderScrollableContent(state.productStrategy.rawOutput)}

        {showFeedbackInput ? (
          <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="yellow" paddingX={1}>
            <Text bold color="yellow">Provide feedback for refinement:</Text>
            <Box marginTop={1}>
              <TextInput
                onSubmit={handleFeedbackSubmit}
                placeholder="Enter your feedback and press Enter..."
              />
            </Box>
            <Box marginTop={1}>
              <Text dimColor>Press Enter to submit, ESC to cancel</Text>
            </Box>
          </Box>
        ) : (
          renderReviewActions()
        )}
      </Box>
    );
  }

  if (state.stage === 'creating-project') {
    const isGeneratingPlan = state.productStrategy && !state.implementationPlan;
    const isRefining = reviewAction === 'reject';

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">📋 Project Creation - Processing</Text>
        <Box marginTop={1} gap={1}>
          <Spinner type="dots" />
          <Text>
            {isRefining
              ? 'Refining based on feedback...'
              : isGeneratingPlan
                ? 'Generating implementation plan...'
                : 'Processing...'}
          </Text>
        </Box>
      </Box>
    );
  }

  if (state.stage === 'eng-review' && state.implementationPlan) {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" borderColor="cyan">
        <Text bold color="cyan">🏗️  Review Implementation Plan</Text>
        <Box marginTop={1}>
          <Text bold>Title: {state.implementationPlan.title}</Text>
        </Box>

        {state.implementationPlan.validated ? (
          <Text color="green">✅ Format validation passed</Text>
        ) : (
          <Text color="yellow">⚠️  Format validation failed</Text>
        )}

        {renderValidationErrors(state.implementationPlan.validationErrors)}

        {state.implementationPlan.filePath && (
          <Box marginTop={1}>
            <Text color="gray">📄 Saved to: {state.implementationPlan.filePath}</Text>
          </Box>
        )}

        {renderScrollableContent(state.implementationPlan.rawOutput)}

        {showFeedbackInput ? (
          <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="yellow" paddingX={1}>
            <Text bold color="yellow">Provide feedback for refinement:</Text>
            <Box marginTop={1}>
              <TextInput
                onSubmit={handleFeedbackSubmit}
                placeholder="Enter your feedback and press Enter..."
              />
            </Box>
            <Box marginTop={1}>
              <Text dimColor>Press Enter to submit, ESC to cancel</Text>
            </Box>
          </Box>
        ) : (
          renderReviewActions()
        )}
      </Box>
    );
  }

  if (state.stage === 'complete' && state.implementationPlan?.filePath) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="green" bold>✅ Project creation workflow complete!</Text>
        <Box marginTop={1}>
          <Text>Implementation plan saved to:</Text>
          <Text color="cyan">{state.implementationPlan.filePath}</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Ready to create GitHub project...</Text>
        </Box>
      </Box>
    );
  }

  return null;
}
