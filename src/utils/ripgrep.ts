import { execFile, type ExecFileException, spawnSync } from 'node:child_process';

export interface RipgrepConfig {
  command: string;
  args?: string[];
}

export const hasRipgrepSync = (): boolean => {
  try {
    const result = spawnSync('which', ['rg'], {
      stdio: 'ignore',
      timeout: 1000,
    });
    return result.status === 0;
  } catch {
    return false;
  }
};

export const ripGrep = async (
  args: string[],
  target: string,
  abortSignal: AbortSignal,
  config: RipgrepConfig = { command: 'rg' },
): Promise<string[]> => {
  const { command, args: commandArgs = [] } = config;

  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...commandArgs, ...args, target],
      {
        maxBuffer: 20_000_000,
        signal: abortSignal,
        timeout: 10_000,
      },
      (error: ExecFileException | null, stdout: string, stderr: string) => {
        if (!error) {
          resolve(stdout.trim().split('\n').filter(Boolean));
          return;
        }

        if (error.code === 1) {
          resolve([]);
          return;
        }

        reject(
          new Error(
            `ripgrep failed with exit code ${error.code}: ${stderr || error.message}`,
          ),
        );
      },
    );
  });
};
