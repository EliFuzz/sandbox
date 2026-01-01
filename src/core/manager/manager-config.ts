import { getDefaultWritePaths } from '@/core/environment/env-utils';
import {
  containsGlobChars,
  removeTrailingGlobSuffix,
} from '@/core/filesystem/path-utils';
import type {
  FsReadRestrictionConfig,
  FsWriteRestrictionConfig,
  NetworkRestrictionConfig,
} from '@/core/sandbox/sandbox-schemas';
import type { SandboxRuntimeConfig } from '@/core/sandbox/sandbox-config';
import { cloneDeep, getPlatform, logger } from '@/utils';
import { state } from '@/core/manager/manager-state';

const filterGlobsForLinux = (paths: string[]): string[] =>
  paths
    .map((path) => removeTrailingGlobSuffix(path))
    .filter((path) => {
      if (getPlatform() === 'linux' && containsGlobChars(path)) {
        logger.info(`Skipping glob pattern on Linux: ${path}`);
        return false;
      }
      return true;
    });

export const getFsReadConfig = (): FsReadRestrictionConfig =>
  state.config
    ? { denyOnly: filterGlobsForLinux(state.config.filesystem.denyRead) }
    : { denyOnly: [] };

export const getFsWriteConfig = (): FsWriteRestrictionConfig => {
  if (!state.config) {
    return { allowOnly: getDefaultWritePaths(), denyWithinAllow: [] };
  }
  return {
    allowOnly: [
      ...getDefaultWritePaths(),
      ...filterGlobsForLinux(state.config.filesystem.allowWrite),
    ],
    denyWithinAllow: filterGlobsForLinux(state.config.filesystem.denyWrite),
  };
};

export const getNetworkRestrictionConfig = (): NetworkRestrictionConfig => {
  if (!state.config) return {};
  const { allowedDomains, deniedDomains } = state.config.network;
  return {
    ...(allowedDomains.length > 0 && { allowedHosts: allowedDomains }),
    ...(deniedDomains.length > 0 && { deniedHosts: deniedDomains }),
  };
};

export const getAllowUnixSockets = (): string[] | undefined =>
  state.config?.network?.allowUnixSockets;

export const getAllowAllUnixSockets = (): boolean | undefined =>
  state.config?.network?.allowAllUnixSockets;

export const getAllowLocalBinding = (): boolean | undefined =>
  state.config?.network?.allowLocalBinding;

export const getIgnoreViolations = (): Record<string, string[]> | undefined =>
  state.config?.ignoreViolations;

export const getEnableWeakerNestedSandbox = (): boolean | undefined =>
  state.config?.enableWeakerNestedSandbox;

export const getRipgrepConfig = (): { command: string; args?: string[] } =>
  state.config?.ripgrep ?? { command: 'rg' };

export const getMandatoryDenySearchDepth = (): number =>
  state.config?.mandatoryDenySearchDepth ?? 3;

export const getAllowGitConfig = (): boolean =>
  state.config?.filesystem?.allowGitConfig ?? false;

export const getConfig = (): SandboxRuntimeConfig | undefined => state.config;

export const getProxyPort = (): number | undefined =>
  state.managerContext?.httpProxyPort;

export const getSocksProxyPort = (): number | undefined =>
  state.managerContext?.socksProxyPort;

export const getLinuxHttpSocketPath = (): string | undefined =>
  state.managerContext?.linuxBridge?.httpSocketPath;

export const getLinuxSocksSocketPath = (): string | undefined =>
  state.managerContext?.linuxBridge?.socksSocketPath;

export const getSandboxViolationStore = () => state.sandboxViolationStore;

export const updateConfig = (newConfig: SandboxRuntimeConfig): void => {
  state.config = cloneDeep(newConfig);
  logger.info('Sandbox configuration updated');
};

export const getLinuxGlobPatternWarnings = (): string[] => {
  if (getPlatform() !== 'linux' || !state.config) return [];

  const allPaths = [
    ...state.config.filesystem.denyRead,
    ...state.config.filesystem.allowWrite,
    ...state.config.filesystem.denyWrite,
  ];

  return allPaths.filter((path) =>
    containsGlobChars(removeTrailingGlobSuffix(path)),
  );
};
