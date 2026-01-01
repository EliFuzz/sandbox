import { z } from 'zod';

const validateWildcardDomain = (domain: string): boolean => {
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) {
    return false;
  }

  const parts = domain.split('.');
  return parts.length >= 2 && parts.every((p) => p.length > 0);
};

const validateDomainPattern = (val: string): boolean => {
  if (val.includes('://') || val.includes('/') || val.includes(':')) {
    return false;
  }

  if (val === 'localhost') return true;

  if (val.startsWith('*.')) {
    const domain = val.slice(2);
    return validateWildcardDomain(domain);
  }

  if (val.includes('*')) {
    return false;
  }

  return val.includes('.') && !val.startsWith('.') && !val.endsWith('.');
};

const domainPatternSchema = z.string().refine(validateDomainPattern, {
  message: 'Invalid domain pattern. Allowed: "example.com", "*.example.com")',
});

const filesystemPathSchema = z.string().min(1, 'Path cannot be empty');

export const NetworkConfigSchema = z.object({
  allowedDomains: z
    .array(domainPatternSchema)
    .describe('Domains to allow access to (e.g., github.com, *.npmjs.org)'),
  deniedDomains: z
    .array(domainPatternSchema)
    .describe('Domains to deny access to'),
  allowUnixSockets: z
    .array(z.string())
    .optional()
    .describe('Unix socket paths to allow (macOS only)'),
  allowAllUnixSockets: z
    .boolean()
    .optional()
    .describe('Allow all Unix sockets (Linux only)'),
  allowLocalBinding: z
    .boolean()
    .optional()
    .describe('Allow binding to local ports (default: false)'),
  httpProxyPort: z
    .number()
    .int()
    .min(1)
    .max(65535)
    .optional()
    .describe('External HTTP proxy port to use'),
  socksProxyPort: z
    .number()
    .int()
    .min(1)
    .max(65535)
    .optional()
    .describe('External SOCKS proxy port to use'),
});

export const FilesystemConfigSchema = z.object({
  denyRead: z
    .array(filesystemPathSchema)
    .describe('Paths to deny reading from'),
  allowWrite: z
    .array(filesystemPathSchema)
    .describe('Paths to allow writing to'),
  denyWrite: z
    .array(filesystemPathSchema)
    .describe('Paths to deny writing to (overrides allowWrite)'),
  allowGitConfig: z
    .boolean()
    .optional()
    .describe('Allow writes to .git/config (default: false)'),
});

export const IgnoreViolationsConfigSchema = z
  .record(z.string(), z.array(z.string()))
  .describe('Command patterns and paths to ignore violations for');

export const RipgrepConfigSchema = z.object({
  command: z.string().describe('Ripgrep command to execute (e.g., rg, vsbx)'),
  args: z
    .array(z.string())
    .optional()
    .describe('Additional args before ripgrep args'),
});

export const SandboxRuntimeConfigSchema = z.object({
  network: NetworkConfigSchema.describe('Configure network restrictions'),
  filesystem: FilesystemConfigSchema.describe(
    'Configure filesystem restrictions'
  ),
  ignoreViolations: IgnoreViolationsConfigSchema.optional().describe(
    'Configure violations to ignore'
  ),
  enableWeakerNestedSandbox: z
    .boolean()
    .optional()
    .describe('Enable weaker sandbox for Docker'),
  ripgrep: RipgrepConfigSchema.optional().describe(
    'Configure custom ripgrep (default: rg)'
  ),
  mandatoryDenySearchDepth: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe('Max depth to search for dangerous files (Linux, default: 3)'),
  allowPty: z
    .boolean()
    .optional()
    .describe('Allow PTY operations (macOS only)'),
});

export type NetworkConfig = z.infer<typeof NetworkConfigSchema>;
export type FilesystemConfig = z.infer<typeof FilesystemConfigSchema>;
export type IgnoreViolationsConfig = z.infer<
  typeof IgnoreViolationsConfigSchema
>;
export type RipgrepConfig = z.infer<typeof RipgrepConfigSchema>;
export type SandboxRuntimeConfig = z.infer<typeof SandboxRuntimeConfigSchema>;
