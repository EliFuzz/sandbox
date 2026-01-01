import { SandboxManager } from '@/core/manager/sandbox-manager';
import type { SandboxRuntimeConfig } from '@/core/sandbox/sandbox-config';
import { wrapCommandWithSandboxLinux } from '@/os/linux';
import { wrapCommandWithSandboxMacOS } from '@/os/macos/sandbox/macos-sandbox';
import { getPlatform } from '@/utils/platform';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function createTestConfig(): SandboxRuntimeConfig {
  return {
    network: {
      allowedDomains: ['example.com', 'api.github.com'],
      deniedDomains: [],
    },
    filesystem: {
      denyRead: ['~/.ssh'],
      allowWrite: ['.', '/tmp'],
      denyWrite: ['.env'],
    },
  };
}

function skipIfUnsupportedPlatform(): boolean {
  const platform = getPlatform();
  return platform !== 'linux' && platform !== 'macos';
}

describe('wrapWithSandbox customConfig', () => {
  beforeAll(async () => {
    if (skipIfUnsupportedPlatform()) {
      return;
    }
    await SandboxManager.initialize(createTestConfig());
  });

  afterAll(async () => {
    if (skipIfUnsupportedPlatform()) {
      return;
    }
    await SandboxManager.reset();
  });

  describe('without customConfig', () => {
    it('uses main config values', async () => {
      if (skipIfUnsupportedPlatform()) {
        return;
      }

      const command = 'echo hello';
      const wrapped = await SandboxManager.wrapWithSandbox(command);

      expect(wrapped).not.toBe(command);
      expect(wrapped.length).toBeGreaterThan(command.length);
    });
  });

  describe('with customConfig filesystem overrides', () => {
    it('uses custom allowWrite when provided', async () => {
      if (skipIfUnsupportedPlatform()) {
        return;
      }

      const command = 'echo hello';
      const wrapped = await SandboxManager.wrapWithSandbox(command, undefined, {
        filesystem: {
          denyRead: [],
          allowWrite: [],
          denyWrite: [],
        },
      });

      expect(wrapped).not.toBe(command);
      expect(wrapped.length).toBeGreaterThan(command.length);
    });

    it('uses custom denyRead when provided', async () => {
      if (skipIfUnsupportedPlatform()) {
        return;
      }

      const command = 'cat /etc/passwd';
      const wrapped = await SandboxManager.wrapWithSandbox(command, undefined, {
        filesystem: {
          denyRead: ['/etc/passwd'],
          allowWrite: [],
          denyWrite: [],
        },
      });

      expect(wrapped).not.toBe(command);
    });
  });

  describe('with customConfig network overrides', () => {
    it('blocks network when allowedDomains is empty', async () => {
      if (skipIfUnsupportedPlatform()) {
        return;
      }

      const command = 'curl https://example.com';
      const wrapped = await SandboxManager.wrapWithSandbox(command, undefined, {
        network: {
          allowedDomains: [],
          deniedDomains: [],
        },
      });

      expect(wrapped).not.toBe(command);
    });

    it('uses main config network when customConfig.network is undefined', async () => {
      if (skipIfUnsupportedPlatform()) {
        return;
      }

      const command = 'echo hello';
      const wrapped = await SandboxManager.wrapWithSandbox(command, undefined, {
        filesystem: {
          denyRead: [],
          allowWrite: [],
          denyWrite: [],
        },
      });

      expect(wrapped).not.toBe(command);
    });
  });

  describe('readonly mode simulation', () => {
    it('can create a fully restricted sandbox config', async () => {
      if (skipIfUnsupportedPlatform()) {
        return;
      }

      const command = 'ls -la';

      const readonlyConfig = {
        network: {
          allowedDomains: [],
          deniedDomains: [],
        },
        filesystem: {
          denyRead: [],
          allowWrite: [],
          denyWrite: [],
        },
      };

      const wrapped = await SandboxManager.wrapWithSandbox(
        command,
        undefined,
        readonlyConfig
      );

      expect(wrapped).not.toBe(command);
      expect(wrapped.length).toBeGreaterThan(command.length);
    });
  });

  describe('partial config merging', () => {
    it('only overrides specified filesystem fields', async () => {
      if (skipIfUnsupportedPlatform()) {
        return;
      }

      const command = 'echo test';

      const wrapped = await SandboxManager.wrapWithSandbox(command, undefined, {
        filesystem: {
          denyRead: [],
          allowWrite: ['/custom/path'],
          denyWrite: [],
        },
      });

      expect(wrapped).not.toBe(command);
    });

    it('only overrides specified network fields', async () => {
      if (skipIfUnsupportedPlatform()) {
        return;
      }

      const command = 'echo test';

      const wrapped = await SandboxManager.wrapWithSandbox(command, undefined, {
        network: {
          allowedDomains: ['custom.example.com'],
          deniedDomains: [],
        },
      });

      expect(wrapped).not.toBe(command);
    });
  });
});

describe('restriction pattern semantics', () => {
  const command = 'echo hello';

  describe('no sandboxing needed (early return)', () => {
    it('returns command unchanged when no restrictions on Linux', async () => {
      if (getPlatform() !== 'linux') {
        return;
      }

      const result = await wrapCommandWithSandboxLinux({
        command,
        needsNetworkRestriction: false,
        readConfig: { denyOnly: [] },
        writeConfig: undefined,
      });

      expect(result).toBe(command);
    });

    it('returns command unchanged when no restrictions on macOS', () => {
      if (getPlatform() !== 'macos') {
        return;
      }

      const result = wrapCommandWithSandboxMacOS({
        command,
        needsNetworkRestriction: false,
        readConfig: { denyOnly: [] },
        writeConfig: undefined,
      });

      expect(result).toBe(command);
    });

    it('returns command unchanged with undefined readConfig on Linux', async () => {
      if (getPlatform() !== 'linux') {
        return;
      }

      const result = await wrapCommandWithSandboxLinux({
        command,
        needsNetworkRestriction: false,
        readConfig: undefined,
        writeConfig: undefined,
      });

      expect(result).toBe(command);
    });

    it('returns command unchanged with undefined readConfig on macOS', () => {
      if (getPlatform() !== 'macos') {
        return;
      }

      const result = wrapCommandWithSandboxMacOS({
        command,
        needsNetworkRestriction: false,
        readConfig: undefined,
        writeConfig: undefined,
      });

      expect(result).toBe(command);
    });
  });

  describe('read restrictions (deny-only pattern)', () => {
    it('empty denyOnly means no read restrictions on Linux', async () => {
      if (getPlatform() !== 'linux') {
        return;
      }

      const result = await wrapCommandWithSandboxLinux({
        command,
        needsNetworkRestriction: false,
        readConfig: { denyOnly: [] },
        writeConfig: { allowOnly: ['/tmp'], denyWithinAllow: [] },
      });

      expect(result).not.toBe(command);
      expect(result).toContain('bwrap');
    });

    it('non-empty denyOnly means has read restrictions on Linux', async () => {
      if (getPlatform() !== 'linux') {
        return;
      }

      const result = await wrapCommandWithSandboxLinux({
        command,
        needsNetworkRestriction: false,
        readConfig: { denyOnly: ['/secret'] },
        writeConfig: undefined,
      });

      expect(result).not.toBe(command);
      expect(result).toContain('bwrap');
    });
  });

  describe('write restrictions (allow-only pattern)', () => {
    it('undefined writeConfig means no write restrictions on Linux', async () => {
      if (getPlatform() !== 'linux') {
        return;
      }

      const result = await wrapCommandWithSandboxLinux({
        command,
        needsNetworkRestriction: false,
        readConfig: { denyOnly: ['/secret'] },
        writeConfig: undefined,
      });

      expect(result).not.toBe(command);
    });

    it('empty allowOnly means maximally restrictive (has restrictions) on Linux', async () => {
      if (getPlatform() !== 'linux') {
        return;
      }

      const result = await wrapCommandWithSandboxLinux({
        command,
        needsNetworkRestriction: false,
        readConfig: { denyOnly: [] },
        writeConfig: { allowOnly: [], denyWithinAllow: [] },
      });

      expect(result).not.toBe(command);
      expect(result).toContain('bwrap');
    });

    it('any writeConfig means has restrictions on macOS', () => {
      if (getPlatform() !== 'macos') {
        return;
      }

      const result = wrapCommandWithSandboxMacOS({
        command,
        needsNetworkRestriction: false,
        readConfig: { denyOnly: [] },
        writeConfig: { allowOnly: [], denyWithinAllow: [] },
      });

      expect(result).not.toBe(command);
      expect(result).toContain('sandbox-exec');
    });
  });

  describe('network restrictions', () => {
    it('needsNetworkRestriction false skips network sandbox on Linux', async () => {
      if (getPlatform() !== 'linux') {
        return;
      }

      const result = await wrapCommandWithSandboxLinux({
        command,
        needsNetworkRestriction: false,
        readConfig: { denyOnly: ['/secret'] },
        writeConfig: undefined,
      });

      expect(result).not.toBe(command);
      expect(result).not.toContain('--unshare-net');
    });

    it('needsNetworkRestriction false skips network sandbox on macOS', () => {
      if (getPlatform() !== 'macos') {
        return;
      }

      const result = wrapCommandWithSandboxMacOS({
        command,
        needsNetworkRestriction: false,
        readConfig: { denyOnly: ['/secret'] },
        writeConfig: undefined,
      });

      expect(result).not.toBe(command);
      expect(result).toContain('sandbox-exec');
    });

    it('needsNetworkRestriction true without proxy sockets blocks all network on Linux', async () => {
      if (getPlatform() !== 'linux') {
        return;
      }

      const result = await wrapCommandWithSandboxLinux({
        command,
        needsNetworkRestriction: true,
        httpSocketPath: undefined,
        socksSocketPath: undefined,
        readConfig: { denyOnly: [] },
        writeConfig: { allowOnly: ['/tmp'], denyWithinAllow: [] },
      });

      expect(result).not.toBe(command);
      expect(result).toContain('bwrap');
      expect(result).toContain('--unshare-net');
      expect(result).not.toContain('HTTP_PROXY');
    });

    it('needsNetworkRestriction true without proxy ports blocks all network on macOS', () => {
      if (getPlatform() !== 'macos') {
        return;
      }

      const result = wrapCommandWithSandboxMacOS({
        command,
        needsNetworkRestriction: true,
        httpProxyPort: undefined,
        socksProxyPort: undefined,
        readConfig: { denyOnly: [] },
        writeConfig: { allowOnly: ['/tmp'], denyWithinAllow: [] },
      });

      expect(result).not.toBe(command);
      expect(result).toContain('sandbox-exec');
    });

    it('needsNetworkRestriction true with proxy allows filtered network on Linux', async () => {
      if (getPlatform() !== 'linux') {
        return;
      }

      const tmpDir = os.tmpdir();
      const httpSocket = path.join(tmpDir, `test-http-${Date.now()}.sock`);
      const socksSocket = path.join(tmpDir, `test-socks-${Date.now()}.sock`);

      fs.writeFileSync(httpSocket, '');
      fs.writeFileSync(socksSocket, '');

      try {
        const result = await wrapCommandWithSandboxLinux({
          command,
          needsNetworkRestriction: true,
          httpSocketPath: httpSocket,
          socksSocketPath: socksSocket,
          httpProxyPort: 3128,
          socksProxyPort: 1080,
          readConfig: { denyOnly: [] },
          writeConfig: { allowOnly: ['/tmp'], denyWithinAllow: [] },
        });

        expect(result).not.toBe(command);
        expect(result).toContain('bwrap');
        expect(result).toContain('--unshare-net');
        expect(result).toContain(httpSocket);
        expect(result).toContain(socksSocket);
      } finally {
        fs.unlinkSync(httpSocket);
        fs.unlinkSync(socksSocket);
      }
    });

    it('needsNetworkRestriction true with proxy allows filtered network on macOS', () => {
      if (getPlatform() !== 'macos') {
        return;
      }

      const result = wrapCommandWithSandboxMacOS({
        command,
        needsNetworkRestriction: true,
        httpProxyPort: 3128,
        socksProxyPort: 1080,
        readConfig: { denyOnly: [] },
        writeConfig: { allowOnly: ['/tmp'], denyWithinAllow: [] },
      });

      expect(result).not.toBe(command);
      expect(result).toContain('sandbox-exec');
      expect(result).toContain('HTTP_PROXY');
      expect(result).toContain('HTTPS_PROXY');
    });
  });
});

describe('empty allowedDomains network blocking (CVE fix)', () => {
  const command = 'curl https://example.com';

  describe('SandboxManager.wrapWithSandbox with empty allowedDomains', () => {
    beforeAll(async () => {
      if (skipIfUnsupportedPlatform()) {
        return;
      }
      await SandboxManager.initialize({
        network: {
          allowedDomains: ['example.com'],
          deniedDomains: [],
        },
        filesystem: {
          denyRead: [],
          allowWrite: ['/tmp'],
          denyWrite: [],
        },
      });
    });

    afterAll(async () => {
      if (skipIfUnsupportedPlatform()) {
        return;
      }
      await SandboxManager.reset();
    });

    it('empty allowedDomains in customConfig triggers network restriction on Linux', async () => {
      if (getPlatform() !== 'linux') {
        return;
      }

      const result = await SandboxManager.wrapWithSandbox(command, undefined, {
        network: {
          allowedDomains: [],
          deniedDomains: [],
        },
        filesystem: {
          denyRead: [],
          allowWrite: ['/tmp'],
          denyWrite: [],
        },
      });

      expect(result).not.toBe(command);
      expect(result).toContain('bwrap');
      expect(result).toContain('--unshare-net');
    });

    it('empty allowedDomains in customConfig triggers network restriction on macOS', async () => {
      if (getPlatform() !== 'macos') {
        return;
      }

      const result = await SandboxManager.wrapWithSandbox(command, undefined, {
        network: {
          allowedDomains: [],
          deniedDomains: [],
        },
        filesystem: {
          denyRead: [],
          allowWrite: ['/tmp'],
          denyWrite: [],
        },
      });

      expect(result).not.toBe(command);
      expect(result).toContain('sandbox-exec');
    });

    it('non-empty allowedDomains still works correctly', async () => {
      if (skipIfUnsupportedPlatform()) {
        return;
      }

      const result = await SandboxManager.wrapWithSandbox(command, undefined, {
        network: {
          allowedDomains: ['example.com'],
          deniedDomains: [],
        },
        filesystem: {
          denyRead: [],
          allowWrite: ['/tmp'],
          denyWrite: [],
        },
      });

      expect(result).not.toBe(command);
      if (SandboxManager.getProxyPort()) {
        expect(result).toContain('HTTP_PROXY');
      }
    });

    it('undefined network config in customConfig falls back to main config', async () => {
      if (skipIfUnsupportedPlatform()) {
        return;
      }

      const result = await SandboxManager.wrapWithSandbox(command, undefined, {
        filesystem: {
          denyRead: [],
          allowWrite: ['/tmp'],
          denyWrite: [],
        },
      });

      expect(result).not.toBe(command);
      if (SandboxManager.getProxyPort()) {
        expect(result).toContain('HTTP_PROXY');
      }
    });
  });
});
