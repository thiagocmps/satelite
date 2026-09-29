import { OpenAICompatibleProvider, type OpenAICompatibleConfig } from './openai-compatible.provider.js';

export type OpenRouterConfig = Omit<OpenAICompatibleConfig, 'name'>;

/**
 * Adaptador da OpenRouter (API compativel com OpenAI /chat/completions).
 * A implementacao comum vive em OpenAICompatibleProvider; aqui so muda o
 * identificador gravado no banco e os headers de identidade do app.
 */
export class OpenRouterProvider extends OpenAICompatibleProvider {
  constructor(config: OpenRouterConfig) {
    super({ ...config, name: 'openrouter' });
  }
}