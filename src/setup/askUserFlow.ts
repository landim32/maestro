/**
 * @license
 * Portions adapted from qwen-code (https://github.com/QwenLM/qwen-code),
 * packages/cli/src/ui/components/messages/AskUserQuestionDialog.tsx
 * @ 1c9cdd234fd9a391cac146e2d4c834d603afd045.
 * Copyright 2025 Qwen Team. Copyright 2025 Google LLC.
 * SPDX-License-Identifier: Apache-2.0
 * Modified for Maestro; see THIRD_PARTY_NOTICES.md.
 */

import type { AskUserAnswer, AskUserQuestion } from '../tools/types.js';

/**
 * Pure reducer for the `ask_user` dialog (specs/005 data-model.md § 4): one question at a time,
 * ↑/↓ or digits select, Space marks in multi-select, "Outro…" takes free text, Esc cancels all.
 */
export type AskUserFlowState =
  | {
      step: 'question';
      index: number;
      questions: AskUserQuestion[];
      answers: AskUserAnswer[];
      /** 0..options.length — the last index is the "Outro…" row. */
      selected: number;
      checked: boolean[];
      other: string;
      error?: string;
    }
  | { step: 'done'; answers: AskUserAnswer[] }
  | { step: 'cancelled' };

export type AskUserKey =
  | { type: 'up' }
  | { type: 'down' }
  | { type: 'enter' }
  | { type: 'cancel' }
  | { type: 'space' }
  | { type: 'digit'; n: number }
  | { type: 'input'; value: string };

export const ERR_NONE_CHECKED = 'Marque ao menos uma opção (Espaço)';
export const ERR_EMPTY_OTHER = 'Digite uma resposta ou volte com Esc';

type QuestionState = Extract<AskUserFlowState, { step: 'question' }>;

function startQuestion(
  questions: AskUserQuestion[],
  index: number,
  answers: AskUserAnswer[],
): QuestionState {
  const q = questions[index]!;
  return {
    step: 'question',
    index,
    questions,
    answers,
    selected: 0,
    checked: q.options.map(() => false),
    other: '',
  };
}

export function initialAskUserFlow(questions: AskUserQuestion[]): AskUserFlowState {
  return startQuestion(questions, 0, []);
}

export function currentQuestion(state: QuestionState): AskUserQuestion {
  return state.questions[state.index]!;
}

/** True when the highlighted row is "Outro…" (free text). */
export function isOtherSelected(state: QuestionState): boolean {
  return state.selected === currentQuestion(state).options.length;
}

function advance(state: QuestionState, answer: AskUserAnswer): AskUserFlowState {
  const answers = [...state.answers];
  answers[state.index] = answer;
  const next = state.index + 1;
  if (next >= state.questions.length) return { step: 'done', answers };
  return startQuestion(state.questions, next, answers);
}

export function askUserReducer(state: AskUserFlowState, key: AskUserKey): AskUserFlowState {
  if (state.step !== 'question') return state;
  if (key.type === 'cancel') return { step: 'cancelled' };

  const q = currentQuestion(state);
  const rows = q.options.length + 1; // options + "Outro…"
  const other = isOtherSelected(state);

  switch (key.type) {
    case 'up':
      return { ...state, selected: (state.selected - 1 + rows) % rows, error: undefined };
    case 'down':
      return { ...state, selected: (state.selected + 1) % rows, error: undefined };
    case 'digit': {
      if (other) return state; // typing into the free-text field
      const i = key.n - 1;
      if (i < 0 || i >= q.options.length) return state;
      if (q.multiSelect) {
        const checked = [...state.checked];
        checked[i] = !checked[i];
        return { ...state, selected: i, checked, error: undefined };
      }
      return advance(state, { kind: 'options', labels: [q.options[i]!.label] });
    }
    case 'space': {
      if (other || !q.multiSelect) return state;
      const checked = [...state.checked];
      checked[state.selected] = !checked[state.selected];
      return { ...state, checked, error: undefined };
    }
    case 'input':
      if (!other) return state;
      return { ...state, other: key.value, error: undefined };
    case 'enter': {
      if (other) {
        const text = state.other.trim();
        if (text === '') return { ...state, error: ERR_EMPTY_OTHER };
        return advance(state, { kind: 'other', text });
      }
      if (q.multiSelect) {
        const labels = q.options.filter((_, i) => state.checked[i]).map((o) => o.label);
        if (labels.length === 0) return { ...state, error: ERR_NONE_CHECKED };
        return advance(state, { kind: 'options', labels });
      }
      return advance(state, { kind: 'options', labels: [q.options[state.selected]!.label] });
    }
  }
}
