import { memo } from 'react';
import { Box, Text } from 'ink';
import type { Message } from '../../providers/types.js';
import type { Notice } from '../../session/controller.js';
import type { TerminalCapabilities } from '../hooks/useTerminalCapabilities.js';
import { Markdown } from '../markdown/Markdown.js';

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

const MessageItem = memo(
  function MessageItem({
    message,
    width,
    color,
  }: {
    message: Message;
    width: number;
    color: boolean;
  }) {
    if (message.role === 'user') {
      return (
        <Box>
          <Text color={color ? 'cyan' : undefined} bold>
            ›{' '}
          </Text>
          <Text>{textOf(message)}</Text>
        </Box>
      );
    }
    if (message.role === 'assistant') {
      const text = textOf(message);
      const calls = message.content.filter((p) => p.type === 'tool_call');
      return (
        <Box flexDirection="column">
          {text !== '' && (
            <AssistantBody text={text} width={width} color={color} streaming={false} />
          )}
          {calls.map((c) =>
            c.type === 'tool_call' ? (
              <Text key={c.callId} dimColor>
                ⚙ {c.name}
              </Text>
            ) : null,
          )}
        </Box>
      );
    }
    return (
      <Box flexDirection="column" paddingLeft={2}>
        {message.content.map((p) =>
          p.type === 'tool_result' ? (
            <Text key={p.callId} dimColor color={p.isError && color ? 'yellow' : undefined}>
              {p.isError ? '✗' : '✓'} {p.output.split('\n')[0]?.slice(0, 120)}
              {p.output.includes('\n') || p.output.length > 120 ? ' …' : ''}
            </Text>
          ) : null,
        )}
      </Box>
    );
  },
  (a, b) => a.message.id === b.message.id && a.width === b.width && a.color === b.color,
);

export function MessageList({
  history,
  notices,
  partialText,
  generating,
  width,
  capabilities,
  leading,
}: MessageListProps) {
  const items: React.ReactNode[] = [];
  let noticeIdx = 0;
  const sorted = [...notices].sort((a, b) => a.position - b.position || a.id - b.id);
  const color = capabilities.color;

  const flushNotices = (upTo: number) => {
    while (noticeIdx < sorted.length && sorted[noticeIdx]!.position <= upTo) {
      const n = sorted[noticeIdx]!;
      items.push(<NoticeLine key={`n${n.id}`} notice={n} color={color} />);
      noticeIdx++;
    }
  };

  history.forEach((m, i) => {
    flushNotices(i);
    items.push(<MessageItem key={m.id} message={m} width={width} color={color} />);
  });
  flushNotices(Number.MAX_SAFE_INTEGER);

  return (
    <Box flexDirection="column" paddingX={1} gap={1} width={width + 2}>
      {leading}
      {items}
      {generating && (
        <Box flexDirection="column">
          {partialText !== '' && (
            <AssistantBody text={partialText} width={width} color={color} streaming />
          )}
          <Text color={color ? 'cyan' : undefined}>▍</Text>
        </Box>
      )}
    </Box>
  );
}
