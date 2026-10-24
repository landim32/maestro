import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { Box, Text, useBoxMetrics } from 'ink';
import type { DOMElement } from 'ink';
import type { TerminalCapabilities } from '../hooks/useTerminalCapabilities.js';
import { useViewport } from '../hooks/useViewport.js';
import type { ViewportActions } from '../hooks/useViewport.js';
import { ScrollIndicator } from './ScrollIndicator.js';

export interface TranscriptProps {
  capabilities: TerminalCapabilities;
  /** Receives the scroll actions once mounted (used by keyboard/mouse handlers in App). */
  actionsRef: RefObject<ViewportActions | null>;
  /** Called whenever `scrollable` changes (for status hints). */
  onScrollableChange?: (scrollable: boolean) => void;
  children: React.ReactNode;
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
  children,
}: TranscriptProps) {
  const outerRef = useRef<DOMElement | null>(null);
  const innerRef = useRef<DOMElement | null>(null);
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

  const color = capabilities.color;
  const showNewBelow = state.newBelow && !state.follow;

  return (
    <Box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={3} overflow="hidden">
      {/* minHeight={0} everywhere: Yoga's default min-height:auto would otherwise refuse to shrink below the content. */}
      <Box flexDirection="row" flexGrow={1} flexShrink={1} minHeight={0} overflow="hidden">
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
