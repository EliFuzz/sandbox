import { initializeLinuxNetworkBridge } from '@/os/linux';
import { startMacOSSandboxLogMonitor } from '@/os/macos';
import type { SandboxAskCallback } from '@/core/sandbox/sandbox-schemas';
import type { SandboxRuntimeConfig } from '@/core/sandbox/sandbox-config';
import { state } from '@/core/manager/manager-state';
import {
  startHttpProxyServer,
  startSocksProxyServer,
} from '@/core/manager/manager-proxy';
import { registerCleanup, reset } from '@/core/manager/manager-cleanup';
import { getPlatform, hasRipgrepSync, logger, type Platform } from '@/utils';
import { hasLinuxSandboxDependenciesSync } from '@/os/linux';

export { reset } from '@/core/manager/manager-cleanup';

export const isSupportedPlatform = (platform: Platform): boolean =>
  ['macos', 'linux'].includes(platform);

export const isSandboxingEnabled = (): boolean => state.config !== undefined;

export const checkDependencies = (ripgrepConfig?: {
  command: string;
  args?: string[];
}): boolean => {
  const platform = getPlatform();

  if (!isSupportedPlatform(platform)) return false;

  const rgToCheck = ripgrepConfig ?? state.config?.ripgrep;
  if (!rgToCheck?.command && !hasRipgrepSync()) return false;

  if (platform === 'linux') {
    const allowAllUnixSockets =
      state.config?.network?.allowAllUnixSockets ?? false;
    return hasLinuxSandboxDependenciesSync(allowAllUnixSockets);
  }

  return true;
};

const setupProxies = async (sandboxAskCallback?: SandboxAskCallback) => {
  const httpProxyPort =
    state.config?.network?.httpProxyPort ??
    (await startHttpProxyServer(sandboxAskCallback));

  if (state.config?.network?.httpProxyPort !== undefined) {
    logger.info(`Using external HTTP proxy on port ${httpProxyPort}`);
  }

  const socksProxyPort =
    state.config?.network?.socksProxyPort ??
    (await startSocksProxyServer(sandboxAskCallback));

  if (state.config?.network?.socksProxyPort !== undefined) {
    logger.info(`Using external SOCKS proxy on port ${socksProxyPort}`);
  }

  return { httpProxyPort, socksProxyPort };
};

const initializeNetworkInfrastructure = async (
  httpProxyPort: number,
  socksProxyPort: number,
) => {
  const linuxBridge =
    getPlatform() === 'linux'
      ? await initializeLinuxNetworkBridge(httpProxyPort, socksProxyPort)
      : undefined;

  const context = { httpProxyPort, socksProxyPort, linuxBridge };
  state.managerContext = context;
  logger.info('Network infrastructure initialized');
  return context;
};

const performInitialization = async (
  sandboxAskCallback?: SandboxAskCallback,
) => {
  try {
    const { httpProxyPort, socksProxyPort } =
      await setupProxies(sandboxAskCallback);
    return await initializeNetworkInfrastructure(httpProxyPort, socksProxyPort);
  } catch (error) {
    state.initializationPromise = undefined;
    state.managerContext = undefined;
    reset().catch((e) =>
      logger.error(`Cleanup failed in initialization: ${e}`),
    );
    throw error;
  }
};

export const initialize = async (
  runtimeConfig: SandboxRuntimeConfig,
  sandboxAskCallback?: SandboxAskCallback,
  enableLogMonitor = false,
): Promise<void> => {
  if (state.initializationPromise) {
    await state.initializationPromise;
    return;
  }

  state.config = runtimeConfig;

  if (!checkDependencies()) {
    const platform = getPlatform();
    const messages: Record<string, string> = {
      linux: ' Required: ripgrep (rg), bubblewrap (bwrap), and socat.',
      macos: ' Required: ripgrep (rg).',
    };
    let errorMessage = 'Sandbox dependencies are not available on this system.';
    errorMessage +=
      messages[platform] ?? ` Platform '${platform}' is not supported.`;
    throw new Error(errorMessage);
  }

  if (enableLogMonitor && getPlatform() === 'macos') {
    state.logMonitorShutdown = startMacOSSandboxLogMonitor(
      state.sandboxViolationStore.addViolation.bind(
        state.sandboxViolationStore,
      ),
      state.config?.ignoreViolations,
    );
    logger.info('Started macOS sandbox log monitor');
  }

  registerCleanup();
  state.initializationPromise = performInitialization(sandboxAskCallback);
  await state.initializationPromise;
};
