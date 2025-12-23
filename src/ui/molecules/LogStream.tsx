/**
 * LogStream - Real-time log viewer
 */

import React from 'react';
import { Box, Text } from 'ink';

interface LogEntry {
  timestamp: Date;
  message: string;
  level: 'info' | 'warn' | 'error' | 'debug';
}

interface LogStreamProps {
  logs: LogEntry[];
  maxLines?: number;
  title?: string;
  follow?: boolean;
}

const LEVEL_COLORS: Record<LogEntry['level'], string> = {
  info: 'white',
  warn: 'yellow',
  error: 'red',
  debug: 'gray',
};

const LEVEL_ICONS: Record<LogEntry['level'], string> = {
  info: '\u2139',  // ℹ
  warn: '\u26A0',  // ⚠
  error: '\u2717', // ✗
  debug: '\u2022', // •
};

export function LogStream({
  logs,
  maxLines = 15,
  title = 'Output',
  follow = true,
}: LogStreamProps): React.ReactElement {
  const displayLogs = follow ? logs.slice(-maxLines) : logs.slice(0, maxLines);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray">
      {/* Header */}
      <Box paddingX={1} marginBottom={0}>
        <Text bold>{title}</Text>
        {follow && <Text dimColor> (following)</Text>}
        <Box flexGrow={1} />
        <Text dimColor>{logs.length} entries</Text>
      </Box>

      {/* Log entries */}
      <Box flexDirection="column" paddingX={1}>
        {displayLogs.length === 0 ? (
          <Text dimColor>No output yet...</Text>
        ) : (
          displayLogs.map((log, i) => (
            <Box key={i}>
              <Text dimColor>
                [{log.timestamp.toLocaleTimeString()}]
              </Text>
              <Text color={LEVEL_COLORS[log.level]}>
                {' '}{LEVEL_ICONS[log.level]}{' '}
              </Text>
              <Text color={LEVEL_COLORS[log.level]}>{log.message}</Text>
            </Box>
          ))
        )}

        {/* Cursor indicator when following */}
        {follow && logs.length > 0 && (
          <Text color="cyan">{'\u258C'}</Text>
        )}
      </Box>
    </Box>
  );
}
