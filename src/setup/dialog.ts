import type { AuthFlowState } from './authFlow.js';
import type { ModelFlowState } from './modelFlow.js';

/** Modal dialog state owned by the SessionController (data-model.md § 2). */
export type DialogState =
  { type: 'auth'; flow: AuthFlowState } | { type: 'model'; flow: ModelFlowState };

/** Keys the UI forwards to the open dialog (contracts/dialog-flows.md § 1). */
export type DialogKey =
  | { type: 'up' }
  | { type: 'down' }
  | { type: 'enter' }
  | { type: 'back' }
  | { type: 'cancel' }
  | { type: 'input'; value: string };
