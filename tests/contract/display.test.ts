/**
 * specs/009 data-model § 3: `tool_result.display` is display-only. Every provider conversion
 * must produce exactly the same request with or without it.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => import('../helpers/anthropicMock.js'));
vi.mock('openai', () => import('../helpers/openaiMock.js'));

import { toAnthropicMessages } from '../../src/providers/anthropicProtocol.js';
import { buildUserMessage } from '../../src/providers/claudeCodeStream.js';
import { toOpenAIMessages } from '../../src/providers/qwen.js';
import type { Message } from '../../src/providers/types.js';
import { fileDiff } from '../../src/tools/diff.js';

const at = new Date(0);
function history(withDisplay: boolean): Message[] {
  return [
    { id: 'u', role: 'user', content: [{ type: 'text', text: 'escreva a.txt' }], createdAt: at },
    {
      id: 'a',
      role: 'assistant',
      content: [{ type: 'tool_call', callId: 'c1', name: 'write_file', input: { path: 'a.txt' } }],
      createdAt: at,
    },
    {
      id: 't',
      role: 'tool',
      content: [
        {
          type: 'tool_result',
          callId: 'c1',
          output: 'wrote 3 bytes to a.txt',
          isError: false,
          ...(withDisplay
            ? {
                display: {
                  diff: fileDiff('x\n', 'y\n', 'a.txt'),
                  autoMode: 'auto' as const,
                  declined: true,
                  speckitStep: 'setup-plan',
                  summary: 'SEGREDO-DE-EXIBICAO',
                },
              }
            : {}),
        },
      ],
      createdAt: at,
    },
    { id: 'u2', role: 'user', content: [{ type: 'text', text: 'e agora?' }], createdAt: at },
  ];
}

describe('contract: display metadata never reaches the model (specs/009)', () => {
  it('Anthropic protocol (claude, qwen anthropic)', () => {
    const a = toAnthropicMessages(history(true));
    expect(a).toEqual(toAnthropicMessages(history(false)));
    expect(JSON.stringify(a)).not.toContain('SEGREDO-DE-EXIBICAO');
  });
  it('OpenAI protocol (qwen)', () => {
    const o = toOpenAIMessages('sys', history(true));
    expect(o).toEqual(toOpenAIMessages('sys', history(false)));
    expect(JSON.stringify(o)).not.toContain('SEGREDO-DE-EXIBICAO');
  });
  it('Claude Code stdin message', () => {
    const c = buildUserMessage(history(true));
    expect(c).toEqual(buildUserMessage(history(false)));
    expect(JSON.stringify(c)).not.toContain('SEGREDO-DE-EXIBICAO');
  });
});
