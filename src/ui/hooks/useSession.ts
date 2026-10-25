import { useEffect, useMemo, useState } from 'react';
import type { SessionController } from '../../session/controller.js';

/** Subscribes a component to controller/session changes and returns a snapshot. */
export function useSession(controller: SessionController) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const onChange = () => setTick((t) => t + 1);
    controller.on('change', onChange);
    return () => {
      controller.off('change', onChange);
    };
  }, [controller]);

  const s = controller.session;
  // Stable reference while the command list itself does not change (it only changes on /speckit.init).
  const commandList = controller.commands;
  const commands = useMemo(
    () => commandList.map((c) => ({ name: c.name, usage: c.usage, description: c.description })),
    [commandList],
  );
  return {
    history: s.history,
    state: s.state,
    partialText: controller.partialText,
    notices: controller.notices,
    pending: s.pendingConfirmation,
    providerId: s.activeProviderId,
    model: controller.activeModel,
    usage: controller.lastUsage,
    /** Persistent input history for ↑/↓ (oldest first) — contracts/history.md. */
    historyItems: controller.history?.entries ?? [],
    /** Live approval mode and the short-lived status message (contracts/approval-modes.md). */
    approvalMode: controller.approvalMode,
    transient: controller.transient,
    /** ask_user dialog state while awaiting_answer (contracts/ask-user.md). */
    question: controller.questionFlow,
    /** Slash commands (built-in + Spec Kit) for the prompt suggestions (specs/006). */
    commands,
  };
}
