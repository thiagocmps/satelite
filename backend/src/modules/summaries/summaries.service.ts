import type { Logger } from '../../config/logger.js';
import { errorMessage, NotFoundError } from '../../core/errors.js';
import { sha256 } from '../../core/fingerprint.js';
import type { AiProvider } from '../../integrations/ai/ai.provider.js';
import type { Article } from '../news/news.types.js';
import type { SummariesRepository, SummaryRecord } from './summaries.repository.js';

export type AiSummaryPayload = {
  text: string;
  /** A UI sempre mostra que o texto veio de um modelo. */
  generatedByAi: true;
  provider: string;
  model: string;
  promptVersion: string;
  language: string;
  createdAt: string;
  updatedAt: string;
  tokensIn: number | null;
  tokensOut: number | null;
  /** true = servido do PostgreSQL, sem chamar a IA nesta requisicao. */
  cached: boolean;
};

export type SummariesDeps = {
  news: { findById(id: string): Promise<Article | null> };
  summaries: SummariesRepository;
  provider: AiProvider;
  promptVersion: string;
  language: string;
  logger: Logger;
};

/**
 * Resumos por IA com cache no banco.
 *
 * Um resumo so e gerado quando nao existe um valido para (artigo, modelo, versao
 * do prompt) cujo input_hash ainda bate com o conteudo atual. Chamadas simultaneas
 * para a mesma noticia compartilham a mesma Promise (evita duplicar custo no
 * plano gratuito, que e limitado por requisicao).
 */
export class SummariesService {
  readonly #inFlight = new Map<string, Promise<AiSummaryPayload>>();

  constructor(private readonly deps: SummariesDeps) {}

  async get(articleId: string): Promise<AiSummaryPayload | null> {
    await this.#requireArticle(articleId);
    const record = await this.deps.summaries.findLatest(articleId);
    return record?.status === 'ok' && record.summary ? toPayload(record, true) : null;
  }

  async generate(articleId: string): Promise<AiSummaryPayload> {
    const article = await this.#requireArticle(articleId);
    const { provider, promptVersion } = this.deps;

    const inputHash = sha256(
      [promptVersion, provider.model, article.title, article.description ?? '', article.content ?? ''].join('\n'),
    );

    const cached = await this.deps.summaries.find(articleId, provider.model, promptVersion);
    if (cached?.status === 'ok' && cached.summary && cached.inputHash === inputHash) {
      return toPayload(cached, true);
    }

    const key = `${articleId}:${provider.model}:${promptVersion}`;
    const pending = this.#inFlight.get(key);
    if (pending) return pending;

    const promise = this.#generate(article, inputHash).finally(() => this.#inFlight.delete(key));
    this.#inFlight.set(key, promise);
    return promise;
  }

  async #requireArticle(articleId: string): Promise<Article> {
    const article = await this.deps.news.findById(articleId);
    if (!article) throw new NotFoundError(`Noticia ${articleId} nao encontrada`);
    return article;
  }

  async #generate(article: Article, inputHash: string): Promise<AiSummaryPayload> {
    const { provider, promptVersion, language } = this.deps;

    try {
      const result = await provider.summarize({
        title: article.title,
        description: article.description,
        content: article.content,
      });

      const saved = await this.deps.summaries.save({
        articleId: article.id,
        provider: result.provider,
        model: result.model,
        promptVersion,
        language,
        inputHash,
        status: 'ok',
        summary: result.text,
        tokensIn: result.promptTokens ?? null,
        tokensOut: result.completionTokens ?? null,
        latencyMs: result.latencyMs,
      });
      return toPayload(saved, false);
    } catch (error) {
      const message = errorMessage(error);
      this.deps.logger.warn({ articleId: article.id, model: provider.model, err: error }, 'falha ao gerar resumo');
      // guarda o erro para observabilidade, sem virar "resumo" para o cliente
      await this.deps.summaries
        .save({
          articleId: article.id,
          provider: provider.name,
          model: provider.model,
          promptVersion,
          language,
          inputHash,
          status: 'error',
          error: message,
        })
        .catch((saveError) => this.deps.logger.error({ err: saveError }, 'falha ao registrar erro do resumo'));
      throw error;
    }
  }
}

const toPayload = (record: SummaryRecord, cached: boolean): AiSummaryPayload => ({
  text: record.summary ?? '',
  generatedByAi: true,
  provider: record.provider,
  model: record.model,
  promptVersion: record.promptVersion,
  language: record.language,
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString(),
  tokensIn: record.tokensIn,
  tokensOut: record.tokensOut,
  cached,
});
