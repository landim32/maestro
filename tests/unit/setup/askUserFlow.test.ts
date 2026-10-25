import { describe, expect, it } from 'vitest';
import {
  askUserReducer,
  ERR_EMPTY_OTHER,
  ERR_NONE_CHECKED,
  initialAskUserFlow,
  isOtherSelected,
} from '../../../src/setup/askUserFlow.js';
import type { AskUserFlowState, AskUserKey } from '../../../src/setup/askUserFlow.js';
import type { AskUserQuestion } from '../../../src/tools/types.js';

const single: AskUserQuestion = {
  question: 'Qual abordagem?',
  header: 'Abordagem',
  options: [
    { label: 'Memória (Recommended)', description: 'simples' },
    { label: 'Redis', description: 'compartilhado' },
    { label: 'Arquivo', description: 'persistente' },
  ],
  multiSelect: false,
};
const multi: AskUserQuestion = {
  question: 'Quais extras?',
  header: 'Extras',
  options: [
    { label: 'Logs', description: 'a' },
    { label: 'Métricas', description: 'b' },
  ],
  multiSelect: true,
};

function run(state: AskUserFlowState, ...keys: AskUserKey[]): AskUserFlowState {
  return keys.reduce((s, k) => askUserReducer(s, k), state);
}
const asQuestion = (s: AskUserFlowState) => {
  if (s.step !== 'question') throw new Error(`expected question, got ${s.step}`);
  return s;
};

/** specs/005 data-model.md § 4 */
describe('askUserReducer', () => {
  it('starts on the first option; ↑/↓ wrap around including the "Outro…" row', () => {
    const s0 = asQuestion(initialAskUserFlow([single]));
    expect(s0).toMatchObject({ index: 0, selected: 0, checked: [false, false, false], other: '' });
    expect(asQuestion(run(s0, { type: 'up' })).selected).toBe(3); // Outro…
    expect(isOtherSelected(asQuestion(run(s0, { type: 'up' })))).toBe(true);
    expect(asQuestion(run(s0, { type: 'down' }, { type: 'down' })).selected).toBe(2);
    expect(asQuestion(run(s0, ...Array(4).fill({ type: 'down' }))).selected).toBe(0);
  });

  it('single choice: Enter on an option or a digit answers and finishes a one-question call', () => {
    const s0 = initialAskUserFlow([single]);
    expect(run(s0, { type: 'down' }, { type: 'enter' })).toEqual({
      step: 'done',
      answers: [{ kind: 'options', labels: ['Redis'] }],
    });
    expect(run(s0, { type: 'digit', n: 3 })).toEqual({
      step: 'done',
      answers: [{ kind: 'options', labels: ['Arquivo'] }],
    });
    // digits outside the range and Space do nothing in single choice
    expect(run(s0, { type: 'digit', n: 9 })).toEqual(s0);
    expect(run(s0, { type: 'digit', n: 0 })).toEqual(s0);
    expect(run(s0, { type: 'space' })).toEqual(s0);
  });

  it('multi choice: Space/digits toggle, Enter needs at least one mark and keeps option order', () => {
    const s0 = initialAskUserFlow([multi]);
    const none = asQuestion(run(s0, { type: 'enter' }));
    expect(none.error).toBe(ERR_NONE_CHECKED);
    const marked = asQuestion(
      run(s0, { type: 'down' }, { type: 'space' }, { type: 'digit', n: 1 }),
    );
    expect(marked.checked).toEqual([true, true]);
    expect(marked.error).toBeUndefined();
    expect(run(marked, { type: 'enter' })).toEqual({
      step: 'done',
      answers: [{ kind: 'options', labels: ['Logs', 'Métricas'] }],
    });
    // the digit moved the highlight to option 1, so Space toggles it off again
    expect(asQuestion(run(marked, { type: 'space' })).checked).toEqual([false, true]);
  });

  it('"Outro…": text is only accepted on that row; empty Enter errors; digits/Space are typed, not shortcuts', () => {
    const s0 = initialAskUserFlow([single]);
    // input ignored while an option is highlighted
    expect(asQuestion(run(s0, { type: 'input', value: 'x' })).other).toBe('');
    const other = asQuestion(run(s0, { type: 'up' }));
    expect(asQuestion(run(other, { type: 'enter' })).error).toBe(ERR_EMPTY_OTHER);
    expect(asQuestion(run(other, { type: 'input', value: '  ' }, { type: 'enter' })).error).toBe(
      ERR_EMPTY_OTHER,
    );
    // digit/space do not select while typing a free answer
    expect(asQuestion(run(other, { type: 'digit', n: 1 })).selected).toBe(3);
    expect(run(other, { type: 'space' })).toEqual(other);
    expect(run(other, { type: 'input', value: ' DynamoDB ' }, { type: 'enter' })).toEqual({
      step: 'done',
      answers: [{ kind: 'other', text: 'DynamoDB' }],
    });
  });

  it('several questions: done only after the last; selection/checks/text reset between them', () => {
    const s0 = initialAskUserFlow([single, multi, single]);
    const afterFirst = asQuestion(
      run(s0, { type: 'up' }, { type: 'input', value: 'livre' }, { type: 'enter' }),
    );
    expect(afterFirst).toMatchObject({ index: 1, selected: 0, checked: [false, false], other: '' });
    expect(afterFirst.answers).toEqual([{ kind: 'other', text: 'livre' }]);
    const afterSecond = asQuestion(run(afterFirst, { type: 'space' }, { type: 'enter' }));
    expect(afterSecond.index).toBe(2);
    expect(run(afterSecond, { type: 'digit', n: 2 })).toEqual({
      step: 'done',
      answers: [
        { kind: 'other', text: 'livre' },
        { kind: 'options', labels: ['Logs'] },
        { kind: 'options', labels: ['Redis'] },
      ],
    });
  });

  it('cancel discards everything, even answered questions; terminal states ignore keys', () => {
    const s0 = initialAskUserFlow([single, multi]);
    const second = run(s0, { type: 'enter' });
    expect(run(second, { type: 'cancel' })).toEqual({ step: 'cancelled' });
    const done = run(initialAskUserFlow([single]), { type: 'enter' });
    expect(run(done, { type: 'down' }, { type: 'cancel' })).toEqual(done);
    expect(run({ step: 'cancelled' }, { type: 'enter' })).toEqual({ step: 'cancelled' });
  });
});
