import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExternalServiceError, TimeoutError } from '../../core/errors.js';
import { OpenRouterProvider, type OpenRouterConfig } from './openrouter.provider.js';

const config = (overrides: Partial<OpenRouterConfig> = {}): OpenRouterConfig => ({
  apiKey: 'sk-or-teste',
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'openrouter/free',
  fallbackModels: ['google/gemma-4-31b-it:free'],
  timeoutMs: 5_000,
  maxRetries: 1,
  language: 'pt-BR',
  maxContentChars: 500,
  appUrl: 'http://localhost:8080',
  appName: 'Satelite',
  ...overrides,
});

const input = { title: 'Titulo', description: 'Descricao', content: 'Conteudo' };

const completion = (content: string, usage = { prompt_tokens: 10, completion_tokens: 5 }) => ({
  ok: true,
  status: 200,
  headers: new Headers(),
  text: async () => JSON.stringify({ model: 'google/gemma-4-31b-it:free', choices: [{ message: { content } }], usage }),
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

describe('OpenRouterProvider', () => {
  it('envia o prompt e devolve o texto limpo', async () => {
    fetchMock.mockResolvedValue(completion('  Resumo final.  '));

    const result = await new OpenRouterProvider(config()).summarize(input);

    expect(result).toMatchObject({ text: 'Resumo final.', provider: 'openrouter', promptTokens: 10, completionTokens: 5 });
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.headers.authorization).toBe('Bearer sk-or-teste');
    expect(init.headers['x-title']).toBe('Satelite');
  });

  it('manda o modelo configurado', async () => {
    fetchMock.mockResolvedValue(completion('Resumo'));
    await new OpenRouterProvider(config({ model: 'openai/gpt-oss-120b:free' })).summarize(input);
    expect(lastBody().model).toBe('openai/gpt-oss-120b:free');
  });

  it('trata 401 como erro de credencial (sem retry)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, headers: new Headers(), text: async () => '{"error":{"message":"invalid key"}}' });

    await expect(new OpenRouterProvider(config()).summarize(input)).rejects.toMatchObject({ code: 'AI_AUTH_INVALID' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('trata 402 sem creditos', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 402, headers: new Headers(), text: async () => '{"error":{"message":"no credits"}}' });
    await expect(new OpenRouterProvider(config()).summarize(input)).rejects.toMatchObject({ code: 'AI_QUOTA' });
  });

  it('faz retry em 429 e conclui na segunda tentativa', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers(), text: async () => '{"error":{"message":"rate limited"}}' })
      .mockResolvedValueOnce(completion('Resumo'));

    const result = await new OpenRouterProvider(config({ maxRetries: 2 })).summarize(input);

    expect(result.text).toBe('Resumo');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('respeita Retry-After do 429', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ 'retry-after': '0.01' }),
      text: async () => '{"error":{"message":"rate limited"}}',
    });

    const provider = new OpenRouterProvider(config({ maxRetries: 1 }));
    const startedAt = Date.now();
    await expect(provider.summarize(input)).rejects.toBeInstanceOf(ExternalServiceError);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(5);
  });

  it('cai para o modelo de fallback quando o principal falha com 429', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers(), text: async () => '{"error":{"message":"lotado"}}' })
      .mockResolvedValueOnce(completion('Resumo do fallback'));

    const result = await new OpenRouterProvider(config({ maxRetries: 0 })).summarize(input);

    expect(result.text).toBe('Resumo do fallback');
    expect(lastBody().model).toBe('google/gemma-4-31b-it:free');
  });

  it('nao repete o fallback que ja falhou', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, headers: new Headers(), text: async () => '{"error":{"message":"lotado"}}' });

    await expect(new OpenRouterProvider(config({ maxRetries: 0 })).summarize(input)).rejects.toMatchObject({ code: 'AI_RATE_LIMIT' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejeita resposta sem texto utilizavel', async () => {
    fetchMock.mockResolvedValue(completion('   '));

    await expect(new OpenRouterProvider(config({ maxRetries: 0, fallbackModels: [] })).summarize(input)).rejects.toMatchObject({
      code: 'AI_BAD_RESPONSE',
    });
  });

  it('rejeita corpo que nao e JSON', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, headers: new Headers(), text: async () => '<html>gateway</html>' });
    await expect(new OpenRouterProvider(config({ maxRetries: 0, fallbackModels: [] })).summarize(input)).rejects.toMatchObject({
      code: 'AI_BAD_RESPONSE',
    });
  });

  it('converte timeout do fetch em TimeoutError', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));

    await expect(new OpenRouterProvider(config({ maxRetries: 0, fallbackModels: [] })).summarize(input)).rejects.toBeInstanceOf(TimeoutError);
  });
});
