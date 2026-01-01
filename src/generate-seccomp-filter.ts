import { logger } from '@/utils';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const getVendorArchitecture = (): string | null => {
  const arch = process.arch as string;
  switch (arch) {
    case 'x64':
    case 'x86_64':
      return 'x64';
    case 'arm64':
    case 'aarch64':
      return 'arm64';
    default:
      logger.info(`Unsupported architecture: ${arch}`);
      return null;
  }
};

export const getPreGeneratedBpfPath = (): string | null => {
  const arch = getVendorArchitecture();
  if (!arch) {
    logger.info(
      `Cannot find pre-generated BPF filter: unsupported architecture ${process.arch}`
    );
    return null;
  }

  logger.info(`Detected architecture: ${arch}`);

  const bpfPath = join(
    process.cwd(),
    'dist',
    'vendor',
    'seccomp',
    arch,
    'unix-block.bpf'
  );

  if (existsSync(bpfPath)) {
    logger.info(`Found pre-generated BPF filter: ${bpfPath} (${arch})`);
    return bpfPath;
  }

  logger.info(`Pre-generated BPF filter not found: ${bpfPath} (${arch})`);
  return null;
};

export const getApplySeccompBinaryPath = (): string | null => {
  const arch = getVendorArchitecture();
  if (!arch) {
    logger.info(
      `Cannot find apply-seccomp binary: unsupported architecture ${process.arch}`
    );
    return null;
  }

  logger.info(`Looking for apply-seccomp binary for architecture: ${arch}`);

  const binaryPath = join(
    process.cwd(),
    'dist',
    'vendor',
    'seccomp',
    arch,
    'apply-seccomp'
  );

  if (existsSync(binaryPath)) {
    logger.info(`Found apply-seccomp binary: ${binaryPath} (${arch})`);
    return binaryPath;
  }

  logger.info(`apply-seccomp binary not found: ${binaryPath} (${arch})`);
  return null;
};

export const generateSeccompFilter = (): string | null => {
  const preGeneratedBpf = getPreGeneratedBpfPath();
  if (preGeneratedBpf) {
    logger.info('Using pre-generated BPF filter');
    return preGeneratedBpf;
  }

  logger.error('Pre-generated BPF filter not available for this architecture');
  return null;
};

export const cleanupSeccompFilter = (_filterPath: string): void => {
  try {
    if (existsSync(_filterPath)) {
      unlinkSync(_filterPath);
      logger.info(`Cleaned up seccomp filter: ${_filterPath}`);
    }
  } catch (error) {
    logger.error(`Failed to clean up seccomp filter ${_filterPath}: ${error}`);
  }
};
