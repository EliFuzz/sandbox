export type Platform = 'macos' | 'linux' | 'windows' | 'unknown';

export const getPlatform = (): Platform => {
  switch (process.platform) {
    case 'darwin':
      return 'macos';
    case 'linux':
      return 'linux';
    case 'win32':
      return 'windows';
    default:
      return 'unknown';
  }
};
