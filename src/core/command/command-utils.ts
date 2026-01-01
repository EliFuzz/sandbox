export const encodeSandboxedCommand = (command: string): string => {
  const truncatedCommand = command.slice(0, 100);
  return Buffer.from(truncatedCommand).toString('base64');
};

export const decodeSandboxedCommand = (encodedCommand: string): string => {
  return Buffer.from(encodedCommand, 'base64').toString('utf8');
};
