/**
 * DiffSummary - Git diff statistics with expandable details
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { $ } from 'zx';

interface DiffFileStat {
  file: string;
  additions: number;
  deletions: number;
}

interface DiffSummaryProps {
  cwd?: string;
  maxFiles?: number;
  isActive?: boolean;
}

export function DiffSummary({
  cwd = process.cwd(),
  maxFiles = 8,
  isActive = true,
}: DiffSummaryProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [stats, setStats] = useState<DiffFileStat[]>([]);
  const [error, setError] = useState<string | null>(null);

  const totalAdditions = stats.reduce((sum, file) => sum + file.additions, 0);
  const totalDeletions = stats.reduce((sum, file) => sum + file.deletions, 0);

  const loadStats = useCallback(async () => {
    try {
      $.verbose = false;
      const result = await $`cd ${cwd} && git diff --numstat`;
      const lines = result.stdout.trim().split('\n').filter(Boolean);

      if (lines.length === 0) {
        setStats([]);
        return;
      }

      const parsed = lines.map((line) => {
        const [additionsRaw, deletionsRaw, ...fileParts] = line.split('\t');
        const file = fileParts.join('\t');
        const additions = additionsRaw === '-' ? 0 : Number(additionsRaw);
        const deletions = deletionsRaw === '-' ? 0 : Number(deletionsRaw);

        return {
          file,
          additions: Number.isNaN(additions) ? 0 : additions,
          deletions: Number.isNaN(deletions) ? 0 : deletions,
        };
      });

      setStats(parsed);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [cwd]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  useInput((input) => {
    if (input === 'd') {
      setExpanded((prev) => !prev);
    }
  }, { isActive });

  if (error) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1}>
        <Text color="red">✗ Failed to read git diff</Text>
        <Text dimColor>{error}</Text>
      </Box>
    );
  }

  if (stats.length === 0) {
    return (
      <Box borderStyle="round" borderColor="gray" paddingX={1}>
        <Text dimColor>No local changes detected.</Text>
      </Box>
    );
  }

  const visibleStats = expanded ? stats : stats.slice(0, maxFiles);
  const hiddenCount = stats.length - visibleStats.length;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold>Diff Summary</Text>
        <Text dimColor>Press d to {expanded ? 'collapse' : 'expand'}</Text>
      </Box>

      {!expanded ? (
        <Box marginTop={1} gap={1}>
          <Text color="green">+{totalAdditions}</Text>
          <Text color="red">-{totalDeletions}</Text>
          <Text dimColor>in {stats.length} files</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1} gap={1}>
          {visibleStats.map((file) => (
            <Box key={file.file} gap={2}>
              <Text color="green">+{file.additions}</Text>
              <Text color="red">-{file.deletions}</Text>
              <Text>{file.file}</Text>
            </Box>
          ))}
          {hiddenCount > 0 && (
            <Text dimColor>...and {hiddenCount} more files</Text>
          )}
        </Box>
      )}
    </Box>
  );
}
