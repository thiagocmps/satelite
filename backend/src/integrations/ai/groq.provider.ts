import { OpenAICompatibleProvider, type OpenAICompatibleConfig } from './openai-compatible.provider.js';

export type GroqConfig = Omit<OpenAICompatibleConfig, 'name'>;

/**
 * Provedor Groq (https://api.groq.com/openai/v1), gateway OpenAI-compativel
 * com plano gratuito por organizacao (RPM/RPD/TPM/TPD; os headers
 * x-ratelimit-* de cada resposta mostram o saldo real). Modelo padrao:
 * qwen/qwen3.8-27b — JSON mode e classificacao testados ao vivo.
 */
export class GroqProvider extends OpenAICompatibleProvider {
  constructor(config: GroqConfig) {
    super({ ...config, name: 'groq' });
  }
}
