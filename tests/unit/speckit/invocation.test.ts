import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isInvocationError, parseInvocation, tokenize } from '../../../src/speckit/invocation.js';

const root = path.resolve(import.meta.dirname, '../../..');

/** contracts/native-steps.md § 1–2 */
describe('parseInvocation', () => {
  it('tokenizes quotes, escapes and operators', () => {
    expect(tokenize(`a "b c" 'd e' f\\ g && h | i`).map((t) => t.text)).toEqual([
      'a',
      'b c',
      'd e',
      'f g',
      '&&',
      'h',
      '|',
      'i',
    ]);
    expect(tokenize(`x 'I'\\''m Groot'`).map((t) => t.text)).toEqual(['x', "I'm Groot"]);
  });

  it('recognises the PowerShell 0.4.x spellings used by this repository', () => {
    expect(
      parseInvocation(
        '.specify/scripts/powershell/check-prerequisites.ps1 -Json -RequireTasks -IncludeTasks',
      ),
    ).toEqual({
      step: 'check-prerequisites',
      json: true,
      requireTasks: true,
      includeTasks: true,
      requireSpec: undefined,
      pathsOnly: undefined,
      template: undefined,
    });
    expect(
      parseInvocation('.specify/scripts/powershell/check-prerequisites.ps1 -Json -PathsOnly'),
    ).toMatchObject({
      step: 'check-prerequisites',
      json: true,
      pathsOnly: true,
    });
    expect(parseInvocation('.specify/scripts/powershell/setup-plan.ps1 -Json')).toEqual({
      step: 'setup-plan',
      json: true,
    });
    expect(
      parseInvocation('.specify/scripts/powershell/update-agent-context.ps1 -AgentType claude'),
    ).toEqual({
      step: 'update-agent-context',
      agentType: 'claude',
      planPath: undefined,
    });
    expect(
      parseInvocation(
        '.specify/scripts/powershell/create-new-feature.ps1 -Json -ShortName "user-auth" "Add user authentication"',
      ),
    ).toMatchObject({
      step: 'create-feature',
      json: true,
      shortName: 'user-auth',
      description: 'Add user authentication',
    });
  });

  it('recognises the bash and python 1.x spellings, launchers and absolute paths', () => {
    expect(
      parseInvocation(
        'scripts/bash/check-prerequisites.sh --json --require-spec --require-tasks --include-tasks',
      ),
    ).toMatchObject({
      step: 'check-prerequisites',
      json: true,
      requireSpec: true,
      requireTasks: true,
      includeTasks: true,
    });
    expect(parseInvocation('bash .specify/scripts/bash/setup-tasks.sh --json')).toEqual({
      step: 'setup-tasks',
      json: true,
    });
    expect(
      parseInvocation(
        'python3 scripts/python/check_prerequisites.py --json --template tasks-template',
      ),
    ).toMatchObject({
      step: 'check-prerequisites',
      template: 'tasks-template',
    });
    expect(
      parseInvocation(
        'pwsh -NoProfile -File C:\\repo\\.specify\\scripts\\powershell\\setup-plan.ps1 -Json',
      ),
    ).toEqual({
      step: 'setup-plan',
      json: true,
    });
    expect(
      parseInvocation("& '.specify/scripts/powershell/check-prerequisites.ps1' -Json"),
    ).toMatchObject({
      step: 'check-prerequisites',
    });
    expect(
      parseInvocation('cd /repo && ./scripts/bash/resolve-template.sh spec-template --json'),
    ).toEqual({
      step: 'resolve-template',
      name: 'spec-template',
      json: true,
    });
    expect(
      parseInvocation(
        `scripts/bash/create-new-feature.sh --json --short-name 'I'\\''m Groot' 'Add I'\\''m Groot' --timestamp --dry-run`,
      ),
    ).toMatchObject({
      step: 'create-feature',
      shortName: "I'm Groot",
      description: "Add I'm Groot",
      timestamp: true,
      dryRun: true,
    });
  });

  it('leaves ordinary commands and unknown scripts alone; reports unknown options', () => {
    expect(parseInvocation('npm test')).toBeUndefined();
    expect(parseInvocation('git status && npm run lint')).toBeUndefined();
    expect(parseInvocation('.specify/scripts/bash/outro.sh --json')).toBeUndefined();
    expect(parseInvocation('echo scripts/bash/setup-plan.sh')).toBeUndefined();
    const bad = parseInvocation('scripts/bash/setup-plan.sh --bogus');
    expect(bad && isInvocationError(bad)).toBe(true);
    if (bad && isInvocationError(bad)) expect(bad.error).toContain("Unknown option '--bogus'");
    const missing = parseInvocation('scripts/bash/create-new-feature.sh --json --short-name');
    expect(missing && isInvocationError(missing) && missing.error).toMatch(/requires a value/);
  });

  it("parses every script invocation literally written in this repository's command files", () => {
    const dir = path.join(root, '.claude', 'commands');
    let found = 0;
    for (const f of fs.readdirSync(dir)) {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const m of text.matchAll(/`(\.specify\/scripts\/powershell\/[^`]+)`/g)) {
        const req = parseInvocation(m[1]!);
        expect(req, `${f}: ${m[1]}`).toBeDefined();
        expect(req && isInvocationError(req), `${f}: ${m[1]}`).toBe(false);
        found++;
      }
    }
    expect(found).toBeGreaterThanOrEqual(8);
  });
});
