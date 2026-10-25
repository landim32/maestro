import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Session } from '../../../src/session/session.js';
import { bundledAssets } from '../../../src/speckit/assets.js';
import { systemGit } from '../../../src/speckit/git.js';
import { SpecKitService } from '../../../src/speckit/service.js';
import { DECLINED_TEXT } from '../../../src/tools/askUser.js';
import { allTools } from '../../../src/tools/registry.js';
import type { ProviderEvent } from '../../../src/providers/types.js';
import { cleanupSized, tick, waitForFrame } from '../../helpers/renderSized.js';
import { answer, KEYS, mountApp, toolCall } from '../../helpers/appHarness.js';
import { withTempRepo } from '../../helpers/tempRepo.js';
import type { TempRepo } from '../../helpers/tempRepo.js';

let repo: TempRepo;
beforeEach(() => {
  repo = withTempRepo({ git: true, specify: '0.4', commandsDir: '.claude/commands' });
  repo.write('specs/001-demo/spec.md', '# spec\n\n## Clarifications\n');
  repo.write('.specify/feature.json', JSON.stringify({ feature_directory: 'specs/001-demo' }));
});
afterEach(() => {
  cleanupSized();
  repo.cleanup();
});

const question = {
  question: 'Qual o limite de perguntas?',
  header: 'Q1',
  options: [
    { label: 'A (Recommended)', description: 'cinco' },
    { label: 'B', description: 'três' },
  ],
};

function mount(events: ProviderEvent[][]) {
  const session = new Session({ cwd: repo.root, activeProviderId: 'claude' });
  const specKit = new SpecKitService({
    cwd: repo.root,
    env: {},
    git: systemGit,
    assets: bundledAssets(),
  });
  return mountApp({
    columns: 110,
    rows: 34,
    events,
    settings: { tools: { approvalMode: 'auto-edit' } },
    controller: { tools: allTools(), session, specKit },
  });
}

async function send(ui: ReturnType<typeof mount>, text: string) {
  ui.stdin.write(text);
  await tick();
  ui.stdin.write(KEYS.enter);
  await tick();
}

/** spec US2; contracts/speckit-commands.md § 3 */
describe('clarification questions as dialogs (US2)', { timeout: 60_000 }, () => {
  it('/speckit.clarify asks through ask_user, the answer reaches the model and is written to the spec', async () => {
    const ui = mount([
      toolCall('q1', 'ask_user', { questions: [question] }),
      toolCall('w1', 'write_file', {
        path: 'specs/001-demo/spec.md',
        content: '# spec\n\n## Clarifications\n- Q1: B\n',
      }),
      answer('clarificação gravada'),
    ]);
    await waitForFrame(ui, 'Type a message');
    await send(ui, '/speckit.clarify');
    await waitForFrame(ui, 'Pergunta 1 de 1 · [Q1]');
    expect(ui.lastFrame()).toContain('1. A (Recommended)');
    ui.stdin.write(KEYS.digit(2));
    await waitForFrame(ui, 'clarificação gravada');
    const result = ui.provider.requests[1]?.messages.at(-1)?.content[0];
    expect(result?.type === 'tool_result' && result.output).toContain('**Q1**: B');
    expect(repo.read('specs/001-demo/spec.md')).toContain('- Q1: B');
    expect(ui.lastFrame()).toContain('› /speckit.clarify');
    // the prompt the model received carries the ask_user guidance of the preamble
    const sent = ui.provider.requests[0]?.messages[0]?.content[0];
    expect(sent?.type === 'text' && sent.text).toMatch(/ask_user/);
  });

  it('Esc declines: the model is told, the spec stays untouched', async () => {
    const ui = mount([
      toolCall('q1', 'ask_user', { questions: [question] }),
      answer('mantive em aberto'),
    ]);
    await waitForFrame(ui, 'Type a message');
    await send(ui, '/speckit.clarify');
    await waitForFrame(ui, 'Pergunta 1 de 1');
    ui.stdin.write(KEYS.esc);
    await waitForFrame(ui, 'mantive em aberto');
    const result = ui.provider.requests[1]?.messages.at(-1)?.content[0];
    expect(result?.type === 'tool_result' && result.output).toBe(DECLINED_TEXT);
    expect(repo.read('specs/001-demo/spec.md')).toBe('# spec\n\n## Clarifications\n');
  });
});
