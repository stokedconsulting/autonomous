/**
 * CommandUI - Shared wrapper for command-based Ink UIs
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { Hotkey } from '../atoms/Hotkey.js';

export interface KeyboardHint {
  keys: string;
  label: string;
}

export interface CommandUIProps {
  commandName: string;
  children: React.ReactNode;
  keyboardHints?: KeyboardHint[];
  headerMeta?: React.ReactNode;
  footerContent?: React.ReactNode;
  onExit?: (code: number) => void;
  jsonMode?: boolean;
  quietMode?: boolean;
  exitProcess?: boolean;
}

interface CommandUIContextValue {
  exit: (code?: number) => void;
  isInteractive: boolean;
  isJsonMode: boolean;
  isQuietMode: boolean;
  hasTTY: boolean;
}

const CommandUIContext = createContext<CommandUIContextValue | null>(null);

export function useCommandUI(): CommandUIContextValue {
  const context = useContext(CommandUIContext);
  if (!context) {
    throw new Error('useCommandUI must be used within CommandUI');
  }
  return context;
}

function hasFlag(argv: string[], longFlag: string, shortFlag?: string): boolean {
  return argv.includes(longFlag) || (shortFlag ? argv.includes(shortFlag) : false);
}

export function CommandUI({
  commandName,
  children,
  keyboardHints = [],
  headerMeta,
  footerContent,
  onExit,
  jsonMode,
  quietMode,
  exitProcess,
}: CommandUIProps): React.ReactElement {
  const { exit: inkExit } = useApp();
  const exitRequestedRef = useRef(false);
  const argv = process.argv ?? [];
  const hasTTY = Boolean(process.stdout.isTTY && process.stdin.isTTY);
  const isJsonMode = jsonMode ?? hasFlag(argv, '--json', '-j');
  const isQuietMode = quietMode ?? hasFlag(argv, '--quiet', '-q');
  const isInteractive = hasTTY && !isJsonMode && !isQuietMode;

  const handleExit = useCallback((code = 0, forceExitProcess = false) => {
    if (exitRequestedRef.current) {
      return;
    }
    exitRequestedRef.current = true;
    process.exitCode = code;
    if (onExit) {
      onExit(code);
    }
    inkExit();
    const shouldExitProcess = forceExitProcess || (exitProcess ?? !isInteractive);
    if (shouldExitProcess) {
      setImmediate(() => process.exit(code));
    }
  }, [exitProcess, inkExit, isInteractive, onExit]);

  const exit = useCallback((code?: number) => {
    handleExit(code ?? 0);
  }, [handleExit]);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      handleExit(130, true);
    }
  }, { isActive: isInteractive });

  useEffect(() => {
    const onSigInt = () => handleExit(130, true);
    const onSigTerm = () => handleExit(143, true);
    process.on('SIGINT', onSigInt);
    process.on('SIGTERM', onSigTerm);
    return () => {
      process.off('SIGINT', onSigInt);
      process.off('SIGTERM', onSigTerm);
    };
  }, [handleExit]);

  const contextValue = useMemo(() => ({
    exit,
    isInteractive,
    isJsonMode,
    isQuietMode,
    hasTTY,
  }), [exit, hasTTY, isInteractive, isJsonMode, isQuietMode]);

  const hints = useMemo(() => {
    if (!isInteractive) {
      return [];
    }
    const baseHints = [
      { keys: 'Ctrl+C', label: 'exit' },
      ...keyboardHints,
    ];
    return baseHints;
  }, [isInteractive, keyboardHints]);

  if (!isInteractive) {
    return (
      <CommandUIContext.Provider value={contextValue}>
        <Box flexDirection="column" padding={1}>
          {!isQuietMode && (
            <Box marginBottom={1} gap={2}>
              <Text bold>{commandName}</Text>
              {headerMeta}
              {isJsonMode && <Text dimColor>(json)</Text>}
              {!hasTTY && <Text dimColor>(non-interactive)</Text>}
            </Box>
          )}
          {children}
        </Box>
      </CommandUIContext.Provider>
    );
  }

  return (
    <CommandUIContext.Provider value={contextValue}>
      <Box flexDirection="column" padding={1}>
        <Box borderStyle="round" borderColor="blue" paddingX={1} marginBottom={1}>
          <Box gap={2}>
            <Text bold color="blue">{commandName}</Text>
            {headerMeta}
          </Box>
        </Box>

        {children}

        {footerContent}

        {hints.length > 0 && (
          <Box marginTop={1} gap={2} flexWrap="wrap">
            {hints.map((hint, index) => (
              <Hotkey key={`${hint.keys}-${index}`} keys={hint.keys} label={hint.label} />
            ))}
          </Box>
        )}
      </Box>
    </CommandUIContext.Provider>
  );
}
