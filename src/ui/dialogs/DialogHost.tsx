import type { DialogState } from '../../setup/dialog.js';
import { AuthDialog } from './AuthDialog.js';
import { ModelDialog } from './ModelDialog.js';

export interface DialogHostProps {
  dialog: DialogState;
  color: boolean;
  onInput: (value: string) => void;
}

/** Picks the dialog component for the controller's current dialog state. */
export function DialogHost({ dialog, color, onInput }: DialogHostProps) {
  if (dialog.type === 'auth')
    return <AuthDialog flow={dialog.flow} color={color} onInput={onInput} />;
  return <ModelDialog flow={dialog.flow} color={color} onInput={onInput} />;
}
