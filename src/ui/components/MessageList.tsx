import { memo } from 'react';
import { Box, Text } from 'ink';
import stringWidth from 'string-width';
import type { ContentPart, Message } from '../../providers/types.js';
import type { Notice } from '../../session/controller.js';
import type { TerminalCapabilities } from '../hooks/useTerminalCapabilities.js';
import { Markdown } from '../markdown/Markdown.js';
import { describeCall, describeResult, fitArg } from '../toolDisplay.js';
import { DiffView } from './DiffView.js';

/** Diff rows shown under a write in the transcript (contracts/diff-view.md § 4). */
export const TRANSCRIPT_DIFF_LINES = 40;

/**
 * Rows of transcript kept rendered (scroll limit). Ink lays out and draws the whole tree on every
 * frame, clipped part included, so an unbounded transcript makes each keystroke slower (measured
 * at 100 columns: ~30 ms with 5 answers, ~100 ms with 120, ~630 ms with 240). Older items leave
 * the screen only: the session history (what the model sees) is untouched.
 */
export const TRANSCRIPT_MAX_ROWS = 2000;

type ToolResultPart = Extract<ContentPart, { type: 'tool_result' }>;
type ToolCallPart = Extract<ContentPart, { type: 'tool_call' }>;

export interface MessageListProps {
  history: Message[];
  notices: Notice[];
  partialText: string;
  generating: boolean;
  /** Columns available for message content. */
  width: number;
  capabilities: TerminalCapabilities;
  /** Rendered once at the top of the transcript (banner). */
  leading?: React.ReactNode;
}

export function textOf(m: Message): string {
  return m.content
    .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

/** Rough height of `text` in rows at `width` columns (wrapping only; markdown spacing ignored). */
export function textRows(text: string, width: number): number {
  const w = Math.max(1, width);
  let rows = 0;
  for (const line of text.split('\n')) rows += Math.max(1, Math.ceil(stringWidth(line) / w));
  return rows;
}

/**
 * Scroll limit: index of the first item to render so the newest items fit `budget` rows (each
 * item also takes one row of gap). The newest item is always rendered.
 */
export function firstVisible(rows: number[], budget: number): number {
  let first = rows.length;
  let left = budget;
  while (first > 0 && left - (rows[first - 1]! + 1) >= 0) {
    first--;
    left -= rows[first]! + 1;
  }
  return first === rows.length && first > 0 ? first - 1 : first;
}

const rowsCache = new WeakMap<Message, { width: number; rows: number }>();

/** Estimated rows of one transcript item (cached per message and width). */
export function messageRows(m: Message, width: number): number {
  const hit = rowsCache.get(m);
  if (hit && hit.width === width) return hit.rows;
  let rows: number;
  if (m.role === 'user') rows = textRows(m.display ?? textOf(m), width - 2);
  else if (m.role === 'assistant') {
    const text = textOf(m);
    rows = (m.route && m.route !== 'chat' ? 1 : 0) + (text !== '' ? textRows(text, width - 2) : 0);
    // `⏺ Label(arg)` + `⎿ summary`; a write's diff can add up to TRANSCRIPT_DIFF_LINES.
    for (const p of m.content)
      if (p.type === 'tool_call')
        rows += p.name === 'write_file' || p.name === 'edit_file' ? 3 + TRANSCRIPT_DIFF_LINES : 2;
  } else rows = m.content.length;
  rowsCache.set(m, { width, rows });
  return rows;
}

function NoticeLine({ notice, color }: { notice: Notice; color: boolean }) {
  const c = notice.level === 'error' ? 'red' : notice.level === 'warn' ? 'yellow' : 'gray';
  return (
    <Box paddingLeft={2}>
      <Text color={color ? c : undefined} dimColor={!color && notice.level === 'info'}>
        {notice.text}
      </Text>
    </Box>
  );
}

export interface AssistantBodyProps {
  text: string;
  width: number;
  color: boolean;
  streaming: boolean;
}

/** Assistant messages are markdown (FR-015); user and tool messages stay literal (FR-020). */
export function AssistantBody({ text, width, color, streaming }: AssistantBodyProps) {
  return <Markdown source={text} width={width} color={color} streaming={streaming} />;
}

/** `⏺ <markdown>`: the marker sits in its own column so the markdown keeps its layout. */
function AssistantText({ text, width, color, streaming }: AssistantBodyProps) {
  return (
    <Box flexDirection="row">
      <Box width={2} flexShrink={0}>
        <Text color={color ? (streaming ? 'white' : 'gray') : undefined}>⏺</Text>
      </Box>
      <Box flexDirection="column" width={Math.max(1, width - 2)}>
        <AssistantBody
          text={text}
          width={Math.max(1, width - 2)}
          color={color}
          streaming={streaming}
        />
      </Box>
    </Box>
  );
}

/** `⏺ Label(arg)` + `  ⎿  summary` (contracts/transcript.md § 2). */
function ToolCallView({
  call,
  result,
  width,
  color,
}: {
  call: ToolCallPart;
  result?: ToolResultPart;
  width: number;
  color: boolean;
}) {
  const view = describeCall(call.name, call.input, { display: result?.display });
  const res = result ? describeResult(call.name, result) : undefined;
  const c = (name: string) => (color ? name : undefined);
  const dot = !res
    ? c('gray')
    : res.tone === 'error'
      ? c('red')
      : res.tone === 'muted'
        ? c('yellow')
        : c('green');
  const argMax = Math.max(1, width - stringWidth(view.label) - 4);
  const arg = view.arg ? fitArg(view.arg, argMax, view.cut, stringWidth) : '';
  const tone = res?.tone === 'error' ? c('red') : res?.tone === 'muted' ? c('yellow') : undefined;
  return (
    <Box flexDirection="column">
      <Text wrap="truncate">
        <Text color={dot}>⏺ </Text>
        <Text bold>{view.label}</Text>
        {arg !== '' && <Text>{`(${arg})`}</Text>}
      </Text>
      {res && (
        <Box flexDirection="row">
          <Box width={5} flexShrink={0}>
            <Text dimColor>{'  ⎿  '}</Text>
          </Box>
          <Box flexDirection="column" width={Math.max(1, width - 5)}>
            {res.lines.map((l, i) => (
              <Text key={i} color={tone} dimColor={!tone && res.tone !== 'ok'} wrap="wrap">
                {l === '' ? ' ' : l}
              </Text>
            ))}
            {res.more > 0 && <Text dimColor>{`… +${res.more} linhas`}</Text>}
            {res.diff && res.diff.hunks.length > 0 && (
              <DiffView
                diff={res.diff}
                color={color}
                maxLines={TRANSCRIPT_DIFF_LINES}
                header="transcript"
              />
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}

const sameResults = (a: Array<ToolResultPart | undefined>, b: Array<ToolResultPart | undefined>) =>
  a.length === b.length && a.every((r, i) => r === b[i]);

const MessageItem = memo(
  function MessageItem({
    message,
    width,
    color,
    results,
  }: {
    message: Message;
    width: number;
    color: boolean;
    /** Result of each tool_call of this message, in order (paired by callId). */
    results: Array<ToolResultPart | undefined>;
  }) {
    if (message.role === 'user') {
      return (
        <Box>
          <Text color={color ? 'cyan' : undefined} bold>
            ›{' '}
          </Text>
          <Text>{message.display ?? textOf(message)}</Text>
        </Box>
      );
    }
    if (message.role === 'assistant') {
      const text = textOf(message);
      const calls = message.content.filter((p): p is ToolCallPart => p.type === 'tool_call');
      // Replies from a route other than chat are labelled (specs/008 contracts/route-resolution.md § 4).
      const routeLine =
        message.route && message.route !== 'chat'
          ? `⇢ ${message.route} · ${message.providerId ?? '?'}${message.model ? ` / ${message.model}` : ''}`
          : undefined;
      return (
        <Box flexDirection="column">
          {routeLine && (
            <Text color={color ? 'magenta' : undefined} dimColor={!color}>
              {routeLine}
            </Text>
          )}
          {text !== '' && (
            <AssistantText text={text} width={width} color={color} streaming={false} />
          )}
          {calls.map((c, i) => (
            <ToolCallView key={c.callId} call={c} result={results[i]} width={width} color={color} />
          ))}
        </Box>
      );
    }
    // Tool results not paired with a call (contracts/transcript.md § 3): generic form.
    return (
      <Box flexDirection="column">
        {message.content.map((p) =>
          p.type === 'tool_result' ? (
            <Text key={p.callId} dimColor color={p.isError && color ? 'red' : undefined}>
              {'  ⎿  '}
              {p.output.split('\n')[0]?.slice(0, 120)}
            </Text>
          ) : null,
        )}
      </Box>
    );
  },
  (a, b) =>
    a.message.id === b.message.id &&
    a.width === b.width &&
    a.color === b.color &&
    sameResults(a.results, b.results),
);

const NO_RESULTS: Array<ToolResultPart | undefined> = [];

export function MessageList({
  history,
  notices,
  partialText,
  generating,
  width,
  capabilities,
  leading,
}: MessageListProps) {
  const entries: Array<{ rows: number; render: () => React.ReactNode }> = [];
  let noticeIdx = 0;
  const sorted = [...notices].sort((a, b) => a.position - b.position || a.id - b.id);
  const color = capabilities.color;

  // Pair every tool_call with its result (research R6).
  const resultsById = new Map<string, ToolResultPart>();
  const callIds = new Set<string>();
  for (const m of history) {
    for (const p of m.content) {
      if (p.type === 'tool_result') resultsById.set(p.callId, p);
      else if (p.type === 'tool_call') callIds.add(p.callId);
    }
  }

  const flushNotices = (upTo: number) => {
    while (noticeIdx < sorted.length && sorted[noticeIdx]!.position <= upTo) {
      const n = sorted[noticeIdx]!;
      entries.push({
        rows: textRows(n.text, width - 2),
        render: () => <NoticeLine key={`n${n.id}`} notice={n} color={color} />,
      });
      noticeIdx++;
    }
  };

  history.forEach((m, i) => {
    flushNotices(i);
    if (m.role === 'tool') {
      const orphan = m.content.some((p) => p.type === 'tool_result' && !callIds.has(p.callId));
      if (!orphan) return; // shown under its call
    }
    const results =
      m.role === 'assistant'
        ? m.content
            .filter((p): p is ToolCallPart => p.type === 'tool_call')
            .map((c) => resultsById.get(c.callId))
        : NO_RESULTS;
    entries.push({
      rows: messageRows(m, width),
      render: () => (
        <MessageItem key={m.id} message={m} width={width} color={color} results={results} />
      ),
    });
  });
  flushNotices(Number.MAX_SAFE_INTEGER);

  const first = firstVisible(
    entries.map((e) => e.rows),
    TRANSCRIPT_MAX_ROWS - (generating ? textRows(partialText, width - 2) : 0),
  );

  return (
    <Box flexDirection="column" paddingX={1} gap={1} width={width + 2}>
      {first > 0 ? (
        <Text dimColor>
          {`↑ ${first} ${first === 1 ? 'item anterior' : 'itens anteriores'} fora da rolagem (o modelo ainda vê a conversa inteira; /clear limpa)`}
        </Text>
      ) : (
        leading
      )}
      {entries.slice(first).map((e) => e.render())}
      {generating && partialText !== '' && (
        <AssistantText text={partialText} width={width} color={color} streaming />
      )}
    </Box>
  );
}
