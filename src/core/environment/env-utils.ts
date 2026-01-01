import { getPlatform } from '@/utils';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const getDefaultWritePaths = (): string[] => {
  const homeDir = homedir();
  return [
    '/dev/stdout',
    '/dev/stderr',
    '/dev/null',
    '/dev/tty',
    '/dev/dtracehelper',
    '/dev/autofs_nowait',
    '/tmp/vsbx',
    '/private/tmp/vsbx',
    join(homeDir, '.npm/_logs'),
    join(homeDir, '.vsbx/debug'),
  ];
};

const addNoProxyVars = (envVars: string[]): void => {
  const noProxyAddresses = [
    'localhost',
    '127.0.0.1',
    '::1',
    '*.local',
    '.local',
    '169.254.0.0/16',
    '10.0.0.0/8',
    '172.16.0.0/12',
    '192.168.0.0/16',
  ].join(',');

  envVars.push(`NO_PROXY=${noProxyAddresses}`, `no_proxy=${noProxyAddresses}`);
};

const addHttpProxyVars = (envVars: string[], httpProxyPort: number): void => {
  const httpProxy = `http://localhost:${httpProxyPort}`;
  envVars.push(
    `HTTP_PROXY=${httpProxy}`,
    `HTTPS_PROXY=${httpProxy}`,
    `http_proxy=${httpProxy}`,
    `https_proxy=${httpProxy}`
  );
};

const addSocksProxyVars = (
  envVars: string[],
  socksProxyPort: number,
  httpProxyPort?: number
): void => {
  const socksProxy = `socks5h://localhost:${socksProxyPort}`;
  envVars.push(`ALL_PROXY=${socksProxy}`, `all_proxy=${socksProxy}`);

  if (getPlatform() === 'macos') {
    envVars.push(
      `GIT_SSH_COMMAND=ssh -o ProxyCommand='nc -X 5 -x localhost:${socksProxyPort} %h %p'`
    );
  }

  envVars.push(
    `FTP_PROXY=${socksProxy}`,
    `ftp_proxy=${socksProxy}`,
    `RSYNC_PROXY=localhost:${socksProxyPort}`,
    `GRPC_PROXY=${socksProxy}`,
    `grpc_proxy=${socksProxy}`
  );

  if (httpProxyPort) {
    const httpProxy = `http://localhost:${httpProxyPort}`;
    envVars.push(
      `DOCKER_HTTP_PROXY=${httpProxy}`,
      `DOCKER_HTTPS_PROXY=${httpProxy}`
    );
  }
};

export const generateProxyEnvVars = (
  httpProxyPort?: number,
  socksProxyPort?: number
): string[] => {
  const envVars: string[] = ['SANDBOX=1', 'TMPDIR=/tmp/vsbx'];

  if (!httpProxyPort && !socksProxyPort) return envVars;

  addNoProxyVars(envVars);

  if (httpProxyPort) {
    addHttpProxyVars(envVars, httpProxyPort);
  }

  if (socksProxyPort) {
    addSocksProxyVars(envVars, socksProxyPort, httpProxyPort);
  }

  return envVars;
};
