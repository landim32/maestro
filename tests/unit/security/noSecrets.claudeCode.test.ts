/**
 * specs/010 FR-002/FR-016: the Claude Code provider never forwards API keys, never logs content,
 * and `/auth` → Claude Code never logs the account e-mail.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClaudeCodeProvider } from '../../../src/providers/claudeCode.js';
import type { ProviderEvent } from '../../../src/providers/types.js';
import { getTool } from '../../../src/tools/registry.js';

const readFileTool = getTool('read_file')!;
import { createLogger } from '../../../src/utils/logger.js';
import { createFakeClaudeCode } from '../../helpers/fakeClaudeCode.js';
import { makeCtx } from '../../helpers/context.js';

const CONTENT = 'CONTEUDO-CONFIDENCIAL-9911';
const KEY = 'sk-ant-api03-NAO-PODE-VAZAR-abcd';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-sec-cc-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('no secrets leak — Claude Code provider', () => {
  it('logs events and counts only; API keys are not passed to the child', async () => {
    const logFile = path.join(tmp, 'debug.log');
    const logger = createLogger({ enabled: true, filePath: logFile });
    let childEnv: NodeJS.ProcessEnv = {};
    const fake = createFakeClaudeCode(async (run) => {
      childEnv = run.env;
      await run.callTool('read_file', { path: 'x' });
      run.text(`resposta com ${CONTENT}`);
      run.result();
    });
    const p = createClaudeCodeProvider(
      makeCtx(
        { providers: { 'claude-code': { enabled: true } } },
        { credentials: { 'claude-code': 'cli' }, env: { ANTHROPIC_API_KEY: KEY } },
      ),
      {
        spawn: fake.spawn,
        locate: () => '/usr/bin/claude',
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
      tools: [readFileTool],
      signal: new AbortController().signal,
      runTool: async () => ({ output: CONTENT, isError: false }),
    }))
      events.push(ev);
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' });
    const log = fs.readFileSync(logFile, 'utf8');
    expect(log).toContain('claudecode.start');
    expect(log).toContain('claudecode.exit');
    expect(log).not.toContain(CONTENT);
    expect(JSON.stringify(childEnv)).not.toContain(KEY);
  });
});
