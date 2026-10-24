import { PROVIDER_IDS } from '../config/schema.js';
import { MaestroError } from '../utils/errors.js';
import { describeProvider } from './status.js';
import type {
  ModelProvider,
  ProviderContext,
  ProviderFactory,
  ProviderId,
  ProviderStatus,
} from './types.js';

const factories: Partial<Record<ProviderId, ProviderFactory>> = {};

/** Registers a provider implementation. Called once per provider at module load (claude.ts, qwen.ts). */
export function registerProvider(id: ProviderId, factory: ProviderFactory): void {
  factories[id] = factory;
}

export function registeredProviders(): ProviderId[] {
  return PROVIDER_IDS.filter((id) => factories[id] !== undefined);
}

export function createProvider(id: ProviderId, ctx: ProviderContext): ModelProvider {
  const factory = factories[id];
  if (!factory) {
    throw new MaestroError({
      category: 'invalid_config',
      message: `Provider '${id}' is not available in this build.`,
    });
  }
  return factory(ctx);
}

/** Status of every known provider (registered or not), without network access. */
export function listStatuses(ctx: ProviderContext): ProviderStatus[] {
  return PROVIDER_IDS.map((id) => describeProvider(id, ctx));
}

/** First provider (in declaration order) that is enabled and configured, excluding `exclude`. */
export function findAlternative(
  statuses: ProviderStatus[],
  exclude: ProviderId,
): ProviderStatus | undefined {
  return statuses.find((s) => s.id !== exclude && s.configured && factories[s.id] !== undefined);
}
