import type { Env } from '../../config/env.js';
import type { AiProvider } from './ai.provider.js';
import { CompositeProvider } from './composite.provider.js';
import { OpenCodeProvider } from './opencode.provider.js';
import { OpenRouterProvider } from './openrouter.provider.js';

/**
 * Registro de provedores. Adicionar um provedor = implementar AiProvider e
 * registrar uma linha aqui; nenhuma outra camada muda.
 *
 * AI_PROVIDER escolhe o principal; AI_FALLBACK_PROVIDERS (lista) acrescenta
 * alternativas. Com mais de um, createAiProvider devolve um CompositeProvider
 * que tenta o principal e falha sobre para o proximo em cota zerada / 429 /
 * 5xx / gateway fora.
 */
export function createAiProvider(env: Env): AiProvider {
  const registry: Record<string, () => AiProvider> = {
    openrouter: () =>
      new OpenRouterProvider({
        apiKey: env.OPENROUTER_API_KEY,
        baseUrl: env.OPENROUTER_BASE_URL,
        model: env.AI_MODEL,
        fallbackModels: env.AI_FALLBACK_MODELS,
        timeoutMs: env.AI_TIMEOUT_MS,
        maxRetries: env.AI_MAX_RETRIES,
        language: env.AI_LANGUAGE,
        maxContentChars: env.AI_MAX_CONTENT_CHARS,
        appUrl: env.APP_URL,
        appName: env.APP_NAME,
        classifyModel: env.AI_CLASSIFY_MODEL,
        classifyFallbackModels: env.AI_CLASSIFY_FALLBACK_MODELS,
        classifyTimeoutMs: env.AI_CLASSIFY_TIMEOUT_MS,
        classifyMaxRetries: env.AI_CLASSIFY_MAX_RETRIES,
      }),
    opencode: () =>
      new OpenCodeProvider({
        apiKey: env.OPENCODE_API_KEY,
        baseUrl: env.OPENCODE_BASE_URL,
        model: env.OPENCODE_MODEL,
        fallbackModels: env.OPENCODE_FALLBACK_MODELS,
        timeoutMs: env.AI_TIMEOUT_MS,
        maxRetries: env.AI_MAX_RETRIES,
        language: env.AI_LANGUAGE,
        maxContentChars: env.AI_MAX_CONTENT_CHARS,
        classifyModel: env.OPENCODE_CLASSIFY_MODEL,
        classifyFallbackModels: env.OPENCODE_CLASSIFY_FALLBACK_MODELS,
        classifyTimeoutMs: env.AI_CLASSIFY_TIMEOUT_MS,
        classifyMaxRetries: env.AI_CLASSIFY_MAX_RETRIES,
      }),
  };

  const names = [env.AI_PROVIDER, ...env.AI_FALLBACK_PROVIDERS.filter((name) => name !== env.AI_PROVIDER)];

  const providers = names.map((name) => {
    const factory = registry[name];
    if (!factory) {
      throw new Error(
        `AI_PROVIDER/AI_FALLBACK_PROVIDERS desconhecido: "${name}". Disponiveis: ${Object.keys(registry).join(', ')}`,
      );
    }
    return factory();
  });

  if (providers.length === 1) return providers[0]!;
  return new CompositeProvider(providers);
}