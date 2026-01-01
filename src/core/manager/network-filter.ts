import type { SandboxRuntimeConfig } from '@/core/sandbox/sandbox-config';
import type { SandboxAskCallback } from '@/core/sandbox/sandbox-schemas';
import { logger } from '@/utils/debug';

export const matchesDomainPattern = (
  hostname: string,
  pattern: string
): boolean => {
  if (pattern.startsWith('*.')) {
    const baseDomain = pattern.substring(2);
    return hostname.toLowerCase().endsWith('.' + baseDomain.toLowerCase());
  }
  return hostname.toLowerCase() === pattern.toLowerCase();
};

const isDomainDenied = (
  host: string,
  config: SandboxRuntimeConfig
): boolean => {
  for (const deniedDomain of config.network.deniedDomains) {
    if (matchesDomainPattern(host, deniedDomain)) {
      return true;
    }
  }
  return false;
};

const isDomainAllowed = (
  host: string,
  config: SandboxRuntimeConfig
): boolean => {
  for (const allowedDomain of config.network.allowedDomains) {
    if (matchesDomainPattern(host, allowedDomain)) {
      return true;
    }
  }
  return false;
};

const askUserPermission = async (
  host: string,
  port: number,
  sandboxAskCallback: SandboxAskCallback
): Promise<boolean> => {
  logger.info(`No matching config rule, asking user: ${host}:${port}`);
  try {
    const userAllowed = await sandboxAskCallback({ host, port });
    logger.info(
      userAllowed
        ? `User allowed: ${host}:${port}`
        : `User denied: ${host}:${port}`
    );
    return userAllowed;
  } catch (error) {
    logger.error(`Error in permission callback: ${error}`);
    return false;
  }
};

export const filterNetworkRequest = async (
  port: number,
  host: string,
  config: SandboxRuntimeConfig | undefined,
  sandboxAskCallback?: SandboxAskCallback
): Promise<boolean> => {
  if (!config) {
    logger.info('No config available, denying network request');
    return false;
  }

  if (isDomainDenied(host, config)) {
    logger.info(`Denied by config rule: ${host}:${port}`);
    return false;
  }

  if (isDomainAllowed(host, config)) {
    logger.info(`Allowed by config rule: ${host}:${port}`);
    return true;
  }

  if (!sandboxAskCallback) {
    logger.info(`No matching config rule, denying: ${host}:${port}`);
    return false;
  }

  return askUserPermission(host, port, sandboxAskCallback);
};
