import { describe, expect, it } from 'vitest';
import { toAnthropicMessages, toAnthropicTools } from '../../src/providers/claude.js';
import { toOpenAIMessages, toOpenAITools } from '../../src/providers/qwen.js';
import type { Message } from '../../src/providers/types.js';
import { allTools } from '../../src/tools/registry.js';

const at = new Date('2026-10-24T12:00:00Z');

/** The canonical fixture from contracts/provider-interface.md § 6. */
const history: Message[] = [
  {
    id: 'u1',
    role: 'user',
    content: [{ type: 'text', text: 'Summarize notes.txt and then list the folder' }],
    createdAt: at,
  },
  {
    id: 'a1',
    role: 'assistant',
    providerId: 'claude',
    content: [
      { type: 'text', text: 'Let me look.' },
      { type: 'tool_call', callId: 'call_read', name: 'read_file', input: { path: 'notes.txt' } },
      {
        type: 'tool_call',
        callId: 'call_ls',
        name: 'list_directory',
        input: { path: '.', recursive: false },
      },
    ],
    createdAt: at,
  },
  {
    id: 't1',
    role: 'tool',
    content: [
      { type: 'tool_result', callId: 'call_read', output: '1\thello notes', isError: false },
      { type: 'tool_result', callId: 'call_ls', output: 'path outside workspace', isError: true },
    ],
    createdAt: at,
  },
  {
    id: 'a2',
    role: 'assistant',
    providerId: 'claude',
    content: [{ type: 'text', text: 'The file says hello.' }],
    createdAt: at,
  },
];

describe('contract: history and tool conversion per provider', () => {
  it('Anthropic messages', () => {
    expect(toAnthropicMessages(history)).toMatchSnapshot();
  });
  it('Anthropic tools (all four workspace tools)', () => {
    expect(toAnthropicTools(allTools())).toMatchSnapshot();
  });
  it('OpenAI-compatible messages', () => {
    expect(toOpenAIMessages('SYSTEM', history)).toMatchSnapshot();
  });
  it('OpenAI-compatible tools (all four workspace tools)', () => {
    expect(toOpenAITools(allTools())).toMatchSnapshot();
  });
  it('both conversions keep tool call ids aligned with their results', () => {
    const a = toAnthropicMessages(history);
    const toolUses = (a[1]!.content as Array<{ type: string; id?: string }>)
      .filter((b) => b.type === 'tool_use')
      .map((b) => b.id);
    const results = (a[2]!.content as Array<{ type: string; tool_use_id?: string }>).map(
      (b) => b.tool_use_id,
    );
    expect(results).toEqual(toolUses);

    const o = toOpenAIMessages('S', history);
    const calls = (o[2] as { tool_calls: Array<{ id: string }> }).tool_calls.map((c) => c.id);
    const toolMsgs = o
      .filter((m) => m.role === 'tool')
      .map((m) => (m as { tool_call_id: string }).tool_call_id);
    expect(toolMsgs).toEqual(calls);
  });
});
