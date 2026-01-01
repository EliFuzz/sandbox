export interface FsReadRestrictionConfig {
  denyOnly: string[];
}

export interface FsWriteRestrictionConfig {
  allowOnly: string[];
  denyWithinAllow: string[];
}

export interface NetworkRestrictionConfig {
  allowedHosts?: string[];
  deniedHosts?: string[];
}

export type NetworkHostPattern = {
  host: string;
  port: number | undefined;
};

export type SandboxAskCallback = (
  params: NetworkHostPattern,
) => Promise<boolean>;
