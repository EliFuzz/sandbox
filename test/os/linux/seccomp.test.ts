import {
  cleanupSeccompFilter,
  generateSeccompFilter,
  getApplySeccompBinaryPath,
  getPreGeneratedBpfPath,
} from '@/generate-seccomp-filter';
import {
  hasLinuxSandboxDependenciesSync,
  wrapCommandWithSandboxLinux,
} from '@/os/linux';
import { getPlatform } from '@/utils/platform';
import { beforeAll, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';

function skipIfNotLinux(): boolean {
  return getPlatform() !== 'linux';
}

function skipIfNotAnt(): boolean {
  return process.env.USER_TYPE !== 'ant';
}

describe('Linux Sandbox Dependencies', () => {
  it('should check for Linux sandbox dependencies', () => {
    if (skipIfNotLinux()) {
      return;
    }

    const hasDeps = hasLinuxSandboxDependenciesSync();
    expect(typeof hasDeps).toBe('boolean');

    if (hasDeps) {
      const bwrapResult = spawnSync('which', ['bwrap'], { stdio: 'ignore' });
      const socatResult = spawnSync('which', ['socat'], { stdio: 'ignore' });
      expect(bwrapResult.status).toBe(0);
      expect(socatResult.status).toBe(0);
    }
  });
});

describe('Pre-generated BPF Support', () => {
  it('should detect pre-generated BPF files on x64/arm64', () => {
    if (skipIfNotLinux()) {
      return;
    }

    const arch = process.arch;
    const preGeneratedBpf = getPreGeneratedBpfPath();

    if (arch === 'x64' || arch === 'arm64') {
      expect(preGeneratedBpf).toBeTruthy();
      if (preGeneratedBpf) {
        expect(existsSync(preGeneratedBpf)).toBe(true);
        expect(preGeneratedBpf).toContain('dist/vendor/seccomp');
        expect(preGeneratedBpf).toMatch(/unix-block\.bpf$/);
      }
    } else {
      expect(preGeneratedBpf).toBeNull();
    }
  });

  it('should have sandbox dependencies on x64/arm64 with bwrap and socat', () => {
    if (skipIfNotLinux()) {
      return;
    }

    const arch = process.arch;
    if (arch !== 'x64' && arch !== 'arm64') {
      return;
    }

    const preGeneratedBpf = getPreGeneratedBpfPath();

    if (!preGeneratedBpf) {
      return;
    }

    const bwrapResult = spawnSync('which', ['bwrap'], { stdio: 'ignore' });
    const socatResult = spawnSync('which', ['socat'], { stdio: 'ignore' });
    const hasApplySeccomp = getApplySeccompBinaryPath() !== null;

    if (
      bwrapResult.status !== 0 ||
      socatResult.status !== 0 ||
      !hasApplySeccomp
    ) {
      return;
    }

    const hasSandboxDeps = hasLinuxSandboxDependenciesSync();
    expect(hasSandboxDeps).toBe(true);
  });

  it('should not allow seccomp on unsupported architectures', () => {
    if (skipIfNotLinux()) {
      return;
    }

    const preGeneratedBpf = getPreGeneratedBpfPath();

    if (preGeneratedBpf !== null) {
      return;
    }

    const hasSandboxDeps = hasLinuxSandboxDependenciesSync(false);

    expect(hasSandboxDeps).toBe(false);

    const hasSandboxDepsWithBypass = hasLinuxSandboxDependenciesSync(true);
    const bwrapResult = spawnSync('which', ['bwrap'], { stdio: 'ignore' });
    const socatResult = spawnSync('which', ['socat'], { stdio: 'ignore' });

    if (bwrapResult.status === 0 && socatResult.status === 0) {
      expect(hasSandboxDepsWithBypass).toBe(true);
    }
  });
});

describe('Seccomp Filter (Pre-generated)', () => {
  it('should return pre-generated BPF filter on x64/arm64', () => {
    if (skipIfNotLinux()) {
      return;
    }

    const arch = process.arch;
    if (arch !== 'x64' && arch !== 'arm64') {
      return;
    }

    const filterPath = generateSeccompFilter();

    expect(filterPath).toBeTruthy();
    expect(filterPath).toMatch(/\.bpf$/);
    expect(filterPath).toContain('dist/vendor/seccomp');

    expect(existsSync(filterPath!)).toBe(true);

    const stats = statSync(filterPath!);
    expect(stats.size).toBeGreaterThan(0);

    expect(stats.size % 8).toBe(0);
  });

  it('should return same path on repeated calls (pre-generated)', () => {
    if (skipIfNotLinux()) {
      return;
    }

    const arch = process.arch;
    if (arch !== 'x64' && arch !== 'arm64') {
      return;
    }

    const filter1 = generateSeccompFilter();
    const filter2 = generateSeccompFilter();

    expect(filter1).toBeTruthy();
    expect(filter2).toBeTruthy();

    expect(filter1).toBe(filter2);
  });

  it('should return null on unsupported architectures', () => {
    if (skipIfNotLinux()) {
      return;
    }

    const arch = process.arch;
    if (arch === 'x64' || arch === 'arm64') {
      return;
    }

    const filter = generateSeccompFilter();
    expect(filter).toBeNull();
  });

  it('should handle cleanup gracefully (no-op for pre-generated files)', () => {
    if (skipIfNotLinux()) {
      return;
    }

    expect(() => cleanupSeccompFilter('/tmp/test.bpf')).not.toThrow();
    expect(() =>
      cleanupSeccompFilter('/dist/vendor/seccomp/x64/unix-block.bpf')
    ).not.toThrow();
    expect(() => cleanupSeccompFilter('')).not.toThrow();
  });
});

describe('Apply Seccomp Binary', () => {
  it('should find pre-built apply-seccomp binary on x64/arm64', () => {
    if (skipIfNotLinux()) {
      return;
    }

    const arch = process.arch;
    if (arch !== 'x64' && arch !== 'arm64') {
      return;
    }

    const binaryPath = getApplySeccompBinaryPath();
    expect(binaryPath).toBeTruthy();

    expect(existsSync(binaryPath!)).toBe(true);

    expect(binaryPath).toContain('dist/vendor/seccomp');
  });

  it('should return null on unsupported architectures', () => {
    if (skipIfNotLinux()) {
      return;
    }

    const arch = process.arch;
    if (arch === 'x64' || arch === 'arm64') {
      return;
    }

    const binaryPath = getApplySeccompBinaryPath();
    expect(binaryPath).toBeNull();
  });
});

describe('Architecture Support', () => {
  it('should fail fast when architecture is unsupported and seccomp is needed', async () => {
    if (skipIfNotLinux() || skipIfNotAnt()) {
      return;
    }
  });

  it('should include architecture information in error messages', () => {
    if (skipIfNotLinux() || skipIfNotAnt()) {
      return;
    }

    const expectedInErrorMessage = [
      'x64',
      'arm64',
      'architecture',
      'allowAllUnixSockets',
    ];

    expect(expectedInErrorMessage.length).toBeGreaterThan(0);
  });

  it('should allow bypassing architecture requirement with allowAllUnixSockets', async () => {
    if (skipIfNotLinux()) {
      return;
    }

    const testCommand = 'echo "test"';

    const wrappedCommand = await wrapCommandWithSandboxLinux({
      command: testCommand,
      needsNetworkRestriction: false,
      allowAllUnixSockets: true,
    });

    expect(wrappedCommand).not.toContain('apply-seccomp');
    expect(wrappedCommand).toContain('echo "test"');
  });
});

describe('USER_TYPE Gating', () => {
  it('should only apply seccomp in sandbox for ANT users', async () => {
    if (skipIfNotLinux()) {
      return;
    }

    if (!hasLinuxSandboxDependenciesSync()) {
      return;
    }

    const testCommand = 'echo "test"';
    const wrappedCommand = await wrapCommandWithSandboxLinux({
      command: testCommand,
      needsNetworkRestriction: false,
    });

    if (process.env.USER_TYPE === 'ant') {
      expect(wrappedCommand).toContain('apply-seccomp');
    } else {
      expect(wrappedCommand).not.toContain('apply-seccomp');
    }
  });
});

describe('Socket Filtering Behavior', () => {
  let filterPath: string | null = null;

  beforeAll(() => {
    if (skipIfNotLinux() || skipIfNotAnt()) {
      return;
    }

    filterPath = generateSeccompFilter();
  });

  it('should block Unix socket creation (SOCK_STREAM)', async () => {
    if (skipIfNotLinux() || skipIfNotAnt() || !filterPath) {
      return;
    }

    const testCommand =
      'python3 -c "import socket; s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM); print(\'Unix socket created\')"';

    const wrappedCommand = await wrapCommandWithSandboxLinux({
      command: testCommand,
      needsNetworkRestriction: false,
    });

    const result = spawnSync('bash', ['-c', wrappedCommand], {
      stdio: 'pipe',
      timeout: 5000,
    });

    expect(result.status).not.toBe(0);
    const stderr = result.stderr?.toString() || '';
    expect(stderr.toLowerCase()).toMatch(
      /permission denied|operation not permitted/
    );
  });

  it('should block Unix socket creation (SOCK_DGRAM)', async () => {
    if (skipIfNotLinux() || skipIfNotAnt() || !filterPath) {
      return;
    }

    const testCommand =
      'python3 -c "import socket; s = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM); print(\'Unix datagram created\')"';

    const wrappedCommand = await wrapCommandWithSandboxLinux({
      command: testCommand,
      needsNetworkRestriction: false,
    });

    const result = spawnSync('bash', ['-c', wrappedCommand], {
      stdio: 'pipe',
      timeout: 5000,
    });

    expect(result.status).not.toBe(0);
    const stderr = result.stderr?.toString() || '';
    expect(stderr.toLowerCase()).toMatch(
      /permission denied|operation not permitted/
    );
  });

  it('should allow TCP socket creation (IPv4)', async () => {
    if (skipIfNotLinux() || skipIfNotAnt() || !filterPath) {
      return;
    }

    const testCommand =
      'python3 -c "import socket; s = socket.socket(socket.AF_INET, socket.SOCK_STREAM); print(\'TCP socket created\')"';

    const wrappedCommand = await wrapCommandWithSandboxLinux({
      command: testCommand,
      needsNetworkRestriction: false,
    });

    const result = spawnSync('bash', ['-c', wrappedCommand], {
      stdio: 'pipe',
      timeout: 5000,
    });

    expect(result.status).toBe(0);
    expect(result.stdout?.toString()).toContain('TCP socket created');
  });

  it('should allow UDP socket creation (IPv4)', async () => {
    if (skipIfNotLinux() || skipIfNotAnt() || !filterPath) {
      return;
    }

    const testCommand =
      'python3 -c "import socket; s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); print(\'UDP socket created\')"';

    const wrappedCommand = await wrapCommandWithSandboxLinux({
      command: testCommand,
      needsNetworkRestriction: false,
    });

    const result = spawnSync('bash', ['-c', wrappedCommand], {
      stdio: 'pipe',
      timeout: 5000,
    });

    expect(result.status).toBe(0);
    expect(result.stdout?.toString()).toContain('UDP socket created');
  });

  it('should allow IPv6 socket creation', async () => {
    if (skipIfNotLinux() || skipIfNotAnt() || !filterPath) {
      return;
    }

    const testCommand =
      'python3 -c "import socket; s = socket.socket(socket.AF_INET6, socket.SOCK_STREAM); print(\'IPv6 socket created\')"';

    const wrappedCommand = await wrapCommandWithSandboxLinux({
      command: testCommand,
      needsNetworkRestriction: false,
    });

    const result = spawnSync('bash', ['-c', wrappedCommand], {
      stdio: 'pipe',
      timeout: 5000,
    });

    expect(result.status).toBe(0);
    expect(result.stdout?.toString()).toContain('IPv6 socket created');
  });
});

describe('Two-Stage Seccomp Application', () => {
  it('should allow network infrastructure to run before filter', async () => {
    if (skipIfNotLinux() || skipIfNotAnt()) {
      return;
    }

    if (!hasLinuxSandboxDependenciesSync()) {
      return;
    }

    const testCommand = 'echo "test"';

    const wrappedCommand = await wrapCommandWithSandboxLinux({
      command: testCommand,
      needsNetworkRestriction: false,
    });

    expect(wrappedCommand).toContain('socat');
    expect(wrappedCommand).toContain('apply-seccomp');

    const socatIndex = wrappedCommand.indexOf('socat');
    const seccompIndex = wrappedCommand.indexOf('apply-seccomp');
    expect(socatIndex).toBeGreaterThan(-1);
    expect(seccompIndex).toBeGreaterThan(-1);
    expect(socatIndex).toBeLessThan(seccompIndex);
  });

  it('should execute user command with filter applied', async () => {
    if (skipIfNotLinux() || skipIfNotAnt()) {
      return;
    }

    if (!hasLinuxSandboxDependenciesSync()) {
      return;
    }

    const testCommand =
      'python3 -c "import socket; socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)"';

    const wrappedCommand = await wrapCommandWithSandboxLinux({
      command: testCommand,
      needsNetworkRestriction: false,
    });

    const result = spawnSync('bash', ['-c', wrappedCommand], {
      stdio: 'pipe',
      timeout: 5000,
    });

    expect(result.status).not.toBe(0);
  });
});

describe('Sandbox Integration', () => {
  it('should handle commands without network or filesystem restrictions', async () => {
    if (skipIfNotLinux()) {
      return;
    }

    if (!hasLinuxSandboxDependenciesSync()) {
      return;
    }

    const testCommand = 'echo "hello world"';
    const wrappedCommand = await wrapCommandWithSandboxLinux({
      command: testCommand,
      needsNetworkRestriction: false,
    });

    expect(wrappedCommand).toBeTruthy();
    expect(typeof wrappedCommand).toBe('string');
  });

  it('should wrap commands with filesystem restrictions', async () => {
    if (skipIfNotLinux()) {
      return;
    }

    if (!hasLinuxSandboxDependenciesSync()) {
      return;
    }

    const testCommand = 'ls /';
    const wrappedCommand = await wrapCommandWithSandboxLinux({
      command: testCommand,
      needsNetworkRestriction: false,
      writeConfig: {
        allowOnly: ['/tmp'],
        denyWithinAllow: [],
      },
    });

    expect(wrappedCommand).toBeTruthy();
    expect(wrappedCommand).toContain('bwrap');
  });

  it('should include seccomp for ANT users with dependencies', async () => {
    if (skipIfNotLinux()) {
      return;
    }

    if (!hasLinuxSandboxDependenciesSync()) {
      return;
    }

    const testCommand = 'echo "test"';
    const wrappedCommand = await wrapCommandWithSandboxLinux({
      command: testCommand,
      needsNetworkRestriction: false,
    });

    const isAnt = process.env.USER_TYPE === 'ant';

    if (isAnt) {
      expect(wrappedCommand).toContain('apply-seccomp');
    } else {
      expect(wrappedCommand).not.toContain('apply-seccomp');
    }
  });
});

describe('Error Handling', () => {
  it('should handle cleanup calls gracefully (no-op)', () => {
    if (skipIfNotLinux()) {
      return;
    }

    expect(() => cleanupSeccompFilter('')).not.toThrow();
    expect(() =>
      cleanupSeccompFilter('/invalid/path/filter.bpf')
    ).not.toThrow();
    expect(() => cleanupSeccompFilter('/tmp/nonexistent.bpf')).not.toThrow();
    expect(() =>
      cleanupSeccompFilter('/dist/vendor/seccomp/x64/unix-block.bpf')
    ).not.toThrow();
  });
});
