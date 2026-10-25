import type { RouteEntry } from '../../routes/catalog.js';
import type { RoutesFlowContext, RoutesFlowState } from '../../setup/routesFlow.js';
import { ACTION_LABELS, NEW_ROUTE_LABEL } from '../../setup/routesFlow.js';
import { DialogFrame } from './DialogFrame.js';
import { credentialLabel } from './ModelDialog.js';
import { ProgressView } from './ProgressView.js';
import { ResultView } from './ResultView.js';
import { SelectList } from './SelectList.js';
import type { SelectItem } from './SelectList.js';
import { TextField } from './TextField.js';

export interface RoutesDialogProps {
  flow: RoutesFlowState;
  /** Entries and names the reducer sees (from the driver). */
  ctx: RoutesFlowContext;
  color: boolean;
  onInput: (value: string) => void;
  rows?: number;
}

export const TITLE = 'Rotas por modelo';

/** Status column of a route row (contracts/routes-dialog.md § 2). */
export function routeStatus(e: RouteEntry): string {
  const parts: string[] = [];
  if (e.origin === 'default')
    parts.push(`padrão (segue ${e.follows === 'active' ? 'o ativo' : 'chat'})`);
  else parts.push(e.origin);
  if (!e.available) parts.push('indisponível');
  if (e.missingCommand) parts.push('comando ausente');
  if (e.kind === 'purpose' && e.name !== 'chat' && !e.builtin)
    parts.push(e.alias === 'collides' ? 'atalho em colisão' : `atalho /${e.name}`);
  else if (e.kind === 'purpose' && e.name !== 'chat' && e.alias === 'collides')
    parts.push('atalho em colisão');
  return parts.join(' · ');
}

export function routeTargetText(e: RouteEntry): string {
  const effort = e.resolved.effort ? ` · ${e.resolved.effort}` : '';
  return `${e.resolved.provider} / ${e.resolved.model}${effort}`;
}

/** Rows of the list with group headers, and the display index of the flow's `selected`. */
export function routeItems(
  entries: readonly RouteEntry[],
  selected: number,
): { items: SelectItem[]; selectedIndex: number } {
  const items: SelectItem[] = [];
  let selectedIndex = -1;
  let lastKind: string | undefined;
  entries.forEach((e, k) => {
    if (e.kind !== lastKind) {
      lastKind = e.kind;
      items.push({ header: true, label: e.kind === 'purpose' ? 'Rotas' : 'Comandos' });
    }
    if (k === selected) selectedIndex = items.length;
    items.push({
      label: `${e.target ? '●' : '○'} ${e.name}`,
      description: routeTargetText(e),
      status: routeStatus(e),
    });
  });
  if (selected >= entries.length) selectedIndex = items.length;
  items.push({ label: `+ ${NEW_ROUTE_LABEL}` });
  return { items, selectedIndex };
}

export function RoutesDialog({ flow, ctx, color, onInput, rows }: RoutesDialogProps) {
  const maxVisible = rows !== undefined ? Math.max(3, rows - 15) : undefined;
  switch (flow.step) {
    case 'list': {
      const { items, selectedIndex } = routeItems(ctx.entries, flow.selected);
      return (
        <DialogFrame title={TITLE} hints="↑↓ navegar · Enter abrir · Esc fechar" color={color}>
          <SelectList
            color={color}
            selected={selectedIndex}
            labelWidth={22}
            items={items}
            maxVisible={maxVisible}
          />
        </DialogFrame>
      );
    }
    case 'action':
      return (
        <DialogFrame
          title={`${TITLE} · ${flow.route}`}
          hints="↑↓ escolher · Enter confirmar · Esc voltar"
          color={color}
        >
          <SelectList
            color={color}
            selected={flow.selected}
            labelWidth={30}
            items={flow.options.map((a) => ({ label: ACTION_LABELS[a] }))}
          />
        </DialogFrame>
      );
    case 'provider':
      return (
        <DialogFrame
          title={`${TITLE} · ${flow.route} · provedor`}
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
    case 'model':
      return (
        <DialogFrame
          title={`${TITLE} · ${flow.route} · ${flow.providerId}`}
          hints="↑↓ escolher · Enter confirmar · Esc voltar"
          color={color}
        >
          <SelectList
            color={color}
            selected={flow.selected}
            labelWidth={34}
            maxVisible={maxVisible}
            items={[
              ...flow.models.map((m) => ({ label: `○ ${m}` })),
              { label: '○ Digitar outro modelo…' },
            ]}
          />
        </DialogFrame>
      );
    case 'custom':
      return (
        <DialogFrame
          title={`${TITLE} · ${flow.route}`}
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
    case 'newRoute':
      return (
        <DialogFrame
          title={`${TITLE} · nova rota`}
          hints="Enter continuar · Esc voltar · Ctrl+U limpar"
          color={color}
        >
          <TextField
            label="Nome da rota (ex.: review)"
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
        <DialogFrame title={TITLE} hints="" color={color}>
          <ProgressView message={`Gravando rota ${flow.route}…`} color={color} hint="" />
        </DialogFrame>
      );
    case 'done':
      return (
        <DialogFrame title={TITLE} hints="Enter / Esc fechar" color={color}>
          <ResultView kind="success" title={flow.message} color={color} />
        </DialogFrame>
      );
    case 'failed':
      return (
        <DialogFrame title={TITLE} hints="Enter / Esc fechar" color={color}>
          <ResultView
            kind="error"
            title="Não foi possível gravar a rota"
            lines={[flow.error]}
            color={color}
          />
        </DialogFrame>
      );
    default:
      return null;
  }
}
