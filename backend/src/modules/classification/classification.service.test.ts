import { describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../../config/env.js';
import type { Logger } from '../../config/logger.js';
import { ConflictError, ExternalServiceError } from '../../core/errors.js';
import type { AiProvider, AiSummaryResult, ClassifyInput } from '../../integrations/ai/ai.provider.js';
import type { CategoriesRepository } from '../categories/categories.repository.js';
import { aiDefaults } from '../settings/settings.defaults.js';
import type { AiSettings, AiSettingsSource } from '../settings/settings.types.js';
import { ClassificationService, type ClassificationDeps } from './classification.service.js';
import type { ClassificationRepository, PendingArticle, ResolveVerdict } from './classification.repository.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;

/** Ajustes de IA falsos: defaults do .env com overrides pontuais por teste. */
const settingsSource = (classify: Partial<AiSettings['classify']> = {}): AiSettingsSource => {
  const base = aiDefaults(
    loadEnv({
      DATABASE_URL: 'postgres://user:pass@localhost:5432/satelite',
      AI_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY: 'sk-or-teste',
    }),
  );
  return { ai: () => ({ ...base, classify: { ...base.classify, ...classify } }) };
};

const categories = [
  { id: 'cat-tech', slug: 'tecnologia', name: 'Tecnologia', description: null, color: null, articleCount: 0, createdAt: new Date() },
  { id: 'cat-space', slug: 'ciencia', name: 'Ciencia', description: null, color: null, articleCount: 0, createdAt: new Date() },
];
const categoriesFake = { list: async () => categories } as unknown as CategoriesRepository;

const rules = [
  { categoryId: 'cat-tech', keyword: 'inteligencia artificial' },
  { categoryId: 'cat-space', keyword: 'nasa' },
];

class FakeRepository implements ClassificationRepository {
  readonly resolutions: Array<{ id: string; verdict: ResolveVerdict }> = [];
  remaining: number;

  constructor(readonly pending: PendingArticle[]) {
    this.remaining = pending.length;
  }

  async listPending(limit: number): Promise<PendingArticle[]> {
    return this.pending.slice(0, limit);
  }

  async countPending(): Promise<number> {
    return this.remaining;
  }

  async resolve(id: string, verdict: ResolveVerdict): Promise<void> {
    this.resolutions.push({ id, verdict });
    this.remaining = Math.max(0, this.remaining - 1);
  }
}

class FakeProvider implements AiProvider {
  readonly name = 'fake';
  readonly model = 'fake-model';
  calls = 0;

  constructor(private readonly behavior: (input: ClassifyInput) => Promise<string>) {}

  async summarize(): Promise<AiSummaryResult> {
    throw new Error('summarize nao e usado aqui');
  }

  async classify(input: ClassifyInput): Promise<AiSummaryResult> {
    this.calls += 1;
    return {
      text: await this.behavior(input),
      provider: this.name,
      model: this.model,
      promptTokens: 0,
      completionTokens: 0,
      latencyMs: 5,
    };
  }

  async suggestGroup(): Promise<AiSummaryResult> {
    throw new Error('suggestGroup nao e usado aqui');
  }
}

/** Provedor com lote: uma requisicao cobre todos os artigos do pedido. */
class FakeBatchProvider extends FakeProvider {
  batchCalls = 0;
  readonly batchSizes: number[] = [];

  async classifyBatch(inputs: ClassifyInput[]): Promise<AiSummaryResult> {
    this.batchCalls += 1;
    this.batchSizes.push(inputs.length);
    // cada artigo vira um item do lote, com o slug da primeira categoria
    const results = inputs.map((_, index) => ({ id: index, categorySlug: 'tecnologia', confidence: 0.9 }));
    return {
      text: JSON.stringify({ results }),
      provider: this.name,
      model: this.model,
      promptTokens: 0,
      completionTokens: 0,
      latencyMs: 5,
    };
  }
}

function setup(
  pending: PendingArticle[],
  providerBehavior?: (input: ClassifyInput) => Promise<string>,
  overrides: Partial<ClassificationDeps> & { classify?: Partial<AiSettings['classify']> } = {},
) {
  const { classify = {}, ...deps } = overrides;
  const repository = new FakeRepository(pending);
  const provider = new FakeProvider(
    providerBehavior ?? (() => Promise.resolve('{"categorySlug":null,"confidence":0.5}')),
  );
  const service = new ClassificationService({
    repository,
    categories: categoriesFake,
    listRules: async () => rules,
    provider,
    settings: settingsSource({
      enabled: true,
      minTextChars: 40,
      minConfidence: 0.5,
      batch: 100,
      // 1 = uma chamada por artigo (o FakeProvider nao implementa lote); os
      // testes de lote sobrescrevem com um provider que sim.
      batchSize: 1,
      concurrency: 2,
      ...classify,
    }),
    blockSports: false,
    logger,
    ...deps,
  });
  return { service, repository, provider };
}

const decisiveArticle: PendingArticle = {
  id: 'a-decisive',
  title: 'Nova inteligencia artificial da OpenAI faz sucesso',
  description: 'Textinho curto.',
  content: null,
  categoryId: 'cat-tech',
};

const ambiguousArticle: PendingArticle = {
  id: 'a-amb',
  title: 'Nasa adota inteligencia artificial em nova missao',
  description: 'A agencia espacial norte-americana quer usar as novas ferramentas para navegacao autonoma.',
  content: 'Documento de apoio com mais detalhes e volume de texto para a classificacao por IA.',
  categoryId: null,
};

const shortArticle: PendingArticle = {
  id: 'a-short',
  title: 'Texto curto.',
  description: null,
  content: null,
  categoryId: null,
};

describe('ClassificationService', () => {
  it('resolve por keyword sem chamar a IA', async () => {
    const { service, provider } = setup([decisiveArticle]);

    const report = await service.runOnce();

    expect(provider.calls).toBe(0);
    expect(report).toMatchObject({ processed: 1, resolvedKeyword: 1, aiCalls: 0, errors: 0, pending: 0 });
    expect(report).toMatchObject({
      resolvedShort: 0,
      aiAssigned: 0,
    });
  });

  it('chama a IA na ambiguidade e aplica a categoria com confianca', async () => {
    const { service, repository, provider } = setup(
      [ambiguousArticle],
      () => Promise.resolve('{"categorySlug":"tecnologia","confidence":0.9}'),
    );

    const report = await service.runOnce();

    expect(provider.calls).toBe(1);
    expect(report).toMatchObject({ processed: 1, aiCalls: 1, aiAssigned: 1, pending: 0 });
    expect(repository.resolutions[0]?.verdict).toEqual({
      categoryId: 'cat-tech',
      method: 'ai',
      confidence: 0.9,
      aiClassified: true,
    });
  });

  it('classifica varios artigos em UMA requisicao quando o provedor aceita lote', async () => {
    const repository = new FakeRepository([
      ambiguousArticle,
      { ...ambiguousArticle, id: 'a-2' },
      { ...ambiguousArticle, id: 'a-3' },
    ]);
    const provider = new FakeBatchProvider(() => Promise.resolve('nao deveria ser usado'));
    const service = new ClassificationService({
      repository,
      categories: categoriesFake,
      listRules: async () => rules,
      provider,
      settings: settingsSource({
        enabled: true,
        minTextChars: 40,
        minConfidence: 0.5,
        batch: 100,
        // 3 artigos cabem numa unica requisicao
        batchSize: 3,
        concurrency: 1,
      }),
      blockSports: false,
      logger,
    });

    const report = await service.runOnce();

    // o custo e por requisicao: 1 chamada no lugar de 3
    expect(provider.batchCalls).toBe(1);
    expect(provider.calls).toBe(0);
    expect(provider.batchSizes).toEqual([3]);
    expect(report).toMatchObject({ processed: 3, aiCalls: 1, aiAssigned: 3, errors: 0, pending: 0 });
    expect(repository.resolutions).toHaveLength(3);
    expect(repository.resolutions.every((entry) => entry.verdict.categoryId === 'cat-tech')).toBe(true);
  });

  it('mantem a categoria atual quando a IA nao sabe', async () => {
    const { service, repository, provider } = setup(
      [{ ...ambiguousArticle, categoryId: 'cat-space' }],
      () => Promise.resolve('{"categorySlug":null,"confidence":0.3}'),
    );

    const report = await service.runOnce();

    expect(provider.calls).toBe(1);
    expect(report).toMatchObject({ aiCalls: 1, aiAssigned: 0, errors: 0 });
    expect(repository.resolutions[0]?.verdict).toEqual({
      categoryId: null, // null = mantem a categoria atual
      method: 'ai',
      confidence: 0.3,
      aiClassified: true,
    });
  });

  it('sai da fila sem custo quando o texto e curto demais', async () => {
    const { service, repository, provider } = setup([shortArticle]);

    const report = await service.runOnce();

    expect(provider.calls).toBe(0);
    expect(report).toMatchObject({ processed: 1, resolvedShort: 1, aiCalls: 0, errors: 0 });
    expect(repository.resolutions[0]?.verdict).toEqual({
      categoryId: null,
      method: null,
      confidence: null,
      aiClassified: false,
    });
  });

  it('conteudo esportivo sai da fila sem chamar a IA nem receber categoria', async () => {
    const sportsArticle: PendingArticle = {
      id: 'a-sports',
      title: 'Flamengo vence classico e assume a lideranca do Brasileirao',
      description: 'O time carioca venceu por 2 a 1 no Maracana.',
      content: 'Longo texto sobre a partida para passar do piso de caracteres.',
      categoryId: null,
    };
    const { service, repository, provider } = setup([sportsArticle], undefined, { blockSports: true });

    const report = await service.runOnce();

    expect(provider.calls).toBe(0);
    expect(report).toMatchObject({ processed: 1, blocked: 1, aiCalls: 0, errors: 0, pending: 0 });
    expect(repository.resolutions[0]?.verdict).toEqual({
      categoryId: null,
      method: null,
      confidence: null,
      aiClassified: false,
    });
  });

  it('com filtro desligado o artigo esportivo segue o fluxo normal (va para a IA)', async () => {
    const sportsArticle: PendingArticle = {
      id: 'a-sports-2',
      title: 'Flamengo vence classico no Maracana',
      description: 'Gol no fim do segundo tempo garantiu a vitoria.',
      content: 'Longo texto sobre a partida para passar do piso de caracteres.',
      categoryId: null,
    };
    const { service, provider } = setup(
      [sportsArticle],
      () => Promise.resolve('{"categorySlug":null,"confidence":0.3}'),
    ); // blockSports default false

    const report = await service.runOnce();

    expect(provider.calls).toBe(1);
    expect(report).toMatchObject({ blocked: 0, aiCalls: 1, aiAssigned: 0 });
  });

  it('falha de IA mantem o artigo pendente e registra erro', async () => {
    const { service, repository, provider } = setup(
      [ambiguousArticle],
      () => Promise.reject(new ExternalServiceError('AI_UPSTREAM_ERROR', 'upstream down')),
    );

    const report = await service.runOnce();

    expect(provider.calls).toBe(1);
    expect(repository.resolutions).toHaveLength(0);
    expect(report).toMatchObject({ processed: 1, aiCalls: 1, errors: 1, pending: 1 });
  });

  it('429 da IA (cota zerada) aborta a rodada em vez de insistir no lote', async () => {
    const { service, repository, provider } = setup(
      [ambiguousArticle, { ...ambiguousArticle, id: 'a-2' }, { ...ambiguousArticle, id: 'a-3' }],
      () => Promise.reject(new ExternalServiceError('AI_RATE_LIMIT', 'cota zerada')),
      { classify: { concurrency: 1 } },
    );

    const report = await service.runOnce();

    // a triagem (sem IA) varre os 3; o aborto vale para as CHAMADAS de modelo:
    // so o primeiro artigo chega ao provedor, o resto fica pendente
    expect(provider.calls).toBe(1);
    expect(repository.resolutions).toHaveLength(0);
    expect(report).toMatchObject({ processed: 3, aiCalls: 1, errors: 1, pending: 3 });
  });

  it('resposta ilegivel mantem o artigo pendente', async () => {
    const { service, repository } = setup([ambiguousArticle], () => Promise.resolve('sem sentido nenhum'));

    const report = await service.runOnce();

    expect(repository.resolutions).toHaveLength(0);
    expect(report).toMatchObject({ errors: 1, pending: 1 });
  });

  it('keyword apenas no conteudo NAO decide; o caso vai para a IA', async () => {
    const contentOnly = {
      id: 'a-content-only',
      title: 'Do jogo do bicho ao tigrinho: a historia da jogatina',
      description: 'Reportagem sobre apostas e proibicoes no Brasil.',
      content: 'O Congresso Nacional deve votar o projeto ainda este semestre, segundo liderancas partidarias.',
      categoryId: null,
    };
    const { service, repository, provider } = setup([contentOnly], () => Promise.resolve('{"categorySlug":null,"confidence":0.4}'), {
      listRules: async () => [{ categoryId: 'cat-tech', keyword: 'congresso' }],
    });

    const report = await service.runOnce();

    // "congresso" so aparece no corpo: a keyword nao resolve, e a IA assume
    expect(provider.calls).toBe(1);
    expect(report).toMatchObject({ resolvedKeyword: 0, aiCalls: 1, aiAssigned: 0 });
    expect(repository.resolutions[0]?.verdict).toMatchObject({ method: 'ai' });
  });

  it('recusa execucao concorrente (ConflictError)', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { service } = setup(
      [ambiguousArticle],
      () => gate.then(() => '{"categorySlug":"tecnologia","confidence":0.9}'),
    );

    const first = service.runOnce(); // trava dentro do provider
    await expect(service.runOnce()).rejects.toBeInstanceOf(ConflictError);

    release();
    const report = await first;
    expect(report.processed).toBe(1);
  });

  it('com IA desligada devolve relatorio vazio e nao toca o banco', async () => {
    const repository = new FakeRepository([ambiguousArticle]);
    const service = new ClassificationService({
      repository,
      categories: categoriesFake,
      listRules: async () => rules,
      provider: new FakeProvider(() => Promise.reject(new Error('nao deveria chamar'))),
      settings: settingsSource({
        enabled: false,
        minTextChars: 40,
        minConfidence: 0.5,
        batch: 100,
        batchSize: 1,
        concurrency: 2,
      }),
      blockSports: true,
      logger,
    });

    const report = await service.runOnce();

    expect(report).toEqual({
      processed: 0,
      resolvedKeyword: 0,
      resolvedShort: 0,
      blocked: 0,
      aiCalls: 0,
      aiAssigned: 0,
      errors: 0,
      pending: 0,
    });
    expect(repository.remaining).toBe(1);
  });
});