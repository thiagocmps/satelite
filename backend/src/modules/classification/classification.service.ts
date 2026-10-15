import type { Logger } from '../../config/logger.js';
import { ConflictError, ExternalServiceError } from '../../core/errors.js';
import { parseClassifiedBatch, parseClassifiedContent, type ClassifyMention } from '../../integrations/ai/ai.classify.js';
import type { AiProvider, AiSummaryResult, ClassifyInput } from '../../integrations/ai/ai.provider.js';
import type { CategoriesRepository } from '../categories/categories.repository.js';
import type { AiSettingsSource } from '../settings/settings.types.js';
import type { ClassificationRepository, PendingArticle, ResolveVerdict } from './classification.repository.js';
import { buildArticleText, buildKeywordIndex, buildKeywordText, classifyText, type KeywordIndex } from './keyword-engine.js';
import { isSportsContent } from './sports-block.js';

export type ClassificationReport = {
  processed: number;
  /** Resolvido por keyword (sem custo de modelo). */
  resolvedKeyword: number;
  /** Sem decisao deterministica e texto curto demais para a IA. */
  resolvedShort: number;
  /** Conteudo esportivo: sai da fila (nao gasta modelo nem recebe categoria). */
  blocked: number;
  aiCalls: number;
  /** A IA atribuiu uma categoria (confianca >= piso). */
  aiAssigned: number;
  /** Falhas (IA ou banco): o artigo permanece pendente. */
  errors: number;
  /** Pendencias restantes apos a rodada. */
  pending: number;
};

export type ClassificationDeps = {
  repository: ClassificationRepository;
  categories: CategoriesRepository;
  listRules: () => Promise<{ categoryId: string; keyword: string }[]>;
  provider: AiProvider;
  /**
   * Ajustes lidos A CADA RODADA (enabled, lote, concorrencia, cortes, piso de
   * confianca): salvar na tela de config vale na proxima execucao, sem reiniciar.
   */
  settings: AiSettingsSource;
  /** Dropa conteudo esportivo antes de qualquer chamada de IA (CONTENT_FILTER_SPORTS). */
  blockSports: boolean;
  logger: Logger;
};

/**
 * Processa a fila `needs_ai`: keyword decides (sem modelo), texto curto sai da
 * fila sem custo, e o resto vai para a IA (OpenRouter) com catalogo real de
 * categorias. Falha de IA mantem o artigo pendente para a proxima rodada.
 */
export class ClassificationService {
  #running = false;

  constructor(private readonly deps: ClassificationDeps) {}

  get isRunning(): boolean {
    return this.#running;
  }

  async countPending(): Promise<number> {
    return this.deps.repository.countPending();
  }

  async runOnce(): Promise<ClassificationReport> {
    const emptyReport: ClassificationReport = {
      processed: 0,
      resolvedKeyword: 0,
      resolvedShort: 0,
      blocked: 0,
      aiCalls: 0,
      aiAssigned: 0,
      errors: 0,
      pending: 0,
    };

    const cfg = this.deps.settings.ai().classify;
    if (!cfg.enabled) {
      this.deps.logger.info({}, 'classificacao por IA desligada (config: classify.enabled=false)');
      return emptyReport;
    }
    if (this.#running) throw new ConflictError('Ja existe uma classificacao em andamento');
    this.#running = true;

    const report: ClassificationReport = { ...emptyReport };

    try {
      const [rules, categories] = await Promise.all([this.deps.listRules(), this.deps.categories.list()]);
      const index = buildKeywordIndex(rules);
      const catalog = categories.map((category) => ({ slug: category.slug, name: category.name, id: category.id }));
      const idBySlug = new Map(catalog.map((category) => [category.slug, category.id]));

      const pending = await this.deps.repository.listPending(cfg.batch);

      // Fase 1: tudo que a IA nao precisa ver sai da fila sem custo — keyword,
      // texto curto e esporte nao pagam requisicao nenhuma.
      const forAi: PendingArticle[] = [];
      for (const item of pending) {
        const resolved = await this.#triage(item, index, report);
        if (resolved) forAi.push(item);
      }

      // Fase 2: o que sobrou vai para a IA em lotes. Uma requisicao cobre
      // `cfg.batchSize` artigos, entao o overhead fixo do prompt (catalogo +
      // regras + exemplos) deixa de se repetir por noticia.
      const chunks: PendingArticle[][] = [];
      for (let offset = 0; offset < forAi.length; offset += cfg.batchSize) {
        chunks.push(forAi.slice(offset, offset + cfg.batchSize));
      }

      /** Circuito: no primeiro 429 geral a rodada para de puxar itens. */
      const abort = { hit: false };
      let cursor = 0;
      const next = (): PendingArticle[] | undefined => (abort.hit ? undefined : chunks[cursor++]);

      const worker = async () => {
        for (let chunk = next(); chunk; chunk = next()) {
          await this.#classifyChunk(chunk, catalog, idBySlug, report, abort);
        }
      };

      await Promise.all(
        Array.from({ length: Math.max(1, Math.min(cfg.concurrency, chunks.length)) }, worker),
      );

      report.pending = await this.deps.repository.countPending();
      return report;
    } finally {
      this.#running = false;
    }
  }

  /**
   * Fase sem IA: esporte sai da fila, keyword decide sem modelo, texto curto
   * sai como esta. Devolve true quando o artigo precisa da IA.
   */
  async #triage(article: PendingArticle, index: KeywordIndex, report: ClassificationReport): Promise<boolean> {
    report.processed += 1;
    try {
      // esporte nunca paga modelo nem recebe categoria (sai da fila). Artigos ja
      // categorizados (ex.: politica que cita esporte) mantem a categoria:
      // Verdict com categoryId null preserva a categoria atual.
      if (this.deps.blockSports && isSportsContent(buildKeywordText(article))) {
        await this.#resolve(article.id, {
          categoryId: null,
          method: null,
          confidence: null,
          aiClassified: false,
        });
        report.blocked += 1;
        return false;
      }

      // decisao deterministica: titulo+descricao apenas (conteudo gera falso positivo)
      const keyword = classifyText(buildKeywordText(article), index);

      // decisao deterministica: quem a keyword resolve nunca paga modelo
      if (keyword.decision === 'decisive') {
        await this.#resolve(article.id, {
          categoryId: keyword.match.categoryId,
          method: 'keyword',
          confidence: null,
          aiClassified: false,
        });
        report.resolvedKeyword += 1;
        return false;
      }

      // sem decisao deterministica e texto curto demais: sai da fila como esta
      if (buildArticleText(article).length < this.deps.settings.ai().classify.minTextChars) {
        await this.#resolve(article.id, {
          categoryId: null,
          method: null,
          confidence: null,
          aiClassified: false,
        });
        report.resolvedShort += 1;
        return false;
      }

      return true;
    } catch (error) {
      report.errors += 1;
      this.deps.logger.warn({ articleId: article.id, err: error }, 'triagem falhou; artigo permanece pendente');
      return false;
    }
  }

  /** Uma requisicao de IA cobre o lote inteiro; falha nao derruba os outros. */
  async #classifyChunk(
    chunk: PendingArticle[],
    catalog: Array<{ slug: string; name: string; id: string }>,
    idBySlug: Map<string, string>,
    report: ClassificationReport,
    abort: { hit: boolean },
  ): Promise<void> {
    const cfg = this.deps.settings.ai().classify;
    const inputs = chunk.map((article) => ({
      title: article.title,
      description: article.description,
      content: article.content,
      categories: catalog.map(({ slug, name }) => ({ slug, name })),
    }));

    let mentions: Array<ClassifyMention | null>;
    try {
      const useBatch = typeof this.deps.provider.classifyBatch === 'function' && chunk.length > 1;
      if (useBatch) {
        // uma requisicao cobre o lote inteiro
        report.aiCalls += 1;
        const raw = await (this.deps.provider.classifyBatch as (i: ClassifyInput[]) => Promise<AiSummaryResult>)(inputs);
        mentions = parseClassifiedBatch(raw?.text ?? null, chunk.length, catalog, cfg.minConfidence);
      } else {
        // provedor sem lote (ou lote de 1): uma requisicao por artigo
        mentions = await this.#classifyOneByOne(inputs, report);
      }
    } catch (error) {
      report.errors += chunk.length;
      if (error instanceof ExternalServiceError && error.code === 'AI_RATE_LIMIT') {
        // cota zerada: abrir o resto do lote so martela a API; manter pendente
        abort.hit = true;
      }
      this.deps.logger.warn({ size: chunk.length, err: error }, 'classificacao por lote falhou; artigo permanece pendente');
      return;
    }

    for (const [offset, article] of chunk.entries()) {
      const mention = mentions[offset];
      // item ilegivel ou faltando na resposta: nao decide nada, fica pendente
      if (!mention) {
        report.errors += 1;
        this.deps.logger.warn({ articleId: article.id }, 'resposta do lote sem este artigo; permanece pendente');
        continue;
      }

      const categoryId = mention.categorySlug ? (idBySlug.get(mention.categorySlug) ?? null) : null;
      await this.#resolve(article.id, {
        categoryId,
        method: 'ai',
        confidence: mention.confidence,
        aiClassified: true,
      });
      if (categoryId) report.aiAssigned += 1;

      this.deps.logger.info(
        { articleId: article.id, slug: mention.categorySlug, confidence: mention.confidence },
        'artigo classificado por IA',
      );
    }
  }

  /**
   * Provedor sem lote: uma requisicao por artigo. Devolve a mencao de cada um
   * na mesma forma do lote — resposta ilegivel vira `null` (artigo pendente),
   * sem passar por JSON intermediario que pudesse mascarar a falha.
   */
  async #classifyOneByOne(
    inputs: ClassifyInput[],
    report: ClassificationReport,
  ): Promise<Array<ClassifyMention | null>> {
    const mentions: Array<ClassifyMention | null> = [];
    const minConfidence = this.deps.settings.ai().classify.minConfidence;
    for (const input of inputs) {
      report.aiCalls += 1;
      const result = await this.deps.provider.classify(input);
      mentions.push(parseClassifiedContent(result.text, input.categories, minConfidence));
    }
    return mentions;
  }

  async #resolve(id: string, verdict: ResolveVerdict): Promise<void> {
    await this.deps.repository.resolve(id, verdict);
  }
}