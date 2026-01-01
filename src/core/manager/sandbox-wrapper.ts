import { getDefaultWritePaths } from '@/core/environment/env-utils';
import {
  getAllowAllUnixSockets,
  getAllowGitConfig,
  getAllowLocalBinding,
  getAllowUnixSockets,
  getEnableWeakerNestedSandbox,
  getIgnoreViolations,
  getLinuxHttpSocketPath,
  getLinuxSocksSocketPath,
  getMandatoryDenySearchDepth,
  getProxyPort,
  getRipgrepConfig,
  getSocksProxyPort,
} from '@/core/manager/manager-config';
import { waitForNetworkInitialization } from '@/core/manager/manager-proxy';
import { state } from '@/core/manager/manager-state';
import type { SandboxRuntimeConfig } from '@/core/sandbox/sandbox-config';
import type {
  FsReadRestrictionConfig,
  FsWriteRestrictionConfig,
} from '@/core/sandbox/sandbox-schemas';
import { wrapCommandWithSandboxLinux } from '@/os/linux';
import { wrapCommandWithSandboxMacOS } from '@/os/macos';
import { getPlatform } from '@/utils';
import { EOL } from 'node:os';

const buildConfigs = (customConfig?: Partial<SandboxRuntimeConfig>) => {
  const userAllowWrite =
    customConfig?.filesystem?.allowWrite ??
    state.config?.filesystem.allowWrite ??
    [];
  const writeConfig = {
    allowOnly: [...getDefaultWritePaths(), ...userAllowWrite],
    denyWithinAllow:
      customConfig?.filesystem?.denyWrite ??
      state.config?.filesystem.denyWrite ??
      [],
  };
  const readConfig = {
    denyOnly:
      customConfig?.filesystem?.denyRead ??
      state.config?.filesystem.denyRead ??
      [],
  };
  const hasNetworkConfig =
    customConfig?.network?.allowedDomains !== undefined ||
    state.config?.network?.allowedDomains !== undefined;
  const allowedDomains =
    customConfig?.network?.allowedDomains ??
    state.config?.network.allowedDomains ??
    [];
  const needsNetworkRestriction = hasNetworkConfig;
  const needsNetworkProxy = allowedDomains.length > 0;

  return {
    writeConfig,
    readConfig,
    needsNetworkRestriction,
    needsNetworkProxy,
  };
};

const getMacOSOptions = (
  command: string,
  needsNetworkRestriction: boolean,
  needsNetworkProxy: boolean,
  writeConfig: FsWriteRestrictionConfig,
  readConfig: FsReadRestrictionConfig | undefined,
  allowPty: boolean | undefined,
  binShell?: string
) => ({
  command,
  needsNetworkRestriction,
  httpProxyPort: needsNetworkProxy ? getProxyPort() : undefined,
  socksProxyPort: needsNetworkProxy ? getSocksProxyPort() : undefined,
  readConfig,
  writeConfig,
  allowUnixSockets: getAllowUnixSockets(),
  allowAllUnixSockets: getAllowAllUnixSockets(),
  allowLocalBinding: getAllowLocalBinding(),
  ignoreViolations: getIgnoreViolations(),
  allowPty,
  allowGitConfig: getAllowGitConfig(),
  binShell,
});

const getLinuxOptions = (
  command: string,
  needsNetworkRestriction: boolean,
  needsNetworkProxy: boolean,
  writeConfig: FsWriteRestrictionConfig,
  readConfig: FsReadRestrictionConfig | undefined,
  binShell?: string,
  abortSignal?: AbortSignal
) => ({
  command,
  needsNetworkRestriction,
  httpSocketPath: needsNetworkProxy ? getLinuxHttpSocketPath() : undefined,
  socksSocketPath: needsNetworkProxy ? getLinuxSocksSocketPath() : undefined,
  httpProxyPort: needsNetworkProxy
    ? state.managerContext?.httpProxyPort
    : undefined,
  socksProxyPort: needsNetworkProxy
    ? state.managerContext?.socksProxyPort
    : undefined,
  readConfig,
  writeConfig,
  enableWeakerNestedSandbox: getEnableWeakerNestedSandbox(),
  allowAllUnixSockets: getAllowAllUnixSockets(),
  binShell,
  ripgrepConfig: getRipgrepConfig(),
  mandatoryDenySearchDepth: getMandatoryDenySearchDepth(),
  allowGitConfig: getAllowGitConfig(),
  abortSignal,
});

export const wrapWithSandbox = async (
  command: string,
  binShell?: string,
  customConfig?: Partial<SandboxRuntimeConfig>,
  abortSignal?: AbortSignal
): Promise<string> => {
  const platform = getPlatform();
  const {
    writeConfig,
    readConfig,
    needsNetworkRestriction,
    needsNetworkProxy,
  } = buildConfigs(customConfig);

  if (needsNetworkProxy) {
    await waitForNetworkInitialization();
  }

  const allowPty = customConfig?.allowPty ?? state.config?.allowPty;

  switch (platform) {
    case 'macos':
      return wrapCommandWithSandboxMacOS(
        getMacOSOptions(
          command,
          needsNetworkRestriction,
          needsNetworkProxy,
          writeConfig,
          readConfig,
          allowPty,
          binShell
        )
      );
    case 'linux':
      return wrapCommandWithSandboxLinux(
        getLinuxOptions(
          command,
          needsNetworkRestriction,
          needsNetworkProxy,
          writeConfig,
          readConfig,
          binShell,
          abortSignal
        )
      );
    default:
      throw new Error(
        `Sandbox configuration is not supported on platform: ${platform}`
      );
  }
};

export const annotateStderrWithSandboxFailures = (
  command: string,
  stderr: string
): string => {
  if (!state.config) return stderr;

  const violations =
    state.sandboxViolationStore.getViolationsForCommand(command);
  if (violations.length === 0) return stderr;

  return (
    stderr +
    EOL +
    '<sandbox_violations>' +
    EOL +
    violations.map((v) => v.line).join(EOL) +
    EOL +
    '</sandbox_violations>'
  );
};
