import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box } from 'ink';
import type { UiSettings } from '../config/schema.js';
import type { SessionController } from '../session/controller.js';
import { pickBannerVariant } from './banner.js';
import { Banner } from './components/Banner.js';
import { Header } from './components/Header.js';
import { MessageList } from './components/MessageList.js';
import { InputPrompt } from './components/InputPrompt.js';
import { StatusBar } from './components/StatusBar.js';
import { ConfirmationDialog } from './components/ConfirmationDialog.js';
import { Transcript } from './components/Transcript.js';
import { useKeyboard } from './hooks/useKeyboard.js';
import { useMouseWheel } from './hooks/useMouseWheel.js';
import { useSession } from './hooks/useSession.js';
import { useTerminalCapabilities } from './hooks/useTerminalCapabilities.js';
import type { ViewportActions } from './hooks/useViewport.js';

export interface AppProps {
  controller: SessionController;
  onExit: () => void;
  ui?: Pick<UiSettings, 'altScreen' | 'mouse' | 'color'>;
  flags?: { altScreen?: boolean; color?: boolean };
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_UI = { altScreen: true, mouse: true, color: undefined } as const;

export function App({ controller, onExit, ui = DEFAULT_UI, flags, env }: AppProps) {
  const snap = useSession(controller);
  const caps = useTerminalCapabilities({ ui, flags, env });

  // Scroll actions are provided by the Transcript once mounted.
  const viewportRef = useRef<ViewportActions | null>(null);
  const viewport = useMemo<ViewportActions>(
    () => ({
      scrollBy: (d) => viewportRef.current?.scrollBy(d),
      pageUp: () => viewportRef.current?.pageUp(),
      pageDown: () => viewportRef.current?.pageDown(),
      home: () => viewportRef.current?.home(),
      end: () => viewportRef.current?.end(),
      reset: () => viewportRef.current?.reset(),
    }),
    [],
  );
  const [scrollable, setScrollable] = useState(false);

  const { exitArmed } = useKeyboard({
    state: snap.state,
    onCancel: () => controller.cancel(),
    onExit,
    onConfirm: (ok) => controller.confirm(ok),
    viewport,
  });

  const onWheel = useCallback((lines: number) => viewport.scrollBy(lines), [viewport]);
  useMouseWheel({ enabled: caps.mouse, onWheel });

  const onSubmit = useCallback(
    (text: string) => {
      viewport.end();
      void controller.submit(text);
    },
    [controller, viewport],
  );

  // /clear → back to the top, following again.
  const historyLength = snap.history.length;
  useEffect(() => {
    if (historyLength === 0) viewport.reset();
  }, [historyLength, viewport]);

  // One-time transient notice when the alternate screen is unavailable/disabled.
  const [transientNotice, setTransientNotice] = useState<string | undefined>(
    caps.altScreen ? undefined : 'alt screen off',
  );
  useEffect(() => {
    if (!transientNotice) return;
    const t = setTimeout(() => setTransientNotice(undefined), 5000);
    return () => clearTimeout(t);
  }, [transientNotice]);

  const contentWidth = Math.max(10, caps.columns - 1 /* indicator */ - 2 /* padding */);
  const confirmMaxLines = Math.max(3, Math.floor(caps.rows / 2) - 6);

  return (
    <Box width={caps.columns} height={caps.rows} flexDirection="column" overflow="hidden">
      <Header
        providerId={snap.providerId}
        model={snap.model}
        cwd={controller.session.cwd}
        columns={caps.columns}
        color={caps.color}
      />
      <Transcript capabilities={caps} actionsRef={viewportRef} onScrollableChange={setScrollable}>
        <MessageList
          history={snap.history}
          notices={snap.notices}
          partialText={snap.partialText}
          generating={snap.state === 'generating'}
          width={contentWidth}
          capabilities={caps}
          leading={
            <Banner
              variant={pickBannerVariant(caps)}
              color={caps.color}
              providerId={snap.providerId}
              model={snap.model}
              cwd={controller.session.cwd}
            />
          }
        />
      </Transcript>
      {snap.state === 'awaiting_confirmation' && snap.pending && (
        <ConfirmationDialog action={snap.pending} maxLines={confirmMaxLines} color={caps.color} />
      )}
      <InputPrompt
        active={snap.state === 'idle'}
        historyItems={snap.userInputs}
        onSubmit={onSubmit}
        placeholder={snap.state === 'idle' ? undefined : 'waiting for the model…'}
        columns={caps.columns}
        color={caps.color}
      />
      <StatusBar
        state={snap.state}
        exitArmed={exitArmed}
        usage={snap.usage}
        capabilities={caps}
        transientNotice={transientNotice}
        scrollable={scrollable}
      />
    </Box>
  );
}
