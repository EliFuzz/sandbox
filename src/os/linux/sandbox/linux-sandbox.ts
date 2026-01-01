import { generateProxyEnvVars } from '@/core/environment/env-utils';
import type {
  FsReadRestrictionConfig,
  FsWriteRestrictionConfig,
} from '@/core/sandbox/sandbox-schemas';
import {
  cleanupSeccompFilter,
  generateSeccompFilter,
  getApplySeccompBinaryPath,
} from '@/generate-seccomp-filter';
import { generateFilesystemArgs } from '@/os/linux/filesystem/filesystem-restrictions';
import { logger } from '@/utils/debug';
import { shellquote } from '@/utils/shell-quote';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const generatedSeccompFilters: Set<string> = new Set();
let exitHandlerRegistered = false;

const registerSeccompCleanupHandler = (): void => {
  if (exitHandlerRegistered) return;

  process.on('exit', () => {
    generatedSeccompFilters.forEach((filterPath) => {
      try {
        cleanupSeccompFilter(filterPath);
      } catch {
        /* empty */
      }
    });
  });

  exitHandlerRegistered = true;
};

const buildSandboxCommand = (
  httpSocketPath: string,
  socksSocketPath: string,
  userCommand: string,
  seccompFilterPath: string | null,
  shell: string
): string => {
  const socatCommands = [
    `socat TCP-LISTEN:3128,fork,reuseaddr UNIX-CONNECT:${httpSocketPath} >/dev/null 2>&1 &`,
    `socat TCP-LISTEN:1080,fork,reuseaddr UNIX-CONNECT:${socksSocketPath} >/dev/null 2>&1 &`,
    'trap "kill %1 %2 2>/dev/null; exit" EXIT',
  ];

  if (seccompFilterPath) {
    const applySeccompBinary = getApplySeccompBinaryPath();
    if (!applySeccompBinary) {
      throw new Error(
        'apply-seccomp binary not found. Ensure dist/vendor/seccomp/{x64,arm64}/apply-seccomp binaries are included.'
      );
    }

    const applySeccompCmd = shellquote([
      applySeccompBinary,
      seccompFilterPath,
      shell,
      '-c',
      userCommand,
    ]);

    const innerScript = [...socatCommands, applySeccompCmd].join('\n');
    return `${shell} -c ${shellquote([innerScript])}`;
  }

  const innerScript = [
    ...socatCommands,
    `eval ${shellquote([userCommand])}`,
  ].join('\n');
  return `${shell} -c ${shellquote([innerScript])}`;
};

export interface LinuxSandboxParams {
  command: string;
  needsNetworkRestriction: boolean;
  httpSocketPath?: string;
  socksSocketPath?: string;
  httpProxyPort?: number;
  socksProxyPort?: number;
  readConfig?: FsReadRestrictionConfig;
  writeConfig?: FsWriteRestrictionConfig;
  enableWeakerNestedSandbox?: boolean;
  allowAllUnixSockets?: boolean;
  binShell?: string | null;
  ripgrepConfig?: { command: string; args?: string[] };
  mandatoryDenySearchDepth?: number;
  allowGitConfig?: boolean;
  abortSignal?: AbortSignal;
}

const handleSeccomp = (allowAllUnixSockets: boolean = false): string | null => {
  if (allowAllUnixSockets) {
    logger.info('Skipping seccomp filter - allowAllUnixSockets is enabled');
    return null;
  }
  const seccompFilterPath = generateSeccompFilter();
  if (seccompFilterPath) {
    if (!seccompFilterPath.includes('/dist/vendor/seccomp/')) {
      generatedSeccompFilters.add(seccompFilterPath);
      registerSeccompCleanupHandler();
    }
    logger.info('Generated seccomp BPF filter for Unix socket blocking');
  } else {
    logger.warn(
      'Seccomp filter not available. Continuing without Unix socket blocking.'
    );
  }
  return seccompFilterPath;
};

const addProxyEnvVars = (
  httpSocketPath: string,
  socksSocketPath: string,
  httpProxyPort: number | undefined,
  socksProxyPort: number | undefined,
  bwrapArgs: string[]
): void => {
  if (!existsSync(httpSocketPath)) {
    throw new Error(
      `Linux HTTP bridge socket does not exist: ${httpSocketPath}`
    );
  }
  if (!existsSync(socksSocketPath)) {
    throw new Error(
      `Linux SOCKS bridge socket does not exist: ${socksSocketPath}`
    );
  }
  bwrapArgs.push(
    '--bind',
    httpSocketPath,
    httpSocketPath,
    '--bind',
    socksSocketPath,
    socksSocketPath
  );
  const proxyEnv = generateProxyEnvVars(3128, 1080);
  bwrapArgs.push(
    ...proxyEnv.flatMap((env: string) => {
      const firstEq = env.indexOf('=');
      return ['--setenv', env.slice(0, firstEq), env.slice(firstEq + 1)];
    })
  );
  if (httpProxyPort !== undefined) {
    bwrapArgs.push(
      '--setenv',
      'AV_HOST_HTTP_PROXY_PORT',
      String(httpProxyPort)
    );
  }
  if (socksProxyPort !== undefined) {
    bwrapArgs.push(
      '--setenv',
      'AV_HOST_SOCKS_PROXY_PORT',
      String(socksProxyPort)
    );
  }
};

const handleNetworkRestriction = (
  needsNetworkRestriction: boolean,
  httpSocketPath: string | undefined,
  socksSocketPath: string | undefined,
  httpProxyPort: number | undefined,
  socksProxyPort: number | undefined,
  bwrapArgs: string[]
): void => {
  if (!needsNetworkRestriction) return;
  bwrapArgs.push('--unshare-net');
  if (httpSocketPath && socksSocketPath) {
    addProxyEnvVars(
      httpSocketPath,
      socksSocketPath,
      httpProxyPort,
      socksProxyPort,
      bwrapArgs
    );
  }
};

const getShell = (binShell: string | null = 'bash'): string => {
  if (!binShell) binShell = 'bash';
  const shellPathResult = spawnSync('which', [binShell], {
    encoding: 'utf8',
  });
  if (shellPathResult.status !== 0) {
    throw new Error(`Shell '${binShell}' not found in PATH`);
  }
  return shellPathResult.stdout.trim();
};

const buildFinalCommand = (
  needsNetworkRestriction: boolean,
  httpSocketPath: string | undefined,
  socksSocketPath: string | undefined,
  command: string,
  seccompFilterPath: string | null,
  shell: string,
  bwrapArgs: string[]
): void => {
  bwrapArgs.push('--', shell, '-c');
  if (needsNetworkRestriction && httpSocketPath && socksSocketPath) {
    bwrapArgs.push(
      buildSandboxCommand(
        httpSocketPath,
        socksSocketPath,
        command,
        seccompFilterPath,
        shell
      )
    );
  } else if (seccompFilterPath) {
    const applySeccompBinary = getApplySeccompBinaryPath();
    if (!applySeccompBinary) {
      throw new Error('apply-seccomp binary not found.');
    }
    bwrapArgs.push(
      shellquote([applySeccompBinary, seccompFilterPath, shell, '-c', command])
    );
  } else {
    bwrapArgs.push(command);
  }
};

const cleanupSeccompOnError = (seccompFilterPath: string | null): void => {
  if (
    seccompFilterPath &&
    !seccompFilterPath.includes('/dist/vendor/seccomp/')
  ) {
    generatedSeccompFilters.delete(seccompFilterPath);
    try {
      cleanupSeccompFilter(seccompFilterPath);
    } catch (cleanupError) {
      logger.error(`Failed to clean up seccomp filter: ${cleanupError}`);
    }
  }
};

export const wrapCommandWithSandboxLinux = async (
  params: LinuxSandboxParams
): Promise<string> => {
  const {
    command,
    needsNetworkRestriction,
    httpSocketPath,
    socksSocketPath,
    httpProxyPort,
    socksProxyPort,
    readConfig,
    writeConfig,
    enableWeakerNestedSandbox,
    allowAllUnixSockets,
    binShell,
    ripgrepConfig = { command: 'rg' },
    mandatoryDenySearchDepth = 3,
    allowGitConfig = false,
    abortSignal,
  } = params;

  const hasReadRestrictions = readConfig && readConfig.denyOnly.length > 0;
  const hasWriteRestrictions = writeConfig !== undefined;

  if (
    !needsNetworkRestriction &&
    !hasReadRestrictions &&
    !hasWriteRestrictions
  ) {
    return command;
  }

  const bwrapArgs: string[] = ['--new-session', '--die-with-parent'];
  let seccompFilterPath: string | null = null;

  try {
    seccompFilterPath = handleSeccomp(allowAllUnixSockets ?? false);

    handleNetworkRestriction(
      needsNetworkRestriction,
      httpSocketPath,
      socksSocketPath,
      httpProxyPort,
      socksProxyPort,
      bwrapArgs
    );

    const fsArgs = await generateFilesystemArgs(
      readConfig,
      writeConfig,
      ripgrepConfig,
      mandatoryDenySearchDepth,
      allowGitConfig ?? false,
      abortSignal
    );
    bwrapArgs.push(...fsArgs, '--dev', '/dev', '--unshare-pid');
    if (!enableWeakerNestedSandbox) {
      bwrapArgs.push('--proc', '/proc');
    }

    const shell = getShell(binShell);

    buildFinalCommand(
      needsNetworkRestriction,
      httpSocketPath,
      socksSocketPath,
      command,
      seccompFilterPath,
      shell,
      bwrapArgs
    );

    const wrappedCommand = shellquote(['bwrap', ...bwrapArgs]);

    const restrictions = [];
    if (needsNetworkRestriction) restrictions.push('network');
    if (hasReadRestrictions || hasWriteRestrictions)
      restrictions.push('filesystem');
    if (seccompFilterPath) restrictions.push('seccomp(unix-block)');

    logger.info(
      `Wrapped command with bwrap (${restrictions.join(', ')} restrictions)`
    );

    return wrappedCommand;
  } catch (error) {
    cleanupSeccompOnError(seccompFilterPath);
    throw error;
  }
};
