import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  ASK_USER_DESCRIPTION,
  askUserInputSchema,
  askUserTool,
  DECLINED_TEXT,
  formatAnswers,
  NO_USER_TEXT,
  normalizeQuestions,
} from '../../../src/tools/askUser.js';
import type { AskUserQuestion, ToolContext } from '../../../src/tools/types.js';
import { makeSettings } from '../../helpers/context.js';

const ctx = (ask?: ToolContext['ask']): ToolContext => ({
  cwd: '/w',
  signal: new AbortController().signal,
  settings: makeSettings().tools,
  ask,
});

const q = (over: Partial<AskUserQuestion> = {}): AskUserQuestion => ({
  question: 'Qual banco?',
  header: 'Banco',
  options: [
    { label: 'Postgres (Recommended)', description: 'relacional' },
    { label: 'SQLite', description: 'arquivo local' },
  ],
  multiSelect: false,
  ...over,
});

/** contracts/ask-user.md § 1 */
describe('ask_user input schema', () => {
  it('generates a JSON schema with the item bounds and no additional properties', () => {
    const js = z.toJSONSchema(askUserInputSchema) as Record<string, unknown>;
    expect(js['additionalProperties']).toBe(false);
    const questions = (js['properties'] as Record<string, Record<string, unknown>>)['questions']!;
    expect(questions).toMatchObject({ type: 'array', minItems: 1, maxItems: 4 });
    const item = questions['items'] as Record<string, unknown>;
    expect(item['additionalProperties']).toBe(false);
    expect(item['required']).toEqual(['question', 'header', 'options']);
    const props = item['properties'] as Record<string, Record<string, unknown>>;
    expect(props['header']).toMatchObject({ type: 'string', maxLength: 12 });
    expect(props['options']).toMatchObject({ type: 'array', minItems: 2, maxItems: 4 });
    expect(props['multiSelect']).toMatchObject({ type: 'boolean' });
  });

  it('accepts a valid call without multiSelect; normalizeQuestions fills false', () => {
    const r = askUserInputSchema.safeParse({ questions: [{ ...q(), multiSelect: undefined }] });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.questions[0]?.multiSelect).toBeUndefined();
      expect(normalizeQuestions(r.data.questions)[0]?.multiSelect).toBe(false);
    }
  });

  it.each([
    ['no questions', { questions: [] }, /between 1 and 4 questions/],
    ['five questions', { questions: [q(), q(), q(), q(), q()] }, /between 1 and 4 questions/],
    ['one option', { questions: [q({ options: [q().options[0]!] })] }, /between 2 and 4 options/],
    [
      'five options',
      {
        questions: [
          q({
            options: ['a', 'b', 'c', 'd', 'e'].map((l) => ({ label: l, description: l })),
          }),
        ],
      },
      /between 2 and 4 options/,
    ],
    ['long header', { questions: [q({ header: 'ABCDEFGHIJKLM' })] }, /at most 12 characters/],
    ['blank question', { questions: [q({ question: '   ' })] }, /"question" must be a non-empty/],
    [
      'duplicate labels',
      {
        questions: [
          q({
            options: [
              { label: 'X', description: 'a' },
              { label: 'x', description: 'b' },
            ],
          }),
        ],
      },
      /duplicate option label 'x'/,
    ],
    ['unknown field', { questions: [q()], extra: 1 }, /unrecognized|Unrecognized/],
  ])('rejects %s', (_name, input, message) => {
    const r = askUserInputSchema.safeParse(input);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.message).join('\n')).toMatch(message);
  });
});

/** contracts/ask-user.md § 2, § 4 */
describe('ask_user tool', () => {
  it('describes itself to the model with the qwen-code guidance', () => {
    expect(askUserTool.name).toBe('ask_user');
    expect(askUserTool.kind).toBe('question');
    expect(ASK_USER_DESCRIPTION).toContain('"Other"');
    expect(ASK_USER_DESCRIPTION).toContain('(Recommended)');
    expect(ASK_USER_DESCRIPTION).toContain('multiSelect: true');
    expect(ASK_USER_DESCRIPTION).toMatch(/approval mode/);
  });

  it('formats single, multiple and free-text answers per question header', () => {
    const questions = [q(), q({ header: 'Extras', multiSelect: true }), q({ header: 'Nome' })];
    expect(
      formatAnswers(questions, [
        { kind: 'options', labels: ['SQLite'] },
        { kind: 'options', labels: ['a', 'b'] },
        { kind: 'other', text: 'meu-projeto' },
      ]),
    ).toBe(
      'User has provided the following answers:\n\n**Banco**: SQLite\n**Extras**: a, b\n**Nome**: meu-projeto',
    );
  });

  it('without ctx.ask (non-interactive) returns the no-user text as a non-error result', async () => {
    const r = await askUserTool.run({ questions: [q()] }, ctx());
    expect(r).toEqual({ isError: false, output: NO_USER_TEXT });
  });

  it('with ctx.ask forwards the questions and formats the outcome; declined is not an error', async () => {
    const ask = vi.fn(async () => ({
      answered: true as const,
      answers: [{ kind: 'options' as const, labels: ['Postgres (Recommended)'] }],
    }));
    const r = await askUserTool.run({ questions: [q()] }, ctx(ask));
    expect(ask).toHaveBeenCalledWith({ questions: [q()] });
    expect(r.isError).toBe(false);
    expect(r.output).toContain('**Banco**: Postgres (Recommended)');

    const declined = await askUserTool.run(
      { questions: [q()] },
      ctx(async () => ({ answered: false })),
    );
    expect(declined).toEqual({ isError: false, output: DECLINED_TEXT });
  });
});
