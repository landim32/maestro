import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { ContentPart, Message, ProviderId } from '../providers/types.js';
import type { PendingQuestion, PendingToolAction, ToolResultDisplay } from '../tools/types.js';

export type SessionState = 'idle' | 'generating' | 'awaiting_confirmation' | 'awaiting_answer';

export class SessionBusyError extends Error {
  constructor(action: string) {
    super(`Cannot ${action} while a response is in progress.`);
    this.name = 'SessionBusyError';
  }
}

export interface SessionInit {
  cwd: string;
  activeProviderId: ProviderId;
  modelOverride?: string;
}

export interface SessionEvents {
  change: [];
}

/** Holds conversation state for one interactive run (data-model.md § 4). */
export class Session extends EventEmitter<SessionEvents> {
  readonly cwd: string;
  activeProviderId: ProviderId;
  modelOverride?: string;
  history: Message[] = [];
  /**
   * Messages cleared from the model's context but still on screen (the autopilot starts each step
   * with a clean conversation, specs/011); emptied by a plain clear.
   */
  archived: Message[] = [];
  state: SessionState = 'idle';
  pendingConfirmation?: PendingToolAction;
  /** `ask_user` waiting for the UI (contracts/ask-user.md). At most one of the two pendings is set. */
  pendingQuestion?: PendingQuestion;
  abortController?: AbortController;

  constructor(init: SessionInit) {
    super();
    this.cwd = init.cwd;
    this.activeProviderId = init.activeProviderId;
    this.modelOverride = init.modelOverride;
  }

  private changed(): void {
    this.emit('change');
  }

  /**
   * Returns false (and does nothing) for empty/whitespace-only text (FR-007).
   * `extra` parts (images, specs/007) are appended after the text.
   */
  pushUser(text: string, display?: string, extra: ContentPart[] = []): boolean {
    if (text.trim() === '') return false;
    this.history.push({
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text }, ...extra],
      createdAt: new Date(),
      display,
    });
    this.changed();
    return true;
  }

  pushAssistant(
    parts: ContentPart[],
    providerId: ProviderId,
    model?: string,
    route?: string,
  ): void {
    if (parts.length === 0) return;
    this.history.push({
      id: randomUUID(),
      role: 'assistant',
      content: parts,
      createdAt: new Date(),
      providerId,
      model,
      ...(route ? { route } : {}),
    });
    this.changed();
  }

  pushToolResults(
    results: Array<{
      callId: string;
      output: string;
      isError: boolean;
      display?: ToolResultDisplay;
    }>,
  ): void {
    if (results.length === 0) return;
    this.history.push({
      id: randomUUID(),
      role: 'tool',
      content: results.map((r) => ({ type: 'tool_result', ...r })),
      createdAt: new Date(),
    });
    this.changed();
  }

  /** `keepTranscript`: the model starts over, but the screen keeps showing what came before. */
  clear(opts: { keepTranscript?: boolean } = {}): void {
    if (this.state !== 'idle') throw new SessionBusyError('clear the conversation');
    this.archived = opts.keepTranscript ? [...this.archived, ...this.history] : [];
    this.history = [];
    this.changed();
  }

  /** What the transcript shows: the archived messages followed by the current conversation. */
  get transcript(): Message[] {
    return this.archived.length === 0 ? this.history : [...this.archived, ...this.history];
  }

  switchProvider(id: ProviderId, model?: string): void {
    if (this.state !== 'idle') throw new SessionBusyError('switch provider');
    this.activeProviderId = id;
    this.modelOverride = model;
    this.changed();
  }

  setState(state: SessionState): void {
    this.state = state;
    this.changed();
  }

  setPendingConfirmation(action: PendingToolAction | undefined): void {
    this.pendingConfirmation = action;
    this.setState(action ? 'awaiting_confirmation' : 'generating');
  }

  setPendingQuestion(question: PendingQuestion | undefined): void {
    this.pendingQuestion = question;
    this.setState(question ? 'awaiting_answer' : 'generating');
  }

  beginGeneration(): AbortController {
    this.abortController = new AbortController();
    this.setState('generating');
    return this.abortController;
  }

  endGeneration(): void {
    this.abortController = undefined;
    this.pendingConfirmation = undefined;
    this.pendingQuestion = undefined;
    this.setState('idle');
  }

  /** Aborts the turn; a pending question is answered as "declined" so the tool can finish. */
  cancel(): void {
    const question = this.pendingQuestion;
    if (question) {
      this.pendingQuestion = undefined;
      question.resolve({ answered: false });
    }
    this.abortController?.abort();
  }
}
