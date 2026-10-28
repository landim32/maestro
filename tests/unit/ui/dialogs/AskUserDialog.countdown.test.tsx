import { afterEach, describe, expect, it } from 'vitest';
import { initialAskUserFlow } from '../../../../src/setup/askUserFlow.js';
import { AskUserDialog } from '../../../../src/ui/dialogs/AskUserDialog.js';
import { cleanupSized, renderSized } from '../../../helpers/renderSized.js';

afterEach(() => cleanupSized());

const flow = initialAskUserFlow([
  {
    question: 'Qual banco?',
    header: 'Banco',
    options: [
      { label: 'Postgres', description: 'relacional' },
      { label: 'SQLite', description: 'arquivo' },
    ],
    multiSelect: false,
  },
]);

describe('AskUserDialog countdown (autopilot)', () => {
  it('shows when the autopilot answers and that Esc lets it decide now', () => {
    const ui = renderSized(
      <AskUserDialog
        flow={flow}
        color={false}
        onInput={() => {}}
        deadline={301_000}
        clock={() => 1_000}
      />,
      { columns: 100, rows: 20 },
    );
    const frame = ui.lastFrame() ?? '';
    expect(frame).toContain('Sem resposta, o autopiloto decide em 5:00');
    expect(frame).toContain('Esc o autopiloto decide agora');
  });

  it('without a deadline keeps the plain hints', () => {
    const ui = renderSized(<AskUserDialog flow={flow} color={false} onInput={() => {}} />, {
      columns: 100,
      rows: 20,
    });
    const frame = ui.lastFrame() ?? '';
    expect(frame).not.toContain('autopiloto');
    expect(frame).toContain('Esc cancelar');
  });
});
