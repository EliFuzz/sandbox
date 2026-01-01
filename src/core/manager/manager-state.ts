import { SandboxViolationStore } from '@/core/sandbox/sandbox-violation-store';
import type { SandboxRuntimeConfig } from '@/core/sandbox/sandbox-config';
import type { createHttpProxyServer } from '@/core/network/http-proxy';
import type { SocksProxyWrapper } from '@/core/network/socks-proxy';
import type { LinuxNetworkBridgeContext } from '@/os/linux';

export interface NetworkContext {
  httpProxyPort: number;
  socksProxyPort: number;
  linuxBridge: LinuxNetworkBridgeContext | undefined;
}

interface ManagerState {
  config: SandboxRuntimeConfig | undefined;
  httpProxyServer: ReturnType<typeof createHttpProxyServer> | undefined;
  socksProxyServer: SocksProxyWrapper | undefined;
  managerContext: NetworkContext | undefined;
  initializationPromise: Promise<NetworkContext> | undefined;
  cleanupRegistered: boolean;
  logMonitorShutdown: (() => void) | undefined;
  sandboxViolationStore: SandboxViolationStore;
}

export const state: ManagerState = {
  config: undefined,
  httpProxyServer: undefined,
  socksProxyServer: undefined,
  managerContext: undefined,
  initializationPromise: undefined,
  cleanupRegistered: false,
  logMonitorShutdown: undefined,
  sandboxViolationStore: new SandboxViolationStore(),
};

export const resetState = (): void => {
  state.config = undefined;
  state.httpProxyServer = undefined;
  state.socksProxyServer = undefined;
  state.managerContext = undefined;
  state.initializationPromise = undefined;
  state.logMonitorShutdown = undefined;
};
