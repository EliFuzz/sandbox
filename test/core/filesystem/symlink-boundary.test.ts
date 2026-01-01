import {
  isSymlinkOutsideBoundary,
  normalizePathForSandbox,
} from '@/core/filesystem/path-utils';
import type { FsWriteRestrictionConfig } from '@/core/sandbox';
import { wrapCommandWithSandboxMacOS } from '@/os/macos/sandbox/macos-sandbox';
import { getPlatform } from '@/utils/platform';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

function skipIfNotMacOS(): boolean {
  return getPlatform() !== 'macos';
}

function cleanupPath(p: string): void {
  try {
    if (existsSync(p) || lstatSync(p).isSymbolicLink()) {
      const stat = lstatSync(p);
      if (stat.isSymbolicLink() || stat.isFile()) {
        unlinkSync(p);
      } else if (stat.isDirectory()) {
        rmSync(p, { recursive: true, force: true });
      }
    }
  } catch {
    /* empty */
  }
}

function cleanupTmpVSBX(): void {
  const paths = ['/tmp/vsbx', '/private/tmp/vsbx'];
  for (const p of paths) {
    cleanupPath(p);
  }
}

describe('macOS Seatbelt Symlink Boundary Validation', () => {
  const TEST_ID = Date.now();
  const TEST_BASE_DIR = `/private/tmp/symlink-boundary-test-${TEST_ID}`;
  const WORKSPACE_DIR = join(TEST_BASE_DIR, 'workspace');
  const OUTSIDE_WORKSPACE_FILE = `/private/tmp/outside-allowed-${TEST_ID}.txt`;
  const TEST_CONTENT = 'TEST_CONTENT';

  beforeEach(() => {
    if (skipIfNotMacOS()) {
      return;
    }

    cleanupTmpVSBX();

    if (existsSync(TEST_BASE_DIR)) {
      rmSync(TEST_BASE_DIR, { recursive: true, force: true });
    }
    mkdirSync(WORKSPACE_DIR, { recursive: true });
  });

  afterEach(() => {
    if (skipIfNotMacOS()) {
      return;
    }

    cleanupTmpVSBX();

    if (existsSync(TEST_BASE_DIR)) {
      rmSync(TEST_BASE_DIR, { recursive: true, force: true });
    }
    if (existsSync(OUTSIDE_WORKSPACE_FILE)) {
      unlinkSync(OUTSIDE_WORKSPACE_FILE);
    }
  });

  describe('Symlink Boundary Enforcement', () => {
    it('should preserve original path when symlink points to root', () => {
      if (skipIfNotMacOS()) {
        return;
      }

      console.log(
        '\n=== Step 1: Initial write attempt (should be blocked) ==='
      );

      const writeConfig: FsWriteRestrictionConfig = {
        allowOnly: [WORKSPACE_DIR, '/tmp/vsbx', '/private/tmp/vsbx'],
        denyWithinAllow: [],
      };

      const initialWriteCommand = wrapCommandWithSandboxMacOS({
        command: `echo "${TEST_CONTENT}" > ${OUTSIDE_WORKSPACE_FILE}`,
        needsNetworkRestriction: false,
        readConfig: undefined,
        writeConfig,
      });

      const initialResult = spawnSync(initialWriteCommand, {
        shell: true,
        encoding: 'utf8',
        timeout: 5000,
      });

      expect(initialResult.status).not.toBe(0);
      expect(existsSync(OUTSIDE_WORKSPACE_FILE)).toBe(false);
      console.log('Initial write correctly blocked');

      console.log('\n=== Step 2: Creating symlink /tmp/vsbx -> / ===');

      const symlinkCommand = wrapCommandWithSandboxMacOS({
        command: 'ln -s / /tmp/vsbx',
        needsNetworkRestriction: false,
        readConfig: undefined,
        writeConfig,
      });

      const symlinkResult = spawnSync(symlinkCommand, {
        shell: true,
        encoding: 'utf8',
        timeout: 5000,
      });

      expect(symlinkResult.status).toBe(0);

      const stat = lstatSync('/tmp/vsbx');
      expect(stat.isSymbolicLink()).toBe(true);
      console.log('Symlink created: /tmp/vsbx -> /');

      console.log(
        '\n=== Step 3: Second write attempt (should still be blocked) ==='
      );

      const secondWriteCommand = wrapCommandWithSandboxMacOS({
        command: `echo "${TEST_CONTENT}" > ${OUTSIDE_WORKSPACE_FILE}`,
        needsNetworkRestriction: false,
        readConfig: undefined,
        writeConfig,
      });

      const secondResult = spawnSync(secondWriteCommand, {
        shell: true,
        encoding: 'utf8',
        timeout: 5000,
      });

      expect(secondResult.status).not.toBe(0);
      expect(existsSync(OUTSIDE_WORKSPACE_FILE)).toBe(false);
      console.log('Write correctly blocked with symlink boundary validation');

      console.log('\n=== Summary ===');
      console.log('Symlink boundary validation working correctly');
    });

    it('should block writes outside workspace when /tmp/vsbx does not exist', () => {
      if (skipIfNotMacOS()) {
        return;
      }

      cleanupTmpVSBX();
      expect(existsSync('/tmp/vsbx')).toBe(false);

      const writeConfig: FsWriteRestrictionConfig = {
        allowOnly: [WORKSPACE_DIR, '/tmp/vsbx', '/private/tmp/vsbx'],
        denyWithinAllow: [],
      };

      const wrappedCommand = wrapCommandWithSandboxMacOS({
        command: `echo "test" > ${OUTSIDE_WORKSPACE_FILE}`,
        needsNetworkRestriction: false,
        readConfig: undefined,
        writeConfig,
      });

      const result = spawnSync(wrappedCommand, {
        shell: true,
        encoding: 'utf8',
        timeout: 5000,
      });

      expect(result.status).not.toBe(0);
      expect(existsSync(OUTSIDE_WORKSPACE_FILE)).toBe(false);
    });

    it('should block writes outside workspace when /tmp/vsbx is a regular directory', () => {
      if (skipIfNotMacOS()) {
        return;
      }

      cleanupTmpVSBX();
      mkdirSync('/tmp/vsbx', { recursive: true });

      const stat = lstatSync('/tmp/vsbx');
      expect(stat.isDirectory()).toBe(true);
      expect(stat.isSymbolicLink()).toBe(false);

      const writeConfig: FsWriteRestrictionConfig = {
        allowOnly: [WORKSPACE_DIR, '/tmp/vsbx', '/private/tmp/vsbx'],
        denyWithinAllow: [],
      };

      const wrappedCommand = wrapCommandWithSandboxMacOS({
        command: `echo "test" > ${OUTSIDE_WORKSPACE_FILE}`,
        needsNetworkRestriction: false,
        readConfig: undefined,
        writeConfig,
      });

      const result = spawnSync(wrappedCommand, {
        shell: true,
        encoding: 'utf8',
        timeout: 5000,
      });

      expect(result.status).not.toBe(0);
      expect(existsSync(OUTSIDE_WORKSPACE_FILE)).toBe(false);
    });

    it('should block writes via symlink traversal path', () => {
      if (skipIfNotMacOS()) {
        return;
      }

      cleanupTmpVSBX();
      spawnSync('ln', ['-s', '/', '/tmp/vsbx'], { encoding: 'utf8' });

      const stat = lstatSync('/tmp/vsbx');
      expect(stat.isSymbolicLink()).toBe(true);

      const traversalPath = '/tmp/vsbx/tmp/traversal-write-' + TEST_ID + '.txt';

      const writeConfig: FsWriteRestrictionConfig = {
        allowOnly: [WORKSPACE_DIR, '/tmp/vsbx', '/private/tmp/vsbx'],
        denyWithinAllow: [],
      };

      const wrappedCommand = wrapCommandWithSandboxMacOS({
        command: `echo "test" > ${traversalPath}`,
        needsNetworkRestriction: false,
        readConfig: undefined,
        writeConfig,
      });

      const result = spawnSync(wrappedCommand, {
        shell: true,
        encoding: 'utf8',
        timeout: 5000,
      });

      const realPath = `/tmp/traversal-write-${TEST_ID}.txt`;

      expect(result.status).not.toBe(0);
      expect(existsSync(realPath)).toBe(false);
      console.log('Symlink traversal write blocked');
    });
  });

  describe('isSymlinkOutsideBoundary Integration', () => {
    it('should reject symlink resolution that broadens scope', () => {
      if (skipIfNotMacOS()) {
        return;
      }

      cleanupTmpVSBX();
      spawnSync('ln', ['-s', '/', '/tmp/vsbx'], { encoding: 'utf8' });

      const writeConfig: FsWriteRestrictionConfig = {
        allowOnly: [WORKSPACE_DIR, '/tmp/vsbx', '/private/tmp/vsbx'],
        denyWithinAllow: [],
      };

      const wrappedCommand = wrapCommandWithSandboxMacOS({
        command: `echo "should fail" > ${OUTSIDE_WORKSPACE_FILE}`,
        needsNetworkRestriction: false,
        readConfig: undefined,
        writeConfig,
      });

      const result = spawnSync(wrappedCommand, {
        shell: true,
        encoding: 'utf8',
        timeout: 5000,
      });

      console.log('\nTesting symlink boundary validation:');
      console.log(`Exit code: ${result.status}`);
      console.log(`File exists: ${existsSync(OUTSIDE_WORKSPACE_FILE)}`);

      expect(result.status).not.toBe(0);
      expect(existsSync(OUTSIDE_WORKSPACE_FILE)).toBe(false);
      console.log('Symlink boundary validation working correctly');
    });
  });
});

describe('isSymlinkOutsideBoundary Unit Tests', () => {
  describe('Outside Boundary Detection', () => {
    it('should detect when symlink points to root', () => {
      expect(isSymlinkOutsideBoundary('/tmp/vsbx', '/')).toBe(true);
      expect(isSymlinkOutsideBoundary('/private/tmp/vsbx', '/')).toBe(true);
      expect(isSymlinkOutsideBoundary('/home/user/data', '/')).toBe(true);
    });

    it('should detect when symlink points to ancestor directory', () => {
      expect(isSymlinkOutsideBoundary('/tmp/vsbx/data', '/tmp')).toBe(true);
      expect(isSymlinkOutsideBoundary('/tmp/vsbx/data', '/tmp/vsbx')).toBe(
        true
      );
      expect(isSymlinkOutsideBoundary('/home/user/project/src', '/home')).toBe(
        true
      );
      expect(
        isSymlinkOutsideBoundary('/home/user/project/src', '/home/user')
      ).toBe(true);
    });

    it('should detect when resolved path is very short', () => {
      expect(isSymlinkOutsideBoundary('/tmp/vsbx', '/tmp')).toBe(true);
      expect(isSymlinkOutsideBoundary('/var/data', '/var')).toBe(true);
      expect(isSymlinkOutsideBoundary('/usr/local/bin', '/usr')).toBe(true);
    });

    it('should detect when symlink points to unrelated directory', () => {
      expect(isSymlinkOutsideBoundary('/tmp/vsbx', '/Users/dworken')).toBe(
        true
      );
      expect(isSymlinkOutsideBoundary('/tmp/vsbx', '/home/user')).toBe(true);
      expect(isSymlinkOutsideBoundary('/tmp/vsbx', '/etc')).toBe(true);
      expect(isSymlinkOutsideBoundary('/tmp/vsbx', '/opt/data')).toBe(true);
      expect(isSymlinkOutsideBoundary('/var/data', '/Users/someone/data')).toBe(
        true
      );
    });
  });

  describe('Valid Resolutions', () => {
    it('should allow resolution to same path', () => {
      expect(isSymlinkOutsideBoundary('/tmp/vsbx', '/tmp/vsbx')).toBe(false);
      expect(isSymlinkOutsideBoundary('/home/user', '/home/user')).toBe(false);
    });

    it('should allow macOS /tmp -> /private/tmp canonical resolution', () => {
      expect(isSymlinkOutsideBoundary('/tmp/vsbx', '/private/tmp/vsbx')).toBe(
        false
      );
      expect(
        isSymlinkOutsideBoundary('/tmp/vsbx/data', '/private/tmp/vsbx/data')
      ).toBe(false);
    });

    it('should allow macOS /var -> /private/var canonical resolution', () => {
      expect(
        isSymlinkOutsideBoundary(
          '/var/folders/xx/yy',
          '/private/var/folders/xx/yy'
        )
      ).toBe(false);
    });

    it('should allow resolution to deeper path (more specific)', () => {
      expect(isSymlinkOutsideBoundary('/tmp/vsbx', '/tmp/vsbx/actual')).toBe(
        false
      );
      expect(isSymlinkOutsideBoundary('/home/user', '/home/user/real')).toBe(
        false
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle paths with trailing slashes', () => {
      expect(isSymlinkOutsideBoundary('/tmp/vsbx/', '/')).toBe(true);
    });

    it('should handle private paths resolving to themselves', () => {
      expect(
        isSymlinkOutsideBoundary('/private/tmp/vsbx', '/private/tmp/vsbx')
      ).toBe(false);
      expect(
        isSymlinkOutsideBoundary('/private/var/data', '/private/var/data')
      ).toBe(false);
    });
  });
});

describe('Glob Pattern Symlink Boundary', () => {
  it('should preserve original glob pattern when base directory symlink points to root', () => {
    if (getPlatform() !== 'macos') {
      return;
    }

    cleanupTmpVSBX();
    spawnSync('ln', ['-s', '/', '/tmp/vsbx'], { encoding: 'utf8' });

    const result = normalizePathForSandbox('/tmp/vsbx/**');

    expect(result).toBe('/tmp/vsbx/**');
    expect(result).not.toBe('/**');

    cleanupTmpVSBX();
  });

  it('should preserve original glob pattern when base directory symlink points to parent', () => {
    if (getPlatform() !== 'macos') {
      return;
    }

    cleanupTmpVSBX();
    spawnSync('ln', ['-s', '/tmp', '/tmp/vsbx'], { encoding: 'utf8' });

    const result = normalizePathForSandbox('/tmp/vsbx/**');

    expect(result).toBe('/tmp/vsbx/**');
    expect(result).not.toBe('/tmp/**');

    cleanupTmpVSBX();
  });
});
