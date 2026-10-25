import type { Settings } from '../config/schema.js';
import type { CredentialSource } from '../config/loader.js';
import type { MaestroError } from '../utils/errors.js';
import type { ToolDefinition } from '../tools/types.js';

export type { ProviderId } from '../config/schema.js';
import type { ProviderId } from '../config/schema.js';

export type Role = 'user' | 'assistant' | 'tool';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; callId: string; name: string; input: unknown }
  | { type: 'tool_result'; callId: string; output: string; isError: boolean };

export interface Message {
  id: string;
  role: Role;
  content: ContentPart[];
  createdAt: Date;
  providerId?: ProviderId;
  model?: string;
}

export interface ProviderRequest {
  messages: Message[];
  system: string;
  tools: ToolDefinition[];
  model?: string;
  signal: AbortSignal;
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'cancelled';

export type ProviderEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; callId: string; name: string; input: unknown }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'done'; stopReason: StopReason; detail?: string }
  | { type: 'error'; error: MaestroError };

export interface ProviderStatus {
  id: ProviderId;
  displayName: string;
  enabled: boolean;
  configured: boolean;
  active: boolean;
  model: string;
  credentialSource: CredentialSource;
  maskedKey?: string;
  missing: string[];
  hint?: string;
  /** false when the credentials were saved without a successful connection test (feature 003). */
  verified?: boolean;
}

export interface ModelProvider {
  readonly id: ProviderId;
  readonly displayName: string;
  status(): ProviderStatus;
  stream(req: ProviderRequest): AsyncIterable<ProviderEvent>;
}

export interface ProviderContext {
  settings: Settings;
  credentialSources: Record<ProviderId, CredentialSource>;
  activeId: ProviderId;
  env?: NodeJS.ProcessEnv;
  /** Providers configured through /auth without a passing connection test. */
  unverified?: Set<ProviderId>;
}

export type ProviderFactory = (ctx: ProviderContext) => ModelProvider;
