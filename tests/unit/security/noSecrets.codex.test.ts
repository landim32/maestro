/**
 * specs/012 FR-002/FR-015: the Codex provider never forwards OpenAI keys, never puts the bridge
 * token on the command line and never logs content.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCodexProvider } from '../../../src/providers/codex.js';
import { MCP_TOKEN_ENV } from '../../../src/providers/codexStream.js';
import type { ProviderEvent } from '../../../src/providers/types.js';
import { getTool } from '../../../src/tools/registry.js';
import { createLogger } from '../../../src/utils/logger.js';
import { createFakeCodex } from '../../helpers/fakeCodex.js';
import { makeCtx } from '../../helpers/context.js';

const CONTENT = 'CONTEUDO-CONFIDENCIAL-7733';
const KEY = 'sk-proj-NAO-PODE-VAZAR-wxyz';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-sec-cx-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('no secrets leak — Codex provider', () => {
  it('logs events and counts only; no OpenAI key in the child; the token only in its env', async () => {
    const logFile = path.join(tmp, 'debug.log');
    const logger = createLogger({ enabled: true, filePath: logFile });
    let childEnv: NodeJS.ProcessEnv = {};
    let args: string[] = [];
    const fake = createFakeCodex(async (run) => {
      childEnv = run.env;
      args = run.args;
      await run.callTool('read_file', { path: 'x' });
      run.message(`resposta com ${CONTENT}`);
      run.completed();
    });
    const p = createCodexProvider(
      makeCtx(
        { providers: { codex: { enabled: true } } },
        { credentials: { codex: 'cli' }, env: { OPENAI_API_KEY: KEY, CODEX_API_KEY: KEY } },
      ),
      {
        spawn: fake.spawn,
        locate: () => '/usr/bin/codex',
        readVersion: async () => '0.161.0',
        platform: 'linux',
        tmpDir: () => tmp,
        log: (e, d) => logger.log(e, d),
      },
    );
    const events: ProviderEvent[] = [];
    for await (const ev of p.stream({
      messages: [
        {
          id: '1',
          role: 'user',
          content: [{ type: 'text', text: CONTENT }],
          createdAt: new Date(),
        },
      ],
      system: `sys ${CONTENT}`,
      tools: [getTool('read_file')!],
      signal: new AbortController().signal,
      runTool: async () => ({ output: CONTENT, isError: false }),
    }))
      events.push(ev);
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' });
    const log = fs.readFileSync(logFile, 'utf8');
    expect(log).toContain('codex.start');
    expect(log).toContain('codex.exit');
    expect(log).not.toContain(CONTENT);
    expect(JSON.stringify(childEnv)).not.toContain(KEY);
    const token = childEnv[MCP_TOKEN_ENV]!;
    expect(token).toMatch(/^[0-9a-f]{48}$/);
    expect(args.join(' ')).not.toContain(token);
    expect(log).not.toContain(token);
  });
});
