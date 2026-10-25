/**
 * @license
 * Portions adapted from qwen-code (https://github.com/QwenLM/qwen-code),
 * packages/core/src/tools/askUserQuestion.ts @ 1c9cdd234fd9a391cac146e2d4c834d603afd045.
 * Copyright 2025 Qwen Team. Copyright 2025 Google LLC.
 * SPDX-License-Identifier: Apache-2.0
 * Modified for Maestro; see THIRD_PARTY_NOTICES.md.
 */

import { z } from 'zod';
import type { AskUserAnswer, AskUserQuestion, ToolDefinition } from './types.js';

export const MAX_QUESTIONS = 4;
export const MAX_OPTIONS = 4;
export const MIN_OPTIONS = 2;
export const MAX_HEADER_LENGTH = 12;

const nonEmpty = (what: string) => z.string().trim().min(1, `${what} must be a non-empty string`);

const optionSchema = z.strictObject({
  label: nonEmpty('"label"').describe('Short label of the choice, shown to the user.'),
  description: nonEmpty('"description"').describe('One line explaining what choosing it means.'),
});

const questionSchema = z.strictObject({
  question: nonEmpty('"question"').describe('The complete question to ask the user.'),
  header: nonEmpty('"header"')
    .max(MAX_HEADER_LENGTH, `"header" must have at most ${MAX_HEADER_LENGTH} characters`)
    .describe(`Very short label shown as a tag (max ${MAX_HEADER_LENGTH} chars).`),
  options: z
    .array(optionSchema)
    .min(MIN_OPTIONS, `"options" must contain between ${MIN_OPTIONS} and ${MAX_OPTIONS} options`)
    .max(MAX_OPTIONS, `"options" must contain between ${MIN_OPTIONS} and ${MAX_OPTIONS} options`)
    .superRefine((options, ctx) => {
      const seen = new Set<string>();
      for (const o of options) {
        const key = o.label.toLowerCase();
        if (seen.has(key)) {
          ctx.addIssue({ code: 'custom', message: `duplicate option label '${o.label}'` });
          return;
        }
        seen.add(key);
      }
    })
    .describe('The choices offered; the user can always pick "Other" and type a free answer.'),
  // Optional (not `.default`) so the JSON Schema sent to the model keeps it non-required.
  multiSelect: z
    .boolean()
    .optional()
    .describe('Allow the user to select several options (default false).'),
});

export const askUserInputSchema = z.strictObject({
  questions: z
    .array(questionSchema)
    .min(1, `"questions" must contain between 1 and ${MAX_QUESTIONS} questions`)
    .max(MAX_QUESTIONS, `"questions" must contain between 1 and ${MAX_QUESTIONS} questions`)
    .describe('Questions to ask, answered one at a time.'),
});

export type AskUserInput = z.infer<typeof askUserInputSchema>;

/** Fills the `multiSelect` default so the dialog and the formatter see a complete question. */
export function normalizeQuestions(questions: AskUserInput['questions']): AskUserQuestion[] {
  return questions.map((q) => ({ ...q, multiSelect: q.multiSelect ?? false }));
}

export const DECLINED_TEXT = 'User declined to answer the questions.';
export const NO_USER_TEXT =
  'Cannot ask the user: no interactive user is available (non-interactive mode). Proceed with your best judgement and state the assumption.';
const ANSWERS_HEADER = 'User has provided the following answers:';

export const ASK_USER_DESCRIPTION = [
  'Use this tool when you need a decision from the user to continue: choosing an approach, picking a file, confirming an understanding, learning a preference.',
  "Do not use it to approve file writes or commands — those are handled by the user's approval mode.",
  'Offer concrete, mutually exclusive options with a short description each; the user can always select "Other" to type a free answer.',
  'Set multiSelect: true when several answers may apply.',
  'If you recommend an option, make it the first one and append "(Recommended)" to its label.',
  'Ask at most a few questions per call; the user answers them one at a time and you receive all answers together.',
].join(' ');

/** One answer as text: chosen labels joined with ", " or the free text. */
export function answerText(answer: AskUserAnswer): string {
  return answer.kind === 'other' ? answer.text : answer.labels.join(', ');
}

/** Result sent back to the model (contracts/ask-user.md § 4), same shape as qwen-code's. */
export function formatAnswers(questions: AskUserQuestion[], answers: AskUserAnswer[]): string {
  const lines = questions.map((q, i) => {
    const a = answers[i];
    const header = q.header || `Question ${i + 1}`;
    return `**${header}**: ${a ? answerText(a) : '(no answer)'}`;
  });
  return `${ANSWERS_HEADER}\n\n${lines.join('\n')}`;
}

export const askUserTool: ToolDefinition<AskUserInput> = {
  name: 'ask_user',
  description: ASK_USER_DESCRIPTION,
  inputSchema: askUserInputSchema,
  kind: 'question',
  async run(input, ctx) {
    if (!ctx.ask) return { isError: false, output: NO_USER_TEXT };
    const questions = normalizeQuestions(input.questions);
    const outcome = await ctx.ask({ questions });
    if (!outcome.answered) return { isError: false, output: DECLINED_TEXT };
    return { isError: false, output: formatAnswers(questions, outcome.answers) };
  },
};
