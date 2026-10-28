/**
 * @license
 * Portions adapted from qwen-code (https://github.com/QwenLM/qwen-code),
 * packages/cli/src/ui/components/messages/AskUserQuestionDialog.tsx
 * @ 1c9cdd234fd9a391cac146e2d4c834d603afd045.
 * Copyright 2025 Qwen Team. Copyright 2025 Google LLC.
 * SPDX-License-Identifier: Apache-2.0
 * Modified for Maestro; see THIRD_PARTY_NOTICES.md.
 */

import { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { currentQuestion, isOtherSelected } from '../../setup/askUserFlow.js';
import type { AskUserFlowState } from '../../setup/askUserFlow.js';
import { SelectList } from './SelectList.js';
import type { SelectItem } from './SelectList.js';
import { TextField } from './TextField.js';

export const OTHER_LABEL = 'Outro…';

export interface AskUserDialogProps {
  flow: AskUserFlowState;
  color: boolean;
  /** Free-text edits for the "Outro…" row. */
  onInput: (value: string) => void;
  /** Terminal rows; limits the visible option window. */
  rows?: number;
  /** Autopilot: clock time at which the decider answers by itself (shows a countdown). */
  deadline?: number;
  clock?: () => number;
}

/** `4:59` until the autopilot answers; ticks on its own so the dialog does not re-render. */
function Countdown({ deadline, clock }: { deadline: number; clock: () => number }) {
  const [now, setNow] = useState(clock);
  useEffect(() => {
    const t = setInterval(() => setNow(clock()), 1000);
    return () => clearInterval(t);
  }, [clock]);
  const s = Math.max(0, Math.ceil((deadline - now) / 1000));
  return (
    <Text dimColor>
      Sem resposta, o autopiloto decide em {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
    </Text>
  );
}

/** Rows of the option list for the current question (contracts/ask-user.md § 3). */
export function askUserItems(flow: Extract<AskUserFlowState, { step: 'question' }>): SelectItem[] {
  const q = currentQuestion(flow);
  const items: SelectItem[] = q.options.map((o, i) => ({
    label: `${q.multiSelect ? (flow.checked[i] ? '[x] ' : '[ ] ') : ''}${i + 1}. ${o.label}`,
    description: o.description,
  }));
  items.push({ label: `${q.multiSelect ? '    ' : ''}${q.options.length + 1}. ${OTHER_LABEL}` });
  return items;
}

/** Multiple-choice question from the model, shown above the prompt like the confirmation box. */
export function AskUserDialog({
  flow,
  color,
  onInput,
  rows,
  deadline,
  clock = Date.now,
}: AskUserDialogProps) {
  if (flow.step !== 'question') return null;
  const q = currentQuestion(flow);
  const other = isOtherSelected(flow);
  const c = (name: string) => (color ? name : undefined);
  const maxVisible = rows !== undefined ? Math.max(3, Math.floor(rows / 2) - 6) : undefined;
  const hints = [
    '↑↓ navegar',
    '1-9 escolher',
    ...(q.multiSelect ? ['Espaço marcar'] : []),
    'Enter confirmar',
    deadline !== undefined ? 'Esc o autopiloto decide agora' : 'Esc cancelar',
  ].join(' · ');

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor={c('cyan')}
      paddingX={1}
      marginX={1}
      flexShrink={0}
    >
      <Text color={c('cyan')} bold>
        Pergunta {flow.index + 1} de {flow.questions.length} · [{q.header}]
      </Text>
      <Box marginTop={1}>
        <Text wrap="wrap">{q.question}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <SelectList
          color={color}
          selected={flow.selected}
          items={askUserItems(flow)}
          maxVisible={maxVisible}
        />
      </Box>
      {other && (
        <Box marginTop={1}>
          <TextField
            label=""
            value={flow.other}
            onChange={onInput}
            active
            color={color}
            placeholder="Digite sua resposta"
          />
        </Box>
      )}
      {flow.error && <Text color={c('red')}>✗ {flow.error}</Text>}
      {deadline !== undefined && (
        <Box marginTop={1}>
          <Countdown deadline={deadline} clock={clock} />
        </Box>
      )}
      <Box marginTop={deadline !== undefined ? 0 : 1}>
        <Text dimColor>{hints}</Text>
      </Box>
    </Box>
  );
}
