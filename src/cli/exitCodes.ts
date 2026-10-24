/** Exit codes per contracts/cli.md § 2 */
export const EXIT = {
  OK: 0,
  PROVIDER_ERROR: 1,
  USAGE: 2,
  NO_PROVIDER: 3,
  INTERRUPTED: 130,
} as const;
