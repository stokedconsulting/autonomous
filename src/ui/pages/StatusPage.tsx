/**
 * StatusPage - Complete status view with dashboard
 */

import React from 'react';
import { Box } from 'ink';
import { Header } from '../organisms/Header.js';
import { Dashboard } from '../organisms/Dashboard.js';
import { HelpOverlay } from '../organisms/HelpOverlay.js';

export function StatusPage(): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Header />
      <HelpOverlay />
      <Dashboard />
    </Box>
  );
}
