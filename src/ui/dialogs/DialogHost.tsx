import type { DialogState } from '../../setup/dialog.js';
import type { RoutesFlowContext } from '../../setup/routesFlow.js';
import { AuthDialog } from './AuthDialog.js';
import { ModelDialog } from './ModelDialog.js';
import { RoutesDialog } from './RoutesDialog.js';

export interface DialogHostProps {
  dialog: DialogState;
  color: boolean;
  onInput: (value: string) => void;
  /** Terminal rows (long lists show a window around the selection). */
  rows?: number;
  /** Entries for the routes dialog (specs/008), computed by the driver. */
  routesContext?: () => RoutesFlowContext;
}

/** Picks the dialog component for the controller's current dialog state. */
export function DialogHost({ dialog, color, onInput, rows, routesContext }: DialogHostProps) {
  if (dialog.type === 'auth')
    return <AuthDialog flow={dialog.flow} color={color} onInput={onInput} />;
  if (dialog.type === 'routes') {
    const ctx = routesContext?.() ?? { entries: [], statuses: [], commandNames: [] };
    return (
      <RoutesDialog
        flow={dialog.flow}
        ctx={ctx as RoutesFlowContext}
        color={color}
        onInput={onInput}
        rows={rows}
      />
    );
  }
  return <ModelDialog flow={dialog.flow} color={color} onInput={onInput} rows={rows} />;
}
