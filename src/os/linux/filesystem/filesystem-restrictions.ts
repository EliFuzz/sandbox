import { normalizePathForSandbox } from '@/core/filesystem/path-utils';
import type {
  FsReadRestrictionConfig,
  FsWriteRestrictionConfig,
} from '@/core/sandbox/sandbox-schemas';
import {
  DANGEROUS_FILES,
  getDangerousDirectories,
  normalizeCaseForComparison,
} from '@/core/security/security';
import { logger } from '@/utils/debug';
import { ripGrep } from '@/utils/ripgrep';
import { existsSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

export const DEFAULT_MANDATORY_DENY_SEARCH_DEPTH = 3;

const DEFAULT_RIPGREP_CONFIG = { command: 'rg' };

const buildInitialDenyPaths = (
  cwd: string,
  allowGitConfig: boolean
): string[] => {
  const dangerousDirectories = getDangerousDirectories();
  const denyPaths = [
    ...DANGEROUS_FILES.map((f) => resolve(cwd, f)),
    ...dangerousDirectories.map((d) => resolve(cwd, d)),
    resolve(cwd, '.git/hooks'),
  ];
  if (!allowGitConfig) {
    denyPaths.push(resolve(cwd, '.git/config'));
  }
  return denyPaths;
};

const buildIglobArgs = (allowGitConfig: boolean): string[] => {
  const dangerousDirectories = getDangerousDirectories();
  const iglobArgs: string[] = [];
  for (const fileName of DANGEROUS_FILES) {
    iglobArgs.push('--iglob', fileName);
  }
  for (const dirName of dangerousDirectories) {
    iglobArgs.push('--iglob', `**/${dirName}/**`);
  }
  iglobArgs.push('--iglob', '**/.git/hooks/**');
  if (!allowGitConfig) {
    iglobArgs.push('--iglob', '**/.git/config');
  }
  return iglobArgs;
};

const handleGitDenyPath = (
  segments: string[],
  dirIndex: number,
  match: string,
  denyPaths: string[]
): void => {
  const gitDir = segments.slice(0, dirIndex + 1).join(sep);
  if (match.includes('.git/hooks')) {
    denyPaths.push(join(gitDir, 'hooks'));
  } else if (match.includes('.git/config')) {
    denyPaths.push(join(gitDir, 'config'));
  }
};

const findAndAddDenyPath = (
  absolutePath: string,
  match: string,
  dangerousDirectories: string[],
  denyPaths: string[]
): boolean => {
  for (const dirName of [...dangerousDirectories, '.git']) {
    const normalizedDirName = normalizeCaseForComparison(dirName);
    const segments = absolutePath.split(sep);
    const dirIndex = segments.findIndex(
      (s) => normalizeCaseForComparison(s) === normalizedDirName
    );
    if (dirIndex !== -1) {
      if (dirName === '.git') {
        handleGitDenyPath(segments, dirIndex, match, denyPaths);
      } else {
        denyPaths.push(segments.slice(0, dirIndex + 1).join(sep));
      }
      return true;
    }
  }
  return false;
};

const processMatches = (
  matches: string[],
  cwd: string,
  denyPaths: string[]
): void => {
  const dangerousDirectories = getDangerousDirectories();
  for (const match of matches) {
    const absolutePath = resolve(cwd, match);
    const foundDir = findAndAddDenyPath(
      absolutePath,
      match,
      dangerousDirectories,
      denyPaths
    );
    if (!foundDir) {
      denyPaths.push(absolutePath);
    }
  }
};

const linuxGetMandatoryDenyPaths = async (
  ripgrepConfig: { command: string; args?: string[] } = DEFAULT_RIPGREP_CONFIG,
  maxDepth: number = DEFAULT_MANDATORY_DENY_SEARCH_DEPTH,
  allowGitConfig = false,
  abortSignal?: AbortSignal
): Promise<string[]> => {
  const cwd = process.cwd();
  const fallbackController = new AbortController();
  const signal = abortSignal ?? fallbackController.signal;
  let denyPaths = buildInitialDenyPaths(cwd, allowGitConfig);
  const iglobArgs = buildIglobArgs(allowGitConfig);
  let matches: string[] = [];
  try {
    matches = await ripGrep(
      [
        '--files',
        '--hidden',
        '--max-depth',
        String(maxDepth),
        ...iglobArgs,
        '-g',
        '!**/node_modules/**',
      ],
      cwd,
      signal,
      ripgrepConfig
    );
  } catch (error) {
    logger.info(`ripgrep scan failed: ${error}`);
  }
  processMatches(matches, cwd, denyPaths);
  return Array.from(new Set(denyPaths));
};

const processDenyPaths = (
  denyPaths: string[],
  allowedWritePaths: string[],
  args: string[]
): void => {
  for (const pathPattern of denyPaths) {
    const normalizedPath = normalizePathForSandbox(pathPattern);
    if (normalizedPath.startsWith('/dev/')) {
      continue;
    }
    if (!existsSync(normalizedPath)) {
      logger.info(`Skipping non-existent deny path: ${normalizedPath}`);
      continue;
    }
    const isWithinAllowedPath = allowedWritePaths.some(
      (allowedPath) =>
        normalizedPath.startsWith(allowedPath + '/') ||
        normalizedPath === allowedPath
    );
    if (isWithinAllowedPath) {
      args.push('--ro-bind', normalizedPath, normalizedPath);
    } else {
      logger.info(
        `Skipping deny path not within allowed paths: ${normalizedPath}`
      );
    }
  }
};

const processAllowOnlyPaths = (
  allowOnly: string[],
  args: string[],
  allowedWritePaths: string[]
): void => {
  for (const pathPattern of allowOnly) {
    const normalizedPath = normalizePathForSandbox(pathPattern);
    logger.info(`Processing write path: ${pathPattern} -> ${normalizedPath}`);
    if (normalizedPath.startsWith('/dev/')) {
      logger.info(`Skipping /dev path: ${normalizedPath}`);
      continue;
    }
    if (!existsSync(normalizedPath)) {
      logger.info(`Skipping non-existent write path: ${normalizedPath}`);
      continue;
    }
    args.push('--bind', normalizedPath, normalizedPath);
    allowedWritePaths.push(normalizedPath);
  }
};

const processWriteConfig = async (
  writeConfig: FsWriteRestrictionConfig,
  ripgrepConfig: { command: string; args?: string[] },
  mandatoryDenySearchDepth: number,
  allowGitConfig: boolean,
  abortSignal?: AbortSignal
): Promise<string[]> => {
  const args: string[] = ['--ro-bind', '/', '/'];
  const allowedWritePaths: string[] = [];
  processAllowOnlyPaths(writeConfig.allowOnly || [], args, allowedWritePaths);
  const denyPaths = [
    ...(writeConfig.denyWithinAllow || []),
    ...(await linuxGetMandatoryDenyPaths(
      ripgrepConfig,
      mandatoryDenySearchDepth,
      allowGitConfig,
      abortSignal
    )),
  ];
  processDenyPaths(denyPaths, allowedWritePaths, args);
  return args;
};

const processReadDeny = (
  readConfig: FsReadRestrictionConfig | undefined
): string[] => {
  const args: string[] = [];
  const readDenyPaths = [...(readConfig?.denyOnly || [])];
  if (existsSync('/etc/ssh/ssh_config.d')) {
    readDenyPaths.push('/etc/ssh/ssh_config.d');
  }
  for (const pathPattern of readDenyPaths) {
    const normalizedPath = normalizePathForSandbox(pathPattern);
    if (!existsSync(normalizedPath)) {
      logger.info(`Skipping non-existent read deny path: ${normalizedPath}`);
      continue;
    }
    const readDenyStat = statSync(normalizedPath);
    if (readDenyStat.isDirectory()) {
      args.push('--tmpfs', normalizedPath);
    } else {
      args.push('--ro-bind', '/dev/null', normalizedPath);
    }
  }
  return args;
};

export const generateFilesystemArgs = async (
  readConfig: FsReadRestrictionConfig | undefined,
  writeConfig: FsWriteRestrictionConfig | undefined,
  ripgrepConfig: { command: string; args?: string[] } = DEFAULT_RIPGREP_CONFIG,
  mandatoryDenySearchDepth: number = DEFAULT_MANDATORY_DENY_SEARCH_DEPTH,
  allowGitConfig = false,
  abortSignal?: AbortSignal
): Promise<string[]> => {
  let args: string[] = [];
  if (writeConfig) {
    args = await processWriteConfig(
      writeConfig,
      ripgrepConfig,
      mandatoryDenySearchDepth,
      allowGitConfig,
      abortSignal
    );
  } else {
    args.push('--bind', '/', '/');
  }
  const readArgs = processReadDeny(readConfig);
  args.push(...readArgs);
  return args;
};
