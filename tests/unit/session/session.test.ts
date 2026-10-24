import { describe, expect, it, vi } from 'vitest';
import { Session, SessionBusyError } from '../../../src/session/session.js';

function make() {
  return new Session({ cwd: '/work', activeProviderId: 'claude' });
}

describe('Session', () => {
  it('starts idle with an empty history', () => {
    const s = make();
    expect(s.state).toBe('idle');
    expect(s.history).toEqual([]);
  });

  it('ignores empty or whitespace-only user messages (FR-007)', () => {
    const s = make();
    expect(s.pushUser('')).toBe(false);
    expect(s.pushUser('   \n')).toBe(false);
    expect(s.history).toHaveLength(0);
    expect(s.pushUser('hi')).toBe(true);
    expect(s.history[0]).toMatchObject({ role: 'user', content: [{ type: 'text', text: 'hi' }] });
  });

  it('records assistant messages with provider and model, skipping empty content', () => {
    const s = make();
    s.pushAssistant([], 'claude');
    expect(s.history).toHaveLength(0);
    s.pushAssistant([{ type: 'text', text: 'hello' }], 'qwen', 'qwen3-coder-plus');
    expect(s.history[0]).toMatchObject({
      role: 'assistant',
      providerId: 'qwen',
      model: 'qwen3-coder-plus',
    });
  });

  it('records tool results as a single tool message', () => {
    const s = make();
    s.pushToolResults([
      { callId: 'a', output: 'x', isError: false },
      { callId: 'b', output: 'declined', isError: true },
    ]);
    expect(s.history[0]?.role).toBe('tool');
    expect(s.history[0]?.content).toHaveLength(2);
  });

  it('transitions idle → generating → idle and exposes an AbortController', () => {
    const s = make();
    const ac = s.beginGeneration();
    expect(s.state).toBe('generating');
    expect(s.abortController).toBe(ac);
    s.cancel();
    expect(ac.signal.aborted).toBe(true);
    s.endGeneration();
    expect(s.state).toBe('idle');
    expect(s.abortController).toBeUndefined();
  });

  it('enters awaiting_confirmation and back to generating', () => {
    const s = make();
    s.beginGeneration();
    s.setPendingConfirmation({
      callId: 'c1',
      tool: {} as never,
      input: {},
      previewText: 'preview',
      resolve: () => {},
    });
    expect(s.state).toBe('awaiting_confirmation');
    s.setPendingConfirmation(undefined);
    expect(s.state).toBe('generating');
  });

  it('rejects /clear and provider switch while not idle, preserving history on switch', () => {
    const s = make();
    s.pushUser('a');
    s.beginGeneration();
    expect(() => s.clear()).toThrow(SessionBusyError);
    expect(() => s.switchProvider('qwen')).toThrow(SessionBusyError);
    s.endGeneration();
    s.switchProvider('qwen', 'qwen-max');
    expect(s.activeProviderId).toBe('qwen');
    expect(s.modelOverride).toBe('qwen-max');
    expect(s.history).toHaveLength(1);
    s.clear();
    expect(s.history).toHaveLength(0);
  });

  it('emits change on every mutation', () => {
    const s = make();
    const spy = vi.fn();
    s.on('change', spy);
    s.pushUser('x');
    s.beginGeneration();
    s.endGeneration();
    s.switchProvider('qwen');
    s.clear();
    expect(spy).toHaveBeenCalledTimes(5);
  });
});
