import { closeProxyServers } from '@/core/manager/manager-proxy';
import { resetState, state } from '@/core/manager/manager-state';
import { logger } from '@/utils/debug';
import type { ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';

const killProcess = async (
  process: ChildProcess,
  name: string
): Promise<void> => {
  if (!process.pid || process.killed) return;

  try {
    process.kill(process.pid);
    logger.info(`Sent SIGTERM to ${name} bridge process`);

    await new Promise<void>((resolve) => {
      process.once('exit', () => {
        logger.info(`${name} bridge process exited`);
        resolve();
      });

      setTimeout(() => {
        if (!process.killed && process.pid) {
          logger.warn(`${name} bridge did not exit, forcing SIGKILL`);
          try {
            process.kill(process.pid);
          } catch {
            /* empty */
          }
        }
        resolve();
      }, 5000);
    });
  } catch (err) {
    if ((err as Error & { code?: string }).code !== 'ESRCH') {
      logger.error(`Error killing ${name} bridge: ${err}`);
    }
  }
};

const cleanupSocket = (socketPath: string, name: string): void => {
  if (!socketPath) return;
  try {
    rmSync(socketPath, { force: true });
    logger.info(`Cleaned up ${name} socket`);
  } catch (err) {
    logger.error(`${name} socket cleanup error: ${err}`);
  }
};

const cleanupBridgeProcesses = async (): Promise<void> => {
  if (!state.managerContext?.linuxBridge) return;

  const {
    httpSocketPath,
    socksSocketPath,
    httpBridgeProcess,
    socksBridgeProcess,
  } = state.managerContext.linuxBridge;

  await Promise.all([
    killProcess(httpBridgeProcess, 'HTTP'),
    killProcess(socksBridgeProcess, 'SOCKS'),
  ]);
  cleanupSocket(httpSocketPath, 'HTTP');
  cleanupSocket(socksSocketPath, 'SOCKS');
};

export const reset = async (): Promise<void> => {
  if (state.logMonitorShutdown) {
    state.logMonitorShutdown();
    state.logMonitorShutdown = undefined;
  }

  await cleanupBridgeProcesses();
  await closeProxyServers();

  resetState();
};

export const registerCleanup = (): void => {
  if (state.cleanupRegistered) return;

  const cleanupHandler = () =>
    reset().catch((e) => logger.error(`Cleanup failed: ${e}`));

  process.once('exit', cleanupHandler);
  process.once('SIGINT', cleanupHandler);
  process.once('SIGTERM', cleanupHandler);

  state.cleanupRegistered = true;
};
