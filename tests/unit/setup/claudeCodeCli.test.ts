import { describe, expect, it } from 'vitest';
import {
  createClaudeCodeCli,
  isSubscriptionLogin,
  maskEmail,
  parseAuthStatus,
} from '../../../src/setup/claudeCodeCli.js';

describe('claudeCodeCli (specs/010 research R8)', () => {
  it('parses `claude auth status` and masks the e-mail', () => {
    const s = parseAuthStatus(
      JSON.stringify({
        loggedIn: true,
        authMethod: 'claude.ai',
        email: 'rodrigo@example.com',
        orgId: 'x',
      }),
    );
    expect(s).toEqual({ loggedIn: true, authMethod: 'claude.ai', maskedEmail: 'r***@example.com' });
    expect(JSON.stringify(s)).not.toContain('rodrigo');
    expect(isSubscriptionLogin(s as never)).toBe(true);
    expect(isSubscriptionLogin({ loggedIn: true, authMethod: 'api_key' })).toBe(false);
    expect(isSubscriptionLogin({ loggedIn: false, authMethod: 'claude.ai' })).toBe(false);
  });
  it('tolerates text before the JSON and rejects garbage', () => {
    expect(parseAuthStatus('warning\n{"loggedIn":false}')).toEqual({
      loggedIn: false,
      authMethod: undefined,
      maskedEmail: undefined,
    });
    expect(parseAuthStatus('nope')).toHaveProperty('error');
    expect(parseAuthStatus('{broken')).toHaveProperty('error');
  });
  it('maskEmail hides everything that does not look like an e-mail', () => {
    expect(maskEmail(undefined)).toBeUndefined();
    expect(maskEmail('abc')).toBe('***');
  });
  it('readStatus runs only `auth status` (never a login)', async () => {
    const seen: string[][] = [];
    const cli = createClaudeCodeCli({
      platform: 'linux',
      env: {},
      execFile: ((_f: string, args: string[], _o: unknown, cb: (e: null, out: string) => void) => {
        seen.push(args);
        cb(null, '{"loggedIn":true,"authMethod":"claude.ai"}');
      }) as never,
    });
    expect(await cli.readStatus('/bin/claude')).toMatchObject({ loggedIn: true });
    expect(seen).toEqual([['auth', 'status']]);
  });
});
