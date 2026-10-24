import { useEffect, useState } from 'react';
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
  return {
    history: s.history,
    state: s.state,
    partialText: controller.partialText,
    notices: controller.notices,
    pending: s.pendingConfirmation,
    providerId: s.activeProviderId,
    model: controller.activeModel,
    usage: controller.lastUsage,
    userInputs: s.history
      .filter((m) => m.role === 'user')
      .map((m) => m.content.map((p) => (p.type === 'text' ? p.text : '')).join('')),
  };
}
