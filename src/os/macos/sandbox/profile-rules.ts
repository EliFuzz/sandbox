import { normalizePathForSandbox } from '@/core/filesystem/path-utils';
import type {
  FsReadRestrictionConfig,
  FsWriteRestrictionConfig,
} from '@/core/sandbox/sandbox-schemas';
import {
  DANGEROUS_FILES,
  getDangerousDirectories,
} from '@/core/security/security';
import {
  createRuleWithGlobSupport,
  escapePath,
  getAncestorDirectories,
  getTmpdirParentIfMacOSPattern,
} from '@/os/macos/sandbox/profile-utils';
import { dirname, resolve } from 'node:path';

export const getMandatoryDenyPatterns = (allowGitConfig = false): string[] => {
  const cwd = process.cwd();
  const denyPaths: string[] = [];

  for (const fileName of DANGEROUS_FILES) {
    denyPaths.push(resolve(cwd, fileName), `**/${fileName}`);
  }

  for (const dirName of getDangerousDirectories()) {
    denyPaths.push(resolve(cwd, dirName), `**/${dirName}/**`);
  }

  denyPaths.push(
    resolve(cwd, '.git/hooks'),
    '**/.git/hooks/**',
    ...(allowGitConfig ? [] : [resolve(cwd, '.git/config'), '**/.git/config'])
  );

  return [...new Set(denyPaths)];
};

const generateAncestorRules = (baseDir: string, logTag: string): string[] => {
  const rules: string[] = [];
  for (const ancestorDir of getAncestorDirectories(baseDir)) {
    rules.push(
      '(deny file-write-unlink',
      `  (literal ${escapePath(ancestorDir)})`,
      `  (with message "${logTag}"))`
    );
  }
  return rules;
};

const generateRulesForPath = (
  pathPattern: string,
  logTag: string
): string[] => {
  const normalizedPath = normalizePathForSandbox(pathPattern);
  const rules = [
    ...createRuleWithGlobSupport(
      normalizedPath,
      'file-write-unlink',
      'deny',
      logTag
    ),
  ];

  const staticPrefix = normalizedPath.split(/[*?[\]]/)[0];
  if (staticPrefix && staticPrefix !== '/') {
    const baseDir = staticPrefix.endsWith('/')
      ? staticPrefix.slice(0, -1)
      : dirname(staticPrefix);
    rules.push(
      '(deny file-write-unlink',
      `  (literal ${escapePath(baseDir)})`,
      `  (with message "${logTag}"))`
    );
    rules.push(...generateAncestorRules(baseDir, logTag));
  }

  return rules;
};

const generateMoveBlockingRules = (
  pathPatterns: string[],
  logTag: string
): string[] => {
  const rules: string[] = [];

  for (const pathPattern of pathPatterns) {
    rules.push(...generateRulesForPath(pathPattern, logTag));
  }

  return rules;
};

export const generateReadRules = (
  config: FsReadRestrictionConfig | undefined,
  logTag: string
): string[] => {
  if (!config) return ['(allow file-read*)'];

  const rules: string[] = ['(allow file-read*)'];

  for (const pathPattern of config.denyOnly || []) {
    rules.push(
      ...createRuleWithGlobSupport(pathPattern, 'file-read*', 'deny', logTag)
    );
  }

  rules.push(...generateMoveBlockingRules(config.denyOnly || [], logTag));

  return rules;
};

const generateTmpdirRules = (logTag: string): string[] => {
  const rules: string[] = [];
  for (const tmpdirParent of getTmpdirParentIfMacOSPattern()) {
    const normalizedPath = normalizePathForSandbox(tmpdirParent);
    rules.push(
      '(allow file-write*',
      `  (subpath ${escapePath(normalizedPath)})`,
      `  (with message "${logTag}"))`
    );
  }
  return rules;
};

const generateAllowRules = (allowOnly: string[], logTag: string): string[] => {
  const rules: string[] = [];
  for (const pathPattern of allowOnly) {
    rules.push(
      ...createRuleWithGlobSupport(pathPattern, 'file-write*', 'allow', logTag)
    );
  }
  return rules;
};

const generateDenyRules = (denyPaths: string[], logTag: string): string[] => {
  const rules: string[] = [];
  for (const pathPattern of denyPaths) {
    rules.push(
      ...createRuleWithGlobSupport(pathPattern, 'file-write*', 'deny', logTag)
    );
  }
  return rules;
};

export const generateWriteRules = (
  config: FsWriteRestrictionConfig | undefined,
  logTag: string,
  allowGitConfig = false
): string[] => {
  if (!config) return ['(allow file-write*)'];

  const tmpdirRules = generateTmpdirRules(logTag);
  const allowRules = generateAllowRules(config.allowOnly || [], logTag);

  const denyPaths = [
    ...(config.denyWithinAllow || []),
    ...getMandatoryDenyPatterns(allowGitConfig),
  ];

  const denyRules = generateDenyRules(denyPaths, logTag);
  const moveRules = generateMoveBlockingRules(denyPaths, logTag);

  return [...tmpdirRules, ...allowRules, ...denyRules, ...moveRules];
};

export const generateNetworkRules = (
  needsNetworkRestriction: boolean,
  allowLocalBinding: boolean | undefined,
  allowAllUnixSockets: boolean | undefined,
  allowUnixSockets: string[] | undefined,
  httpProxyPort: number | undefined,
  socksProxyPort: number | undefined
): string[] => {
  const rules: string[] = [''];

  if (!needsNetworkRestriction) {
    rules.push('(allow network*)');
    return rules;
  }

  if (allowLocalBinding) {
    rules.push(
      '(allow network-bind (local ip "localhost:*"))',
      '(allow network-inbound (local ip "localhost:*"))',
      '(allow network-outbound (local ip "localhost:*"))'
    );
  }

  if (allowAllUnixSockets) {
    rules.push('(allow network* (subpath "/"))');
  } else if (allowUnixSockets && allowUnixSockets.length > 0) {
    for (const socketPath of allowUnixSockets) {
      const normalizedPath = normalizePathForSandbox(socketPath);
      rules.push(`(allow network* (subpath ${escapePath(normalizedPath)}))`);
    }
  }

  if (httpProxyPort !== undefined) {
    rules.push(
      `(allow network-bind (local ip "localhost:${httpProxyPort}"))`,
      `(allow network-inbound (local ip "localhost:${httpProxyPort}"))`,
      `(allow network-outbound (remote ip "localhost:${httpProxyPort}"))`
    );
  }

  if (socksProxyPort !== undefined) {
    rules.push(
      `(allow network-bind (local ip "localhost:${socksProxyPort}"))`,
      `(allow network-inbound (local ip "localhost:${socksProxyPort}"))`,
      `(allow network-outbound (remote ip "localhost:${socksProxyPort}"))`
    );
  }

  return rules;
};

export const generatePtyRules = (): string[] => {
  return [
    '(allow pseudo-tty)',
    '(allow file-ioctl (literal "/dev/ptmx") (regex #"^/dev/ttys"))',
    '(allow file-read* file-write* (literal "/dev/ptmx") (regex #"^/dev/ttys"))',
  ];
};
