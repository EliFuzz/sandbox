import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  FsReadRestrictionConfig,
  FsWriteRestrictionConfig,
} from '@/core/sandbox';
import { wrapCommandWithSandboxMacOS } from '@/os/macos/sandbox/macos-sandbox';
import { getPlatform } from '@/utils/platform';

function skipIfNotMacOS(): boolean {
  return getPlatform() !== 'macos';
}

describe('macOS Seatbelt Read Bypass Prevention', () => {
  const TEST_BASE_DIR = join(tmpdir(), 'seatbelt-test-' + Date.now());
  const TEST_DENIED_DIR = join(TEST_BASE_DIR, 'denied-dir');
  const TEST_SECRET_FILE = join(TEST_DENIED_DIR, 'secret.txt');
  const TEST_SECRET_CONTENT = 'SECRET_CREDENTIAL_DATA';
  const TEST_MOVED_FILE = join(TEST_BASE_DIR, 'moved-secret.txt');
  const TEST_MOVED_DIR = join(TEST_BASE_DIR, 'moved-denied-dir');

  const TEST_GLOB_DIR = join(TEST_BASE_DIR, 'glob-test');
  const TEST_GLOB_FILE1 = join(TEST_GLOB_DIR, 'secret1.txt');
  const TEST_GLOB_FILE2 = join(TEST_GLOB_DIR, 'secret2.log');
  const TEST_GLOB_MOVED = join(TEST_BASE_DIR, 'moved-glob.txt');

  beforeAll(() => {
    if (skipIfNotMacOS()) {
      return;
    }

    mkdirSync(TEST_DENIED_DIR, { recursive: true });
    writeFileSync(TEST_SECRET_FILE, TEST_SECRET_CONTENT);

    mkdirSync(TEST_GLOB_DIR, { recursive: true });
    writeFileSync(TEST_GLOB_FILE1, 'GLOB_SECRET_1');
    writeFileSync(TEST_GLOB_FILE2, 'GLOB_SECRET_2');
  });

  afterAll(() => {
    if (skipIfNotMacOS()) {
      return;
    }

    if (existsSync(TEST_BASE_DIR)) {
      rmSync(TEST_BASE_DIR, { recursive: true, force: true });
    }
  });

  describe('Literal Path - Direct File Move Prevention', () => {
    it('should block moving a read-denied file to a readable location', () => {
      if (skipIfNotMacOS()) {
        return;
      }

      const readConfig: FsReadRestrictionConfig = {
        denyOnly: [TEST_DENIED_DIR],
      };

      const wrappedCommand = wrapCommandWithSandboxMacOS({
        command: `mv ${TEST_SECRET_FILE} ${TEST_MOVED_FILE}`,
        needsNetworkRestriction: false,
        readConfig,
        writeConfig: undefined,
      });

      expect(existsSync(TEST_SECRET_FILE)).toBe(true);

      const result = spawnSync(wrappedCommand, {
        shell: true,
        encoding: 'utf8',
        timeout: 5000,
      });

      expect(result.status).not.toBe(0);
      const output = (result.stderr || '').toLowerCase();
      expect(output).toContain('operation not permitted');

      expect(existsSync(TEST_SECRET_FILE)).toBe(true);
      expect(existsSync(TEST_MOVED_FILE)).toBe(false);
    });

    it('should still block reading the file (sanity check)', () => {
      if (skipIfNotMacOS()) {
        return;
      }

      const readConfig: FsReadRestrictionConfig = {
        denyOnly: [TEST_DENIED_DIR],
      };

      const wrappedCommand = wrapCommandWithSandboxMacOS({
        command: `cat ${TEST_SECRET_FILE}`,
        needsNetworkRestriction: false,
        readConfig,
        writeConfig: undefined,
      });

      const result = spawnSync(wrappedCommand, {
        shell: true,
        encoding: 'utf8',
        timeout: 5000,
      });

      expect(result.status).not.toBe(0);
      const output = (result.stderr || '').toLowerCase();
      expect(output).toContain('operation not permitted');

      expect(result.stdout).not.toContain(TEST_SECRET_CONTENT);
    });
  });

  describe('Literal Path - Ancestor Directory Move Prevention', () => {
    it('should block moving an ancestor directory of a read-denied file', () => {
      if (skipIfNotMacOS()) {
        return;
      }

      const readConfig: FsReadRestrictionConfig = {
        denyOnly: [TEST_DENIED_DIR],
      };

      const wrappedCommand = wrapCommandWithSandboxMacOS({
        command: `mv ${TEST_DENIED_DIR} ${TEST_MOVED_DIR}`,
        needsNetworkRestriction: false,
        readConfig,
        writeConfig: undefined,
      });

      expect(existsSync(TEST_DENIED_DIR)).toBe(true);

      const result = spawnSync(wrappedCommand, {
        shell: true,
        encoding: 'utf8',
        timeout: 5000,
      });

      expect(result.status).not.toBe(0);
      const output = (result.stderr || '').toLowerCase();
      expect(output).toContain('operation not permitted');

      expect(existsSync(TEST_DENIED_DIR)).toBe(true);
      expect(existsSync(TEST_MOVED_DIR)).toBe(false);
    });

    it('should block moving the grandparent directory', () => {
      if (skipIfNotMacOS()) {
        return;
      }

      const readConfig: FsReadRestrictionConfig = {
        denyOnly: [TEST_SECRET_FILE],
      };

      const movedBaseDir = join(tmpdir(), 'moved-base-' + Date.now());

      const wrappedCommand = wrapCommandWithSandboxMacOS({
        command: `mv ${TEST_BASE_DIR} ${movedBaseDir}`,
        needsNetworkRestriction: false,
        readConfig,
        writeConfig: undefined,
      });

      const result = spawnSync(wrappedCommand, {
        shell: true,
        encoding: 'utf8',
        timeout: 5000,
      });

      expect(result.status).not.toBe(0);
      const output = (result.stderr || '').toLowerCase();
      expect(output).toContain('operation not permitted');

      expect(existsSync(TEST_BASE_DIR)).toBe(true);
      expect(existsSync(movedBaseDir)).toBe(false);
    });
  });

  describe('Glob Pattern - File Move Prevention', () => {
    it('should block moving files matching a glob pattern (*.txt)', () => {
      if (skipIfNotMacOS()) {
        return;
      }

      const globPattern = join(TEST_GLOB_DIR, '*.txt');

      const readConfig: FsReadRestrictionConfig = {
        denyOnly: [globPattern],
      };

      const wrappedCommand = wrapCommandWithSandboxMacOS({
        command: `mv ${TEST_GLOB_FILE1} ${TEST_GLOB_MOVED}`,
        needsNetworkRestriction: false,
        readConfig,
        writeConfig: undefined,
      });

      expect(existsSync(TEST_GLOB_FILE1)).toBe(true);

      const result = spawnSync(wrappedCommand, {
        shell: true,
        encoding: 'utf8',
        timeout: 5000,
      });

      expect(result.status).not.toBe(0);
      const output = (result.stderr || '').toLowerCase();
      expect(output).toContain('operation not permitted');

      expect(existsSync(TEST_GLOB_FILE1)).toBe(true);
      expect(existsSync(TEST_GLOB_MOVED)).toBe(false);
    });

    it('should still block reading files matching the glob pattern', () => {
      if (skipIfNotMacOS()) {
        return;
      }

      const globPattern = join(TEST_GLOB_DIR, '*.txt');

      const readConfig: FsReadRestrictionConfig = {
        denyOnly: [globPattern],
      };

      const wrappedCommand = wrapCommandWithSandboxMacOS({
        command: `cat ${TEST_GLOB_FILE1}`,
        needsNetworkRestriction: false,
        readConfig,
        writeConfig: undefined,
      });

      const result = spawnSync(wrappedCommand, {
        shell: true,
        encoding: 'utf8',
        timeout: 5000,
      });

      expect(result.status).not.toBe(0);
      const output = (result.stderr || '').toLowerCase();
      expect(output).toContain('operation not permitted');

      expect(result.stdout).not.toContain('GLOB_SECRET_1');
    });

    it('should block moving the parent directory containing glob-matched files', () => {
      if (skipIfNotMacOS()) {
        return;
      }

      const globPattern = join(TEST_GLOB_DIR, '*.txt');

      const readConfig: FsReadRestrictionConfig = {
        denyOnly: [globPattern],
      };

      const movedGlobDir = join(TEST_BASE_DIR, 'moved-glob-dir');

      const wrappedCommand = wrapCommandWithSandboxMacOS({
        command: `mv ${TEST_GLOB_DIR} ${movedGlobDir}`,
        needsNetworkRestriction: false,
        readConfig,
        writeConfig: undefined,
      });

      const result = spawnSync(wrappedCommand, {
        shell: true,
        encoding: 'utf8',
        timeout: 5000,
      });

      expect(result.status).not.toBe(0);
      const output = (result.stderr || '').toLowerCase();
      expect(output).toContain('operation not permitted');

      expect(existsSync(TEST_GLOB_DIR)).toBe(true);
      expect(existsSync(movedGlobDir)).toBe(false);
    });
  });

  describe('Glob Pattern - Recursive Patterns', () => {
    it('should block moving files matching a recursive glob pattern (**/*.txt)', () => {
      if (skipIfNotMacOS()) {
        return;
      }

      const nestedDir = join(TEST_GLOB_DIR, 'nested');
      const nestedFile = join(nestedDir, 'nested-secret.txt');
      mkdirSync(nestedDir, { recursive: true });
      writeFileSync(nestedFile, 'NESTED_SECRET');

      const globPattern = join(TEST_GLOB_DIR, '**/*.txt');

      const readConfig: FsReadRestrictionConfig = {
        denyOnly: [globPattern],
      };

      const movedNested = join(TEST_BASE_DIR, 'moved-nested.txt');

      const wrappedCommand = wrapCommandWithSandboxMacOS({
        command: `mv ${nestedFile} ${movedNested}`,
        needsNetworkRestriction: false,
        readConfig,
        writeConfig: undefined,
      });

      const result = spawnSync(wrappedCommand, {
        shell: true,
        encoding: 'utf8',
        timeout: 5000,
      });

      expect(result.status).not.toBe(0);
      const output = (result.stderr || '').toLowerCase();
      expect(output).toContain('operation not permitted');

      expect(existsSync(nestedFile)).toBe(true);
      expect(existsSync(movedNested)).toBe(false);
    });
  });
});

describe('macOS Seatbelt Write Bypass Prevention', () => {
  const TEST_BASE_DIR = join(tmpdir(), 'seatbelt-write-test-' + Date.now());
  const TEST_ALLOWED_DIR = join(TEST_BASE_DIR, 'allowed');
  const TEST_DENIED_DIR = join(TEST_ALLOWED_DIR, 'secrets');
  const TEST_DENIED_FILE = join(TEST_DENIED_DIR, 'secret.txt');
  const TEST_ORIGINAL_CONTENT = 'ORIGINAL_CONTENT';
  const TEST_MODIFIED_CONTENT = 'MODIFIED_CONTENT';

  const TEST_RENAMED_DIR = join(TEST_BASE_DIR, 'renamed-secrets');

  const TEST_GLOB_DIR = join(TEST_ALLOWED_DIR, 'glob-test');
  const TEST_GLOB_SECRET1 = join(TEST_GLOB_DIR, 'secret1.txt');
  const TEST_GLOB_SECRET2 = join(TEST_GLOB_DIR, 'secret2.log');
  const TEST_GLOB_RENAMED = join(TEST_BASE_DIR, 'renamed-glob');

  beforeAll(() => {
    if (skipIfNotMacOS()) {
      return;
    }

    mkdirSync(TEST_DENIED_DIR, { recursive: true });
    mkdirSync(TEST_GLOB_DIR, { recursive: true });

    writeFileSync(TEST_DENIED_FILE, TEST_ORIGINAL_CONTENT);
    writeFileSync(TEST_GLOB_SECRET1, TEST_ORIGINAL_CONTENT);
    writeFileSync(TEST_GLOB_SECRET2, TEST_ORIGINAL_CONTENT);
  });

  afterAll(() => {
    if (skipIfNotMacOS()) {
      return;
    }

    if (existsSync(TEST_BASE_DIR)) {
      rmSync(TEST_BASE_DIR, { recursive: true, force: true });
    }
  });

  describe('Literal Path - Direct Directory Move Prevention', () => {
    it('should block write bypass via directory rename (mv a c, write c/b, mv c a)', () => {
      if (skipIfNotMacOS()) {
        return;
      }

      const writeConfig: FsWriteRestrictionConfig = {
        allowOnly: [TEST_ALLOWED_DIR],
        denyWithinAllow: [TEST_DENIED_DIR],
      };

      const mvCommand1 = wrapCommandWithSandboxMacOS({
        command: `mv ${TEST_DENIED_DIR} ${TEST_RENAMED_DIR}`,
        needsNetworkRestriction: false,
        readConfig: undefined,
        writeConfig,
      });

      const result1 = spawnSync(mvCommand1, {
        shell: true,
        encoding: 'utf8',
        timeout: 5000,
      });

      expect(result1.status).not.toBe(0);
      const output1 = (result1.stderr || '').toLowerCase();
      expect(output1).toContain('operation not permitted');

      expect(existsSync(TEST_DENIED_DIR)).toBe(true);
      expect(existsSync(TEST_RENAMED_DIR)).toBe(false);
    });

    it('should still block direct writes to denied paths (sanity check)', () => {
      if (skipIfNotMacOS()) {
        return;
      }

      const writeConfig: FsWriteRestrictionConfig = {
        allowOnly: [TEST_ALLOWED_DIR],
        denyWithinAllow: [TEST_DENIED_DIR],
      };

      const wrappedCommand = wrapCommandWithSandboxMacOS({
        command: `echo "${TEST_MODIFIED_CONTENT}" > ${TEST_DENIED_FILE}`,
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
      const output = (result.stderr || '').toLowerCase();
      expect(output).toContain('operation not permitted');

      const content = readFileSync(TEST_DENIED_FILE, 'utf8');
      expect(content).toBe(TEST_ORIGINAL_CONTENT);
    });
  });

  describe('Literal Path - Ancestor Directory Move Prevention', () => {
    it('should block moving an ancestor directory of a write-denied path', () => {
      if (skipIfNotMacOS()) {
        return;
      }

      const writeConfig: FsWriteRestrictionConfig = {
        allowOnly: [TEST_ALLOWED_DIR],
        denyWithinAllow: [TEST_DENIED_FILE],
      };

      const movedAllowedDir = join(TEST_BASE_DIR, 'moved-allowed');

      const wrappedCommand = wrapCommandWithSandboxMacOS({
        command: `mv ${TEST_ALLOWED_DIR} ${movedAllowedDir}`,
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
      const output = (result.stderr || '').toLowerCase();
      expect(output).toContain('operation not permitted');

      expect(existsSync(TEST_ALLOWED_DIR)).toBe(true);
      expect(existsSync(movedAllowedDir)).toBe(false);
    });

    it('should block moving the grandparent directory', () => {
      if (skipIfNotMacOS()) {
        return;
      }

      const writeConfig: FsWriteRestrictionConfig = {
        allowOnly: [TEST_ALLOWED_DIR],
        denyWithinAllow: [TEST_DENIED_FILE],
      };

      const movedBaseDir = join(tmpdir(), 'moved-write-base-' + Date.now());

      const wrappedCommand = wrapCommandWithSandboxMacOS({
        command: `mv ${TEST_BASE_DIR} ${movedBaseDir}`,
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
      const output = (result.stderr || '').toLowerCase();
      expect(output).toContain('operation not permitted');

      expect(existsSync(TEST_BASE_DIR)).toBe(true);
      expect(existsSync(movedBaseDir)).toBe(false);
    });
  });

  describe('Glob Pattern - File Move Prevention', () => {
    it('should block write bypass via moving glob-matched files', () => {
      if (skipIfNotMacOS()) {
        return;
      }

      const globPattern = join(TEST_GLOB_DIR, '*.txt');

      const writeConfig: FsWriteRestrictionConfig = {
        allowOnly: [TEST_ALLOWED_DIR],
        denyWithinAllow: [globPattern],
      };

      const mvCommand = wrapCommandWithSandboxMacOS({
        command: `mv ${TEST_GLOB_SECRET1} ${join(TEST_BASE_DIR, 'moved-secret.txt')}`,
        needsNetworkRestriction: false,
        readConfig: undefined,
        writeConfig,
      });

      const result = spawnSync(mvCommand, {
        shell: true,
        encoding: 'utf8',
        timeout: 5000,
      });

      expect(result.status).not.toBe(0);
      const output = (result.stderr || '').toLowerCase();
      expect(output).toContain('operation not permitted');

      expect(existsSync(TEST_GLOB_SECRET1)).toBe(true);
    });

    it('should still block direct writes to glob-matched files', () => {
      if (skipIfNotMacOS()) {
        return;
      }

      const globPattern = join(TEST_GLOB_DIR, '*.txt');

      const writeConfig: FsWriteRestrictionConfig = {
        allowOnly: [TEST_ALLOWED_DIR],
        denyWithinAllow: [globPattern],
      };

      const wrappedCommand = wrapCommandWithSandboxMacOS({
        command: `echo "${TEST_MODIFIED_CONTENT}" > ${TEST_GLOB_SECRET1}`,
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
      const output = (result.stderr || '').toLowerCase();
      expect(output).toContain('operation not permitted');

      const content = readFileSync(TEST_GLOB_SECRET1, 'utf8');
      expect(content).toBe(TEST_ORIGINAL_CONTENT);
    });

    it('should block moving the parent directory containing glob-matched files', () => {
      if (skipIfNotMacOS()) {
        return;
      }

      const globPattern = join(TEST_GLOB_DIR, '*.txt');

      const writeConfig: FsWriteRestrictionConfig = {
        allowOnly: [TEST_ALLOWED_DIR],
        denyWithinAllow: [globPattern],
      };

      const wrappedCommand = wrapCommandWithSandboxMacOS({
        command: `mv ${TEST_GLOB_DIR} ${TEST_GLOB_RENAMED}`,
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
      const output = (result.stderr || '').toLowerCase();
      expect(output).toContain('operation not permitted');

      expect(existsSync(TEST_GLOB_DIR)).toBe(true);
      expect(existsSync(TEST_GLOB_RENAMED)).toBe(false);
    });
  });

  describe('Glob Pattern - Recursive Patterns', () => {
    it('should block moving files matching a recursive glob pattern (**/*.txt)', () => {
      if (skipIfNotMacOS()) {
        return;
      }

      const nestedDir = join(TEST_GLOB_DIR, 'nested');
      const nestedFile = join(nestedDir, 'nested-secret.txt');
      mkdirSync(nestedDir, { recursive: true });
      writeFileSync(nestedFile, TEST_ORIGINAL_CONTENT);

      const globPattern = join(TEST_GLOB_DIR, '**/*.txt');

      const writeConfig: FsWriteRestrictionConfig = {
        allowOnly: [TEST_ALLOWED_DIR],
        denyWithinAllow: [globPattern],
      };

      const movedNested = join(TEST_BASE_DIR, 'moved-nested.txt');

      const wrappedCommand = wrapCommandWithSandboxMacOS({
        command: `mv ${nestedFile} ${movedNested}`,
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
      const output = (result.stderr || '').toLowerCase();
      expect(output).toContain('operation not permitted');

      expect(existsSync(nestedFile)).toBe(true);
      expect(existsSync(movedNested)).toBe(false);
    });
  });
});

describe('macOS Seatbelt Process Enumeration', () => {
  it('should allow enumerating all process IDs (kern.proc.all sysctl)', () => {
    if (skipIfNotMacOS()) {
      return;
    }

    const wrappedCommand = wrapCommandWithSandboxMacOS({
      command: 'ps -axo pid=',
      needsNetworkRestriction: false,
      readConfig: undefined,
      writeConfig: undefined,
    });

    const result = spawnSync(wrappedCommand, {
      shell: true,
      encoding: 'utf8',
      timeout: 5000,
    });

    expect(result.status).toBe(0);

    const pids = result.stdout
      .trim()
      .split('\n')
      .filter((line) => line.trim());
    expect(pids.length).toBeGreaterThan(0);

    for (const pid of pids) {
      expect(parseInt(pid.trim(), 10)).toBeGreaterThan(0);
    }
  });
});
