/**
 * OrchestratorPage - LLM orchestration management view
 */

import React from 'react';
import { Box } from 'ink';
import { Header } from '../organisms/Header.js';
import { OrchestratorView } from '../organisms/OrchestratorView.js';
import { HelpOverlay } from '../organisms/HelpOverlay.js';

export function OrchestratorPage(): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Header />
      <HelpOverlay />
      <OrchestratorView />
    </Box>
  );
}
