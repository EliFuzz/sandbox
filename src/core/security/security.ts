export const DANGEROUS_FILES = [
  '.gitconfig',
  '.gitmodules',
  '.bashrc',
  '.bash_profile',
  '.zshrc',
  '.zprofile',
  '.profile',
  '.ripgreprc',
  '.mcp.json',
] as const;

export const DANGEROUS_DIRECTORIES = ['.git', '.vscode', '.idea'] as const;

export const getDangerousDirectories = (): string[] => {
  return [
    ...DANGEROUS_DIRECTORIES.filter((d) => d !== '.git'),
    '.vsbx/commands',
    '.vsbx/agents',
  ];
};

export const normalizeCaseForComparison = (pathStr: string): string => {
  return pathStr.toLowerCase();
};
