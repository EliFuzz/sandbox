import { encodeSandboxedCommand } from '@/core/command/command-utils';
import {
  containsGlobChars,
  normalizePathForSandbox,
} from '@/core/filesystem/path-utils';
import { dirname } from 'node:path';

export const sessionSuffix = `_${Math.random().toString(36).slice(2, 11)}_VSBX`;

export const escapePath = (pathStr: string): string => JSON.stringify(pathStr);

export const generateLogTag = (command: string): string => {
  const encodedCommand = encodeSandboxedCommand(command);
  return `CMD64_${encodedCommand}_END_${sessionSuffix}`;
};

export const getAncestorDirectories = (pathStr: string): string[] => {
  const ancestors: string[] = [];
  let currentPath = dirname(pathStr);

  while (currentPath !== '/' && currentPath !== '.') {
    ancestors.push(currentPath);
    const parentPath = dirname(currentPath);
    if (parentPath === currentPath) break;
    currentPath = parentPath;
  }

  return ancestors;
};

export const globToRegex = (globPattern: string): string => {
  return (
    '^' +
    globPattern
      .replace(/[.^$+{}()|\\]/g, '\\$&')
      .replace(/\[([^\]]*?)$/g, '\\[$1')
      .replace(/\*\*\//g, '__GLOBSTAR_SLASH__')
      .replace(/\*\*/g, '__GLOBSTAR__')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
      .replace(/__GLOBSTAR_SLASH__/g, '(.*/)?')
      .replace(/__GLOBSTAR__/g, '.*') +
    '$'
  );
};

export const getTmpdirParentIfMacOSPattern = (): string[] => {
  const tmpdir = process.env.TMPDIR;
  if (!tmpdir) return [];

  const match = tmpdir.match(
    /^\/(private\/)?var\/folders\/[^/]{2}\/[^/]+\/T\/?$/
  );
  if (!match) return [];

  const parent = tmpdir.replace(/\/T\/?$/, '');

  if (parent.startsWith('/private/var/')) {
    return [parent, parent.replace('/private', '')];
  }
  if (parent.startsWith('/var/')) {
    return [parent, '/private' + parent];
  }

  return [parent];
};

export const createRuleWithGlobSupport = (
  pathPattern: string,
  ruleType: string,
  action: 'allow' | 'deny',
  logTag: string
): string[] => {
  const normalizedPath = normalizePathForSandbox(pathPattern);
  const rules: string[] = [];

  if (containsGlobChars(normalizedPath)) {
    const regexPattern = globToRegex(normalizedPath);
    rules.push(
      `(${action} ${ruleType}`,
      `  (regex ${escapePath(regexPattern)})`,
      `  (with message "${logTag}"))`
    );
  } else {
    rules.push(
      `(${action} ${ruleType}`,
      `  (subpath ${escapePath(normalizedPath)})`,
      `  (with message "${logTag}"))`
    );
  }

  return rules;
};
