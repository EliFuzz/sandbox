import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, normalize, resolve } from 'node:path';

export const containsGlobChars = (pathPattern: string): boolean =>
  /[*?[\]]/.test(pathPattern);

export const removeTrailingGlobSuffix = (pathPattern: string): string =>
  pathPattern.replace(/\/\*\*$/, '');

const normalizePrivatePath = (p: string): string => {
  if (p.startsWith('/tmp/') || p.startsWith('/var/')) {
    return '/private' + p;
  }
  return p;
};

export const isSymlinkOutsideBoundary = (
  originalPath: string,
  resolvedPath: string
): boolean => {
  const normalizedOriginal = normalize(originalPath);
  const normalizedResolved = normalize(resolvedPath);

  if (normalizedResolved === normalizedOriginal) return false;

  const canonicalOriginal = normalizePrivatePath(normalizedOriginal);
  if (normalizedResolved === canonicalOriginal) return false;

  if (normalizedResolved === '/') return true;

  const resolvedParts = normalizedResolved.split('/').filter(Boolean);
  if (resolvedParts.length <= 1) return true;

  const startsWithOriginal = normalizedResolved.startsWith(
    normalizedOriginal + '/'
  );
  const startsWithCanonical = normalizedResolved.startsWith(
    canonicalOriginal + '/'
  );

  if (!startsWithOriginal && !startsWithCanonical) return true;

  if (
    normalizedOriginal.startsWith(normalizedResolved + '/') ||
    canonicalOriginal.startsWith(normalizedResolved + '/')
  )
    return true;

  return false;
};

const getNormalizedPath = (pathPattern: string): string => {
  if (pathPattern === '~') return homedir();
  if (pathPattern.startsWith('~/')) return homedir() + pathPattern.slice(1);
  if (!isAbsolute(pathPattern)) return resolve(process.cwd(), pathPattern);
  return pathPattern;
};

const handleGlobPath = (normalizedPath: string): string => {
  const staticPrefix = normalizedPath.split(/[*?[\]]/)[0];
  if (!staticPrefix || staticPrefix === '/') return normalizedPath;
  const baseDir = staticPrefix.endsWith('/')
    ? staticPrefix.slice(0, -1)
    : dirname(staticPrefix);
  try {
    const resolvedBaseDir = realpathSync(baseDir);
    if (!isSymlinkOutsideBoundary(baseDir, resolvedBaseDir)) {
      return resolvedBaseDir + normalizedPath.slice(baseDir.length);
    }
  } catch {
    // empty
  }
  return normalizedPath;
};

const handleNonGlobPath = (normalizedPath: string): string => {
  try {
    const resolvedPath = realpathSync(normalizedPath);
    if (!isSymlinkOutsideBoundary(normalizedPath, resolvedPath)) {
      return resolvedPath;
    }
  } catch {
    // empty
  }
  return normalizedPath;
};

export const normalizePathForSandbox = (pathPattern: string): string => {
  const normalizedPath = getNormalizedPath(pathPattern);
  if (containsGlobChars(normalizedPath)) {
    return handleGlobPath(normalizedPath);
  }
  return handleNonGlobPath(normalizedPath);
};
