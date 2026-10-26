/** specs/013 FR-016: the debug log records skill names and counts, never skill content. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionController } from '../../../src/session/controller.js';
import { Session } from '../../../src/session/session.js';
import { discoverSkills } from '../../../src/skills/catalog.js';
import { toolsFor } from '../../../src/tools/registry.js';
import { createLogger } from '../../../src/utils/logger.js';
import { createFakeProvider } from '../../helpers/fakeProvider.js';
import { makeCtx } from '../../helpers/context.js';

let cwd: string;
let logFile: string;
const SENTINEL = 'SENTINELA-SKILL-123';

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-skills-sec-'));
  logFile = path.join(cwd, 'debug.log');
  const dir = path.join(cwd, '.claude', 'skills', 'padroes');
  fs.mkdirSync(path.join(dir, 'refs'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: padroes\ndescription: d\n---\n${SENTINEL}\n`,
  );
  fs.writeFileSync(path.join(dir, 'refs', 'x.md'), `${SENTINEL}-ref\n`);
});
afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

describe('skills never leak content into the debug log', () => {
  it('skill.load logs name, source, ok and bytes only', async () => {
    const ctx = makeCtx({});
    const catalog = discoverSkills({ cwd, home: path.join(cwd, 'sem-home') });
    const provider = createFakeProvider([
      [
        { type: 'tool_call', callId: 'a', name: 'load_skill', input: { name: 'padroes' } },
        { type: 'done', stopReason: 'tool_use' },
      ],
      [
        {
          type: 'tool_call',
          callId: 'b',
          name: 'load_skill',
          input: { name: 'padroes', file: 'refs/x.md' },
        },
        { type: 'done', stopReason: 'tool_use' },
      ],
      [
        { type: 'text_delta', text: 'ok' },
        { type: 'done', stopReason: 'end_turn' },
      ],
    ]);
    const controller = new SessionController({
      session: new Session({ cwd, activeProviderId: 'claude' }),
      ctx,
      tools: toolsFor(ctx.settings.tools, { skills: catalog }),
      system: 'sys',
      interactive: false,
      providerOverride: () => provider,
      logger: createLogger({ enabled: true, filePath: logFile }),
    });
    await controller.submit('use a skill');
    const log = fs.readFileSync(logFile, 'utf8');
    const loads = log.split('\n').filter((l) => l.includes('"skill.load"'));
    expect(loads).toHaveLength(2);
    expect(loads[1]).toContain('refs/x.md');
    expect(log).not.toContain(SENTINEL);
  });
});
