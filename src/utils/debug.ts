export const logger = {
  info: (message: string) =>
    process.env.ENV === 'dev' && console.error(message),
  warn: (message: string) =>
    process.env.ENV === 'dev' && console.error(message),
  error: (message: string) =>
    process.env.ENV === 'dev' && console.error(message),
};
