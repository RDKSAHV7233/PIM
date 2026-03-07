/**
 * Logger — no-ops in production. RULE R13: never console.log in production paths.
 */
const isDev = process.env.NODE_ENV === 'development'

export const logger = {
  info:  (...args: unknown[]) => isDev && console.info('[PIM1]', ...args),
  warn:  (...args: unknown[]) => isDev && console.warn('[PIM1]', ...args),
  error: (...args: unknown[]) => console.error('[PIM1]', ...args), // keep errors in prod for Sentry
}
