import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GroqProvider, type GroqConfig } from './groq.provider.js';

const config = (overrides: Partial<GroqConfig> = {}): GroqConfig => ({
  apiKey: 'gsk-teste',
  baseUrl: 'https://api.groq.com/openai/v1',
  model: 'qwen/qwen3.8-27b',
  fallbackModels: ['openai/gpt-oss-20b'],
  timeoutMs: 5_000,
  maxRetries: 1,
  language: 'pt-BR',
  maxContentChars: 5_000,
  classifyModel: '',
  classifyFallbackModels: [],
  classifyTimeoutMs: 5_000,
  classifyMaxRetries: 1,
  ...overrides,
});

const completion = (content: string) => ({
  ok: true,
  status: 200,
  headers: new Headers(),
  text: async () =>
    JSON.stringify({
      model: 'qwen/qwen3.8-27b',
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
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

const lastBody = () =>
  JSON.parse((fetchMock.mock.calls.at(-1)?.[1] as { body: string }).body) as {
    model: string;
    temperature: number;
    response_format?: { type: string };
    messages: Array<{ role: string; content: string }>;
  };

/** Conteudo com "palavras" unicas: da pra comparar pedacos sem coincidencia. */
const longContent = Array.from({ length: 500 }, (_, index) => `w${index}`).join(' ');

describe('GroqProvider', () => {
  it('fala com a API do Groq usando a chave da organizacao', async () => {
    fetchMock.mockResolvedValue(completion('Resumo direto.'));

    const result = await new GroqProvider(config()).summarize({
      title: 'Titulo',
      description: null,
      content: 'Conteudo',
    });

    expect(result).toMatchObject({ text: 'Resumo direto.', provider: 'groq', promptTokens: 10, completionTokens: 5 });
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(init.headers.authorization).toBe('Bearer gsk-teste');
  });

  it('classifica em lote com JSON estrito e payload enxuto (classifyMaxContentChars)', async () => {
    fetchMock.mockResolvedValue(
      completion('{"results":[{"id":0,"categorySlug":"politica","confidence":0.95},{"id":1,"categorySlug":"mundo","confidence":0.9}]}'),
    );

    await new GroqProvider(config({ classifyMaxContentChars: 200 })).classifyBatch([
      { title: 'PEC da escala 6x1', description: null, content: longContent, categories: [{ slug: 'politica', name: 'Politica' }] },
      { title: 'Guerra no Oriente Medio', description: null, content: longContent, categories: [{ slug: 'mundo', name: 'Mundo' }] },
    ]);

    expect(lastBody()).toMatchObject({ model: 'qwen/qwen3.8-27b', temperature: 0, response_format: { type: 'json_object' } });

    const user = lastBody().messages.at(-1)!.content;
    // truncate() do projeto corta no limite e anexa "…": comparar folga nas pontas
    const lead = longContent.slice(0, 150);
    const beyond = longContent.slice(250, 400);
    expect(user).toContain(lead); // o lead do conteudo entra
    expect(user).not.toContain(beyond); // o resto e cortado (cota de tokens/dia)
    // o resumo continua usando o corte cheio (AI_MAX_CONTENT_CHARS)
    fetchMock.mockResolvedValue(completion('Resumo'));
    await new GroqProvider(config({ classifyMaxContentChars: 200 })).summarize({
      title: 'Titulo',
      description: null,
      content: longContent,
    });
    expect(lastBody().messages.at(-1)!.content).toContain(beyond);
  });

  it('sem classifyMaxContentChars o classify cai no corte dos resumos', async () => {
    fetchMock.mockResolvedValue(completion('{"categorySlug":"mundo","confidence":0.9}'));

    await new GroqProvider(config()).classify({
      title: 'Guerra no Oriente Medio',
      description: null,
      content: longContent,
      categories: [{ slug: 'mundo', name: 'Mundo' }],
    });

    expect(lastBody().messages.at(-1)!.content).toContain(longContent.slice(250, 400));
  });

  it('trata 401 como erro de credencial (sem retry)', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers(),
      text: async () => '{"error":{"message":"invalid api key"}}',
    });

    await expect(
      new GroqProvider(config()).summarize({ title: 'Titulo', description: null, content: 'Conteudo' }),
    ).rejects.toMatchObject({ code: 'AI_AUTH_INVALID' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('cai para o modelo de fallback quando o principal responde 429', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers(), text: async () => '{"error":{"message":"rate limit"}}' })
      .mockResolvedValueOnce(completion('Resumo do fallback'));

    const result = await new GroqProvider(config({ maxRetries: 0 })).summarize({
      title: 'Titulo',
      description: null,
      content: 'Conteudo',
    });

    expect(result.text).toBe('Resumo do fallback');
    expect(lastBody().model).toBe('openai/gpt-oss-20b');
  });
});
