import { describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../../core/errors.js';
import { sha256 } from '../../core/fingerprint.js';
import { sanitizeSummary } from '../../integrations/ai/ai.prompts.js';
import type { AiProvider, SummarizeInput } from '../../integrations/ai/ai.provider.js';
import type { Article } from '../news/news.types.js';
import { SummariesService, type SummariesDeps } from './summaries.service.js';
import type { SummaryRecord, SummarySave, SummariesRepository } from './summaries.repository.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as SummariesDeps['logger'];

const article: Article = {
  id: 'a-1',
  title: 'Noticia de teste',
  description: 'Resumo curto',
  content: 'Conteudo completo da noticia',
  imageUrl: null,
  author: null,
  url: 'https://exemplo.com/1',
  publishedAt: '2026-09-28T10:00:00.000Z',
  ingestedAt: '2026-09-28T10:05:00.000Z',
  source: { id: 's-1', slug: 'g1', name: 'G1', siteUrl: null },
  category: null,
  categoryMethod: null,
  categoryConfidence: null,
  summary: null,
};

class FakeSummariesRepository implements SummariesRepository {
  readonly calls: SummarySave[] = [];
  readonly rows = new Map<string, SummaryRecord>();

  async find(articleId: string, model: string, promptVersion: string): Promise<SummaryRecord | null> {
    return this.rows.get(`${articleId}:${model}:${promptVersion}`) ?? null;
  }

  async findLatest(articleId: string): Promise<SummaryRecord | null> {
    const found = [...this.rows.values()].filter((row) => row.articleId === articleId);
    return found.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ?? null;
  }

  async save(input: SummarySave): Promise<SummaryRecord> {
    this.calls.push(input);
    const record: SummaryRecord = {
      id: `sum-${this.calls.length}`,
      articleId: input.articleId,
      provider: input.provider,
      model: input.model,
      promptVersion: input.promptVersion,
      language: input.language,
      summary: input.summary ?? null,
      inputHash: input.inputHash,
      status: input.status,
      error: input.error ?? null,
      tokensIn: input.tokensIn ?? null,
      tokensOut: input.tokensOut ?? null,
      latencyMs: input.latencyMs ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.set(`${input.articleId}:${input.model}:${input.promptVersion}`, record);
    return record;
  }
}

class FakeProvider implements AiProvider {
  readonly name = 'fake';
  readonly model = 'fake-model';
  calls = 0;
  lastInput: SummarizeInput | undefined;

  constructor(private readonly behavior: () => Promise<{ text: string; promptTokens?: number; completionTokens?: number }>) {}

  async summarize(input: SummarizeInput) {
    this.calls += 1;
    this.lastInput = input;
    const result = await this.behavior();
    return {
      text: result.text,
      provider: this.name,
      model: this.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      latencyMs: 12,
    };
  }

  classify(): Promise<import('../../integrations/ai/ai.provider.js').AiSummaryResult> {
    throw new Error('classify nao e usado nos testes de resumo');
  }
}

const inputHashOf = (item: Article, model: string, promptVersion: string) =>
  sha256([promptVersion, model, item.title, item.description ?? '', item.content ?? ''].join('\n'));

function setup(behavior: () => Promise<{ text: string; promptTokens?: number; completionTokens?: number }>) {
  const repository = new FakeSummariesRepository();
  const provider = new FakeProvider(behavior);
  const deps: SummariesDeps = {
    news: { findById: async (id) => (id === article.id ? article : null) },
    summaries: repository,
    provider,
    promptVersion: 'v1',
    language: 'pt-BR',
    logger,
  };
  return { service: new SummariesService(deps), repository, provider };
}

const ok = async () => ({ text: 'Resumo gerado pela IA.', promptTokens: 120, completionTokens: 30 });

describe('SummariesService', () => {
  it('gera e persiste o resumo na primeira chamada', async () => {
    const { service, repository } = setup(ok);

    const payload = await service.generate(article.id);

    expect(payload).toMatchObject({ text: 'Resumo gerado pela IA.', generatedByAi: true, cached: false, model: 'fake-model' });
    expect(payload.tokensIn).toBe(120);
    expect(repository.calls[0]).toMatchObject({ status: 'ok', model: 'fake-model', promptVersion: 'v1' });
  });

  it('devolve o resumo do banco sem chamar a IA de novo', async () => {
    const { service, provider } = setup(ok);

    await service.generate(article.id);
    const second = await service.generate(article.id);

    expect(provider.calls).toBe(1);
    expect(second.cached).toBe(true);
  });

  it('regera quando o conteudo da noticia muda', async () => {
    const { service, provider, repository } = setup(ok);
    await service.generate(article.id);

    const stale = repository.rows.get('a-1:fake-model:v1');
    expect(stale?.inputHash).toBe(inputHashOf(article, 'fake-model', 'v1'));

    // simula edicao: o hash guardado deixa de bater com o conteudo atual
    stale!.inputHash = 'hash-antigo';
    await service.generate(article.id);

    expect(provider.calls).toBe(2);
  });

  it('compartilha a chamada quando duas requisicoes chegam juntas', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { service, provider, repository } = setup(async () => {
      await gate;
      return { text: 'Resumo' };
    });

    const both = Promise.all([service.generate(article.id), service.generate(article.id)]);
    release?.();
    const [first, second] = await both;

    expect(provider.calls).toBe(1);
    expect(repository.calls).toHaveLength(1);
    expect(first.text).toBe('Resumo');
    expect(second.text).toBe('Resumo');
  });

  it('registra o erro e propaga, sem virar resumo', async () => {
    const { service, repository } = setup(async () => {
      throw new Error('provedor fora do ar');
    });

    await expect(service.generate(article.id)).rejects.toThrow('provedor fora do ar');
    expect(repository.calls[0]).toMatchObject({ status: 'error', error: 'provedor fora do ar' });
    expect(await service.get(article.id)).toBeNull();
  });

  it('permite nova tentativa depois de um erro', async () => {
    let shouldFail = true;
    const { service, provider } = setup(async () => {
      if (shouldFail) throw new Error('timeout');
      return { text: 'Resumo' };
    });

    await expect(service.generate(article.id)).rejects.toThrow();
    shouldFail = false;
    const payload = await service.generate(article.id);

    expect(payload.text).toBe('Resumo');
    expect(provider.calls).toBe(2);
  });

  it('get() devolve null antes de gerar', async () => {
    const { service } = setup(ok);
    expect(await service.get(article.id)).toBeNull();
  });

  it('get() falha com 404 para noticia inexistente', async () => {
    const { service } = setup(ok);
    await expect(service.get('nao-existe')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('nao envia o conteudo inteiro para a IA (limite configurado)', async () => {
    const { service, provider } = setup(ok);
    await service.generate(article.id);
    expect(provider.lastInput?.content).toBe(article.content);
  });
});

describe('sanitizeSummary', () => {
  it('remove cercas de markdown, aspas e prefixos', () => {
    expect(sanitizeSummary('```\n**Resumo:** texto aqui.\n```')).toBe('Resumo: texto aqui.');
    expect(sanitizeSummary('"Resumo curto."')).toBe('Resumo curto.');
  });

  it('colapsa espacos', () => {
    expect(sanitizeSummary('  a\n\n  b  ')).toBe('a b');
  });

  it('devolve vazio para entrada inutil', () => {
    expect(sanitizeSummary(null)).toBe('');
    expect(sanitizeSummary('   ')).toBe('');
  });
});
