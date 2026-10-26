import { describe, expect, it } from 'vitest';
import { createCodexCli, parseLoginStatus } from '../../../src/setup/codexCli.js';

describe('codexCli (specs/012 research R9)', () => {
  it('parses `codex login status`, keeping only the method', () => {
    expect(parseLoginStatus('Logged in using ChatGPT\n')).toEqual({
      loggedIn: true,
      method: 'chatgpt',
    });
    const key = parseLoginStatus('Logged in using an API key - sk-proj-ABCDEF***WXYZ\n');
    expect(key).toEqual({ loggedIn: true, method: 'api-key' });
    expect(JSON.stringify(key)).not.toMatch(/sk-|ABCDEF|WXYZ/);
    expect(parseLoginStatus('Logged in using access token')).toEqual({
      loggedIn: true,
      method: 'other',
    });
    expect(parseLoginStatus('Not logged in')).toEqual({ loggedIn: false });
    expect(parseLoginStatus('???')).toHaveProperty('error');
  });

  it('runs only `--version` and `login status` (never a login); .cmd shims go through the shell', async () => {
    const seen: Array<{ args: string[]; shell: unknown }> = [];
    const cli = createCodexCli({
      platform: 'win32',
      env: {},
      execFile: ((
        _f: string,
        args: string[],
        o: { shell?: unknown },
        cb: (e: null, out: string, err: string) => void,
      ) => {
        seen.push({ args, shell: o.shell });
        cb(null, args[0] === '--version' ? 'codex-cli 0.161.0\n' : '', 'Logged in using ChatGPT\n');
      }) as never,
    });
    expect(await cli.readVersion('C:/npm/codex.cmd')).toBe('0.161.0');
    expect(await cli.readLoginStatus('C:/bin/codex.exe')).toEqual({
      loggedIn: true,
      method: 'chatgpt',
    });
    expect(seen).toEqual([
      { args: ['--version'], shell: true },
      { args: ['login', 'status'], shell: false },
    ]);
  });

  it('a failing status command never echoes its output (it may contain part of a key)', async () => {
    const cli = createCodexCli({
      platform: 'linux',
      env: {},
      execFile: ((_f: string, _a: string[], _o: unknown, cb: (e: Error, out: string) => void) => {
        cb(
          Object.assign(new Error('Command failed: sk-proj-LEAK'), { code: 'EPERM' }),
          'boom sk-proj-LEAK',
        );
      }) as never,
    });
    const r = await cli.readLoginStatus('/bin/codex');
    expect(r).toEqual({ error: 'não foi possível consultar o Codex (EPERM)' });
  });
});
