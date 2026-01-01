import type {
  FsReadRestrictionConfig,
  FsWriteRestrictionConfig,
} from '@/core/sandbox/sandbox-schemas';
import { getBaseProfile } from '@/os/macos/sandbox/macos-base-profile';
import {
  generateNetworkRules,
  generatePtyRules,
  generateReadRules,
  generateWriteRules,
  getMandatoryDenyPatterns,
} from '@/os/macos/sandbox/profile-rules';
import { generateLogTag } from '@/os/macos/sandbox/profile-utils';

export {
  generateLogTag,
  getMandatoryDenyPatterns as macGetMandatoryDenyPatterns,
};

export const generateSandboxProfile = ({
  readConfig,
  writeConfig,
  httpProxyPort,
  socksProxyPort,
  needsNetworkRestriction,
  allowUnixSockets,
  allowAllUnixSockets,
  allowLocalBinding,
  allowPty,
  allowGitConfig = false,
  logTag,
}: {
  readConfig: FsReadRestrictionConfig | undefined;
  writeConfig: FsWriteRestrictionConfig | undefined;
  httpProxyPort?: number;
  socksProxyPort?: number;
  needsNetworkRestriction: boolean;
  allowUnixSockets?: string[];
  allowAllUnixSockets?: boolean;
  allowLocalBinding?: boolean;
  allowPty?: boolean;
  allowGitConfig?: boolean;
  logTag: string;
}): string =>
  [
    ...getBaseProfile,
    ...generateNetworkRules(
      needsNetworkRestriction,
      allowLocalBinding,
      allowAllUnixSockets,
      allowUnixSockets,
      httpProxyPort,
      socksProxyPort
    ),
    ...generateReadRules(readConfig, logTag),
    ...generateWriteRules(writeConfig, logTag, allowGitConfig),
    ...(allowPty ? generatePtyRules() : []),
  ].join('\n');
