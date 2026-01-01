import { logger } from '@/utils/debug';
import type { Socks5Server } from '@pondwader/socks5-server';
import { createServer as createSocks5Server } from '@pondwader/socks5-server';
import type { Server as NetServer } from 'node:net';

export interface SocksProxyServerOptions {
  filter(port: number, host: string): Promise<boolean> | boolean;
}

export interface SocksProxyWrapper {
  server: Socks5Server;
  getPort(): number | undefined;
  listen(port: number, hostname: string): Promise<number>;
  close(): Promise<void>;
  unref(): void;
}

const getServerPort = (socksServer: Socks5Server): number | undefined => {
  try {
    const serverInternal = (
      socksServer as unknown as { server?: NetServer }
    )?.server;
    if (!serverInternal || typeof serverInternal?.address !== 'function') {
      return undefined;
    }

    const address = serverInternal.address();
    if (address && typeof address === 'object' && 'port' in address) {
      return address.port;
    }
  } catch (error) {
    logger.error(`Error getting port: ${error}`);
  }
  return undefined;
};

const unrefServer = (socksServer: Socks5Server): void => {
  try {
    const serverInternal = (
      socksServer as unknown as { server?: NetServer }
    )?.server;
    if (serverInternal && typeof serverInternal?.unref === 'function') {
      serverInternal.unref();
    }
  } catch (error) {
    logger.error(`Error calling unref: ${error}`);
  }
};

const isAlreadyClosedError = (error: Error): boolean => {
  const errorMessage = error.message?.toLowerCase() || '';
  return (
    errorMessage.includes('not running') ||
    errorMessage.includes('already closed') ||
    errorMessage.includes('not listening')
  );
};

export const createSocksProxyServer = (
  options: SocksProxyServerOptions,
): SocksProxyWrapper => {
  const socksServer = createSocks5Server();

  socksServer.setRulesetValidator(async (conn) => {
    try {
      const hostname = conn.destAddress;
      const port = conn.destPort;

      logger.info(`Connection request to ${hostname}:${port}`);

      const allowed = await options.filter(port, hostname);
      if (!allowed) {
        logger.error(`Connection blocked to ${hostname}:${port}`);
        return false;
      }

      logger.info(`Connection allowed to ${hostname}:${port}`);
      return true;
    } catch (error) {
      logger.error(`Error validating connection: ${error}`);
      return false;
    }
  });

  return {
    server: socksServer,
    getPort(): number | undefined {
      return getServerPort(socksServer);
    },
    listen(port: number, hostname: string): Promise<number> {
      return new Promise((resolve, reject) => {
        const listeningCallback = (): void => {
          const actualPort = this.getPort();
          if (actualPort) {
            logger.info(`SOCKS proxy listening on ${hostname}:${actualPort}`);
            resolve(actualPort);
          } else {
            reject(new Error('Failed to get SOCKS proxy server port'));
          }
        };
        socksServer.listen(port, hostname, listeningCallback);
      });
    },
    async close(): Promise<void> {
      return new Promise((resolve, reject) => {
        socksServer.close((error) => {
          if (error && !isAlreadyClosedError(error)) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
    unref(): void {
      unrefServer(socksServer);
    },
  };
};
