import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../config/env.js';
import { createAiProvider } from './ai.registry.js';
import { CompositeProvider } from './composite.provider.js';
import { OpenCodeProvider } from './opencode.provider.js';
import { OpenRouterProvider } from './openrouter.provider.js';

const env = (overrides: Record<string, string> = {}) =>
  loadEnv({
    DATABASE_URL: 'postgres://user:pass@localhost:5432/satelite',
    OPENROUTER_API_KEY: 'sk-or-teste',
    ...overrides,
  });

describe('createAiProvider', () => {
  it('devolve o provedor unico quando nao ha fallback', () => {
    const provider = createAiProvider(env());
    expect(provider).toBeInstanceOf(OpenRouterProvider);
    expect(provider.name).toBe('openrouter');
  });

  it('monta uma cadeia (CompositeProvider) quando AI_FALLBACK_PROVIDERS traz opencode', () => {
    const provider = createAiProvider(env({ AI_FALLBACK_PROVIDERS: 'opencode' }));
    expect(provider).toBeInstanceOf(CompositeProvider);
    expect(provider.name).toBe('openrouter');
    expect((provider as CompositeProvider).model).toBe('openrouter/free');
  });

  it('rejeita provedor desconhecido tanto como principal quanto como fallback', () => {
    expect(() => createAiProvider(env({ AI_FALLBACK_PROVIDERS: 'groq' }))).toThrow(/desconhecido/);
    expect(() => createAiProvider(env({ AI_PROVIDER: 'groq' }))).toThrow(/desconhecido/);
  });

  it('aceita opencode como principal sem exigir chave da OpenRouter', () => {
    const provider = createAiProvider(env({ AI_PROVIDER: 'opencode', OPENROUTER_API_KEY: '' }));
    expect(provider).toBeInstanceOf(OpenCodeProvider);
    expect(provider.name).toBe('opencode');
  });

  it('exige chave da OpenRouter quando ela aparece como fallback', () => {
    expect(() =>
      createAiProvider(env({ AI_PROVIDER: 'opencode', AI_FALLBACK_PROVIDERS: 'openrouter', OPENROUTER_API_KEY: '' })),
    ).toThrow(/OPENROUTER_API_KEY/);
  });
});