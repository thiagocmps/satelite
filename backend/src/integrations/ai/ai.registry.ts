import type { AiSettings } from '../../modules/settings/settings.types.js';
import type { AiProvider } from './ai.provider.js';
import { CompositeProvider } from './composite.provider.js';
import { GroqProvider } from './groq.provider.js';
import { OpenCodeProvider } from './opencode.provider.js';
import type { OpenAICompatibleConfig } from './openai-compatible.provider.js';
import { OpenRouterProvider } from './openrouter.provider.js';

/**
 * Registro de provedores. Adicionar um provedor = subclasse + 1 linha em
 * `builders` + 1 entrada em `AI_PROVIDER_META` (+ defaults em
 * settings.defaults.ts e vars no env.ts). A tela de config descobre os cards
 * por `AI_PROVIDER_META` — nada de frontend para atualizar.
 */
export const AI_PROVIDER_META = {
  groq: { label: 'Groq', keyUrl: 'https://console.groq.com/keys' },
  openrouter: { label: 'OpenRouter', keyUrl: 'https://openrouter.ai/keys' },
  opencode: { label: 'OpenCode Zen', keyUrl: 'https://opencode.ai/console' },
} as const;

export type AiProviderId = keyof typeof AI_PROVIDER_META;

export const AI_PROVIDER_IDS = Object.keys(AI_PROVIDER_META) as AiProviderId[];

type ProviderConfig = Omit<OpenAICompatibleConfig, 'name'>;

/**
 * Monta a cadeia de provedores a partir da CONFIGURACAO EFETIVA (defaults do
 * .env + overrides do banco — ver modules/settings). O primeiro da cadeia e o
 * principal; os demais so entram em falha recuperavel (cota, 429, 5xx, timeout).
 */
export function createAiProvider(settings: AiSettings): AiProvider {
  const config = (id: AiProviderId): ProviderConfig => {
    const provider = settings.providers[id];
    if (!provider) throw new Error(`configuracao do provedor "${id}" ausente`);
    return {
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl,
      model: provider.model,
      fallbackModels: provider.fallbackModels,
      timeoutMs: settings.summarize.timeoutMs,
      maxRetries: settings.summarize.maxRetries,
      language: settings.summarize.language,
      maxContentChars: settings.summarize.maxContentChars,
      classifyModel: provider.classifyModel,
      classifyFallbackModels: provider.classifyFallbackModels,
      classifyTimeoutMs: settings.classify.timeoutMs,
      classifyMaxRetries: settings.classify.maxRetries,
      classifyMaxContentChars: settings.classify.maxContentChars,
    };
  };

  // Record<AiProviderId, ...> exige TODOS os ids: provedor novo sem builder
  // nao compila (e sem meta tambem nao — AI_PROVIDER_IDS deriva dela).
  const builders: Record<AiProviderId, () => AiProvider> = {
    groq: () => new GroqProvider(config('groq')),
    openrouter: () => new OpenRouterProvider(config('openrouter')),
    opencode: () => new OpenCodeProvider(config('opencode')),
  };

  const chain = [settings.provider, ...settings.fallbackProviders];
  const providers: AiProvider[] = [];
  for (const id of chain) {
    const build = builders[id as AiProviderId];
    if (!build) {
      throw new Error(`provedor de IA desconhecido: "${id}" (registrados: ${AI_PROVIDER_IDS.join(', ')})`);
    }
    providers.push(build());
  }

  const [primary, ...rest] = providers;
  if (!primary) throw new Error('cadeia de provedores de IA vazia');
  return rest.length > 0 ? new CompositeProvider([primary, ...rest]) : primary;
}
