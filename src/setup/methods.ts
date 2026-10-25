import {
  DASHSCOPE_INTL_BASE_URL,
  DEFAULT_DASHSCOPE_BASE_URL,
  DEFAULTS,
  KNOWN_QWEN_BASE_URLS,
  QWEN_DEFAULT_BASE_URLS,
  QWENCLOUD_ANTHROPIC_BASE_URL,
  QWENCLOUD_OPENAI_BASE_URL,
} from '../config/defaults.js';
import type { QwenProtocol } from '../config/defaults.js';
import type { Settings } from '../config/schema.js';
import type { ProviderId, ProviderStatus } from '../providers/types.js';

export type MethodId = 'claude-api' | 'claude-login' | 'claude-code' | 'qwen';
export type FieldKey = 'protocol' | 'apiKey' | 'baseUrl' | 'model';
export type Values = Record<FieldKey, string>;

export interface ChoiceOption {
  value: string;
  label: string;
  description?: string;
}

export interface FieldSpec {
  key: FieldKey;
  label: string;
  /** `text` (default) or `choice` (↑/↓ pick one of `options`). */
  kind?: 'text' | 'choice';
  options?: ChoiceOption[];
  secret: boolean;
  required: boolean;
  default?: string;
  /** Default that depends on earlier answers (e.g. endpoint per protocol). */
  defaultFor?: (values: Values) => string | undefined;
  /** Values considered "untouched defaults" — replaced when `defaultFor` changes. */
  knownDefaults?: readonly string[];
  hint?: string;
  /** Returns an error message, or undefined when valid. */
  validate: (value: string) => string | undefined;
}

export interface ConnectionMethod {
  id: MethodId;
  label: string;
  description: string;
  providerId: ProviderId;
  kind: 'fields' | 'login';
  fields: FieldSpec[];
}

const URL_RE = /^https?:\/\/\S+$/;

const apiKeyField = (label: string): FieldSpec => ({
  key: 'apiKey',
  label,
  secret: true,
  required: true,
  validate: (v) => {
    const t = v.trim();
    if (t === '') return 'informe a chave';
    if (/\s/.test(t)) return 'a chave não pode conter espaços';
    return undefined;
  },
});

const modelField = (def: string): FieldSpec => ({
  key: 'model',
  label: 'Modelo',
  secret: false,
  required: true,
  default: def,
  validate: (v) => (v.trim() === '' ? 'informe o modelo' : undefined),
});

export const QWEN_PROTOCOL_OPTIONS: ChoiceOption[] = [
  { value: 'openai', label: 'OpenAI compatível', description: QWENCLOUD_OPENAI_BASE_URL },
  { value: 'anthropic', label: 'Anthropic compatível', description: QWENCLOUD_ANTHROPIC_BASE_URL },
];

export const CONNECTION_METHODS: ConnectionMethod[] = [
  {
    id: 'claude-api',
    label: 'Claude API',
    description: 'chave de API · consome créditos de API',
    providerId: 'claude',
    kind: 'fields',
    fields: [
      apiKeyField('Chave de API (sk-ant-…)'),
      {
        key: 'baseUrl',
        label: 'Endpoint (opcional)',
        secret: false,
        required: false,
        hint: 'deixe vazio para usar a API da Anthropic',
        validate: (v) =>
          v.trim() === '' || URL_RE.test(v.trim()) ? undefined : 'use http:// ou https://',
      },
      modelField(DEFAULTS.claude.model),
    ],
  },
  {
    id: 'claude-login',
    label: 'Claude Auth Login',
    description: 'login do console (ant) · consome créditos',
    providerId: 'claude',
    kind: 'login',
    fields: [],
  },
  {
    id: 'qwen',
    label: 'Qwen',
    description: 'Qwen Cloud / Alibaba Cloud (OpenAI ou Anthropic compatível)',
    providerId: 'qwen',
    kind: 'fields',
    fields: [
      {
        key: 'protocol',
        label: 'Protocolo',
        kind: 'choice',
        options: QWEN_PROTOCOL_OPTIONS,
        secret: false,
        required: true,
        default: DEFAULTS.qwen.protocol,
        validate: (v) =>
          QWEN_PROTOCOL_OPTIONS.some((o) => o.value === v) ? undefined : 'escolha um protocolo',
      },
      {
        key: 'baseUrl',
        label: 'Endpoint',
        secret: false,
        required: true,
        defaultFor: (values) =>
          QWEN_DEFAULT_BASE_URLS[(values.protocol as QwenProtocol) || 'openai'],
        knownDefaults: KNOWN_QWEN_BASE_URLS,
        hint: `DashScope (pay-as-you-go): ${DEFAULT_DASHSCOPE_BASE_URL} · internacional: ${DASHSCOPE_INTL_BASE_URL}`,
        validate: (v) => (URL_RE.test(v.trim()) ? undefined : 'use http:// ou https://'),
      },
      apiKeyField('Chave de API (sk-…)'),
      modelField(DEFAULTS.qwen.model),
    ],
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    description: 'Claude Code instalado · usa a assinatura',
    providerId: 'claude-code',
    kind: 'login',
    fields: [],
  },
];

export function methodById(id: MethodId): ConnectionMethod {
  const m = CONNECTION_METHODS.find((x) => x.id === id);
  if (!m) throw new Error(`unknown connection method: ${id}`);
  return m;
}

/** Default of a field given the other values (static default or `defaultFor`). */
export function fieldDefault(field: FieldSpec, values: Values): string {
  return field.defaultFor?.(values) ?? field.default ?? '';
}

export type MethodStatus = 'not_configured' | 'configured' | 'active';

/** Derives the menu state of a method from provider statuses (data-model § 1). */
export function methodStatus(method: ConnectionMethod, statuses: ProviderStatus[]): MethodStatus {
  const s = statuses.find((x) => x.id === method.providerId);
  if (!s) return 'not_configured';
  const matches =
    method.id === 'claude-login'
      ? s.credentialSource === 'profile'
      : method.id === 'claude-api'
        ? s.credentialSource === 'config' || s.credentialSource === 'env'
        : s.configured;
  if (!matches || !s.configured) return 'not_configured';
  return s.active ? 'active' : 'configured';
}

/** Human label for the menu's right column (contracts/dialog-flows.md § 2). */
export function methodStatusLabel(
  status: MethodStatus,
  s: ProviderStatus | undefined,
  method: ConnectionMethod,
): string {
  if (status === 'not_configured') return 'não configurado';
  const how =
    method.id === 'claude-code'
      ? 'Claude Code'
      : method.id === 'claude-login'
        ? 'perfil'
        : s?.maskedKey
          ? `chave ${s.maskedKey}`
          : s?.credentialSource === 'env'
            ? 'ambiente'
            : 'chave';
  return status === 'active' ? `ativo (${how})` : `configurado (${how})`;
}

/** Values to pre-fill the fields with (secrets are never returned; the UI shows the masked key). */
export function currentValues(method: ConnectionMethod, settings: Settings): Values {
  const p = settings.providers[method.providerId];
  const protocol = method.providerId === 'qwen' ? settings.providers.qwen.protocol : '';
  const partial: Values = { protocol, apiKey: '', baseUrl: '', model: '' };
  const baseUrlField = method.fields.find((f) => f.key === 'baseUrl');
  const storedUrl = 'baseUrl' in p ? p.baseUrl : undefined;
  partial.baseUrl = storedUrl ?? (baseUrlField ? fieldDefault(baseUrlField, partial) : '');
  const modelField = method.fields.find((f) => f.key === 'model');
  partial.model = p.model ?? (modelField ? fieldDefault(modelField, partial) : '');
  return partial;
}
