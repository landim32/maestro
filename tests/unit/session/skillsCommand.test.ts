/** specs/013 US3: /skills reports the catalogue without calling the model. */
import { describe, expect, it } from 'vitest';
import { SessionController } from '../../../src/session/controller.js';
import type { ControllerSkills } from '../../../src/session/controller.js';
import { Session } from '../../../src/session/session.js';
import { makeCtx } from '../../helpers/context.js';
import { textProvider } from '../../helpers/fakeProvider.js';

const make = (skills?: ControllerSkills) => {
  const fake = textProvider(['nunca']);
  const ctl = new SessionController({
    session: new Session({ cwd: '/p', activeProviderId: 'claude' }),
    ctx: makeCtx({}),
    tools: [],
    system: 'sys',
    interactive: false,
    providerOverride: () => fake,
    skills,
  });
  return { ctl, fake };
};

describe('/skills', () => {
  it('lists the catalogue as an info notice and never calls the provider', async () => {
    const { ctl, fake } = make({
      catalog: {
        skills: [
          {
            name: 'revisao-pr',
            description: 'Checklist de PR',
            source: 'project-claude',
            dir: '/p/.claude/skills/revisao-pr',
            file: '/p/.claude/skills/revisao-pr/SKILL.md',
          },
        ],
        shadowed: [],
        ignored: [],
      },
      state: 'on',
      home: '/h',
    });
    await ctl.submit('/skills');
    expect(fake.requests).toHaveLength(0);
    expect(ctl.notices.at(-1)).toMatchObject({ level: 'info' });
    expect(ctl.notices.at(-1)?.text).toMatch(/^Skills disponíveis \(1\):\n {2}revisao-pr/);
    expect(ctl.commands.some((c) => c.name === 'skills')).toBe(true);
  });

  it('without a catalogue (default) and when disabled', async () => {
    let { ctl } = make();
    await ctl.submit('/skills');
    expect(ctl.notices.at(-1)?.text).toMatch(/^Nenhuma skill encontrada/);
    ({ ctl } = make({
      catalog: { skills: [], shadowed: [], ignored: [] },
      state: 'disabled',
      home: '',
    }));
    await ctl.submit('/skills');
    expect(ctl.notices.at(-1)?.text).toBe('Skills desligadas (skills.enabled: false).');
  });
});
