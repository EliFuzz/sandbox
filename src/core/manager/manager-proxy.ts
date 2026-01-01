import { createHttpProxyServer } from '@/core/network/http-proxy';
import { createSocksProxyServer } from '@/core/network/socks-proxy';
import type { SandboxAskCallback } from '@/core/sandbox/sandbox-schemas';
import { filterNetworkRequest } from '@/core/manager/network-filter';
import { state } from '@/core/manager/manager-state';
import { logger } from '@/utils/debug';

export const startHttpProxyServer = async (
  sandboxAskCallback?: SandboxAskCallback,
): Promise<number> => {
  state.httpProxyServer = createHttpProxyServer({
    filter: (port: number, host: string) =>
      filterNetworkRequest(port, host, state.config, sandboxAskCallback),
  });
  return new Promise<number>((resolve, reject) => {
    if (!state.httpProxyServer) {
      reject(new Error('HTTP proxy server undefined before listen'));
      return;
    }
    const server = state.httpProxyServer;
    server.once('error', reject);
    server.once('listening', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        server.unref();
        logger.info(`HTTP proxy listening on localhost:${address.port}`);
        resolve(address.port);
      } else {
        reject(new Error('Failed to get proxy server address'));
      }
    });
    server.listen(0, '127.0.0.1');
  });
};

export const startSocksProxyServer = async (
  sandboxAskCallback?: SandboxAskCallback,
): Promise<number> => {
  state.socksProxyServer = createSocksProxyServer({
    filter: (port: number, host: string) =>
      filterNetworkRequest(port, host, state.config, sandboxAskCallback),
  });
  return new Promise<number>((resolve, reject) => {
    if (!state.socksProxyServer) {
      reject(new Error('SOCKS proxy server undefined before listen'));
      return;
    }
    state.socksProxyServer
      .listen(0, '127.0.0.1')
      .then((port: number) => {
        state.socksProxyServer?.unref();
        resolve(port);
      })
      .catch(reject);
  });
};

export const closeProxyServers = async (): Promise<void> => {
  const closePromises: Promise<void>[] = [];

  if (state.httpProxyServer) {
    closePromises.push(
      new Promise<void>((resolve) => {
        state.httpProxyServer!.close((error) => {
          if (error && error.message !== 'Server is not running.') {
            logger.error(`Error closing HTTP proxy server: ${error.message}`);
          }
          resolve();
        });
      }),
    );
  }

  if (state.socksProxyServer) {
    closePromises.push(
      state.socksProxyServer.close().catch((error: Error) => {
        logger.error(`Error closing SOCKS proxy server: ${error.message}`);
      }),
    );
  }

  await Promise.all(closePromises);
  state.httpProxyServer = undefined;
  state.socksProxyServer = undefined;
};

export const waitForNetworkInitialization = async (): Promise<boolean> => {
  if (!state.config) return false;
  if (state.initializationPromise) {
    try {
      await state.initializationPromise;
      return true;
    } catch {
      return false;
    }
  }
  return state.managerContext !== undefined;
};
