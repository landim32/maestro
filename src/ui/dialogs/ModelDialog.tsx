import { Box, Text } from 'ink';
import type { CredentialSource } from '../../config/loader.js';
import type { ModelFlowState } from '../../setup/modelFlow.js';
import { DialogFrame } from './DialogFrame.js';
import { ProgressView } from './ProgressView.js';
import { ResultView } from './ResultView.js';
import { SelectList } from './SelectList.js';
import type { SelectItem } from './SelectList.js';
import { TextField } from './TextField.js';

export interface ModelDialogProps {
  flow: ModelFlowState;
  color: boolean;
  onInput: (value: string) => void;
  /** Terminal rows; limits the visible window of long lists. */
  rows?: number;
}

export const CUSTOM_MODEL_LABEL = 'Digitar outro modelo…';
export const NOT_CONFIGURED = 'não configurado — configure com /auth';

function credentialLabel(
  configured: boolean,
  source: CredentialSource,
  maskedKey: string | undefined,
): string {
  if (!configured) return NOT_CONFIGURED;
  if (source === 'profile') return 'perfil';
  if (maskedKey) return `chave ${maskedKey}`;
  if (source === 'env') return 'ambiente';
  return '';
}

/**
 * Rows of the grouped list (contracts/model-catalog.md § 2) and the display index of the
 * flow's `selected` (which counts models only, plus the trailing custom entry).
 */
export function groupedItems(flow: Extract<ModelFlowState, { step: 'list' }>): {
  items: SelectItem[];
  selectedIndex: number;
} {
  const items: SelectItem[] = [];
  let selectedIndex = -1;
  let lastProvider: string | undefined;
  flow.items.forEach((it, k) => {
    if (it.providerId !== lastProvider) {
      lastProvider = it.providerId;
      items.push({
        header: true,
        label: `${it.providerId} · ${credentialLabel(it.configured, it.credentialSource, it.maskedKey)}`,
      });
    }
    if (k === flow.selected) selectedIndex = items.length;
    items.push({
      label: `${it.active ? '●' : '○'} ${it.model}`,
      status: it.active ? 'ativo' : undefined,
      disabled: !it.configured,
    });
  });
  if (flow.selected === flow.items.length) selectedIndex = items.length;
  items.push({ label: `○ ${CUSTOM_MODEL_LABEL}` });
  return { items, selectedIndex };
}

/** Maps ModelFlowState → screens (contracts/model-catalog.md § 2). */
export function ModelDialog({ flow, color, onInput, rows }: ModelDialogProps) {
  // Header, status bar, prompt (3), frame borders/title/footer (6) and the two window markers.
  const maxVisible = rows !== undefined ? Math.max(3, rows - 15) : undefined;
  switch (flow.step) {
    case 'list': {
      const { items, selectedIndex } = groupedItems(flow);
      return (
        <DialogFrame
          title="Selecionar modelo"
          hints="↑↓ navegar · Enter selecionar · Esc fechar"
          color={color}
        >
          <SelectList
            color={color}
            selected={selectedIndex}
            labelWidth={34}
            items={items}
            maxVisible={maxVisible}
          />
        </DialogFrame>
      );
    }
    case 'customProvider':
      return (
        <DialogFrame
          title="Selecionar modelo · provedor"
          hints="↑↓ escolher · Enter confirmar · Esc voltar"
          color={color}
        >
          <SelectList
            color={color}
            selected={flow.selected}
            labelWidth={10}
            items={flow.providers.map((p) => ({
              label: p.id,
              description: credentialLabel(p.configured, p.credentialSource, p.maskedKey),
              disabled: !p.configured,
            }))}
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
          <ResultView
            kind="success"
            title={`${flow.providerId} / ${flow.model}`}
            warnings={flow.warning ? [flow.warning] : undefined}
            color={color}
          />
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
