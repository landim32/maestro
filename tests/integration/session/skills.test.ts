/**
 * specs/013 US1/US3: skills reach the model through load_skill in both tool loops, including a
 * user skill outside the working directory, and nothing changes when the feature is off.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Session } from '../../../src/session/session.js';
import { runTurn } from '../../../src/session/turn.js';
import { buildSystemPrompt } from '../../../src/session/systemPrompt.js';
import { discoverSkills, sessionSkills } from '../../../src/skills/catalog.js';
import { toolsFor } from '../../../src/tools/registry.js';
import type {
  ModelProvider,
  ProviderEvent,
  ProviderRequest,
} from '../../../src/providers/types.js';
import { createFakeProvider } from '../../helpers/fakeProvider.js';
import { makeSettings } from '../../helpers/context.js';

let cwd: string;
let home: string;
const toolSettings = makeSettings().tools;

const skill = (root: string, name: string, body: string) => {
  const dir = path.join(root, '.claude', 'skills', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: d ${name}\n---\n${body}\n`,
  );
  return dir;
};

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-skills-int-'));
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-skills-uhome-'));
  skill(cwd, 'revisao-pr', 'CORPO-DO-PROJETO');
  skill(home, 'commit-msg', 'CORPO-DO-USUARIO');
});
afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

const toolCall = (callId: string, name: string, input: unknown): ProviderEvent[] => [
  { type: 'tool_call', callId, name, input },
  { type: 'done', stopReason: 'tool_use' },
];
const answer = (text: string): ProviderEvent[] => [
  { type: 'text_delta', text },
  { type: 'done', stopReason: 'end_turn' },
];
const resultOf = (s: Session, i: number) => {
  const part = s.history[i]?.content[0];
  return part?.type === 'tool_result' ? part : undefined;
};

describe('load_skill in a turn', () => {
  it('built-in loop: no confirmation in default mode; a user skill outside cwd loads, read_file of it does not', async () => {
    const catalog = discoverSkills({ cwd, home });
    const tools = toolsFor(toolSettings, { skills: catalog });
    const userSkill = path.join(home, '.claude', 'skills', 'commit-msg', 'SKILL.md');
    const s = new Session({ cwd, activeProviderId: 'claude' });
    const confirm = vi.fn(async () => true);
    const p = createFakeProvider([
      toolCall('c1', 'load_skill', { name: 'revisao-pr' }),
      toolCall('c2', 'load_skill', { name: 'commit-msg' }),
      toolCall('c3', 'read_file', { path: userSkill }),
      answer('pronto'),
    ]);
    s.pushUser('revise');
    const r = await runTurn(
      s,
      p,
      { system: 'sys', tools, toolSettings, approvalMode: () => 'default' },
      { confirm },
    );
    expect(r.stopReason).toBe('end_turn');
    expect(confirm).not.toHaveBeenCalled();
    expect(resultOf(s, 2)).toMatchObject({ isError: false });
    expect(resultOf(s, 2)?.output).toContain('CORPO-DO-PROJETO');
    expect(resultOf(s, 4)?.output).toContain('CORPO-DO-USUARIO');
    expect(resultOf(s, 4)?.display?.skill).toMatchObject({ source: 'user', ok: true });
    expect(resultOf(s, 6)).toMatchObject({ isError: true });
    expect(resultOf(s, 6)?.output).toMatch(/outside workspace/);
  });

  it('provider-driven loop: the call goes through runTool and returns the body', async () => {
    const tools = toolsFor(toolSettings, { skills: discoverSkills({ cwd, home }) });
    const results: Array<{ output: string; isError: boolean }> = [];
    const p: ModelProvider = {
      id: 'claude-code',
      displayName: 'driven',
      capabilities: { executesTools: true },
      status: () => ({
        id: 'claude-code',
        displayName: 'driven',
        enabled: true,
        configured: true,
        active: true,
        model: 'm',
        credentialSource: 'cli',
        missing: [],
      }),
      async *stream(req: ProviderRequest) {
        results.push(
          await req.runTool!({ callId: 'k', name: 'load_skill', input: { name: 'revisao-pr' } }),
        );
        yield { type: 'text_delta', text: 'ok' };
        yield { type: 'done', stopReason: 'end_turn' };
      },
    };
    const s = new Session({ cwd, activeProviderId: 'claude-code' });
    s.pushUser('x');
    await runTurn(s, p, { system: 'sys', tools, toolSettings, approvalMode: () => 'default' });
    expect(results[0]).toMatchObject({ isError: false });
    expect(results[0]?.output).toContain('CORPO-DO-PROJETO');
  });
});

describe('feature off (US3, FR-004)', () => {
  it('skills.enabled false or tools disabled: no discovery, no section, no load_skill', () => {
    const discover = vi.fn(discoverSkills);
    for (const settings of [
      { tools: { enabled: true }, skills: { enabled: false } },
      { tools: { enabled: false }, skills: { enabled: true } },
    ]) {
      const { state, catalog } = sessionSkills(settings, { cwd, home }, discover);
      expect(state).toBe(settings.tools.enabled ? 'disabled' : 'no-tools');
      expect(
        toolsFor({ ...toolSettings, ...settings.tools }, { skills: catalog }).map((t) => t.name),
      ).not.toContain('load_skill');
      expect(
        buildSystemPrompt({ cwd, toolsEnabled: settings.tools.enabled, skills: catalog.skills }),
      ).not.toContain('# Skills');
    }
    expect(discover).not.toHaveBeenCalled();
    const on = sessionSkills(
      { tools: { enabled: true }, skills: { enabled: true } },
      { cwd, home },
      discover,
    );
    expect(on.state).toBe('on');
    expect(on.catalog.skills.map((s) => s.name)).toEqual(['revisao-pr', 'commit-msg']);
  });
});
