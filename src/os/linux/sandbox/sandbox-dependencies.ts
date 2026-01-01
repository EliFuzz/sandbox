import {
  getApplySeccompBinaryPath,
  getPreGeneratedBpfPath,
} from '@/generate-seccomp-filter';
import { logger } from '@/utils/debug';
import { spawnSync } from 'node:child_process';

export const hasLinuxSandboxDependenciesSync = (
  allowAllUnixSockets = false,
): boolean => {
  try {
    const bwrapResult = spawnSync('which', ['bwrap'], {
      stdio: 'ignore',
      timeout: 1000,
    });
    const socatResult = spawnSync('which', ['socat'], {
      stdio: 'ignore',
      timeout: 1000,
    });

    const hasBasicDeps = bwrapResult.status === 0 && socatResult.status === 0;

    if (!allowAllUnixSockets) {
      const hasPreGeneratedBpf = getPreGeneratedBpfPath() !== null;

      const hasApplySeccompBinary = getApplySeccompBinaryPath() !== null;

      if (!hasPreGeneratedBpf || !hasApplySeccompBinary) {
        logger.warn(
          `Seccomp filtering not available (missing binaries for ${process.arch})`,
        );
      }
    }

    return hasBasicDeps;
  } catch {
    return false;
  }
};
