import { logger } from '@/utils/debug';
import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface LinuxNetworkBridgeContext {
  httpSocketPath: string;
  socksSocketPath: string;
  httpBridgeProcess: ChildProcess;
  socksBridgeProcess: ChildProcess;
  httpProxyPort: number;
  socksProxyPort: number;
}

const startBridge = (
  socketPath: string,
  proxyPort: number,
  name: string
): ChildProcess => {
  const args = [
    `UNIX-LISTEN:${socketPath},fork,reuseaddr`,
    `TCP:localhost:${proxyPort},keepalive,keepidle=10,keepintvl=5,keepcnt=3`,
  ];

  logger.info(`Starting ${name} bridge: socat ${args.join(' ')}`);

  const process = spawn('socat', args, { stdio: 'ignore' });

  if (!process.pid) {
    throw new Error(`Failed to start ${name} bridge process`);
  }

  process.on('error', (err) => {
    logger.error(`${name} bridge process error: ${err}`);
  });

  process.on('exit', (code, signal) => {
    if (code === 0) {
      logger.info(
        `${name} bridge process exited with code ${code}, signal ${signal}`
      );
    } else {
      logger.error(
        `${name} bridge process exited with code ${code}, signal ${signal}`
      );
    }
  });

  return process;
};

const killProcesses = (http: ChildProcess, socks: ChildProcess): void => {
  if (http.pid) {
    try {
      process.kill(http.pid, 'SIGTERM');
    } catch {
      // empty
    }
  }
  if (socks.pid) {
    try {
      process.kill(socks.pid, 'SIGTERM');
    } catch {
      // empty
    }
  }
};

const areProcessesAlive = (http: ChildProcess, socks: ChildProcess): boolean =>
  !!http.pid && !http.killed && !!socks.pid && !socks.killed;

const checkSocketsReady = (
  httpSocketPath: string,
  socksSocketPath: string,
  attempt: number
): boolean => {
  try {
    return existsSync(httpSocketPath) && existsSync(socksSocketPath);
  } catch (err) {
    logger.error(`Error checking sockets (attempt ${attempt + 1}): ${err}`);
    return false;
  }
};

const waitForSockets = async (
  httpSocketPath: string,
  socksSocketPath: string,
  httpProcess: ChildProcess,
  socksProcess: ChildProcess
): Promise<void> => {
  const maxAttempts = 5;
  for (let i = 0; i < maxAttempts; i++) {
    if (!areProcessesAlive(httpProcess, socksProcess)) {
      throw new Error('Linux bridge process died unexpectedly');
    }
    if (checkSocketsReady(httpSocketPath, socksSocketPath, i)) {
      logger.info(`Linux bridges ready after ${i + 1} attempts`);
      return;
    }
    if (i === maxAttempts - 1) {
      killProcesses(httpProcess, socksProcess);
      throw new Error(
        `Failed to create bridge sockets after ${maxAttempts} attempts`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, i * 100));
  }
};

const startSocksBridge = (
  socksSocketPath: string,
  socksProxyPort: number,
  httpProcess: ChildProcess
): ChildProcess => {
  try {
    return startBridge(socksSocketPath, socksProxyPort, 'SOCKS');
  } catch (err) {
    if (httpProcess.pid) {
      try {
        process.kill(httpProcess.pid, 'SIGTERM');
      } catch {
        // empty
      }
    }
    throw err;
  }
};

export const initializeLinuxNetworkBridge = async (
  httpProxyPort: number,
  socksProxyPort: number
): Promise<LinuxNetworkBridgeContext> => {
  const socketId = randomBytes(8).toString('hex');
  const httpSocketPath = join(tmpdir(), `vsbx-http-${socketId}.sock`);
  const socksSocketPath = join(tmpdir(), `vsbx-socks-${socketId}.sock`);
  const httpBridgeProcess = startBridge(httpSocketPath, httpProxyPort, 'HTTP');
  const socksBridgeProcess = startSocksBridge(
    socksSocketPath,
    socksProxyPort,
    httpBridgeProcess
  );
  await waitForSockets(
    httpSocketPath,
    socksSocketPath,
    httpBridgeProcess,
    socksBridgeProcess
  );
  return {
    httpSocketPath,
    socksSocketPath,
    httpBridgeProcess,
    socksBridgeProcess,
    httpProxyPort,
    socksProxyPort,
  };
};
