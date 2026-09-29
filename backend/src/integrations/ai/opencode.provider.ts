import { OpenAICompatibleProvider, type OpenAICompatibleConfig } from './openai-compatible.provider.js';

export type OpenCodeConfig = Omit<OpenAICompatibleConfig, 'name'>;

/**
 * Provedor OpenCode Zen (https://opencode.ai/zen/v1), gateway OpenAI-compativel
 * com modelos gratuitos. A chave "public" e a que o proprio gateway usa — sem
 * credencial nem conta. Modelo padrao: space-bunny-free (testado ao vivo).
 */
export class OpenCodeProvider extends OpenAICompatibleProvider {
  constructor(config: OpenCodeConfig) {
    super({ ...config, name: 'opencode' });
  }
}