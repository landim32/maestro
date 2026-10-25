import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { Box, Text, useBoxMetrics } from 'ink';
import type { DOMElement } from 'ink';
import type { MouseGeometry } from '../frameRecorder.js';
import type { TerminalCapabilities } from '../hooks/useTerminalCapabilities.js';
import { useViewport } from '../hooks/useViewport.js';
import type { ViewportActions } from '../hooks/useViewport.js';
import { selectedSpan } from '../selection.js';
import type { SelectionState } from '../selection.js';
import { ScrollIndicator } from './ScrollIndicator.js';

export interface TranscriptProps {
  capabilities: TerminalCapabilities;
  /** Receives the scroll actions once mounted (used by keyboard/mouse handlers in App). */
  actionsRef: RefObject<ViewportActions | null>;
  /** Called whenever `scrollable` changes (for status hints). */
  onScrollableChange?: (scrollable: boolean) => void;
  /** Receives the screen rectangle and scroll state on every render (mouse selection, specs/007). */
  geometryRef?: RefObject<MouseGeometry | undefined>;
  /** Mouse selection to highlight (content coordinates). */
  selection?: SelectionState;
  /** Visible text of a content line, for the highlight overlay. */
  lineText?: (line: number) => string | undefined;
  children: React.ReactNode;
}

/** Highlight overlay: one inverted segment per visible selected line. */
export function SelectionOverlay({
  selection,
  offset,
  viewportHeight,
  lineText,
}: {
  selection: SelectionState;
  offset: number;
  viewportHeight: number;
  lineText: (line: number) => string | undefined;
}) {
  const rows: React.ReactNode[] = [];
  for (let r = 0; r < viewportHeight; r++) {
    const line = offset + r;
    const span = selectedSpan(selection, line);
    if (!span) continue;
    const chars = Array.from(lineText(line) ?? '');
    const to = Math.min(span.to, chars.length - 1);
    if (span.from > to) continue;
    rows.push(
      <Box key={line} position="absolute" top={r} left={span.from} height={1}>
        <Text inverse>{chars.slice(span.from, to + 1).join('')}</Text>
      </Box>,
    );
  }
  return <>{rows}</>;
}

/**
 * Scrollable viewport over the conversation: `overflow="hidden"` + `contentOffsetY`
 * (Ink 8 primitives), content height measured with `useBoxMetrics`, indicator on the right
 * and a "new content" hint when the user is scrolled up (contracts/ui-layout.md).
 */
export function Transcript({
  capabilities,
  actionsRef,
  onScrollableChange,
  geometryRef,
  selection,
  lineText,
  children,
}: TranscriptProps) {
  const rootRef = useRef<DOMElement | null>(null);
  const outerRef = useRef<DOMElement | null>(null);
  const innerRef = useRef<DOMElement | null>(null);
  const root = useBoxMetrics(rootRef);
  const outer = useBoxMetrics(outerRef);
  const inner = useBoxMetrics(innerRef);

  const viewportHeight = outer.hasMeasured ? outer.height : 0;
  const contentHeight = inner.hasMeasured ? inner.height : 0;
  const { state, actions, scrollable } = useViewport(contentHeight, viewportHeight);

  useEffect(() => {
    actionsRef.current = actions;
    return () => {
      actionsRef.current = null;
    };
  }, [actions, actionsRef]);

  useEffect(() => {
    onScrollableChange?.(scrollable);
  }, [scrollable, onScrollableChange]);

  const geometry: MouseGeometry | undefined = root.hasMeasured
    ? {
        transcriptTop: root.top,
        transcriptLeft: root.left,
        viewportOffset: state.offset,
        viewportHeight,
        width: outer.hasMeasured ? outer.width : 0,
      }
    : undefined;
  // Assigned during render on purpose: Ink writes the frame in the reconciler's
  // resetAfterCommit, BEFORE layout effects run, and the FrameRecorder listener must map
  // that frame with the offset of the same render (an effect would lag one frame behind).
  // eslint-disable-next-line react-hooks/refs
  if (geometryRef) geometryRef.current = geometry;

  const color = capabilities.color;
  const showNewBelow = state.newBelow && !state.follow;
  const showSelection = selection && selection.phase !== 'idle' && lineText;

  return (
    <Box
      ref={rootRef}
      flexDirection="column"
      flexGrow={1}
      flexShrink={1}
      minHeight={3}
      overflow="hidden"
    >
      {/* minHeight={0} everywhere: Yoga's default min-height:auto would otherwise refuse to shrink below the content. */}
      <Box
        flexDirection="row"
        flexGrow={1}
        flexShrink={1}
        minHeight={0}
        overflow="hidden"
        position="relative"
      >
        <Box
          ref={outerRef}
          flexDirection="column"
          flexGrow={1}
          flexShrink={1}
          minHeight={0}
          overflow="hidden"
          contentOffsetY={state.offset}
        >
          <Box ref={innerRef} flexDirection="column" flexShrink={0}>
            {children}
          </Box>
        </Box>
        <ScrollIndicator
          offset={state.offset}
          contentHeight={contentHeight}
          viewportHeight={viewportHeight}
          color={color}
        />
        {showSelection && (
          <SelectionOverlay
            selection={selection}
            offset={state.offset}
            viewportHeight={viewportHeight}
            lineText={lineText}
          />
        )}
      </Box>
      {showNewBelow && (
        <Box height={1} flexShrink={0} paddingX={1}>
          <Text color={color ? 'yellow' : undefined} bold>
            ↓ novo conteúdo (End)
          </Text>
        </Box>
      )}
    </Box>
  );
}
