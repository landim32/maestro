import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, useInput } from 'ink';
import type { UiSettings } from '../config/schema.js';
import type { PromptSubmission, SessionController } from '../session/controller.js';
import type { CopyResult } from '../utils/clipboard.js';
import { ContentLineCache } from './frameRecorder.js';
import type { FrameRecorder, MouseGeometry } from './frameRecorder.js';
import { idleSelection } from './selection.js';
import type { SelectionState } from './selection.js';
import { useMouseSelection } from './hooks/useMouseSelection.js';
import { isMouseSequence } from './hooks/useMouseWheel.js';
import type { DialogKey } from '../setup/dialog.js';
import { pickBannerVariant } from './banner.js';
import { Banner } from './components/Banner.js';
import { Header } from './components/Header.js';
import { MessageList } from './components/MessageList.js';
import { InputPrompt } from './components/InputPrompt.js';
import { StatusBar } from './components/StatusBar.js';
import { ConfirmationDialog } from './components/ConfirmationDialog.js';
import { Transcript } from './components/Transcript.js';
import { AskUserDialog } from './dialogs/AskUserDialog.js';
import { DialogHost } from './dialogs/DialogHost.js';
import type { AskUserKey } from '../setup/askUserFlow.js';
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
  /** Recorder wrapping the stdout given to Ink; feeds the mouse-selection text (specs/007). */
  frame?: FrameRecorder;
  /** Injected clipboard (tests). */
  copy?: (text: string) => Promise<CopyResult>;
}

const DEFAULT_UI = { altScreen: true, mouse: true, color: undefined } as const;

export const COPY_FAILED_NOTICE =
  'Não foi possível copiar; use /mouse off e a seleção nativa do terminal.';

export function App({ controller, onExit, ui = DEFAULT_UI, flags, env, frame, copy }: AppProps) {
  const snap = useSession(controller);
  const caps = useTerminalCapabilities({ ui, flags, env });
  const dialog = controller.dialog;

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

  const onDialogKey = useCallback((key: DialogKey) => controller.setup.dispatch(key), [controller]);
  const onDialogInput = useCallback(
    (value: string) => controller.setup.dispatch({ type: 'input', value }),
    [controller],
  );
  const onQuestionKey = useCallback(
    (key: AskUserKey) => controller.dispatchQuestion(key),
    [controller],
  );
  const onQuestionInput = useCallback(
    (value: string) => controller.dispatchQuestion({ type: 'input', value }),
    [controller],
  );

  const { exitArmed } = useKeyboard({
    state: snap.state,
    onCancel: () => controller.cancel(),
    onExit,
    onConfirm: (ok) => controller.confirm(ok),
    viewport,
    dialogOpen: Boolean(dialog),
    onDialogKey,
    onCycleMode: (dir) => controller.cycleApprovalMode(dir),
    onQuestionKey,
  });

  const onWheel = useCallback((lines: number) => viewport.scrollBy(lines), [viewport]);
  // Mouse tracking stays on while a dialog is open (toggling it would spam escape sequences);
  // /mouse off turns it off for the session (contracts/mouse-selection.md § 5).
  const mouseOn = caps.mouse && snap.mouseEnabled;
  useMouseWheel({ enabled: mouseOn, onWheel });

  // Mouse selection over the transcript (contracts/mouse-selection.md § 1–4).
  const geometryRef = useRef<MouseGeometry | undefined>(undefined);
  const cache = useMemo(() => new ContentLineCache(), []);
  useEffect(() => {
    if (!frame) return;
    return frame.onFrame((lines) => {
      const g = geometryRef.current;
      if (g) cache.update(lines, g);
    });
  }, [frame, cache]);
  const [selection, setSelection] = useState<SelectionState>(idleSelection);
  const lineText = useCallback((line: number) => cache.get(line), [cache]);
  const onCopy = useCallback(
    (r: { ok: boolean; method?: string; lines: number }) => {
      if (!r.ok) {
        controller.notice(COPY_FAILED_NOTICE, 'warn');
        return;
      }
      const n = `${r.lines} linha${r.lines === 1 ? '' : 's'}`;
      controller.showTransient(
        r.method === 'osc52' ? `copiado via terminal (${n})` : `copiado (${n})`,
      );
    },
    [controller],
  );
  const { clear: clearSelection } = useMouseSelection({
    enabled: mouseOn && !dialog,
    geometry: () => geometryRef.current,
    cache,
    copy,
    onChange: setSelection,
    onCopy,
  });
  // Any key clears the highlight (a new click replaces it inside the hook).
  useInput((input) => {
    if (!isMouseSequence(input)) clearSelection();
  });

  const onSubmit = useCallback(
    (submission: PromptSubmission) => {
      viewport.end();
      void controller.submit(submission);
    },
    [controller, viewport],
  );
  const onPromptNotice = useCallback(
    (text: string, level: 'info' | 'warn') => controller.notice(text, level),
    [controller],
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
  // Controller messages (e.g. "modo: YOLO" after Tab) take over the slot for ~3 s, then expire.
  const transientSeq = snap.transient?.seq;
  const [expiredSeq, setExpiredSeq] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (transientSeq === undefined) return;
    const t = setTimeout(() => setExpiredSeq(transientSeq), 3000);
    return () => clearTimeout(t);
  }, [transientSeq]);
  const controllerNotice =
    snap.transient && snap.transient.seq !== expiredSeq ? snap.transient.text : undefined;

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
      {dialog ? (
        <DialogHost dialog={dialog} color={caps.color} onInput={onDialogInput} rows={caps.rows} />
      ) : (
        <Transcript
          capabilities={caps}
          actionsRef={viewportRef}
          onScrollableChange={setScrollable}
          geometryRef={geometryRef}
          selection={selection}
          lineText={lineText}
        >
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
      )}
      {snap.state === 'awaiting_confirmation' && snap.pending && (
        <ConfirmationDialog action={snap.pending} maxLines={confirmMaxLines} color={caps.color} />
      )}
      {snap.state === 'awaiting_answer' && snap.question && (
        <AskUserDialog
          flow={snap.question}
          color={caps.color}
          onInput={onQuestionInput}
          rows={caps.rows}
        />
      )}
      <InputPrompt
        active={snap.state === 'idle' && !dialog}
        historyItems={snap.historyItems}
        commands={snap.commands}
        onSubmit={onSubmit}
        chips={controller.chips}
        limits={controller.settings.ui}
        cwd={controller.session.cwd}
        imagesOk={snap.imagesOk}
        providerId={snap.providerId}
        env={env}
        onNotice={onPromptNotice}
        placeholder={
          dialog
            ? 'diálogo aberto — Esc para fechar'
            : snap.state === 'idle'
              ? undefined
              : snap.state === 'awaiting_answer'
                ? 'responda à pergunta acima'
                : 'waiting for the model…'
        }
        columns={caps.columns}
        color={caps.color}
      />
      <StatusBar
        state={snap.state}
        exitArmed={exitArmed}
        usage={snap.usage}
        capabilities={caps}
        transientNotice={controllerNotice ?? transientNotice}
        scrollable={scrollable && !dialog}
        approvalMode={snap.approvalMode}
        mouseOff={!snap.mouseEnabled}
      />
    </Box>
  );
}
