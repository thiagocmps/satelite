import type { Env } from '../../config/env.js';
import type { AiProvider } from './ai.provider.js';
import { OpenRouterProvider } from './openrouter.provider.js';

/**
 * Registro de provedores. Adicionar um provedor = implementar AiProvider e
 * registrar uma linha aqui; nenhuma outra camada muda.
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
  };

  const factory = registry[env.AI_PROVIDER];
  if (!factory) {
    throw new Error(`AI_PROVIDER desconhecido: "${env.AI_PROVIDER}". Disponiveis: ${Object.keys(registry).join(', ')}`);
  }
  return factory();
}
