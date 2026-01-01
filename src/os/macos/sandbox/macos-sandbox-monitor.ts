import { decodeSandboxedCommand } from '@/core/command/command-utils';
import type { IgnoreViolationsConfig } from '@/core/sandbox/sandbox-config';
import { sessionSuffix } from '@/os/macos/sandbox/profile-utils';
import { logger } from '@/utils/debug';
import { spawn } from 'node:child_process';

export interface SandboxViolationEvent {
  line: string;
  command?: string;
  encodedCommand?: string;
  timestamp: Date;
}

export type SandboxViolationCallback = (
  violation: SandboxViolationEvent
) => void;

const extractCommand = (
  commandLine: string | undefined
): { command?: string; encodedCommand?: string } => {
  if (!commandLine) return {};
  const cmdMatch = /CMD64_(.+?)_END/.exec(commandLine);
  const encodedCommand = cmdMatch?.[1];
  if (!encodedCommand) return {};
  try {
    const command = decodeSandboxedCommand(encodedCommand);
    return { command, encodedCommand };
  } catch {
    return { encodedCommand };
  }
};

const isIgnoredViolation = (violationDetails: string): boolean =>
  violationDetails.includes('mDNSResponder') ||
  violationDetails.includes('mach-lookup com.apple.diagnosticd') ||
  violationDetails.includes('mach-lookup com.apple.analyticsd');

const checkWildcardIgnore = (
  violationDetails: string,
  ignoreViolations: IgnoreViolationsConfig
): boolean => {
  const wildcardPaths = ignoreViolations['*'] || [];
  return wildcardPaths.some((path) => violationDetails.includes(path));
};

const checkCommandPatterns = (
  violationDetails: string,
  command: string,
  ignoreViolations: IgnoreViolationsConfig
): boolean => {
  const commandPatterns = Object.entries(ignoreViolations).filter(
    ([pattern]) => pattern !== '*'
  );
  for (const [pattern, paths] of commandPatterns) {
    if (command.includes(pattern)) {
      if (paths.some((path) => violationDetails.includes(path))) return true;
    }
  }
  return false;
};

const shouldIgnoreViolation = (
  violationDetails: string,
  command: string | undefined,
  ignoreViolations?: IgnoreViolationsConfig
): boolean => {
  if (!ignoreViolations || !command) return false;
  if (checkWildcardIgnore(violationDetails, ignoreViolations)) return true;
  return checkCommandPatterns(violationDetails, command, ignoreViolations);
};

const processLogData = (
  data: Buffer,
  callback: SandboxViolationCallback,
  ignoreViolations?: IgnoreViolationsConfig
): void => {
  const lines = data.toString().split('\n');
  const violationLine = lines.find(
    (line) => line.includes('Sandbox:') && line.includes('deny')
  );
  const commandLine = lines.find((line) => line.startsWith('CMD64_'));
  if (!violationLine) return;
  const sandboxMatch = /Sandbox:\s+(.+)$/.exec(violationLine);
  if (!sandboxMatch?.[1]) return;
  const violationDetails = sandboxMatch[1];
  const { command, encodedCommand } = extractCommand(commandLine);
  if (isIgnoredViolation(violationDetails)) return;
  if (shouldIgnoreViolation(violationDetails, command, ignoreViolations))
    return;
  callback({
    line: violationDetails,
    command,
    encodedCommand,
    timestamp: new Date(),
  });
};

export const startMacOSSandboxLogMonitor = (
  callback: SandboxViolationCallback,
  ignoreViolations?: IgnoreViolationsConfig
): (() => void) => {
  const logProcess = spawn('log', [
    'stream',
    '--predicate',
    `(eventMessage ENDSWITH "${sessionSuffix}")`,
    '--style',
    'compact',
  ]);

  logProcess.stdout?.on('data', (data: Buffer) => {
    processLogData(data, callback, ignoreViolations);
  });

  logProcess.stderr?.on('data', (data: Buffer) => {
    logger.info(`Log stream stderr: ${data.toString()}`);
  });

  logProcess.on('error', (error: Error) => {
    logger.info(`Failed to start log stream: ${error.message}`);
  });

  logProcess.on('exit', (code: number | null) => {
    logger.info(`Log stream exited with code: ${code}`);
  });

  return () => {
    logger.info('Stopping log monitor');
    logProcess.kill('SIGTERM');
  };
};
