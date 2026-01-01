#!/usr/bin/env node

import { SandboxManager } from '@/core/manager/sandbox-manager';
import {
  type SandboxRuntimeConfig,
  SandboxRuntimeConfigSchema,
} from '@/core/sandbox/sandbox-config';
import { logger } from '@/utils';
import { Command } from 'commander';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const validateConfig = (
  parsed: unknown,
  filePath: string
): SandboxRuntimeConfig | null => {
  const result = SandboxRuntimeConfigSchema.safeParse(parsed);

  if (!result.success) {
    console.error(`Invalid configuration in ${filePath}:`);
    result.error.issues.forEach((issue) => {
      const path = issue.path.join('.');
      console.error(`  - ${path}: ${issue.message}`);
    });
    return null;
  }

  return result.data;
};

const loadConfig = (filePath: string): SandboxRuntimeConfig | null => {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    if (content.trim() === '') {
      return null;
    }

    const parsed = JSON.parse(content);
    return validateConfig(parsed, filePath);
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error(
        `Invalid JSON in config file ${filePath}: ${error.message}`
      );
    } else {
      console.error(`Failed to load config from ${filePath}: ${error}`);
    }
    return null;
  }
};

const getDefaultConfigPath = (): string => {
  return join(homedir(), '.vsbx-settings.json');
};

const getDefaultConfig = (): SandboxRuntimeConfig => {
  return {
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
};

const getCommand = (
  options: { c?: string },
  commandArgs: string[]
): string | null => {
  if (options.c) {
    const command = options.c;
    logger.info(`Command string mode (-c): ${command}`);
    return command;
  }
  if (commandArgs.length > 0) {
    const command = commandArgs.join(' ');
    logger.info(`Original command: ${command}`);
    return command;
  }
  console.error(
    'Error: No command specified. Use -c <command> or provide command arguments.'
  );
  return null;
};

const runSandboxedProcess = async (command: string): Promise<void> => {
  const sandboxedCommand = await SandboxManager.wrapWithSandbox(command);

  const child = spawn(sandboxedCommand, {
    shell: true,
    stdio: 'inherit',
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      console.error(`Process killed by signal: ${signal}`);
      process.exit(1);
    }
    process.exit(code ?? 0);
  });

  child.on('error', (error) => {
    console.error(`Failed to execute command: ${error.message}`);
    process.exit(1);
  });

  process.on('SIGINT', () => {
    child.kill('SIGINT');
  });

  process.on('SIGTERM', () => {
    child.kill('SIGTERM');
  });
};

const loadRuntimeConfig = (configPath: string): SandboxRuntimeConfig => {
  let runtimeConfig = loadConfig(configPath);
  if (!runtimeConfig) {
    logger.info(`No config found at ${configPath}, using default config`);
    runtimeConfig = getDefaultConfig();
  }
  return runtimeConfig;
};

const runCliAction = async (
  commandArgs: string[],
  options: { settings?: string; c?: string }
): Promise<void> => {
  if (process.env.ENV === 'dev') {
    process.env.DEBUG = 'true';
  }

  const configPath = options.settings || getDefaultConfigPath();
  const runtimeConfig = loadRuntimeConfig(configPath);

  logger.info('Initializing sandbox...');
  await SandboxManager.initialize(runtimeConfig);

  const command = getCommand(options, commandArgs);
  if (!command) {
    process.exit(1);
  }

  logger.info(
    JSON.stringify(SandboxManager.getNetworkRestrictionConfig(), null, 2)
  );

  await runSandboxedProcess(command);
};

const main = async (): Promise<void> => {
  const program = new Command();

  program
    .name('vsbx')
    .description(
      'Run commands in a sandbox with network and filesystem restrictions'
    )
    .version(process.env.npm_package_version || '1.0.0');

  program
    .argument('[command...]', 'command to run in the sandbox')
    .option(
      '-s, --settings <path>',
      'path to config file (default: ~/.vsbx-settings.json)'
    )
    .option('-c <command>', 'run command string directly')
    .allowUnknownOption()
    .action(
      async (
        commandArgs: string[],
        options: { settings?: string; c?: string }
      ) => {
        try {
          await runCliAction(commandArgs, options);
        } catch (error) {
          console.error(
            `Error: ${error instanceof Error ? error.message : String(error)}`
          );
          process.exit(1);
        }
      }
    );

  program.parse();
};

try {
  await main();
} catch (error) {
  console.error('Fatal error:', error);
  process.exit(1);
}
