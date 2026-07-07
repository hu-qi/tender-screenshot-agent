import {
  createModels,
  createProvider,
  type ApiKeyCredential,
  type Credential,
  type CredentialStore,
  type Model,
  type Models,
} from '@earendil-works/pi-ai';
import { envApiKeyAuth } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import { MacOSKeychainStore, modelApiKeyAccount } from './keychain.js';
import { TenderStore } from './store.js';

export type ModelMode = 'disabled' | 'orchestrate';
export type ModelProviderKind = 'builtin' | 'openai-compatible';
export type ModelAuthMode = 'keychain' | 'none';
export type ModelDataPolicy = 'metadata-only' | 'redacted-text';
export type ModelEgressPolicy = 'local-only' | 'internal-only' | 'external-approved';

export interface ModelProfile {
  enabled: boolean;
  mode: ModelMode;
  profile: string;
  providerKind: ModelProviderKind;
  provider: string;
  model: string;
  baseUrl?: string;
  authMode: ModelAuthMode;
  dataPolicy: ModelDataPolicy;
  egressPolicy: ModelEgressPolicy;
  allowedHosts: string[];
  maxRequestsPerRun: number;
  maxInputChars: number;
  maxOutputTokens: number;
  contextWindow: number;
}

export interface ResolvedModelProfile {
  config: ModelProfile;
  model: Model<any>;
  models: Models;
}

const COST_ZERO = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

class KeychainCredentialStore implements CredentialStore {
  constructor(
    private readonly providerId: string,
    private readonly account: string,
    private readonly authMode: ModelAuthMode,
    private readonly keychain = new MacOSKeychainStore(),
  ) {}

  async read(providerId: string): Promise<Credential | undefined> {
    if (providerId !== this.providerId || this.authMode === 'none') return undefined;
    const key = await this.keychain.get(this.account);
    return key ? { type: 'api_key', key } satisfies ApiKeyCredential : undefined;
  }

  async modify(providerId: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>): Promise<Credential | undefined> {
    const current = await this.read(providerId);
    return fn(current);
  }

  async delete(_providerId: string): Promise<void> {
    // Credential deletion is explicit through `npm run local:config:clear-model`.
  }
}

function readProfile(store: TenderStore): ModelProfile | undefined {
  return store.getPublicSetting<ModelProfile>('llm')?.value;
}

function validateStoredProfile(profile: ModelProfile): void {
  if (!profile.enabled || profile.mode === 'disabled') return;
  if (!profile.provider || !profile.model || !profile.profile) throw new Error('stored model profile is incomplete; run npm run local:config:apply');
  if (!['builtin', 'openai-compatible'].includes(profile.providerKind)) throw new Error('stored model provider kind is unsupported');
  if (!['keychain', 'none'].includes(profile.authMode)) throw new Error('stored model auth mode is unsupported');
  if (!['metadata-only', 'redacted-text'].includes(profile.dataPolicy)) throw new Error('stored model data policy is unsupported');
  if (!['local-only', 'internal-only', 'external-approved'].includes(profile.egressPolicy)) throw new Error('stored model egress policy is unsupported');
}

function customOpenAICompatibleModels(profile: ModelProfile, credentials: CredentialStore): ResolvedModelProfile {
  if (!profile.baseUrl) throw new Error('openai-compatible model profile requires baseUrl');
  const providerId = `tender-${profile.profile}`;
  const models = createModels({ credentials });
  models.setProvider(createProvider({
    id: providerId,
    name: `Tender ${profile.profile}`,
    baseUrl: profile.baseUrl,
    auth: profile.authMode === 'none'
      ? { apiKey: { name: 'No API key', resolve: async () => ({ auth: {} }) } }
      : { apiKey: envApiKeyAuth('Tender model API key', []) },
    models: [{
      id: profile.model,
      name: profile.model,
      api: 'openai-completions',
      provider: providerId,
      baseUrl: profile.baseUrl,
      reasoning: false,
      input: ['text'],
      cost: COST_ZERO,
      contextWindow: profile.contextWindow,
      maxTokens: profile.maxOutputTokens,
    }],
    api: openAICompletionsApi(),
  }));
  const model = models.getModel(providerId, profile.model);
  if (!model) throw new Error('configured openai-compatible model is unavailable');
  return { config: profile, model, models };
}

export class ModelProfileRuntime {
  constructor(private readonly store: TenderStore) {}

  getConfig(): ModelProfile | undefined {
    return readProfile(this.store);
  }

  async resolve(): Promise<ResolvedModelProfile | undefined> {
    const profile = readProfile(this.store);
    if (!profile || !profile.enabled || profile.mode === 'disabled') return undefined;
    validateStoredProfile(profile);

    const providerId = profile.providerKind === 'builtin' ? profile.provider : `tender-${profile.profile}`;
    const credentials = new KeychainCredentialStore(providerId, modelApiKeyAccount(profile.profile), profile.authMode);
    const resolved = profile.providerKind === 'builtin'
      ? (() => {
          const models = builtinModels({ credentials });
          const model = models.getModel(profile.provider, profile.model);
          if (!model) throw new Error(`Pi built-in model is not available: ${profile.provider}/${profile.model}`);
          return { config: profile, model, models };
        })()
      : customOpenAICompatibleModels(profile, credentials);

    if (profile.authMode === 'keychain') {
      const auth = await resolved.models.getAuth(resolved.model);
      if (!auth?.auth.apiKey) throw new Error(`model API key is missing in macOS Keychain for profile ${profile.profile}; run npm run local:config:apply`);
    }
    return resolved;
  }
}
