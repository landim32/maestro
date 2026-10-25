import type { Settings } from '../config/schema.js';
import type { CredentialSource } from '../config/loader.js';
import type { MaestroError } from '../utils/errors.js';
import type { ToolDefinition, ToolResultDisplay } from '../tools/types.js';

export type { ProviderId } from '../config/schema.js';
import type { Effort, ProviderId } from '../config/schema.js';

export type Role = 'user' | 'assistant' | 'tool';

export type ContentPart =
  | { type: 'text'; text: string }
  /** Base64 image attached by the user (specs/007); only providers with `capabilities.images` receive it. */
  | { type: 'image'; mediaType: string; data: string; name?: string }
  | { type: 'tool_call'; callId: string; name: string; input: unknown }
  | {
      type: 'tool_result';
      callId: string;
      output: string;
      isError: boolean;
      /** Display only (specs/009); never sent to the model. */
      display?: ToolResultDisplay;
    };

export interface Message {
  id: string;
  role: Role;
  content: ContentPart[];
  createdAt: Date;
  providerId?: ProviderId;
  model?: string;
  /** Transcript label when `content` is a composed prompt (e.g. `/speckit.plan`); never sent to the model. */
  display?: string;
  /** Route that produced an assistant message (specs/008); absent = chat. */
  route?: string;
}

export interface ProviderRequest {
  messages: Message[];
  system: string;
  tools: ToolDefinition[];
  model?: string;
  signal: AbortSignal;
  /** Per-turn adjustments from the route (specs/008); providers apply what they support. */
  overrides?: { effort?: Effort; maxTokens?: number };
  /**
   * Present for providers with `capabilities.executesTools` (specs/010): the provider runs its own
   * tool loop and calls back here for every tool call; the turn applies validation, interception
   * and the approval policy, and records the call and its result in the session history.
   */
  runTool?: (call: ToolCallRequest) => Promise<{ output: string; isError: boolean }>;
}

export interface ToolCallRequest {
  callId: string;
  name: string;
  input: unknown;
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
  /** Optional features; absent → text only (image parts are dropped before the request). */
  readonly capabilities?: {
    images?: boolean;
    /** The provider drives the tool loop itself through `ProviderRequest.runTool` (specs/010). */
    executesTools?: boolean;
  };
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
