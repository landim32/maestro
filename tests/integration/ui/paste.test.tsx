import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupSized, tick, waitFor, waitForFrame } from '../../helpers/renderSized.js';
import { KEYS, mountApp } from '../../helpers/appHarness.js';
import { createFakeProvider, textProvider } from '../../helpers/fakeProvider.js';
import type { FakeProvider } from '../../helpers/fakeProvider.js';
import { withTempHome } from '../../helpers/tempHome.js';
import type { TempHome } from '../../helpers/tempHome.js';
import { withTempRepo } from '../../helpers/tempRepo.js';
import type { TempRepo } from '../../helpers/tempRepo.js';
import { fileHistoryStore, InputHistory } from '../../../src/session/history.js';
import type { ContentPart } from '../../../src/providers/types.js';

let home: TempHome;
let repo: TempRepo;
beforeEach(() => {
  home = withTempHome();
  repo = withTempRepo({ git: false });
});
afterEach(() => {
  cleanupSized();
  home.cleanup();
  repo.cleanup();
});

const LINES_42 = Array.from({ length: 42 }, (_, i) => `linha ${i + 1}: conteúdo colado`).join('\n');

function mount(
  opts: { provider?: FakeProvider; images?: boolean; settings?: Record<string, unknown> } = {},
) {
  const base = opts.provider ?? textProvider(['r1', 'r2', 'r3'], { id: 'claude' });
  const provider: FakeProvider = opts.images ? { ...base, capabilities: { images: true } } : base;
  const history = new InputHistory(fileHistoryStore(home.historyPath));
  const ui = mountApp({
    columns: 100,
    rows: 30,
    provider,
    cwd: repo.root,
    settings: opts.settings,
    credentials: { credentials: { claude: 'profile', qwen: 'none' } },
    controller: {
      settingsPaths: { globalPath: home.globalPath, cwd: repo.root },
      env: {},
      history,
    },
  });
  return { ...ui, provider, history };
}

const userText = (p: FakeProvider, i = 0) =>
  (p.requests[i]!.messages[0]!.content.find((c) => c.type === 'text') as { text: string }).text;
const userParts = (p: FakeProvider, i = 0): ContentPart[] => p.requests[i]!.messages[0]!.content;

describe('US1 — large pastes become markers; the model gets the full text (contracts/paste-chips.md)', () => {
  it('collapses, sends the delimited block, shows the label and keeps the content out of history.jsonl', async () => {
    const ui = mount();
    await waitForFrame(ui, 'Type a message');
    ui.stdin.write('explique: ');
    ui.stdin.write(KEYS.paste(LINES_42));
    await tick();
    expect(ui.frameText()).toContain('explique: [Pasted text #1 +42 lines]');
    expect(ui.frameText()).not.toContain('linha 7:');
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'r1');
    expect(ui.provider.requests).toHaveLength(1);
    expect(userText(ui.provider)).toBe(
      `explique: <pasted-text id="1" lines="42">\n${LINES_42}\n</pasted-text>`,
    );
    expect(ui.session.history[0]!.display).toBe('explique: [Pasted text #1 +42 lines]');
    expect(ui.frameText()).toContain('› explique: [Pasted text #1 +42 lines]');
    expect(ui.frameText()).not.toContain('linha 7:');
    // ↑ brings the marker back and re-sends the content
    ui.stdin.write(KEYS.up);
    await tick();
    expect(ui.frameText()).toContain('[Pasted text #1 +42 lines]');
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'r2');
    expect(userText(ui.provider, 1)).toContain('<pasted-text id="1" lines="42">');
    // the same display twice collapses into one history entry (contracts/history.md § 1)
    await waitFor(() => home.readHistory().length === 1, 3000, 'history written');
    const raw = fs.readFileSync(home.historyPath, 'utf8');
    expect(raw).toContain('[Pasted text #1 +42 lines]');
    expect(raw).not.toContain('linha 7:');
  });

  it('a second paste is #2 and a total above attachMaxTotalBytes is refused with a warning', async () => {
    const ui = mount({ settings: { ui: { attachMaxTotalBytes: 1024 } } });
    await waitForFrame(ui, 'Type a message');
    ui.stdin.write(KEYS.paste('a\nb\nc\nd'));
    await tick();
    ui.stdin.write(KEYS.paste(LINES_42));
    await tick();
    expect(ui.frameText()).toContain('[Pasted text #1 +4 lines]');
    expect(ui.frameText()).toContain('[Pasted text #2 +42 lines]');
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'acima do limite (1 KB)');
    expect(ui.provider.requests).toHaveLength(0);
    expect(ui.frameText()).toContain('[Pasted text #2 +42 lines]'); // still in the prompt
  });
});

describe('US2 — pasted file paths become attachments (contracts/attachments.md)', () => {
  it('one path → [Arquivo] marker and a <file> block read at send time', async () => {
    repo.write('x.log', 'erro 1\nerro 2\nerro 3\n');
    const ui = mount();
    await waitForFrame(ui, 'Type a message');
    ui.stdin.write('veja ');
    ui.stdin.write(KEYS.paste(path.join(repo.root, 'x.log')));
    await tick();
    expect(ui.frameText()).toContain('veja [Arquivo: x.log, 3 linhas]');
    // the file changes between paste and send: the sent content is the current one
    repo.write('x.log', 'erro 1\nerro 2\nerro 3\nerro 4\n');
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'r1');
    expect(userText(ui.provider)).toBe(
      'veja <file path="x.log" lines="4">\nerro 1\nerro 2\nerro 3\nerro 4\n\n</file>',
    );
    expect(ui.session.history[0]!.display).toBe('veja [Arquivo: x.log, 3 linhas]');
  });

  it('two quoted paths on two lines → two markers; binary and outside paths stay text with a warning', async () => {
    repo.write('src/a.ts', 'const a = 1;');
    repo.write('a b/notes.md', '# notas\n');
    fs.writeFileSync(path.join(repo.root, 'tool.bin'), Buffer.from([0, 1, 2]));
    const ui = mount();
    await waitForFrame(ui, 'Type a message');
    ui.stdin.write(
      KEYS.paste(
        `"${path.join(repo.root, 'src', 'a.ts')}"\n'${path.join(repo.root, 'a b', 'notes.md')}'`,
      ),
    );
    await tick();
    expect(ui.frameText()).toContain('[Arquivo: a.ts, 1 linhas] [Arquivo: notes.md, 1 linhas]');
    ui.stdin.write(KEYS.ctrlU);
    await tick();
    ui.stdin.write(KEYS.paste(path.join(repo.root, 'tool.bin')));
    await waitForFrame(ui, 'tool.bin parece binário');
    expect(ui.frameText()).toContain('tool.bin');
    expect(ui.frameText()).not.toContain('[Arquivo: tool.bin');
    ui.stdin.write(KEYS.ctrlU);
    await tick();
    ui.stdin.write(KEYS.paste(home.globalPath.replace(/settings\.json$/, '')));
    await tick();
    fs.writeFileSync(path.join(home.home, 'o.txt'), 'fora');
    ui.stdin.write(KEYS.ctrlU);
    ui.stdin.write(KEYS.paste(path.join(home.home, 'o.txt')));
    await waitForFrame(ui, 'o.txt está fora da pasta de trabalho');
    expect(ui.frameText()).not.toContain('[Arquivo: o.txt');
  });

  it('a file deleted before Enter is sent as missing with a warning', async () => {
    repo.write('gone.txt', 'x\n');
    const ui = mount();
    await waitForFrame(ui, 'Type a message');
    ui.stdin.write(KEYS.paste(path.join(repo.root, 'gone.txt')));
    await tick();
    expect(ui.frameText()).toContain('[Arquivo: gone.txt, 1 linhas]');
    fs.rmSync(path.join(repo.root, 'gone.txt'));
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'r1');
    expect(userText(ui.provider)).toContain('<file path="gone.txt" missing="true"/>');
    expect(
      ui.controller.notices.some(
        (n) => n.level === 'warn' && /gone\.txt não existe mais/.test(n.text),
      ),
    ).toBe(true);
  });
});

describe('US4 — images for providers that accept them (contracts/attachments.md § 2–3)', () => {
  const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(100, 1)]);

  it('with image support: [Imagem] marker, base64 part in the message and a textual marker', async () => {
    fs.writeFileSync(path.join(repo.root, 'shot.png'), png());
    const ui = mount({ images: true });
    await waitForFrame(ui, 'Type a message');
    ui.stdin.write('o que há aqui? ');
    ui.stdin.write(KEYS.paste(path.join(repo.root, 'shot.png')));
    await tick();
    expect(ui.frameText()).toContain('o que há aqui? [Imagem: shot.png, 104 B]');
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'r1');
    expect(userText(ui.provider)).toBe('o que há aqui? [Imagem: shot.png]');
    const image = userParts(ui.provider).find((p) => p.type === 'image');
    expect(image).toMatchObject({ type: 'image', mediaType: 'image/png', name: 'shot.png' });
    expect((image as { data: string }).data).toBe(png().toString('base64'));
  });

  it('without image support the path stays text with a warning; an oversized image is refused', async () => {
    fs.writeFileSync(path.join(repo.root, 'shot.png'), png());
    fs.writeFileSync(path.join(repo.root, 'big.png'), Buffer.alloc(3000, 1));
    const ui = mount({ images: false, settings: { ui: { imageMaxBytes: 2048 } } });
    await waitForFrame(ui, 'Type a message');
    ui.stdin.write(KEYS.paste(path.join(repo.root, 'shot.png')));
    await waitForFrame(ui, 'O provedor claude não aceita imagens');
    expect(ui.frameText()).not.toContain('[Imagem:');
    ui.stdin.write(KEYS.ctrlU);
    await tick();
    cleanupSized();
    const ui2 = mount({ images: true, settings: { ui: { imageMaxBytes: 2048 } } });
    await waitForFrame(ui2, 'Type a message');
    ui2.stdin.write(KEYS.paste(path.join(repo.root, 'big.png')));
    await waitForFrame(ui2, 'Imagem big.png (3 KB) acima do limite (2 KB)');
    expect(ui2.frameText()).not.toContain('[Imagem:');
  });

  it('a provider that lost image support drops the part with a warning (chip created earlier)', async () => {
    fs.writeFileSync(path.join(repo.root, 'shot.png'), png());
    const ui = mount({ images: true });
    await waitForFrame(ui, 'Type a message');
    ui.stdin.write(KEYS.paste(path.join(repo.root, 'shot.png')));
    await tick();
    expect(ui.frameText()).toContain('[Imagem: shot.png');
    // the active provider is replaced by one without image support before Enter
    const plain = createFakeProvider([
      [
        { type: 'text_delta', text: 'sem imagem' },
        { type: 'done', stopReason: 'end_turn' },
      ],
    ]);
    (ui.controller as unknown as { provider?: unknown }).provider = plain;
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'sem imagem');
    expect(userParts(plain).some((p) => p.type === 'image')).toBe(false);
    expect(ui.frameText()).toContain('não aceita imagens');
  });
});
