import {
  checkDependencies,
  initialize,
  isSandboxingEnabled,
  isSupportedPlatform,
  reset,
} from '@/core/manager/manager-lifecycle';

import {
  getAllowLocalBinding,
  getAllowUnixSockets,
  getConfig,
  getEnableWeakerNestedSandbox,
  getFsReadConfig,
  getFsWriteConfig,
  getIgnoreViolations,
  getLinuxGlobPatternWarnings,
  getLinuxHttpSocketPath,
  getLinuxSocksSocketPath,
  getNetworkRestrictionConfig,
  getProxyPort,
  getSandboxViolationStore,
  getSocksProxyPort,
  updateConfig,
} from '@/core/manager/manager-config';

import { waitForNetworkInitialization } from '@/core/manager/manager-proxy';

import {
  annotateStderrWithSandboxFailures,
  wrapWithSandbox,
} from '@/core/manager/sandbox-wrapper';

export const SandboxManager = {
  initialize,
  isSupportedPlatform,
  isSandboxingEnabled,
  checkDependencies,
  getFsReadConfig,
  getFsWriteConfig,
  getNetworkRestrictionConfig,
  getAllowUnixSockets,
  getAllowLocalBinding,
  getIgnoreViolations,
  getEnableWeakerNestedSandbox,
  getProxyPort,
  getSocksProxyPort,
  getLinuxHttpSocketPath,
  getLinuxSocksSocketPath,
  waitForNetworkInitialization,
  wrapWithSandbox,
  reset,
  getSandboxViolationStore,
  annotateStderrWithSandboxFailures,
  getLinuxGlobPatternWarnings,
  getConfig,
  updateConfig,
} as const;
