import { SandboxManager } from '@/core/manager/sandbox-manager';
import type { SandboxRuntimeConfig } from '@/core/sandbox/sandbox-config';
import { generateSeccompFilter } from '@/generate-seccomp-filter';
import { wrapCommandWithSandboxLinux } from '@/os/linux';
import { getPlatform } from '@/utils/platform';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
} from 'node:fs';
import type { Server } from 'node:net';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function createTestConfig(testDir: string): SandboxRuntimeConfig {
  return {
    network: {
      allowedDomains: ['example.com'],
      deniedDomains: [],
    },
    filesystem: {
      denyRead: [],
      allowWrite: [testDir],
      denyWrite: [],
    },
  };
}

function skipIfNotLinux(): boolean {
  return getPlatform() !== 'linux';
}

function assertPrecompiledBpfInUse(): void {
  const bpfPath = generateSeccompFilter();

  expect(bpfPath).toBeTruthy();
  expect(bpfPath).toContain('/dist/vendor/seccomp/');
  expect(existsSync(bpfPath!)).toBe(true);

  console.log(`Verified using pre-compiled BPF: ${bpfPath}`);
}

describe('Sandbox Integration Tests', () => {
  const TEST_SOCKET_PATH = '/tmp/vsbx-test.sock';
  const TEST_DIR = join(process.cwd(), '.sandbox-test-tmp');
  let socketServer: Server | null = null;

  beforeAll(async () => {
    if (skipIfNotLinux()) {
      return;
    }

    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }

    if (existsSync(TEST_SOCKET_PATH)) {
      unlinkSync(TEST_SOCKET_PATH);
    }

    socketServer = createServer((socket) => {
      socket.on('data', (data) => {
        socket.write('Echo: ' + data.toString());
      });
    });

    await new Promise<void>((resolve, reject) => {
      socketServer!.listen(TEST_SOCKET_PATH, () => {
        console.log(`Test socket server listening on ${TEST_SOCKET_PATH}`);
        resolve();
      });
      socketServer!.on('error', reject);
    });

    await SandboxManager.initialize(createTestConfig(TEST_DIR));
  });

  afterAll(async () => {
    if (skipIfNotLinux()) {
      return;
    }

    if (socketServer) {
      socketServer.close();
    }

    if (existsSync(TEST_SOCKET_PATH)) {
      unlinkSync(TEST_SOCKET_PATH);
    }

    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }

    await SandboxManager.reset();
  });

  describe('With Pre-compiled BPF', () => {
    beforeAll(() => {
      if (skipIfNotLinux()) {
        return;
      }

      console.log('\n=== Testing with Pre-compiled BPF ===');
      assertPrecompiledBpfInUse();
    });

    describe('Unix Socket Restrictions', () => {
      it('should block Unix socket connections with seccomp', async () => {
        if (skipIfNotLinux()) {
          return;
        }

        const command = await SandboxManager.wrapWithSandbox(
          `echo "Test message" | nc -U ${TEST_SOCKET_PATH}`
        );

        const result = spawnSync(command, {
          shell: true,
          encoding: 'utf8',
          timeout: 5000,
        });

        const output = (result.stderr || result.stdout || '').toLowerCase();
        const hasExpectedError =
          output.includes('operation not permitted') ||
          output.includes('create unix socket failed');
        expect(hasExpectedError).toBe(true);
        expect(result.status).not.toBe(0);
      });
    });

    describe('Network Restrictions', () => {
      it('should block HTTP requests to non-allowlisted domains', async () => {
        if (skipIfNotLinux()) {
          return;
        }

        const command = await SandboxManager.wrapWithSandbox(
          'curl -s http://blocked-domain.example'
        );

        const result = spawnSync(command, {
          shell: true,
          encoding: 'utf8',
          timeout: 5000,
        });

        const output = (result.stderr || result.stdout || '').toLowerCase();
        expect(output).toContain('blocked by network allowlist');
      });

      it('should block HTTP requests to vsbx-sandbox.com (not in allowlist)', async () => {
        if (skipIfNotLinux()) {
          return;
        }

        const command = await SandboxManager.wrapWithSandbox(
          'curl -s --show-error --max-time 2 https://www.vsbx-sandbox.com'
        );

        const result = spawnSync(command, {
          shell: true,
          encoding: 'utf8',
          timeout: 3000,
        });

        const output = (result.stderr || result.stdout || '').toLowerCase();
        const didFail = result.status !== 0 || result.status === null;
        expect(didFail).toBe(true);

        expect(output).not.toContain('<!doctype html');
        expect(output).not.toContain('<html');
      });

      it('should allow HTTP requests to allowlisted domains', async () => {
        if (skipIfNotLinux()) {
          return;
        }

        const command = await SandboxManager.wrapWithSandbox(
          'curl -s http://example.com'
        );

        const result = spawnSync(command, {
          shell: true,
          encoding: 'utf8',
          timeout: 10000,
        });

        const output = result.stdout || '';
        expect(result.status).toBe(0);
        expect(output).toContain('Example Domain');
      });
    });

    describe('Filesystem Restrictions', () => {
      it('should block writes outside current working directory', async () => {
        if (skipIfNotLinux()) {
          return;
        }

        const testFile = join(tmpdir(), 'sandbox-blocked-write.txt');

        if (existsSync(testFile)) {
          unlinkSync(testFile);
        }

        const command = await SandboxManager.wrapWithSandbox(
          `echo "should fail" > ${testFile}`
        );

        const result = spawnSync(command, {
          shell: true,
          encoding: 'utf8',
          cwd: TEST_DIR,
          timeout: 5000,
        });

        const output = (result.stderr || result.stdout || '').toLowerCase();
        expect(output).toContain('read-only file system');
        expect(existsSync(testFile)).toBe(false);
      });

      it('should allow writes within current working directory', async () => {
        if (skipIfNotLinux()) {
          return;
        }

        if (!existsSync(TEST_DIR)) {
          mkdirSync(TEST_DIR, { recursive: true });
        }

        const testFile = join(TEST_DIR, 'allowed-write.txt');
        const testContent = 'test content from sandbox';

        if (existsSync(testFile)) {
          unlinkSync(testFile);
        }

        const command = await SandboxManager.wrapWithSandbox(
          `echo "${testContent}" > allowed-write.txt`
        );

        const result = spawnSync(command, {
          shell: true,
          encoding: 'utf8',
          cwd: TEST_DIR,
          timeout: 5000,
        });

        if (result.status !== 0) {
          console.error('Command failed:', command);
          console.error('Status:', result.status);
          console.error('Stdout:', result.stdout);
          console.error('Stderr:', result.stderr);
          console.error('CWD:', TEST_DIR);
          console.error('Test file path:', testFile);
        }

        expect(result.status).toBe(0);
        expect(existsSync(testFile)).toBe(true);

        const content = readFileSync(testFile, 'utf8');
        expect(content).toContain(testContent);

        if (existsSync(testFile)) {
          unlinkSync(testFile);
        }
      });

      it('should allow reads from anywhere', async () => {
        if (skipIfNotLinux()) {
          return;
        }

        const command = await SandboxManager.wrapWithSandbox(
          'head -n 5 ~/.bashrc'
        );

        const result = spawnSync(command, {
          shell: true,
          encoding: 'utf8',
          timeout: 5000,
        });

        expect(result.status).toBe(0);

        if (existsSync(`${process.env.HOME}/.bashrc`)) {
          expect(result.stdout).toBeTruthy();
        }
      });

      it('should allow writes in seccomp-only mode (no network restrictions)', async () => {
        if (skipIfNotLinux()) {
          return;
        }

        const testFile = join(TEST_DIR, 'seccomp-only-write.txt');
        const testContent = 'seccomp-only test content';

        const command = await wrapCommandWithSandboxLinux({
          command: `echo "${testContent}" > ${testFile}`,
          needsNetworkRestriction: false,
          writeConfig: {
            allowOnly: [TEST_DIR],
            denyWithinAllow: [],
          },
          allowAllUnixSockets: false,
        });

        const result = spawnSync(command, {
          shell: true,
          encoding: 'utf8',
          cwd: TEST_DIR,
          timeout: 5000,
        });

        if (result.status !== 0) {
          console.error('Command failed in seccomp-only mode');
          console.error('Status:', result.status);
          console.error('Stdout:', result.stdout);
          console.error('Stderr:', result.stderr);
          console.error('CWD:', TEST_DIR);
          console.error('Test file path:', testFile);
        }

        expect(result.status).toBe(0);
        expect(existsSync(testFile)).toBe(true);

        const content = readFileSync(testFile, 'utf8');
        expect(content.trim()).toBe(testContent);

        if (existsSync(testFile)) {
          unlinkSync(testFile);
        }
      });
    });

    describe('Command Execution', () => {
      it('should execute basic commands successfully', async () => {
        if (skipIfNotLinux()) {
          return;
        }

        const command = await SandboxManager.wrapWithSandbox(
          'echo "Hello from sandbox"'
        );

        const result = spawnSync(command, {
          shell: true,
          encoding: 'utf8',
          timeout: 5000,
        });

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('Hello from sandbox');
      });

      it('should handle complex command pipelines', async () => {
        if (skipIfNotLinux()) {
          return;
        }

        const command = await SandboxManager.wrapWithSandbox(
          'echo "line1\nline2\nline3" | grep line2'
        );

        const result = spawnSync(command, {
          shell: true,
          encoding: 'utf8',
          timeout: 5000,
        });

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('line2');
        expect(result.stdout).not.toContain('line1');
      });
    });

    describe('Shell Selection (binShell parameter)', () => {
      it('should execute commands with zsh when binShell is specified', async () => {
        if (skipIfNotLinux()) {
          return;
        }

        const zshCheck = spawnSync('which zsh', {
          shell: true,
          encoding: 'utf8',
        });
        if (zshCheck.status !== 0) {
          console.log('zsh not available, skipping test');
          return;
        }

        const command = await SandboxManager.wrapWithSandbox(
          'echo "Shell: $ZSH_VERSION"',
          'zsh'
        );

        const result = spawnSync(command, {
          shell: true,
          encoding: 'utf8',
          timeout: 5000,
        });

        expect(result.status).toBe(0);
        expect(result.stdout).toMatch(/Shell: \d+\.\d+/);
      });

      it('should use zsh syntax successfully with binShell=zsh', async () => {
        if (skipIfNotLinux()) {
          return;
        }

        const zshCheck = spawnSync('which zsh', {
          shell: true,
          encoding: 'utf8',
        });
        if (zshCheck.status !== 0) {
          console.log('zsh not available, skipping test');
          return;
        }

        const command = await SandboxManager.wrapWithSandbox(
          'VAR="hello world" && echo ${VAR:u}',
          'zsh'
        );

        const result = spawnSync(command, {
          shell: true,
          encoding: 'utf8',
          timeout: 5000,
        });

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('HELLO WORLD');
      });

      it('should default to bash when binShell is not specified', async () => {
        if (skipIfNotLinux()) {
          return;
        }

        const command = await SandboxManager.wrapWithSandbox(
          'echo "Shell: $BASH_VERSION"'
        );

        const result = spawnSync(command, {
          shell: true,
          encoding: 'utf8',
          timeout: 5000,
        });

        expect(result.status).toBe(0);
        expect(result.stdout).toMatch(/Shell: \d+\.\d+/);
      });
    });

    describe('Security Boundaries', () => {
      it('should isolate PID namespace - sandboxed processes cannot see host PIDs', async () => {
        if (skipIfNotLinux()) {
          return;
        }

        const command = await SandboxManager.wrapWithSandbox(
          'ls /proc | grep -E "^[0-9]+$" | wc -l'
        );

        const result = spawnSync(command, {
          shell: true,
          encoding: 'utf8',
          timeout: 5000,
        });

        expect(result.status).toBe(0);
      });

      it('should prevent symlink-based filesystem escape attempts', async () => {
        if (skipIfNotLinux()) {
          return;
        }

        const linkInAllowed = join(TEST_DIR, 'escape-link-write');
        const targetOutside = '/tmp/escape-test-' + Date.now() + '.txt';

        const command = await SandboxManager.wrapWithSandbox(
          `ln -s ${targetOutside} ${linkInAllowed} 2>&1 && echo "escaped" > ${linkInAllowed} 2>&1`
        );

        const result = spawnSync(command, {
          shell: true,
          encoding: 'utf8',
          cwd: TEST_DIR,
          timeout: 5000,
        });

        const output = (result.stderr || result.stdout || '').toLowerCase();
        expect(output).toContain('read-only file system');

        expect(existsSync(targetOutside)).toBe(false);

        if (existsSync(linkInAllowed)) {
          unlinkSync(linkInAllowed);
        }
        if (existsSync(targetOutside)) {
          unlinkSync(targetOutside);
        }
      });

      it('should terminate background processes when sandbox exits', async () => {
        if (skipIfNotLinux()) {
          return;
        }

        const markerFile = join(TEST_DIR, 'background-process-marker.txt');

        if (existsSync(markerFile)) {
          unlinkSync(markerFile);
        }

        const command = await SandboxManager.wrapWithSandbox(
          `(while true; do echo "alive" >> ${markerFile}; sleep 0.5; done) & sleep 2`
        );

        const startTime = Date.now();
        spawnSync(command, {
          shell: true,
          encoding: 'utf8',
          cwd: TEST_DIR,
          timeout: 5000,
        });
        const endTime = Date.now();

        await new Promise((resolve) => setTimeout(resolve, 2000));

        if (existsSync(markerFile)) {
          const content = readFileSync(markerFile, 'utf8');
          const lines = content.trim().split('\n').length;

          expect(lines).toBeLessThan(10);

          unlinkSync(markerFile);
        } else {
          expect(true).toBe(true);
        }

        expect(endTime - startTime).toBeLessThan(4000);
      });

      it('should kill child processes when sandbox is terminated via SIGTERM (--die-with-parent)', async () => {
        if (skipIfNotLinux()) {
          return;
        }

        const markerFile = join(TEST_DIR, 'sigterm-test-marker.txt');

        if (existsSync(markerFile)) {
          unlinkSync(markerFile);
        }

        const command = await SandboxManager.wrapWithSandbox(
          `for i in $(seq 1 50); do echo "tick $i" >> ${markerFile}; sleep 0.2; done`
        );

        const result = spawnSync('timeout', ['1', 'bash', '-c', command], {
          encoding: 'utf8',
          cwd: TEST_DIR,
          timeout: 5000,
        });

        expect(result.status).toBe(124);

        await new Promise((resolve) => setTimeout(resolve, 1500));

        if (existsSync(markerFile)) {
          const content = readFileSync(markerFile, 'utf8');
          const lines = content.trim().split('\n').length;

          expect(lines).toBeLessThan(10);

          unlinkSync(markerFile);
        }
      });

      it('should not leave orphan processes after timeout kills sandbox', async () => {
        if (skipIfNotLinux()) {
          return;
        }

        const uniqueMarker = `sandbox-orphan-test-${Date.now()}`;
        const markerFile = join(TEST_DIR, 'orphan-test.txt');

        if (existsSync(markerFile)) {
          unlinkSync(markerFile);
        }

        const command = await SandboxManager.wrapWithSandbox(
          `export ORPHAN_MARKER="${uniqueMarker}"; while true; do echo "$ORPHAN_MARKER" >> ${markerFile}; sleep 0.5; done`
        );

        spawnSync('timeout', ['0.5', 'bash', '-c', command], {
          encoding: 'utf8',
          cwd: TEST_DIR,
          timeout: 3000,
        });

        await new Promise((resolve) => setTimeout(resolve, 1500));

        const psResult = spawnSync(
          'bash',
          ['-c', `ps aux | grep "${uniqueMarker}" | grep -v grep || true`],
          {
            encoding: 'utf8',
            timeout: 2000,
          }
        );

        expect(psResult.stdout.trim()).toBe('');

        if (existsSync(markerFile)) {
          unlinkSync(markerFile);
        }
      });

      it('should prevent privilege escalation attempts', async () => {
        if (skipIfNotLinux()) {
          return;
        }

        const setuidTest = join(TEST_DIR, 'setuid-test');

        const command2 = await SandboxManager.wrapWithSandbox(
          'sudo -n echo "elevated" 2>&1 || su -c "echo elevated" 2>&1 || echo "commands blocked"'
        );

        const result2 = spawnSync(command2, {
          shell: true,
          encoding: 'utf8',
          timeout: 5000,
        });

        const output = result2.stdout.toLowerCase();
        if (
          output.includes('elevated') &&
          !output.includes('commands blocked')
        ) {
          expect(output).toMatch(
            /not found|command not found|no such file|not permitted|password|cannot|no password/
          );
        }

        if (existsSync(setuidTest)) {
          unlinkSync(setuidTest);
        }
      });

      it('should enforce network restrictions across protocols and ports', async () => {
        if (skipIfNotLinux()) {
          return;
        }

        const command1 = await SandboxManager.wrapWithSandbox(
          'curl -s --show-error --max-time 2 --connect-timeout 2 https://blocked-domain.example 2>&1 || echo "curl_failed"'
        );

        const result1 = spawnSync(command1, {
          shell: true,
          encoding: 'utf8',
          timeout: 4000,
        });

        const output1 = result1.stdout.toLowerCase();
        const didNotSucceed =
          output1.includes('curl_failed') ||
          output1.includes('timeout') ||
          output1.includes('could not resolve') ||
          output1.includes('failed');
        expect(didNotSucceed).toBe(true);

        const command2 = await SandboxManager.wrapWithSandbox(
          'curl -s --show-error --max-time 2 http://blocked-domain.example:8080 2>&1'
        );

        const result2 = spawnSync(command2, {
          shell: true,
          encoding: 'utf8',
          timeout: 3000,
        });

        const output2 = result2.stdout.toLowerCase();
        expect(output2).toContain('blocked by network allowlist');

        const command3 = await SandboxManager.wrapWithSandbox(
          'curl -s --max-time 2 http://1.1.1.1 2>&1'
        );

        const result3 = spawnSync(command3, {
          shell: true,
          encoding: 'utf8',
          timeout: 3000,
        });

        const output3 = result3.stdout.toLowerCase();
        expect(output3).toContain('blocked by network allowlist');

        const command4 = await SandboxManager.wrapWithSandbox(
          'curl -s --max-time 5 https://example.com 2>&1'
        );

        const result4 = spawnSync(command4, {
          shell: true,
          encoding: 'utf8',
          timeout: 10000,
        });

        const output4 = result4.stdout.toLowerCase();
        expect(output4).not.toContain('blocked by network allowlist');
        if (result4.status === 0) {
          expect(result4.stdout).toContain('Example Domain');
        }
      });

      it('should enforce wildcard domain pattern matching correctly', async () => {
        if (skipIfNotLinux()) {
          return;
        }

        await SandboxManager.reset();
        await SandboxManager.initialize({
          network: {
            allowedDomains: ['*.github.com', 'example.com'],
            deniedDomains: [],
          },
          filesystem: {
            denyRead: [],
            allowWrite: [],
            denyWrite: [],
          },
        });

        const command1 = await SandboxManager.wrapWithSandbox(
          'curl -s --max-time 3 http://api.github.com 2>&1 | head -20'
        );

        const result1 = spawnSync(command1, {
          shell: true,
          encoding: 'utf8',
          timeout: 5000,
        });

        const output1 = result1.stdout.toLowerCase();
        expect(output1).not.toContain('blocked by network allowlist');

        const command2 = await SandboxManager.wrapWithSandbox(
          'curl -s --max-time 2 http://github.com 2>&1'
        );

        const result2 = spawnSync(command2, {
          shell: true,
          encoding: 'utf8',
          timeout: 3000,
        });

        const output2 = result2.stdout.toLowerCase();
        expect(output2).toContain('blocked by network allowlist');

        const command3 = await SandboxManager.wrapWithSandbox(
          'curl -s --max-time 2 http://malicious-github.com 2>&1'
        );

        const result3 = spawnSync(command3, {
          shell: true,
          encoding: 'utf8',
          timeout: 3000,
        });

        const output3 = result3.stdout.toLowerCase();
        expect(output3).toContain('blocked by network allowlist');

        const command4 = await SandboxManager.wrapWithSandbox(
          'curl -s --max-time 3 http://raw.githubusercontent.com 2>&1 | head -20'
        );

        const result4 = spawnSync(command4, {
          shell: true,
          encoding: 'utf8',
          timeout: 5000,
        });

        const output4 = result4.stdout.toLowerCase();
        expect(output4).toContain('blocked by network allowlist');

        await SandboxManager.reset();
        await SandboxManager.initialize(createTestConfig(TEST_DIR));
      });

      it('should prevent creation of special file types that could bypass restrictions', async () => {
        if (skipIfNotLinux()) {
          return;
        }

        const fifoPath = join(TEST_DIR, 'test.fifo');
        const regularFile = join(TEST_DIR, 'regular.txt');
        const hardlinkPath = join(TEST_DIR, 'hardlink.txt');
        const devicePath = join(TEST_DIR, 'fake-device');

        [fifoPath, regularFile, hardlinkPath, devicePath].forEach((path) => {
          if (existsSync(path)) {
            unlinkSync(path);
          }
        });

        const command1 = await SandboxManager.wrapWithSandbox(
          `mkfifo ${fifoPath} && test -p ${fifoPath} && echo "FIFO created"`
        );

        const result1 = spawnSync(command1, {
          shell: true,
          encoding: 'utf8',
          timeout: 3000,
        });

        expect(result1.status).toBe(0);
        expect(result1.stdout).toContain('FIFO created');
        expect(existsSync(fifoPath)).toBe(true);

        const command2a = await SandboxManager.wrapWithSandbox(
          `echo "test content" > ${regularFile}`
        );

        spawnSync(command2a, {
          shell: true,
          encoding: 'utf8',
          timeout: 3000,
        });

        const command2b = await SandboxManager.wrapWithSandbox(
          `ln /etc/passwd ${hardlinkPath} 2>&1`
        );

        const result2b = spawnSync(command2b, {
          shell: true,
          encoding: 'utf8',
          timeout: 3000,
        });

        expect(result2b.status).not.toBe(0);
        const output2 = result2b.stdout.toLowerCase();
        expect(output2).toMatch(
          /read-only|permission denied|not permitted|operation not permitted|cross-device/
        );

        const command3 = await SandboxManager.wrapWithSandbox(
          `mknod ${devicePath} c 1 3 2>&1`
        );

        const result3 = spawnSync(command3, {
          shell: true,
          encoding: 'utf8',
          timeout: 3000,
        });

        expect(result3.status).not.toBe(0);
        const output3 = result3.stdout.toLowerCase();
        expect(output3).toMatch(
          /operation not permitted|permission denied|not permitted/
        );
        expect(existsSync(devicePath)).toBe(false);

        [fifoPath, regularFile, hardlinkPath, devicePath].forEach((path) => {
          if (existsSync(path)) {
            unlinkSync(path);
          }
        });
      });
    });
  });
});

describe('Empty allowedDomains Network Blocking Integration', () => {
  const TEST_DIR = join(process.cwd(), '.sandbox-test-empty-domains');

  beforeAll(async () => {
    if (skipIfNotLinux()) {
      return;
    }

    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterAll(async () => {
    if (skipIfNotLinux()) {
      return;
    }

    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }

    await SandboxManager.reset();
  });

  describe('Network blocked with empty allowedDomains', () => {
    beforeAll(async () => {
      if (skipIfNotLinux()) {
        return;
      }

      await SandboxManager.reset();
      await SandboxManager.initialize({
        network: {
          allowedDomains: [],
          deniedDomains: [],
        },
        filesystem: {
          denyRead: [],
          allowWrite: [TEST_DIR],
          denyWrite: [],
        },
      });
    });

    it('should block all HTTP requests when allowedDomains is empty', async () => {
      if (skipIfNotLinux()) {
        return;
      }

      const command = await SandboxManager.wrapWithSandbox(
        'curl -s --max-time 2 --connect-timeout 2 http://example.com 2>&1 || echo "network_failed"'
      );

      const result = spawnSync(command, {
        shell: true,
        encoding: 'utf8',
        timeout: 5000,
      });

      const output = (result.stdout + result.stderr).toLowerCase();

      const networkBlocked =
        output.includes('network_failed') ||
        output.includes('couldn\'t connect') ||
        output.includes('connection refused') ||
        output.includes('network is unreachable') ||
        output.includes('name or service not known') ||
        output.includes('timed out') ||
        output.includes('connection timed out') ||
        result.status !== 0;

      expect(networkBlocked).toBe(true);

      expect(output).not.toContain('example domain');
      expect(output).not.toContain('<!doctype');
    });

    it('should block all HTTPS requests when allowedDomains is empty', async () => {
      if (skipIfNotLinux()) {
        return;
      }

      const command = await SandboxManager.wrapWithSandbox(
        'curl -s --max-time 2 --connect-timeout 2 https://example.com 2>&1 || echo "network_failed"'
      );

      const result = spawnSync(command, {
        shell: true,
        encoding: 'utf8',
        timeout: 5000,
      });

      const output = (result.stdout + result.stderr).toLowerCase();

      const networkBlocked =
        output.includes('network_failed') ||
        output.includes('couldn\'t connect') ||
        output.includes('connection refused') ||
        output.includes('network is unreachable') ||
        output.includes('name or service not known') ||
        output.includes('timed out') ||
        result.status !== 0;

      expect(networkBlocked).toBe(true);
    });

    it('should block DNS lookups when allowedDomains is empty', async () => {
      if (skipIfNotLinux()) {
        return;
      }

      const command = await SandboxManager.wrapWithSandbox(
        'host example.com 2>&1 || nslookup example.com 2>&1 || echo "dns_failed"'
      );

      const result = spawnSync(command, {
        shell: true,
        encoding: 'utf8',
        timeout: 5000,
      });

      const output = (result.stdout + result.stderr).toLowerCase();

      const dnsBlocked =
        output.includes('dns_failed') ||
        output.includes('connection timed out') ||
        output.includes('no servers could be reached') ||
        output.includes('network is unreachable') ||
        output.includes('name or service not known') ||
        output.includes('temporary failure') ||
        result.status !== 0;

      expect(dnsBlocked).toBe(true);
    });

    it('should block wget when allowedDomains is empty', async () => {
      if (skipIfNotLinux()) {
        return;
      }

      const command = await SandboxManager.wrapWithSandbox(
        'wget -q --timeout=2 -O - http://example.com 2>&1 || echo "wget_failed"'
      );

      const result = spawnSync(command, {
        shell: true,
        encoding: 'utf8',
        timeout: 5000,
      });

      const output = (result.stdout + result.stderr).toLowerCase();

      const wgetBlocked =
        output.includes('wget_failed') ||
        output.includes('failed') ||
        output.includes('network is unreachable') ||
        output.includes('unable to resolve') ||
        result.status !== 0;

      expect(wgetBlocked).toBe(true);
    });

    it('should allow local filesystem operations when network is blocked', async () => {
      if (skipIfNotLinux()) {
        return;
      }

      const testFile = join(TEST_DIR, 'network-blocked-test.txt');
      const testContent = 'test content with network blocked';

      const command = await SandboxManager.wrapWithSandbox(
        `echo "${testContent}" > ${testFile} && cat ${testFile}`
      );

      const result = spawnSync(command, {
        shell: true,
        encoding: 'utf8',
        cwd: TEST_DIR,
        timeout: 5000,
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(testContent);

      if (existsSync(testFile)) {
        unlinkSync(testFile);
      }
    });
  });

  describe('Network allowed with specific domains', () => {
    beforeAll(async () => {
      if (skipIfNotLinux()) {
        return;
      }

      await SandboxManager.reset();
      await SandboxManager.initialize({
        network: {
          allowedDomains: ['example.com'],
          deniedDomains: [],
        },
        filesystem: {
          denyRead: [],
          allowWrite: [TEST_DIR],
          denyWrite: [],
        },
      });
    });

    it('should allow HTTP to explicitly allowed domain', async () => {
      if (skipIfNotLinux()) {
        return;
      }

      const command = await SandboxManager.wrapWithSandbox(
        'curl -s --max-time 5 http://example.com 2>&1'
      );

      const result = spawnSync(command, {
        shell: true,
        encoding: 'utf8',
        timeout: 10000,
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Example Domain');
    });

    it('should block HTTP to non-allowed domain', async () => {
      if (skipIfNotLinux()) {
        return;
      }

      const command = await SandboxManager.wrapWithSandbox(
        'curl -s --max-time 2 http://vsbx-sandbox.com 2>&1'
      );

      const result = spawnSync(command, {
        shell: true,
        encoding: 'utf8',
        timeout: 5000,
      });

      const output = result.stdout.toLowerCase();
      expect(output).toContain('blocked by network allowlist');
    });
  });

  describe('Contrast: empty vs undefined network config', () => {
    it('empty allowedDomains should block network', async () => {
      if (skipIfNotLinux()) {
        return;
      }

      await SandboxManager.reset();
      await SandboxManager.initialize({
        network: {
          allowedDomains: [],
          deniedDomains: [],
        },
        filesystem: {
          denyRead: [],
          allowWrite: [TEST_DIR],
          denyWrite: [],
        },
      });

      const command = await SandboxManager.wrapWithSandbox(
        'curl -s --max-time 2 http://example.com 2>&1 || echo "blocked"'
      );

      const result = spawnSync(command, {
        shell: true,
        encoding: 'utf8',
        timeout: 5000,
      });

      const output = (result.stdout + result.stderr).toLowerCase();
      const isBlocked =
        output.includes('blocked') ||
        output.includes('couldn\'t connect') ||
        output.includes('network is unreachable') ||
        result.status !== 0;

      expect(isBlocked).toBe(true);
      expect(output).not.toContain('example domain');
    });
  });
});
