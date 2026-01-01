import { generateProxyEnvVars } from '@/core/environment/env-utils';
import type { IgnoreViolationsConfig } from '@/core/sandbox/sandbox-config';
import type {
  FsReadRestrictionConfig,
  FsWriteRestrictionConfig,
} from '@/core/sandbox/sandbox-schemas';
import {
  generateLogTag,
  generateSandboxProfile,
} from '@/os/macos/sandbox/macos-sandbox-profile';
import { logger } from '@/utils/debug';
import { shellquote } from '@/utils/shell-quote';
import { spawnSync } from 'node:child_process';

export interface MacOSSandboxParams {
  command: string;
  needsNetworkRestriction: boolean;
  httpProxyPort?: number;
  socksProxyPort?: number;
  allowUnixSockets?: string[];
  allowAllUnixSockets?: boolean;
  allowLocalBinding?: boolean;
  readConfig: FsReadRestrictionConfig | undefined;
  writeConfig: FsWriteRestrictionConfig | undefined;
  ignoreViolations?: IgnoreViolationsConfig;
  allowPty?: boolean;
  allowGitConfig?: boolean;
  binShell?: string;
}

const getShellPath = (binShell = 'bash'): string => {
  const shellPathResult = spawnSync('which', [binShell], { encoding: 'utf8' });
  if (shellPathResult.status !== 0) {
    throw new Error(`Shell '${binShell}' not found in PATH`);
  }
  return shellPathResult.stdout.trim();
};

const logRestrictions = (
  httpProxyPort: number | undefined,
  socksProxyPort: number | undefined,
  readConfig: FsReadRestrictionConfig | undefined,
  writeConfig: FsWriteRestrictionConfig | undefined
): void => {
  const readAccess =
    readConfig && 'allowAllExcept' in readConfig
      ? 'allowAllExcept'
      : 'denyAllExcept';

  const writeAccess =
    writeConfig && 'allowAllExcept' in writeConfig
      ? 'allowAllExcept'
      : 'denyAllExcept';

  logger.info(
    `Applied restrictions - network: ${!!(httpProxyPort || socksProxyPort)}, read: ${
      readConfig ? readAccess : 'none'
    }, write: ${writeConfig ? writeAccess : 'none'}`
  );
};

export const wrapCommandWithSandboxMacOS = (
  params: MacOSSandboxParams
): string => {
  const {
    command,
    needsNetworkRestriction,
    httpProxyPort,
    socksProxyPort,
    allowUnixSockets,
    allowAllUnixSockets,
    allowLocalBinding,
    readConfig,
    writeConfig,
    allowPty,
    allowGitConfig = false,
    binShell,
  } = params;

  const hasReadRestrictions = readConfig && readConfig.denyOnly.length > 0;
  const hasWriteRestrictions = writeConfig !== undefined;
  const hasRestrictions = hasReadRestrictions || hasWriteRestrictions;

  if (!needsNetworkRestriction && !hasRestrictions) {
    return command;
  }

  const profile = generateSandboxProfile({
    readConfig,
    writeConfig,
    httpProxyPort,
    socksProxyPort,
    needsNetworkRestriction,
    allowUnixSockets,
    allowAllUnixSockets,
    allowLocalBinding,
    allowPty,
    allowGitConfig,
    logTag: generateLogTag(command),
  });

  const proxyEnvArgs = generateProxyEnvVars(httpProxyPort, socksProxyPort);
  const shell = getShellPath(binShell);

  const wrappedCommand = shellquote([
    'env',
    ...proxyEnvArgs,
    'sandbox-exec',
    '-p',
    profile,
    shell,
    '-c',
    command,
  ]);

  logRestrictions(httpProxyPort, socksProxyPort, readConfig, writeConfig);

  return wrappedCommand;
};
