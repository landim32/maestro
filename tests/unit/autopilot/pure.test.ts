/** specs/011 — pure modules of the autopilot: stories, gates, questions, decider, log, report, resume. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  looksLikePath,
  parseStories,
  PROMPT_TITLE_MAX,
  promptStoriesFile,
  sectionLikeTitles,
  specifyText,
} from '../../../src/autopilot/stories.js';
import {
  countTasks,
  openTaskLines,
  criticalCount,
  evaluateGate,
  MAX_ANSWERS,
} from '../../../src/autopilot/gates.js';
import type { DiskView, GateSnapshot } from '../../../src/autopilot/gates.js';
import { detectQuestion } from '../../../src/autopilot/questions.js';
import {
  buildOptionsRequest,
  createDecider,
  DeciderError,
  matchOption,
  parseOptionsDecision,
  parseTextDecision,
  recommendedOf,
  toDecisionOptions,
} from '../../../src/autopilot/decider.js';
import { renderDecisions, rewriteProtected } from '../../../src/autopilot/log.js';
import { formatReport, statusText } from '../../../src/autopilot/report.js';
import { checkResume, resumeBranch } from '../../../src/autopilot/resume.js';
import { readRunState, writeRunState } from '../../../src/autopilot/state.js';
import { emptyStory } from '../../../src/autopilot/types.js';
import type { Decision, Run } from '../../../src/autopilot/types.js';
import { textProvider } from '../../helpers/fakeProvider.js';

const tmp: string[] = [];
afterEach(() => {
  for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const mkTmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-unit-'));
  tmp.push(d);
  return d;
};

describe('parseStories (contracts/stories-file.md)', () => {
  it('one story per ## heading; preamble shared; level-3 headings stay in the body', () => {
    const r = parseStories(
      '# Backlog\nContexto comum.\n\n## Login\nComo usuário…\n### Critérios\n- a\n\n## Export\nCSV\n',
    );
    expect(Array.isArray(r)).toBe(true);
    const s = r as Exclude<typeof r, { error: string }>;
    expect(s.map((x) => x.title)).toEqual(['Login', 'Export']);
    expect(s[0]!.body).toContain('### Critérios');
    expect(s[0]!.body).toContain('Contexto do backlog:\nContexto comum.');
    expect(s[0]!.body).not.toContain('# Backlog');
    expect(s[0]!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(specifyText(s[1]!)).toMatch(/^Export\n\nCSV/);
  });
  it('a file without ## is one story; empty file and empty stories are refused', () => {
    const one = parseStories('Quero exportar CSV.\nDetalhes.\n') as Array<{ title: string }>;
    expect(one).toHaveLength(1);
    expect(one[0]!.title).toBe('Quero exportar CSV.');
    expect(parseStories('\n  \n')).toEqual({ error: 'arquivo vazio' });
    expect(parseStories('## A\n\n## B\nok\n')).toEqual({ error: 'história sem descrição: A' });
  });
});

const view = (over: Partial<DiskView> = {}): DiskView => ({
  featureDirs: [],
  spec: { exists: false },
  plan: { exists: false },
  tasks: { exists: false },
  openTasks: 0,
  doneTasks: 0,
  ...over,
});
const snap = (over: Partial<GateSnapshot>): GateSnapshot => ({
  step: 'plan',
  before: view(),
  after: view(),
  branch: '001-x',
  hasGit: true,
  text: 'ok',
  stopReason: 'end_turn',
  ...over,
});
const fresh = { answers: 0, attempts: 0 };

describe('gates (contracts/gates.md § 2)', () => {
  it('specify: a resumed step may keep the feature this story created, and only that one', () => {
    const existing = snap({
      step: 'specify',
      before: view({ feature: '006-x', featureDirs: ['006-x'] }),
      after: view({ feature: '006-x', featureDirs: ['006-x'], spec: { exists: true } }),
      branch: '006-x',
    });
    const resumed = { ...fresh, resumed: true };
    expect(evaluateGate({ ...existing, claimed: '006-x' }, fresh).kind).toBe('stop');
    expect(evaluateGate({ ...existing, claimed: '006-x' }, resumed).kind).toBe('advance');
    expect(evaluateGate(existing, resumed).kind).toBe('stop');
    expect(evaluateGate({ ...existing, claimed: '005-y' }, resumed).kind).toBe('stop');
  });

  it('interruptions, errors and preflight come first', () => {
    expect(evaluateGate(snap({ stopReason: 'cancelled' }), fresh).kind).toBe('interrupted');
    expect(
      evaluateGate(snap({ stopReason: 'error', errorCategory: 'rate_limit' }), fresh).kind,
    ).toBe('interrupted');
    expect(evaluateGate(snap({ stopReason: 'error', errorCategory: 'auth' }), fresh)).toMatchObject(
      {
        kind: 'stop',
        reason: 'erro no turno (auth)',
      },
    );
    expect(evaluateGate(snap({ blocked: 'ERROR: tasks.md not found' }), fresh)).toEqual({
      kind: 'stop',
      reason: 'ERROR: tasks.md not found',
    });
  });
  it('a text question is answered at most MAX_ANSWERS times', () => {
    const q = snap({ text: 'Do you want to proceed with implementation anyway? (yes/no)' });
    expect(evaluateGate(q, fresh).kind).toBe('question');
    expect(evaluateGate(q, { answers: MAX_ANSWERS, attempts: 0 }).kind).toBe('stop');
  });
  it('artifact gates of specify, clarify, plan and tasks', () => {
    const specOk = snap({
      step: 'specify',
      before: view({ featureDirs: ['001-old'] }),
      after: view({
        featureDirs: ['001-old', '002-x'],
        feature: '002-x',
        spec: { exists: true, hash: 'a' },
      }),
      branch: '002-x',
    });
    expect(evaluateGate(specOk, fresh)).toMatchObject({ kind: 'advance', reason: 'feature 002-x' });
    expect(evaluateGate({ ...specOk, branch: 'main' }, fresh).kind).toBe('stop');
    expect(
      evaluateGate({ ...specOk, after: { ...specOk.after, feature: '001-old' } }, fresh).kind,
    ).toBe('stop');
    expect(
      evaluateGate(snap({ step: 'clarify', after: view({ spec: { exists: true } }) }), fresh).kind,
    ).toBe('advance');
    const plan = { exists: true, hash: 'p1' };
    expect(evaluateGate(snap({ after: view({ plan }) }), fresh).kind).toBe('advance');
    expect(evaluateGate(snap({ before: view({ plan }), after: view({ plan }) }), fresh).kind).toBe(
      'stop',
    );
    expect(evaluateGate(snap({ step: 'tasks', after: view({ openTasks: 2 }) }), fresh).kind).toBe(
      'advance',
    );
    expect(evaluateGate(snap({ step: 'tasks' }), fresh).kind).toBe('stop');
  });
  it('analyze: metric first, then the table; one fix, then stop', () => {
    expect(criticalCount('- Critical Issues Count: 2')).toBe(2);
    expect(
      criticalCount(
        '| ID | Category | Severity |\n|---|---|---|\n| C1 | Constitution | CRITICAL | spec |\n| A1 | x | HIGH |',
      ),
    ).toBe(1);
    expect(criticalCount('- **CRITICAL**: Violates constitution MUST')).toBe(0);
    const a = (text: string) => snap({ step: 'analyze', text });
    expect(evaluateGate(a('Critical Issues Count: 0'), fresh).kind).toBe('advance');
    expect(evaluateGate(a('Critical Issues Count: 3'), fresh).kind).toBe('fix');
    expect(evaluateGate(a('Critical Issues Count: 3'), { answers: 0, attempts: 1 })).toMatchObject({
      kind: 'stop',
      reason: '3 achados CRITICAL depois da correção',
    });
  });
  it('implement: done, progress → continue, no progress → reminders, then stop', () => {
    const i = (b: number, open: number, done: number) =>
      snap({
        step: 'implement',
        before: view({ doneTasks: b }),
        after: view({ openTasks: open, doneTasks: done }),
      });
    expect(evaluateGate(i(1, 0, 3), fresh).kind).toBe('advance');
    expect(evaluateGate(i(0, 2, 1), fresh)).toMatchObject({
      kind: 'continue',
      reason: '1/3 tarefas',
    });
    expect(evaluateGate(i(1, 2, 1), fresh)).toMatchObject({
      kind: 'nudge',
      reason: 'nenhuma tarefa marcada (1/3)',
    });
    expect(evaluateGate(i(1, 2, 1), { answers: 0, attempts: 1 }).kind).toBe('nudge');
    expect(evaluateGate(i(1, 2, 1), { answers: 0, attempts: 2 })).toMatchObject({
      kind: 'stop',
      reason: 'sem progresso (1/3 tarefas) depois de 2 lembretes',
    });
  });
  it('looksLikePath and promptStoriesFile: a prompt is always one story', () => {
    expect(looksLikePath('historias.md')).toBe(true);
    expect(looksLikePath('docs/historias')).toBe(true);
    expect(looksLikePath('docs\x5chistorias')).toBe(true);
    expect(looksLikePath('crie um CRUD de clientes')).toBe(false);
    expect(looksLikePath('CRUD')).toBe(false);
    expect(looksLikePath('  ')).toBe(false);
    const file = promptStoriesFile('# Clientes\r\nQuero um CRUD.\n\n## Regras\nnome obrigatório\n');
    const one = parseStories(file) as Array<{ title: string; body: string }>;
    expect(one).toHaveLength(1);
    expect(one[0]!.title).toBe('Clientes');
    expect(one[0]!.body).toContain('### Clientes\nQuero um CRUD.\n\n### Regras\nnome obrigatório');
    const long = promptStoriesFile('palavra '.repeat(30));
    const title = (parseStories(long) as Array<{ title: string }>)[0]!.title;
    expect(title.length).toBe(PROMPT_TITLE_MAX);
    expect(title.endsWith('…')).toBe(true);
  });
  it('promptStoriesFile drops the pasted-text wrapper and never takes a tag as the title', () => {
    const pasted =
      '<pasted-text id="2" lines="2">\nAlterar o login:\n- e-mail e senha\n</pasted-text>';
    expect(promptStoriesFile(pasted)).toBe(
      '## Alterar o login:\n\nAlterar o login:\n- e-mail e senha\n',
    );
    const withFile = promptStoriesFile('<file path="a.md">\nconteúdo\n</file>');
    expect(withFile.startsWith('## conteúdo\n')).toBe(true);
  });
  it('sectionLikeTitles: one story split in "## " sections vs real stories', () => {
    const doc = parseStories(
      '# HU 002\n\n## 1. História\nquero ver pedidos\n\n## 2. Contexto e objetivo\nx\n\n## 3. Escopo\ny\n\n## 8. Riscos\nz\n',
    );
    expect(Array.isArray(doc) && sectionLikeTitles(doc)).toEqual([
      '1. História',
      '2. Contexto e objetivo',
      '3. Escopo',
      '8. Riscos',
    ]);
    const real = parseStories('## Login\nentrar\n\n## Exportar CSV\ncsv\n\n## 3. Relatório\nr\n');
    expect(Array.isArray(real) && sectionLikeTitles(real)).toEqual([]);
  });
  it('countTasks', () => {
    expect(countTasks('- [ ] T001 a\n- [X] T002 b\n* [x] T003 c\n- [ ] sem id\n')).toEqual({
      open: 1,
      done: 2,
    });
  });
  it('openTaskLines', () => {
    expect(openTaskLines('- [ ] T001 a\r\n  - [X] T002 b\n  * [ ] T003 c\n- [ ] sem id\n')).toEqual(
      ['- [ ] T001 a', '* [ ] T003 c'],
    );
  });
});

describe('detectQuestion (contracts/gates.md § 3)', () => {
  it('recognises the Spec Kit questions and ignores rhetorical ones', () => {
    expect(
      detectQuestion('Resumo.\n\nDo you want to proceed with implementation anyway? (yes/no)'),
    ).toMatch(/yes\/no/);
    expect(detectQuestion('Feito.\n\nDeseja que eu rode os testes agora?')).toBe(
      'Deseja que eu rode os testes agora?',
    );
    expect(detectQuestion('Continue? [y/N]')).toBe('Continue? [y/N]');
    expect(detectQuestion('**Your choice**: _[Wait for user response]_')).toBeDefined();
    expect(
      detectQuestion('Por que isso funciona? Porque o cache…\n\nPronto, implementado.'),
    ).toBeUndefined();
    expect(detectQuestion('Tudo pronto.')).toBeUndefined();
    expect(detectQuestion('O que mudou?')).toBeUndefined(); // ends in ? but does not address the user
  });
});

describe('decider (contracts/decisions.md)', () => {
  const opts = [
    { label: 'Postgres (Recommended)', description: 'padrão do projeto' },
    { label: 'SQLite', description: 'mais simples' },
  ];
  it('recommended option and request text', () => {
    expect(recommendedOf(opts)).toBe('Postgres (Recommended)');
    expect(recommendedOf([{ label: 'A', description: 'opção recomendada' }])).toBe('A');
    const dopts = toDecisionOptions(opts);
    const req = buildOptionsRequest(
      { storyTitle: 'Login', storyBody: 'quero entrar', step: 'clarify', spec: 'x'.repeat(5000) },
      { question: 'Banco?', options: dopts, multi: false },
    );
    expect(req).toContain('1. Postgres (Recommended) — padrão do projeto [recomendada]');
    expect(req).toContain('(1 a 2)');
    expect(req).toContain('Responda: {"choice"');
    expect(req.length).toBeLessThan(4400);
  });
  it('matchOption: the same option written another way; the error shows the answer', () => {
    const lettered = toDecisionOptions([
      { label: 'A: Manter o Google (Recommended)', description: 'menor escopo' },
      { label: 'B: Remover o Google', description: 'mais escopo' },
    ]);
    const m = (c: string) => matchOption(c, lettered);
    expect(m('A: Manter o Google (Recommended)')).toBe('A: Manter o Google (Recommended)');
    expect(m('A: Manter o Google')).toBe('A: Manter o Google (Recommended)');
    expect(m('"**B: Remover o Google.**"')).toBe('B: Remover o Google');
    expect(m('B')).toBe('B: Remover o Google');
    expect(m('Opção B')).toBe('B: Remover o Google');
    expect(m('Q2: A')).toBe('A: Manter o Google (Recommended)');
    expect(m('B: Remover')).toBe('B: Remover o Google');
    expect(m('C')).toBeUndefined();
    expect(m('Outra coisa')).toBeUndefined();
    const plain = toDecisionOptions(opts);
    expect(matchOption('Postgres', plain)).toBe('Postgres (Recommended)');
    expect(matchOption('2', plain)).toBe('SQLite');
    expect(matchOption('b)', plain)).toBe('SQLite');
    expect(matchOption('Po', plain)).toBeUndefined();
    expect(parseOptionsDecision('{"choice": "MySQL", "rationale": "x"}', plain, false)).toEqual({
      ok: false,
      error: 'escolha fora das opções ("MySQL")',
    });
  });
  it('createDecider: numbered answer; the retry says what was wrong; failure keeps the answers', async () => {
    const q = {
      question: 'Quem pode criar conta?',
      options: [
        { label: 'A: Cadastro aberto (Recommended)', description: 'qualquer e-mail' },
        { label: 'B: Restrito', description: 'lista ou convite' },
      ],
      multi: false,
    };
    const c = { storyTitle: 'Login', storyBody: 'quero entrar', step: 'specify' as const };
    const make = (texts: string[]) => {
      const fake = textProvider(texts);
      const decider = createDecider({
        target: () => ({ provider: fake }),
        meta: () => ({ story: 1, at: 'agora' }),
        signal: () => new AbortController().signal,
      });
      return { fake, decider };
    };
    const first = make([
      '{"choice": "Aberta", "rationale": "padrão"}',
      '{"choice": 1, "rationale": "padrão"}',
    ]);
    const d = await first.decider.options(c, q);
    expect(d.choice).toBe('A: Cadastro aberto (Recommended)');
    const second = JSON.stringify(first.fake.requests[1]!.messages);
    expect(second).toContain('Sua resposta anterior não serviu: escolha fora das opções');
    expect(second).toContain('(1 a 2)');
    const { decider } = make(['{"choice": "Aberta", "rationale": "x"}', 'não sei']);
    const err = await decider.options(c, q).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DeciderError);
    expect((err as DeciderError).detail).toEqual({
      question: 'Quem pode criar conta?',
      options: ['A: Cadastro aberto (Recommended)', 'B: Restrito'],
      answers: ['{"choice": "Aberta", "rationale": "x"}', 'não sei'],
    });
  });
  it('parses and validates the JSON answer', () => {
    const dopts = toDecisionOptions(opts);
    expect(
      parseOptionsDecision(
        '```json\n{"choice": " sqlite ", "rationale": "Menor."}\n```',
        dopts,
        false,
      ),
    ).toEqual({
      ok: true,
      choice: 'SQLite',
      rationale: 'Menor.',
    });
    expect(parseOptionsDecision('{"choice": "MySQL", "rationale": "x"}', dopts, false)).toEqual({
      ok: false,
      error: 'escolha fora das opções ("MySQL")',
    });
    expect(
      parseOptionsDecision('{"choice": "SQLite", "rationale": ""}', dopts, false),
    ).toMatchObject({ ok: false });
    expect(parseOptionsDecision('sem json', dopts, false)).toEqual({
      ok: false,
      error: 'resposta sem JSON',
    });
    expect(
      parseOptionsDecision(
        '{"choices": ["SQLite","Postgres (Recommended)"], "rationale": "ambos"}',
        dopts,
        true,
      ),
    ).toMatchObject({
      ok: true,
      choice: ['SQLite', 'Postgres (Recommended)'],
    });
    expect(parseOptionsDecision('{"choices": [], "rationale": "x"}', dopts, true)).toMatchObject({
      ok: false,
    });
    expect(parseTextDecision('{"answer":"yes","rationale":"segue"}')).toMatchObject({
      ok: true,
      choice: 'yes',
    });
  });
});

const dec = (over: Partial<Decision> = {}): Decision => ({
  at: '2026-10-25T21:34:00.000Z',
  story: 1,
  feature: '012-login',
  step: 'clarify',
  kind: 'options',
  question: 'Qual provedor?',
  options: toDecisionOptions([
    { label: 'Google (Recommended)', description: '' },
    { label: 'Auth0', description: '' },
  ]),
  choice: 'Auth0',
  rationale: 'Pedido explícito.',
  followedRecommendation: false,
  provider: 'claude-code',
  model: 'claude-opus-5-5',
  ...over,
});

function baseRun(over: Partial<Run> = {}): Run {
  return {
    version: 1,
    id: '20261025-213000',
    input: 'historias.md',
    inputHash: 'h',
    baseBranch: 'main',
    status: 'done',
    pid: 1,
    startedAt: '2026-10-25T21:30:00.000Z',
    stories: [
      { ...emptyStory({ title: 'Login', hash: 'a' }), feature: '012-login', branch: '012-login' },
    ],
    ...over,
  };
}

describe('decision log (contracts/decisions.md § 3)', () => {
  it('renders the Markdown, with the warning when the recommendation was not followed', () => {
    const md = renderDecisions('012-login', baseRun(), 1, [dec()]);
    expect(md).toContain('# Decisões do autopiloto — 012-login');
    expect(md).toContain('## clarify · 2026-10-25 21:34');
    expect(md).toContain('**Opções:** Google (Recommended) (recomendada) · Auth0');
    expect(md).toContain('**Atenção:** a opção recomendada era Google (Recommended)');
    expect(md).toContain('_claude-code / claude-opus-5-5_');
    const resumed = renderDecisions(
      '012-login',
      baseRun(),
      1,
      [dec({ step: 'implement' })],
      '# antigo\n',
    );
    expect(resumed.startsWith('# antigo\n\n## implement')).toBe(true);
  });
  it('rewriteProtected discards model edits of the protected files', () => {
    const root = mkTmp();
    fs.mkdirSync(path.join(root, 'specs', '012-login'), { recursive: true });
    fs.writeFileSync(path.join(root, 'specs', '012-login', 'decisions.md'), 'editado pelo modelo');
    rewriteProtected(root, baseRun(), 1, [dec()]);
    expect(
      fs.readFileSync(path.join(root, 'specs', '012-login', 'decisions.md'), 'utf8'),
    ).toContain('Qual provedor?');
    rewriteProtected(root, baseRun(), 1, []);
    expect(fs.existsSync(path.join(root, 'specs', '012-login', 'decisions.md'))).toBe(false);
    expect(readRunState(root)).toMatchObject({ id: '20261025-213000' });
  });
});

describe('state file (contracts/state-file.md)', () => {
  it('round trip, unknown version and invalid fields', () => {
    const root = mkTmp();
    writeRunState(root, baseRun());
    expect(readRunState(root)).toEqual(baseRun());
    fs.writeFileSync(path.join(root, '.specify', 'autopilot.json'), '{"version":2}');
    expect(readRunState(root)).toEqual({
      error: 'Estado do autopiloto em formato desconhecido (versão 2).',
    });
    fs.writeFileSync(
      path.join(root, '.specify', 'autopilot.json'),
      JSON.stringify({ ...baseRun(), extra: 1 }),
    );
    expect(readRunState(root)).toHaveProperty('error');
    expect(readRunState(mkTmp())).toBeUndefined();
  });
});

describe('report (contracts/autopilot-cli.md § 3)', () => {
  it('done story, stopped story with the last lines, resume hint', () => {
    const run = baseRun({
      status: 'stopped',
      stopped: {
        story: 2,
        step: 'verify',
        reason: 'npm test falhou depois de 3 tentativas de correção',
      },
    });
    run.stories[0]!.status = 'done';
    run.stories[0]!.pr = { url: 'https://x/pull/12', number: 12 };
    run.stories.push({
      ...emptyStory({ title: 'Export', hash: 'b' }),
      feature: '013-export',
      status: 'stopped',
    });
    run.stories.push(emptyStory({ title: 'Seção solta', hash: 'c' }));
    const open = Array.from({ length: 12 }, (_, i) => `- [ ] T${String(i + 1).padStart(3, '0')} x`);
    const text = formatReport(run, {
      decisions: { 1: 4 },
      decisionFiles: { 1: 'specs/012-login/decisions.md', 2: 'specs/013-export/decisions.md' },
      openTasks: { 1: [], 2: open },
      jsonl: '.maestro/autopilot/x.jsonl',
      lastOutput: 'FAIL a.test.js',
    });
    const lines = text.split('\n');
    expect(lines[0]).toBe('Autopiloto 20261025-213000 · historias.md · base main');
    expect(lines[1]).toMatch(/^✓ 1\. 012-login · 0 turnos · 0s · 4 decisões$/);
    expect(lines.slice(3, 6)).toEqual([
      '    PR: https://x/pull/12',
      '  - Nenhuma tarefa em aberto',
      'Decisões: specs/012-login/decisions.md',
    ]);
    expect(lines[6]).toBe(
      '✗ 2. 013-export · parou em verify: npm test falhou depois de 3 tentativas de correção',
    );
    expect(text).toContain('      FAIL a.test.js');
    const from = lines.indexOf('  - Tarefas em aberto:');
    expect(lines.slice(from + 1, from + 11)).toEqual(open.slice(0, 10).map((t) => `  ${t}`));
    expect(lines.slice(from + 11, from + 13)).toEqual([
      '  - … mais 2 (veja o tasks.md)',
      'Decisões: specs/013-export/decisions.md',
    ]);
    // stories not started yet stay out of the report
    expect(text).not.toContain('Seção solta');
    expect(lines.slice(-3, -1)).toEqual(['---', 'Registro: .maestro/autopilot/x.jsonl']);
    expect(text).toContain('Retomar: /autopilot --resume');
    expect(statusText(run)).toMatch(/stopped · 1\/3 histórias concluídas/);
    expect(statusText(undefined)).toBe('Nenhuma execução do autopiloto neste projeto.');
  });
});

describe('resume checks (contracts/state-file.md § 3)', () => {
  const deps = (over: Partial<Parameters<typeof checkResume>[2]> = {}) => ({
    branchExists: () => true,
    isAncestor: () => true,
    isPidAlive: () => false,
    ownPid: 99,
    ...over,
  });
  const interrupted = () => {
    const r = baseRun({ status: 'interrupted' });
    r.stories[0]!.status = 'running';
    r.stories[0]!.steps.specify = { ...r.stories[0]!.steps.specify, status: 'done', sha: 'abc' };
    return r;
  };
  const input = { hash: 'h2', stories: [{ index: 1, title: 'Login', body: 'x', hash: 'a' }] };
  it('accepts a consistent run and appends new stories', () => {
    const out = checkResume(
      interrupted(),
      { ...input, stories: [...input.stories, { index: 2, title: 'Novo', body: 'y', hash: 'n' }] },
      deps(),
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.run.stories.map((s) => s.title)).toEqual(['Login', 'Novo']);
      expect(out.run.pid).toBe(99);
    }
  });
  it('refuses: live owner, missing branch, rewritten history, edited story, finished run', () => {
    const active = { ...interrupted(), status: 'active' as const, pid: 5 };
    expect(checkResume(active, input, deps({ isPidAlive: () => true }))).toMatchObject({
      ok: false,
    });
    expect(checkResume(active, input, deps({ isPidAlive: () => false })).ok).toBe(true);
    expect(checkResume(interrupted(), input, deps({ branchExists: () => false }))).toMatchObject({
      ok: false,
    });
    expect(checkResume(interrupted(), input, deps({ isAncestor: () => false }))).toMatchObject({
      ok: false,
    });
    expect(
      checkResume(
        interrupted(),
        { ...input, stories: [{ ...input.stories[0]!, hash: 'mudou' }] },
        deps(),
      ),
    ).toMatchObject({ ok: false });
    expect(checkResume(baseRun(), input, deps())).toMatchObject({ ok: false });
  });
  it('resumeBranch: current story, else previous, else base', () => {
    const r = interrupted();
    expect(resumeBranch(r)).toBe('012-login');
    r.stories[0]!.branch = undefined;
    expect(resumeBranch(r)).toBe('main');
  });
});
