import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenCodeProvider, type OpenCodeConfig } from './opencode.provider.js';

const config = (overrides: Partial<OpenCodeConfig> = {}): OpenCodeConfig => ({
  apiKey: 'public',
  baseUrl: 'https://opencode.ai/zen/v1',
  model: 'space-bunny-free',
  fallbackModels: ['longcat-2.5-preview-free'],
  timeoutMs: 5_000,
  maxRetries: 1,
  language: 'pt-BR',
  maxContentChars: 500,
  classifyModel: '',
  classifyFallbackModels: [],
  classifyTimeoutMs: 5_000,
  classifyMaxRetries: 1,
  ...overrides,
});

const input = { title: 'Titulo', description: 'Descricao', content: 'Conteudo' };

const completion = (content: string, usage = { prompt_tokens: 10, completion_tokens: 5 }) => ({
  ok: true,
  status: 200,
  headers: new Headers(),
  text: async () =>
    JSON.stringify({ model: 'space-bunny-free', choices: [{ message: { content } }], usage }),
});

let fetchMock: ReturnType<typeof vi.fn>;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const lastBody = () => JSON.parse((fetchMock.mock.calls.at(-1)?.[1] as { body: string }).body) as { model: string; messages: unknown[] };

describe('OpenCodeProvider (OpenCode Zen)', () => {
  it('fala com o endpoint do Zen com a chave publica e devolve texto limpo', async () => {
    fetchMock.mockResolvedValue(completion('  Resumo final.  '));

    const result = await new OpenCodeProvider(config()).summarize(input);

    expect(result).toMatchObject({ text: 'Resumo final.', provider: 'opencode', promptTokens: 10, completionTokens: 5 });
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe('https://opencode.ai/zen/v1/chat/completions');
    expect(init.headers.authorization).toBe('Bearer public');
  });

  it('manda o modelo gratuito configurado', async () => {
    fetchMock.mockResolvedValue(completion('Resumo'));
    await new OpenCodeProvider(config()).summarize(input);
    expect(lastBody().model).toBe('space-bunny-free');
  });

  it('pede JSON estrito na classificacao (sem temperatura)', async () => {
    fetchMock.mockResolvedValue(completion('{"categorySlug":"mundo","confidence":0.9}'));

    const result = await new OpenCodeProvider(config()).classify({
      title: 'Guerra no Oriente Medio',
      description: null,
      content: 'Conflito se intensifica.',
      categories: [{ slug: 'mundo', name: 'Mundo' }],
    });

    expect(result.text).toBe('{"categorySlug":"mundo","confidence":0.9}');
    expect(lastBody()).toMatchObject({ model: 'space-bunny-free', temperature: 0, response_format: { type: 'json_object' } });
  });

  it('trata 401 como erro de credencial (sem retry)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, headers: new Headers(), text: async () => '{"error":{"message":"invalid key"}}' });

    await expect(new OpenCodeProvider(config()).summarize(input)).rejects.toMatchObject({ code: 'AI_AUTH_INVALID' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('cai para o modelo de fallback quando o principal responde 429', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers(), text: async () => '{"error":{"message":"lotado"}}' })
      .mockResolvedValueOnce(completion('Resumo do fallback'));

    const result = await new OpenCodeProvider(config({ maxRetries: 0 })).summarize(input);

    expect(result.text).toBe('Resumo do fallback');
    expect(lastBody().model).toBe('longcat-2.5-preview-free');
  });
});