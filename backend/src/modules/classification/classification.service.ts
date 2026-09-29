import type { Logger } from '../../config/logger.js';
import { ConflictError, ExternalServiceError } from '../../core/errors.js';
import { parseClassifiedContent } from '../../integrations/ai/ai.classify.js';
import type { AiProvider } from '../../integrations/ai/ai.provider.js';
import type { CategoriesRepository } from '../categories/categories.repository.js';
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
  enabled: boolean;
  language: string;
  maxContentChars: number;
  minTextChars: number;
  minConfidence: number;
  batchSize: number;
  concurrency: number;
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

    if (!this.deps.enabled) {
      this.deps.logger.info({}, 'classificacao por IA desligada (AI_CLASSIFY_ENABLED=false)');
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

      const pending = await this.deps.repository.listPending(this.deps.batchSize);

      let cursor = 0;
      /** Circuito: no primeiro 429 da OpenRouter a rodada para de puxar itens. */
      const abort = { hit: false };
      const next = (): PendingArticle | undefined => (abort.hit ? undefined : pending[cursor++]);
      const worker = async () => {
        for (let item = next(); item; item = next()) {
          await this.#process(item, index, catalog, idBySlug, report, abort);
        }
      };

      await Promise.all(
        Array.from({ length: Math.max(1, Math.min(this.deps.concurrency, pending.length)) }, worker),
      );

      report.pending = await this.deps.repository.countPending();
      return report;
    } finally {
      this.#running = false;
    }
  }

  async #process(
    article: PendingArticle,
    index: KeywordIndex,
    catalog: Array<{ slug: string; name: string; id: string }>,
    idBySlug: Map<string, string>,
    report: ClassificationReport,
    abort: { hit: boolean },
  ): Promise<void> {
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
        return;
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
        return;
      }

      // sem decisao deterministica e texto curto demais: sai da fila como esta
      const text = buildArticleText(article);
      if (text.length < this.deps.minTextChars) {
        await this.#resolve(article.id, {
          categoryId: null,
          method: null,
          confidence: null,
          aiClassified: false,
        });
        report.resolvedShort += 1;
        return;
      }

      report.aiCalls += 1;
      const raw = await this.deps.provider.classify({
        title: article.title,
        description: article.description,
        content: article.content,
        categories: catalog.map(({ slug, name }) => ({ slug, name })),
      });

      const mention = parseClassifiedContent(raw.text, catalog, this.deps.minConfidence);
      if (!mention) {
        throw new ExternalServiceError('AI_BAD_RESPONSE', 'Resposta de classificacao ilegivel');
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
    } catch (error) {
      report.errors += 1;
      if (error instanceof ExternalServiceError && error.code === 'AI_RATE_LIMIT') {
        // cota zerada: abrir o resto do lote so martela a API; manter pendente
        abort.hit = true;
      }
      this.deps.logger.warn({ articleId: article.id, err: error }, 'classificacao falhou; artigo permanece pendente');
    }
  }

  async #resolve(id: string, verdict: ResolveVerdict): Promise<void> {
    await this.deps.repository.resolve(id, verdict);
  }
}