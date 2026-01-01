import { logger } from '@/utils/debug';
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect, type Server, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { URL } from 'node:url';

export interface HttpProxyServerOptions {
  filter(
    port: number,
    host: string,
    socket: Socket | Duplex
  ): Promise<boolean> | boolean;
}

const handleConnectRequest = async (
  req: IncomingMessage,
  socket: Socket | Duplex,
  options: HttpProxyServerOptions
): Promise<void> => {
  socket.on('error', (err) => {
    logger.error(`Client socket error: ${err.message}`);
  });

  const [hostname, portStr] = req.url!.split(':');
  const port = portStr === undefined ? undefined : parseInt(portStr, 10);

  if (!hostname || !port) {
    logger.error(`Invalid CONNECT request: ${req.url}`);
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return;
  }

  const allowed = await options.filter(port, hostname, socket);
  if (!allowed) {
    logger.error(`Connection blocked to ${hostname}:${port}`);
    socket.end(
      'HTTP/1.1 403 Forbidden\r\n' +
        'Content-Type: text/plain\r\n' +
        'X-Proxy-Error: blocked-by-allowlist\r\n' +
        '\r\n' +
        'Connection blocked by network allowlist'
    );
    return;
  }

  const serverSocket = connect(port, hostname, () => {
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    serverSocket.pipe(socket);
    socket.pipe(serverSocket);
  });

  serverSocket.on('error', (err) => {
    logger.error(`CONNECT tunnel failed: ${err.message}`);
    socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
  });

  socket.on('error', (err) => {
    logger.error(`Client socket error: ${err.message}`);
    serverSocket.destroy();
  });

  socket.on('end', () => serverSocket.end());
  serverSocket.on('end', () => socket.end());
};

const handleHttpRequest = async (
  req: IncomingMessage,
  res: ServerResponse,
  options: HttpProxyServerOptions
): Promise<void> => {
  const url = new URL(req.url!);
  const hostname = url.hostname;
  const port = url.port
    ? parseInt(url.port, 10)
    : url.protocol === 'https:'
      ? 443
      : 80;

  const allowed = await options.filter(port, hostname, req.socket);
  if (!allowed) {
    logger.error(`HTTP request blocked to ${hostname}:${port}`);
    res.writeHead(403, {
      'Content-Type': 'text/plain',
      'X-Proxy-Error': 'blocked-by-allowlist',
    });
    res.end('Connection blocked by network allowlist');
    return;
  }

  const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest;

  const proxyReq = requestFn(
    {
      hostname,
      port,
      path: url.pathname + url.search,
      method: req.method,
      headers: { ...req.headers, host: url.host },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode!, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (err) => {
    logger.error(`Proxy request failed: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Bad Gateway');
    }
  });

  req.pipe(proxyReq);
};

export const createHttpProxyServer = (
  options: HttpProxyServerOptions
): Server => {
  const server = createServer();

  server.on('connect', async (req, socket) => {
    try {
      await handleConnectRequest(req, socket, options);
    } catch (err) {
      logger.error(`Error handling CONNECT: ${err}`);
      socket.end('HTTP/1.1 500 Internal Server Error\r\n\r\n');
    }
  });

  server.on('request', async (req, res) => {
    try {
      await handleHttpRequest(req, res, options);
    } catch (err) {
      logger.error(`Error handling HTTP request: ${err}`);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  });

  return server;
};
