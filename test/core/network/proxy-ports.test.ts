import { SandboxManager } from '@/core/manager/sandbox-manager';
import type { SandboxRuntimeConfig } from '@/core/sandbox/sandbox-config';
import { getPlatform } from '@/utils/platform';
import { afterAll, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer, request } from 'node:http';
import type { Socket } from 'node:net';
import { connect } from 'node:net';

describe('Proxy Ports Configuration', () => {
  afterAll(async () => {
    await SandboxManager.reset();
  });

  describe('External HTTP + local SOCKS', () => {
    it('uses external HTTP proxy', async () => {
      const config: SandboxRuntimeConfig = {
        network: {
          allowedDomains: ['example.com'],
          deniedDomains: [],
          httpProxyPort: 8888,
        },
        filesystem: {
          denyRead: [],
          allowWrite: [],
          denyWrite: [],
        },
      };

      await SandboxManager.initialize(config);

      const httpProxyPort = SandboxManager.getProxyPort();
      expect(httpProxyPort).toBe(8888);

      const socksProxyPort = SandboxManager.getSocksProxyPort();
      expect(socksProxyPort).toBeDefined();
      expect(socksProxyPort).not.toBe(8888);
      expect(socksProxyPort).toBeGreaterThan(0);

      await SandboxManager.reset();
    });
  });

  describe('External SOCKS + local HTTP', () => {
    it('uses external SOCKS proxy', async () => {
      const config: SandboxRuntimeConfig = {
        network: {
          allowedDomains: ['example.com'],
          deniedDomains: [],
          socksProxyPort: 1080,
        },
        filesystem: {
          denyRead: [],
          allowWrite: [],
          denyWrite: [],
        },
      };

      await SandboxManager.initialize(config);

      const socksProxyPort = SandboxManager.getSocksProxyPort();
      expect(socksProxyPort).toBe(1080);

      const httpProxyPort = SandboxManager.getProxyPort();
      expect(httpProxyPort).toBeDefined();
      expect(httpProxyPort).not.toBe(1080);
      expect(httpProxyPort).toBeGreaterThan(0);

      await SandboxManager.reset();
    });
  });

  describe('Both external proxies', () => {
    it('uses both external proxies', async () => {
      const config: SandboxRuntimeConfig = {
        network: {
          allowedDomains: ['example.com'],
          deniedDomains: [],
          httpProxyPort: 9090,
          socksProxyPort: 9091,
        },
        filesystem: {
          denyRead: [],
          allowWrite: [],
          denyWrite: [],
        },
      };

      await SandboxManager.initialize(config);

      const httpProxyPort = SandboxManager.getProxyPort();
      expect(httpProxyPort).toBe(9090);

      const socksProxyPort = SandboxManager.getSocksProxyPort();
      expect(socksProxyPort).toBe(9091);

      await SandboxManager.reset();
    });
  });

  describe('Both local proxies', () => {
    it('starts both proxies locally', async () => {
      const config: SandboxRuntimeConfig = {
        network: {
          allowedDomains: ['example.com'],
          deniedDomains: [],
        },
        filesystem: {
          denyRead: [],
          allowWrite: [],
          denyWrite: [],
        },
      };

      await SandboxManager.initialize(config);

      const httpProxyPort = SandboxManager.getProxyPort();
      expect(httpProxyPort).toBeDefined();
      expect(httpProxyPort).toBeGreaterThan(0);
      expect(httpProxyPort).toBeLessThan(65536);

      const socksProxyPort = SandboxManager.getSocksProxyPort();
      expect(socksProxyPort).toBeDefined();
      expect(socksProxyPort).toBeGreaterThan(0);
      expect(socksProxyPort).toBeLessThan(65536);

      expect(httpProxyPort).not.toBe(socksProxyPort);

      await SandboxManager.reset();
    });
  });

  describe('Multiple cycles', () => {
    it('handles multiple init/reset cycles', async () => {
      const config1: SandboxRuntimeConfig = {
        network: {
          allowedDomains: ['example.com'],
          deniedDomains: [],
        },
        filesystem: {
          denyRead: [],
          allowWrite: [],
          denyWrite: [],
        },
      };

      await SandboxManager.initialize(config1);
      const httpPort1 = SandboxManager.getProxyPort();
      const socksPort1 = SandboxManager.getSocksProxyPort();
      expect(httpPort1).toBeDefined();
      expect(socksPort1).toBeDefined();
      await SandboxManager.reset();

      const config2: SandboxRuntimeConfig = {
        network: {
          allowedDomains: ['example.com'],
          deniedDomains: [],
          httpProxyPort: 7777,
          socksProxyPort: 7778,
        },
        filesystem: {
          denyRead: [],
          allowWrite: [],
          denyWrite: [],
        },
      };

      await SandboxManager.initialize(config2);
      expect(SandboxManager.getProxyPort()).toBe(7777);
      expect(SandboxManager.getSocksProxyPort()).toBe(7778);
      await SandboxManager.reset();

      const config3: SandboxRuntimeConfig = {
        network: {
          allowedDomains: ['example.com'],
          deniedDomains: [],
          httpProxyPort: 6666,
        },
        filesystem: {
          denyRead: [],
          allowWrite: [],
          denyWrite: [],
        },
      };

      await SandboxManager.initialize(config3);
      expect(SandboxManager.getProxyPort()).toBe(6666);
      const socksPort3 = SandboxManager.getSocksProxyPort();
      expect(socksPort3).toBeDefined();
      expect(socksPort3).not.toBe(6666);
      await SandboxManager.reset();
    });
  });

  describe('Port validation', () => {
    it('accepts valid port range', async () => {
      const config: SandboxRuntimeConfig = {
        network: {
          allowedDomains: ['example.com'],
          deniedDomains: [],
          httpProxyPort: 1,
          socksProxyPort: 65535,
        },
        filesystem: {
          denyRead: [],
          allowWrite: [],
          denyWrite: [],
        },
      };

      await SandboxManager.initialize(config);
      expect(SandboxManager.getProxyPort()).toBe(1);
      expect(SandboxManager.getSocksProxyPort()).toBe(65535);
      await SandboxManager.reset();
    });

    it('accepts standard proxy ports', async () => {
      const config: SandboxRuntimeConfig = {
        network: {
          allowedDomains: ['example.com'],
          deniedDomains: [],
          httpProxyPort: 3128,
          socksProxyPort: 1080,
        },
        filesystem: {
          denyRead: [],
          allowWrite: [],
          denyWrite: [],
        },
      };

      await SandboxManager.initialize(config);
      expect(SandboxManager.getProxyPort()).toBe(3128);
      expect(SandboxManager.getSocksProxyPort()).toBe(1080);
      await SandboxManager.reset();
    });
  });

  describe('Idempotency', () => {
    it('handles multiple init without reset', async () => {
      const config: SandboxRuntimeConfig = {
        network: {
          allowedDomains: ['example.com'],
          deniedDomains: [],
          httpProxyPort: 5555,
          socksProxyPort: 5556,
        },
        filesystem: {
          denyRead: [],
          allowWrite: [],
          denyWrite: [],
        },
      };

      await SandboxManager.initialize(config);
      const httpPort1 = SandboxManager.getProxyPort();
      const socksPort1 = SandboxManager.getSocksProxyPort();

      await SandboxManager.initialize(config);
      const httpPort2 = SandboxManager.getProxyPort();
      const socksPort2 = SandboxManager.getSocksProxyPort();

      expect(httpPort2).toBe(httpPort1);
      expect(socksPort2).toBe(socksPort1);
      expect(httpPort2).toBe(5555);
      expect(socksPort2).toBe(5556);

      await SandboxManager.reset();
    });
  });

  describe('End-to-end', () => {
    it('routes through external proxy (Linux only)', async () => {
      if (getPlatform() !== 'linux') {
        console.log('Skipping e2e test on non-Linux');
        return;
      }

      let externalProxyServer: Server | undefined;
      let externalProxyPort: number | undefined;

      const handleConnect = (
        req: IncomingMessage,
        clientSocket: Socket,
        head: Buffer
      ) => {
        const { port, hostname } = new URL(`http://${req.url}`);

        const serverSocket = connect(Number.parseInt(port) || 80, hostname);

        serverSocket.on('connect', () => {
          clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          serverSocket.write(head);
          serverSocket.pipe(clientSocket);
          clientSocket.pipe(serverSocket);
        });

        serverSocket.on('error', () => {
          clientSocket.end();
        });

        clientSocket.on('error', () => {
          serverSocket.end();
        });
      };

      const handleRequest = (req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url!);
        const options = {
          hostname: url.hostname,
          port: url.port || 80,
          path: url.pathname + url.search,
          method: req.method,
          headers: req.headers,
        };

        const proxyReq = request(options, (proxyRes) => {
          res.writeHead(proxyRes.statusCode!, proxyRes.headers);
          proxyRes.pipe(res);
        });

        proxyReq.on('error', () => {
          res.writeHead(502);
          res.end('Bad Gateway');
        });

        req.pipe(proxyReq);
      };

      try {
        externalProxyServer = createServer();

        externalProxyServer.on('connect', handleConnect);

        externalProxyServer.on('request', handleRequest);

        await new Promise<void>((resolve, reject) => {
          externalProxyServer!.listen(0, '127.0.0.1', () => {
            const addr = externalProxyServer!.address();
            if (addr && typeof addr === 'object') {
              externalProxyPort = addr.port;
              resolve();
            } else {
              reject(new Error('Failed to get proxy address'));
            }
          });
          externalProxyServer!.on('error', reject);
        });

        const config: SandboxRuntimeConfig = {
          network: {
            allowedDomains: ['example.com'],
            deniedDomains: [],
            httpProxyPort: externalProxyPort,
          },
          filesystem: {
            denyRead: [],
            allowWrite: [],
            denyWrite: [],
          },
        };

        await SandboxManager.initialize(config);

        expect(SandboxManager.getProxyPort()).toBe(externalProxyPort);

        const command = await SandboxManager.wrapWithSandbox(
          'curl -s --max-time 5 http://example.com'
        );

        const result = spawnSync(command, {
          shell: true,
          encoding: 'utf8',
          timeout: 10000,
        });

        expect(result.status).toBe(0);

        const output = (result.stderr || result.stdout || '').toLowerCase();
        expect(output).not.toContain('blocked by network allowlist');
      } finally {
        await SandboxManager.reset();

        if (externalProxyServer) {
          await new Promise<void>((resolve) => {
            externalProxyServer!.close(() => {
              resolve();
            });
          });
        }
      }
    });
  });
});
