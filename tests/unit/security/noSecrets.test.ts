import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => import('../../helpers/anthropicMock.js'));
vi.mock('openai', () => import('../../helpers/openaiMock.js'));

import * as anthropic from '../../helpers/anthropicMock.js';
import * as openai from '../../helpers/openaiMock.js';
import { runNonInteractive } from '../../../src/cli/nonInteractive.js';
import { createClaudeProvider } from '../../../src/providers/claude.js';
import { createQwenProvider } from '../../../src/providers/qwen.js';
import { SessionController } from '../../../src/session/controller.js';
import { Session } from '../../../src/session/session.js';
import { createLogger } from '../../../src/utils/logger.js';
import { makeCtx } from '../../helpers/context.js';

const CLAUDE_KEY = 'sk-ant-api03-SUPERSECRETCLAUDE-abcd';
const QWEN_KEY = 'sk-dashscope-SUPERSECRETQWEN-wxyz';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-sec-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function sink() {
  const parts: string[] = [];
  return { write: (s: string) => parts.push(s), text: () => parts.join('') };
}

describe('no secrets leak — /auth dialog', () => {
  it(
    'the typed key never appears in frames, notices, settings log lines or the debug log',
    { timeout: 30_000 },
    async () => {
      const { mountApp, KEYS } = await import('../../helpers/appHarness.js');
      const { waitForFrame, cleanupSized } = await import('../../helpers/renderSized.js');
      const { fakeAntCli } = await import('../../helpers/fakeAnt.js');
      const home = path.join(tmp, 'home');
      const globalPath = path.join(home, '.maestro', 'settings.json');
      const logPath = path.join(tmp, 'debug.log');
      const logger = createLogger({ enabled: true, filePath: logPath, secrets: [QWEN_KEY] });
      const { fileHistoryStore, InputHistory } = await import('../../../src/session/history.js');
      const historyFile = path.join(home, '.maestro', 'history.jsonl');
      const ui = mountApp({
        columns: 100,
        rows: 30,
        credentials: { credentials: { claude: 'env', qwen: 'none' } },
        controller: {
          settingsPaths: { globalPath, cwd: home },
          env: {},
          logger,
          debug: true,
          history: new InputHistory(fileHistoryStore(historyFile, logger)),
          setupDeps: {
            testConnection: async () => ({ ok: true, latencyMs: 1 }),
            ant: fakeAntCli(),
            env: {},
            platform: 'win32',
          },
        },
      });
      try {
        await waitForFrame(ui, 'Type a message');
        ui.stdin.write('/auth qwen');
        await new Promise((r) => setTimeout(r, 30)); // let the prompt state update before Enter
        ui.stdin.write(KEYS.enter);
        await waitForFrame(ui, 'Conectar provedor');
        ui.stdin.write(KEYS.enter);
        await waitForFrame(ui, 'Protocolo');
        ui.stdin.write(KEYS.enter); // OpenAI compatível (default)
        await waitForFrame(ui, 'Endpoint');
        ui.stdin.write(KEYS.enter);
        await waitForFrame(ui, 'Chave de API');
        ui.stdin.write(QWEN_KEY);
        await new Promise((r) => setTimeout(r, 30));
        expect(ui.lastFrame()).not.toContain(QWEN_KEY);
        ui.stdin.write(KEYS.enter);
        await waitForFrame(ui, 'Modelo');
        ui.stdin.write(KEYS.enter);
        await waitForFrame(ui, 'Usar qwen como provedor ativo?');
        ui.stdin.write(KEYS.enter);
        await waitForFrame(ui, 'qwen configurado e ativo');
        const allFrames = ui.stdout.frames.join('\n');
        expect(allFrames).not.toContain(QWEN_KEY);
        expect(ui.controller.notices.map((n) => n.text).join('\n')).not.toContain(QWEN_KEY);
        const log = fs.readFileSync(logPath, 'utf8');
        expect(log).toMatch(/settings\.write/);
        expect(log).not.toContain(QWEN_KEY);
        // the key is stored only in settings.json itself
        expect(fs.readFileSync(globalPath, 'utf8')).toContain(QWEN_KEY);
        // dialog fields never reach the input history; the command itself does (contracts/history.md § 2)
        const history = fs.readFileSync(historyFile, 'utf8');
        expect(history).toContain('/auth qwen');
        expect(history).not.toContain(QWEN_KEY);
      } finally {
        cleanupSized();
      }
    },
  );
});

describe('no secrets leak — ask_user free text', () => {
  it(
    'text typed in "Outro…" reaches the model only; never history.jsonl nor the debug log (FR-018)',
    { timeout: 30_000 },
    async () => {
      const { mountApp, KEYS, toolCall, answer } = await import('../../helpers/appHarness.js');
      const { waitForFrame, cleanupSized, tick } = await import('../../helpers/renderSized.js');
      const { allTools } = await import('../../../src/tools/registry.js');
      const { fileHistoryStore, InputHistory } = await import('../../../src/session/history.js');
      const SECRET = 'segredo-xyz-9876';
      const logPath = path.join(tmp, 'debug.log');
      const historyFile = path.join(tmp, 'history.jsonl');
      const logger = createLogger({ enabled: true, filePath: logPath, secrets: [] });
      const ui = mountApp({
        columns: 100,
        rows: 32,
        events: [
          toolCall('q1', 'ask_user', {
            questions: [
              {
                question: 'Qual token?',
                header: 'Token',
                options: [
                  { label: 'nenhum', description: 'sem token' },
                  { label: 'padrão', description: 'o padrão' },
                ],
              },
            ],
          }),
          answer('recebido'),
        ],
        controller: {
          tools: allTools(),
          logger,
          debug: true,
          history: new InputHistory(fileHistoryStore(historyFile, logger)),
        },
      });
      try {
        await waitForFrame(ui, 'Type a message');
        ui.stdin.write('pergunte o token');
        await tick();
        ui.stdin.write(KEYS.enter);
        await waitForFrame(ui, 'Pergunta 1 de 1 · [Token]');
        ui.stdin.write(KEYS.up); // Outro…
        await waitForFrame(ui, 'Digite sua resposta');
        ui.stdin.write(SECRET);
        await tick();
        ui.stdin.write(KEYS.enter);
        await waitForFrame(ui, 'recebido');
        // the model got it
        const toolMsg = ui.provider.requests[1]?.messages.at(-1);
        expect(JSON.stringify(toolMsg?.content)).toContain(SECRET);
        // the history has the prompt but not the dialog text
        const history = fs.readFileSync(historyFile, 'utf8');
        expect(history).toContain('pergunte o token');
        expect(history).not.toContain(SECRET);
        // the log records counts only
        const log = fs.readFileSync(logPath, 'utf8');
        expect(log).toMatch(/ask_user\.answered/);
        expect(log).toContain('"other":1');
        expect(log).not.toContain(SECRET);
      } finally {
        cleanupSized();
      }
    },
  );
});

describe('no secrets leak', () => {
  it('/model output masks both keys', async () => {
    const ctx = makeCtx(
      { providers: { claude: { apiKey: CLAUDE_KEY }, qwen: { enabled: true, apiKey: QWEN_KEY } } },
      { credentials: { claude: 'config', qwen: 'config' } },
    );
    const controller = new SessionController({
      session: new Session({ cwd: tmp, activeProviderId: 'claude' }),
      ctx,
      tools: [],
      system: 's',
      interactive: false, // textual table (the interactive form opens a dialog)
    });
    await controller.submit('/model');
    const text = controller.notices.map((n) => n.text).join('\n');
    expect(text).toContain('****abcd');
    expect(text).toContain('****wxyz');
    expect(text).not.toContain(CLAUDE_KEY);
    expect(text).not.toContain(QWEN_KEY);
  });

  it('auth errors from both SDKs, stderr output and the debug log never contain the keys', async () => {
    const ctx = makeCtx(
      { providers: { claude: { apiKey: CLAUDE_KEY }, qwen: { enabled: true, apiKey: QWEN_KEY } } },
      { credentials: { claude: 'config', qwen: 'config' }, env: {} },
    );
    const logPath = path.join(tmp, 'debug.log');
    const logger = createLogger({
      enabled: true,
      filePath: logPath,
      secrets: [CLAUDE_KEY, QWEN_KEY],
    });

    anthropic.scriptStreams([
      {
        events: [],
        throwDuring: new anthropic.AuthenticationError(401, `invalid key ${CLAUDE_KEY}`),
      },
    ]);
    openai.scriptCompletions([
      {
        chunks: [],
        rejectWith: new openai.AuthenticationError(401, `Incorrect API key provided: ${QWEN_KEY}`),
      },
    ]);

    for (const [id, provider] of [
      ['claude', createClaudeProvider(ctx)],
      ['qwen', createQwenProvider(ctx)],
    ] as const) {
      const session = new Session({ cwd: tmp, activeProviderId: id });
      const controller = new SessionController({
        session,
        ctx,
        tools: [],
        system: 's',
        interactive: false,
        debug: true,
        logger,
        providerOverride: () => provider,
      });
      const stdout = sink();
      const stderr = sink();
      const code = await runNonInteractive({
        controller,
        prompt: 'hi',
        stdout,
        stderr,
        handleSignals: false,
      });
      expect(code).toBe(1);
      const all = stdout.text() + stderr.text();
      expect(all).toMatch(/authentication failed/);
      expect(all).not.toContain(CLAUDE_KEY);
      expect(all).not.toContain(QWEN_KEY);
    }

    const log = fs.readFileSync(logPath, 'utf8');
    expect(log).toMatch(/turn\.error/);
    expect(log).not.toContain(CLAUDE_KEY);
    expect(log).not.toContain(QWEN_KEY);
    expect(log).toContain('****abcd');
  });
});
