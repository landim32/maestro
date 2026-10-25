import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Session } from '../../../src/session/session.js';
import { bundledAssets } from '../../../src/speckit/assets.js';
import { systemGit } from '../../../src/speckit/git.js';
import { SpecKitService } from '../../../src/speckit/service.js';
import { allTools } from '../../../src/tools/registry.js';
import { cleanupSized, tick, waitFor, waitForFrame } from '../../helpers/renderSized.js';
import { answer, KEYS, mountApp } from '../../helpers/appHarness.js';
import { withTempRepo } from '../../helpers/tempRepo.js';
import type { TempRepo } from '../../helpers/tempRepo.js';

let repo: TempRepo;
beforeEach(() => {
  repo = withTempRepo({ git: true, specify: '0.4', commandsDir: '.claude/commands' });
  // an existing feature so /speckit.plan passes its preflight
  repo.write('specs/001-demo/spec.md', '# spec');
  repo.write('.specify/feature.json', JSON.stringify({ feature_directory: 'specs/001-demo' }));
});
afterEach(() => {
  cleanupSized();
  repo.cleanup();
});

function mount() {
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
    events: [answer('plano feito'), answer('ok')],
    controller: { tools: allTools(), session, specKit },
  });
}

const promptLines = (ui: ReturnType<typeof mount>) =>
  ui.frameLines().filter((l) => l.includes('/speckit.'));

/** contracts/speckit-commands.md § 4–5 */
describe('Spec Kit in the UI (US1)', { timeout: 60_000 }, () => {
  it('suggests commands while typing "/spec", → completes the first, Enter shows the typed line only', async () => {
    const ui = mount();
    await waitForFrame(ui, 'Type a message');
    ui.stdin.write('/spec');
    await waitForFrame(ui, '/speckit.analyze');
    const lines = promptLines(ui);
    expect(lines.length).toBeGreaterThanOrEqual(6);
    expect(lines.length).toBeLessThanOrEqual(7); // 6 suggestions (+ the typed line itself)
    expect(ui.lastFrame()).toContain('/speckit.checklist');

    ui.stdin.write(KEYS.right);
    await waitForFrame(ui, '› /speckit.analyze');
    // the completed line (no trailing space: analyze takes no arguments) still lists itself only
    ui.stdin.write(' x');
    await tick();
    expect(promptLines(ui).filter((l) => !l.includes('›'))).toHaveLength(0); // suggestions gone once there is a space
    // Enter runs the preflight: analyze needs plan.md + tasks.md → blocked without calling the model
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'plan.md not found');
    expect(ui.provider.requests).toHaveLength(0);

    ui.stdin.write('/speckit.plan');
    await tick();
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'plano feito');
    const frame = ui.lastFrame() ?? '';
    expect(frame).toContain('› /speckit.plan');
    expect(frame).not.toContain('Maestro: how this Spec Kit command runs here');
    expect(ui.provider.requests[0]?.messages[0]?.content[0]).toMatchObject({ type: 'text' });
    const sent = ui.provider.requests[0]?.messages[0]?.content[0];
    expect(sent?.type === 'text' && sent.text).toContain(
      'Maestro: how this Spec Kit command runs here',
    );
  });

  it('/help lists the Spec Kit section with origin and version', async () => {
    const ui = mount();
    await waitForFrame(ui, 'Type a message');
    ui.stdin.write('/help');
    await tick();
    ui.stdin.write(KEYS.enter);
    await waitForFrame(ui, 'Spec Kit (');
    const text = ui.controller.notices.at(-1)?.text ?? '';
    expect(text).toContain('embutido v1.2.3');
    expect(text).toContain('claude: .claude/commands');
    expect(text).toMatch(/\/speckit\.specify <descrição>.*\(claude\)/);
    expect(text).toMatch(/\/speckit\.converge.*\(bundled\)/);
    await waitFor(() => ui.controller.session.state === 'idle', 2000, 'idle');
  });
});
