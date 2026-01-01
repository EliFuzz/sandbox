import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

function getCliPath(): string {
  return join(process.cwd(), 'src', 'core', 'cli', 'cli.ts');
}

function runCli(
  args: string[],
  options?: { input?: string; env?: Record<string, string> }
) {
  const result = spawnSync('bun', ['run', getCliPath(), ...args], {
    encoding: 'utf-8',
    input: options?.input,
    env: {
      ...process.env,
      HOME: '/tmp/cli-test-nonexistent',
      ...options?.env,
    },
  });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status,
  };
}

describe('CLI', () => {
  describe('-c flag', () => {
    test('executes simple command', () => {
      const result = runCli(['-c', 'echo hello']);
      expect(result.stdout.trim()).toBe('hello');
      expect(result.status).toBe(0);
    });

    test('passes command string without escaping', () => {
      const result = runCli(['-c', 'echo "hello world"']);
      expect(result.stdout.trim()).toBe('hello world');
      expect(result.status).toBe(0);
    });

    test('handles JSON arguments', () => {
      const result = runCli(['-c', 'echo \'{"key": "value"}\'']);
      expect(result.stdout.trim()).toBe('{"key": "value"}');
      expect(result.status).toBe(0);
    });

    test('handles nested JSON objects', () => {
      const json = '{"servers":{"name":"test","type":"sdk"}}';
      const result = runCli(['-c', `echo '${json}'`]);
      expect(result.stdout.trim()).toBe(json);
      expect(result.status).toBe(0);
    });

    test('handles shell expansion', () => {
      const result = runCli(['-c', 'echo $HOME']);
      expect(result.stdout.trim()).not.toBe('$HOME');
      expect(result.status).toBe(0);
    });

    test('handles pipes', () => {
      const result = runCli(['-c', 'echo "hello world" | wc -w']);
      expect(result.stdout.trim()).toBe('2');
      expect(result.status).toBe(0);
    });

    test('handles command substitution', () => {
      const result = runCli(['-c', 'echo "count: $(echo 1 2 3 | wc -w)"']);
      expect(result.stdout.trim()).toContain('3');
      expect(result.status).toBe(0);
    });
  });

  describe('positional arguments', () => {
    test('executes simple command', () => {
      const result = runCli(['echo', 'hello']);
      expect(result.stdout.trim()).toBe('hello');
      expect(result.status).toBe(0);
    });

    test('joins multiple arguments', () => {
      const result = runCli(['echo', 'hello', 'world']);
      expect(result.stdout.trim()).toBe('hello world');
      expect(result.status).toBe(0);
    });

    test('handles arguments with flags', () => {
      const result = runCli(['echo', '-n', 'no newline']);
      expect(result.stdout).toBe('no newline');
      expect(result.status).toBe(0);
    });
  });

  describe('error handling', () => {
    test('shows error when no command', () => {
      const result = runCli([]);
      expect(result.stderr).toContain('No command specified');
      expect(result.status).toBe(1);
    });
  });

  describe('debug output', () => {
    test('ENV=dev enables debug for positional args', () => {
      const result = runCli(['echo', 'test'], { env: { ENV: 'dev' } });
      expect(result.stderr).toContain('Original command');
      expect(result.status).toBe(0);
    });

    test('ENV=dev enables debug for -c mode', () => {
      const result = runCli(['-c', 'echo test'], { env: { ENV: 'dev' } });
      expect(result.stderr).toContain('Command string mode');
      expect(result.status).toBe(0);
    });

    test('no debug output without ENV=dev', () => {
      const result = runCli(['echo', 'test']);
      expect(result.status).toBe(0);
    });
  });
});
