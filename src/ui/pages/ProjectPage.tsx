/**
 * ProjectPage - GitHub Project browser
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { Select, Spinner } from '@inkjs/ui';
import { Header } from '../organisms/Header.js';
import { HelpOverlay } from '../organisms/HelpOverlay.js';
import { Divider } from '../atoms/Divider.js';
import { useUIStore } from '../stores/ui-store.js';
import { useKeyboardNav } from '../hooks/useKeyboardNav.js';

interface Project {
  id: string;
  title: string;
  number: number;
  itemCount: number;
  url: string;
}

export function ProjectPage(): React.ReactElement {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const navigate = useUIStore((s) => s.navigate);

  useKeyboardNav({
    enableVimNav: true,
    maxItems: projects.length,
  });

  // Mock loading projects - will be connected to real API
  useEffect(() => {
    const timer = setTimeout(() => {
      setProjects([
        { id: '1', title: 'autonomous', number: 1, itemCount: 12, url: 'https://github.com/orgs/example/projects/1' },
        { id: '2', title: 'backend-v2', number: 2, itemCount: 8, url: 'https://github.com/orgs/example/projects/2' },
      ]);
      setLoading(false);
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  const handleSelect = (value: string) => {
    setSelectedProject(value);
    const project = projects.find(p => p.id === value);
    if (project) {
      navigate('status');
    }
  };

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
        ) : projects.length === 0 ? (
          <Box padding={1}>
            <Text dimColor>No projects found. Configure a project with 'auto config'.</Text>
          </Box>
        ) : (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text dimColor>Select a project to manage:</Text>
            </Box>
            <Select
              options={projects.map(p => ({
                label: `${p.title} (#${p.number}) - ${p.itemCount} items`,
                value: p.id,
              }))}
              onChange={handleSelect}
            />
          </Box>
        )}

        {/* Selected Project Details */}
        {selectedProject && (
          <Box marginTop={1} borderStyle="round" borderColor="cyan" paddingX={1}>
            <Text>Selected: </Text>
            <Text bold color="cyan">
              {projects.find(p => p.id === selectedProject)?.title}
            </Text>
          </Box>
        )}

        <Box marginTop={1}>
          <Text dimColor>
            Enter: select │ q: back │ ?: help
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
