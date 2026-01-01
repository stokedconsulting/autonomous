/**
 * SetupPage - Guided setup wizard for dependencies and configuration
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import { ConfirmInput, ProgressBar, Spinner } from '@inkjs/ui';
import { Header } from '../organisms/Header.js';
import { HelpOverlay } from '../organisms/HelpOverlay.js';
import { Divider } from '../atoms/Divider.js';
import { DependencyChecker, DependencyStatus } from '../../utils/dependency-checker.js';
import { ConfigManager } from '../../core/config-manager.js';
import { parseGitHubRemote, getGitRoot } from '../../git/utils.js';
import { join } from 'path';
import { promises as fs } from 'fs';
import { ConfigInitPage } from './ConfigInitPage.js';

export interface SetupOptions {
  installAll?: boolean;
  skipPrompts?: boolean;
}

type SetupPhase = 'loading' | 'dependencies' | 'config' | 'complete' | 'error';

async function checkConfigExists(cwd: string): Promise<boolean> {
  const gitRoot = await getGitRoot(cwd);
  const basePath = gitRoot ?? cwd;
  const newPath = join(basePath, '.autonomous', '.autonomous-config.json');
  const legacyPath = join(basePath, '.autonomous-config.json');

  try {
    await fs.access(newPath);
    return true;
  } catch {
    try {
      await fs.access(legacyPath);
      return true;
    } catch {
      return false;
    }
  }
}

async function resolveConfigPath(cwd: string): Promise<string> {
  const gitRoot = await getGitRoot(cwd);
  const basePath = gitRoot ?? cwd;
  return join(basePath, '.autonomous', '.autonomous-config.json');
}

export function SetupPage({ options }: { options?: SetupOptions }): React.ReactElement {
  const [phase, setPhase] = useState<SetupPhase>('loading');
  const [dependencies, setDependencies] = useState<DependencyStatus[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showConfigInit, setShowConfigInit] = useState(false);
  const [configPath, setConfigPath] = useState<string | null>(null);
  const [changesetsPrompt, setChangesetsPrompt] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [installResult, setInstallResult] = useState<boolean | null>(null);

  const installAll = options?.installAll ?? false;
  const skipPrompts = options?.skipPrompts ?? false;

  const requiredDeps = useMemo(
    () => dependencies.filter((dep) => dep.required),
    [dependencies]
  );
  const optionalDeps = useMemo(
    () => dependencies.filter((dep) => !dep.required),
    [dependencies]
  );

  const missingRequired = useMemo(
    () => requiredDeps.filter((dep) => !dep.installed),
    [requiredDeps]
  );

  const refreshDependencies = useCallback(async () => {
    const checker = new DependencyChecker(process.cwd());
    const results = await checker.checkAll();
    setDependencies(results);
    return { checker, results };
  }, []);

  useEffect(() => {
    void (async () => {
      setPhase('loading');
      try {
        const { results } = await refreshDependencies();

        if (results.some((dep) => dep.required && !dep.installed)) {
          setPhase('error');
          setErrorMessage('Required dependencies are missing.');
          return;
        }

        const changesets = results.find((dep) => dep.name === '@changesets/cli');
        const needsChangesets = changesets && !changesets.installed && changesets.installCommand;

        if (needsChangesets) {
          if (installAll && !skipPrompts) {
            setIsInstalling(true);
            const { checker } = await refreshDependencies();
            const installed = await checker.installChangesets();
            setInstallResult(installed);
            await refreshDependencies();
            setIsInstalling(false);
          } else if (!skipPrompts) {
            setChangesetsPrompt(true);
          }
        }

        setPhase('dependencies');
      } catch (error) {
        setPhase('error');
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    })();
  }, [installAll, refreshDependencies, skipPrompts]);

  useEffect(() => {
    if (phase !== 'dependencies') return;
    if (changesetsPrompt || isInstalling) return;

    void (async () => {
      const exists = await checkConfigExists(process.cwd());
      if (!exists) {
        if (skipPrompts) {
          try {
            const cwd = process.cwd();
            const remoteInfo = await parseGitHubRemote(cwd);
            const configManager = new ConfigManager(cwd);
            await configManager.initialize(remoteInfo?.owner, remoteInfo?.repo);
            setConfigPath(await resolveConfigPath(cwd));
            setPhase('complete');
          } catch (error) {
            setPhase('error');
            setErrorMessage(error instanceof Error ? error.message : String(error));
          }
        } else {
          setShowConfigInit(true);
          setPhase('config');
        }
      } else {
        setConfigPath(await resolveConfigPath(process.cwd()));
        setPhase('complete');
      }
    })();
  }, [changesetsPrompt, isInstalling, phase, skipPrompts]);

  const stepNumber = phase === 'config' || showConfigInit ? 2 : 1;
  const totalSteps = 2;
  const progressValue = Math.round((stepNumber / totalSteps) * 100);

  const renderDependencySection = () => (
    <Box flexDirection="column" gap={1}>
      <Text bold>Dependency check</Text>
      {dependencies.length === 0 ? (
        <Text dimColor>No dependencies found.</Text>
      ) : (
        <>
          <Box flexDirection="column" gap={1}>
            <Text bold>Required</Text>
            {requiredDeps.map((dep) => (
              <DependencyRow key={dep.name} dependency={dep} />
            ))}
          </Box>
          <Box flexDirection="column" gap={1} marginTop={1}>
            <Text bold>Optional</Text>
            {optionalDeps.map((dep) => (
              <DependencyRow key={dep.name} dependency={dep} />
            ))}
          </Box>
        </>
      )}

      {missingRequired.length > 0 && (
        <Box marginTop={1}>
          <Text color="red" bold>✗ Missing required dependencies.</Text>
        </Box>
      )}

      {changesetsPrompt && (
        <Box marginTop={1} flexDirection="column">
          <Text>Install optional @changesets/cli now?</Text>
          <ConfirmInput
            onConfirm={async () => {
              setChangesetsPrompt(false);
              setIsInstalling(true);
              const { checker } = await refreshDependencies();
              const installed = await checker.installChangesets();
              setInstallResult(installed);
              await refreshDependencies();
              setIsInstalling(false);
            }}
            onCancel={() => {
              setChangesetsPrompt(false);
              setInstallResult(false);
            }}
          />
        </Box>
      )}

      {isInstalling && (
        <Box marginTop={1}>
          <Spinner label="Installing @changesets/cli..." />
        </Box>
      )}

      {installResult !== null && !isInstalling && (
        <Box marginTop={1}>
          <Text color={installResult ? 'green' : 'yellow'}>
            {installResult ? '✓ Optional dependency installed' : 'Skipped optional install'}
          </Text>
        </Box>
      )}
    </Box>
  );

  const renderContent = () => {
    if (phase === 'loading') {
      return (
        <Box gap={1}>
          <Spinner label="Checking dependencies..." />
        </Box>
      );
    }

    if (phase === 'error') {
      return (
        <Box flexDirection="column">
          <Text color="red" bold>✗ Setup failed</Text>
          {errorMessage && <Text color="red">{errorMessage}</Text>}
          {missingRequired.length > 0 && (
            <Box marginTop={1} flexDirection="column">
              <Text dimColor>Install required dependencies and re-run setup.</Text>
              {missingRequired.map(dep => (
                <Text key={dep.name} dimColor>
                  {dep.name}: {dep.installCommand ?? 'See documentation'}
                </Text>
              ))}
            </Box>
          )}
        </Box>
      );
    }

    if (phase === 'config' && showConfigInit) {
      return (
        <Box flexDirection="column">
          <Text bold>Configuration initialization</Text>
          <ConfigInitPage
            onComplete={(path) => {
              setConfigPath(path);
              setPhase('complete');
              setShowConfigInit(false);
            }}
          />
        </Box>
      );
    }

    if (phase === 'complete') {
      return (
        <Box flexDirection="column">
          <Text color="green" bold>✓ Setup complete</Text>
          {configPath && (
            <Box marginTop={1} flexDirection="column">
              <Text dimColor>Configuration file:</Text>
              <Text color="cyan">{configPath}</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>Next steps: run </Text>
            <Text color="cyan">auto start</Text>
            <Text dimColor> to begin autonomous work.</Text>
          </Box>
        </Box>
      );
    }

    return renderDependencySection();
  };

  return (
    <Box flexDirection="column">
      <Header />
      <HelpOverlay />

      <Box flexDirection="column" padding={1}>
        <Divider title="Setup Wizard" />

        <Box marginBottom={1} flexDirection="column">
          <Box justifyContent="space-between">
            <Text dimColor>Step {stepNumber} of {totalSteps}</Text>
            <Text dimColor>{progressValue}%</Text>
          </Box>
          <ProgressBar value={progressValue} />
        </Box>

        {renderContent()}
      </Box>
    </Box>
  );
}

function DependencyRow({ dependency }: { dependency: DependencyStatus }): React.ReactElement {
  const icon = dependency.installed ? '✓' : dependency.required ? '✗' : '○';
  const color = dependency.installed ? 'green' : dependency.required ? 'red' : 'yellow';

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text color={color}>{icon}</Text>
        <Text bold>{dependency.name}</Text>
        {dependency.version && <Text dimColor>{dependency.version}</Text>}
      </Box>
      <Box marginLeft={2}>
        <Text dimColor>{dependency.purpose}</Text>
      </Box>
      {!dependency.installed && dependency.installCommand && (
        <Box marginLeft={2}>
          <Text dimColor>Install: {dependency.installCommand}</Text>
        </Box>
      )}
    </Box>
  );
}
