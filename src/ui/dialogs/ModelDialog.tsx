import { Box, Text } from 'ink';
import type { ModelFlowState } from '../../setup/modelFlow.js';
import { DialogFrame } from './DialogFrame.js';
import { ProgressView } from './ProgressView.js';
import { ResultView } from './ResultView.js';
import { SelectList } from './SelectList.js';
import { TextField } from './TextField.js';

export interface ModelDialogProps {
  flow: ModelFlowState;
  color: boolean;
  onInput: (value: string) => void;
}

export const CUSTOM_MODEL_LABEL = 'Digitar outro modelo…';

/** Maps ModelFlowState → screens (contracts/dialog-flows.md § 7). */
export function ModelDialog({ flow, color, onInput }: ModelDialogProps) {
  switch (flow.step) {
    case 'list':
      return (
        <DialogFrame
          title="Selecionar modelo"
          hints="↑↓ navegar · Enter selecionar · Esc fechar"
          color={color}
        >
          <SelectList
            color={color}
            selected={flow.selected}
            labelWidth={34}
            items={[
              ...flow.items.map((it) => ({
                label: `${it.active ? '●' : '○'} ${it.providerId.padEnd(6)} / ${it.configured ? it.model : '…'}`,
                description: it.configured
                  ? it.credentialSource === 'profile'
                    ? 'perfil'
                    : it.maskedKey
                      ? `chave ${it.maskedKey}`
                      : it.credentialSource === 'env'
                        ? 'ambiente'
                        : ''
                  : 'não configurado — configure com /auth',
                status: it.active ? 'ativo' : undefined,
                disabled: !it.configured,
              })),
              { label: `○ ${CUSTOM_MODEL_LABEL}` },
            ]}
          />
        </DialogFrame>
      );
    case 'custom':
      return (
        <DialogFrame
          title="Selecionar modelo"
          hints="Enter aplicar · Esc voltar · Ctrl+U limpar"
          color={color}
        >
          <TextField
            label={`Modelo para ${flow.providerId}`}
            value={flow.value}
            onChange={onInput}
            active
            color={color}
            error={flow.error}
          />
        </DialogFrame>
      );
    case 'applying':
      return (
        <DialogFrame title="Selecionar modelo" hints="" color={color}>
          <ProgressView
            message={`Ativando ${flow.providerId} / ${flow.model}…`}
            color={color}
            hint=""
          />
        </DialogFrame>
      );
    case 'done':
      return (
        <DialogFrame title="Selecionar modelo" hints="" color={color}>
          <ResultView kind="success" title={`${flow.providerId} / ${flow.model}`} color={color} />
        </DialogFrame>
      );
    case 'failed':
      return (
        <DialogFrame title="Selecionar modelo" hints="Enter fechar" color={color}>
          <ResultView
            kind="error"
            title={flow.error}
            actions={['Fechar']}
            selected={0}
            color={color}
          />
        </DialogFrame>
      );
    case 'closed':
      return (
        <Box>
          <Text> </Text>
        </Box>
      );
  }
}
