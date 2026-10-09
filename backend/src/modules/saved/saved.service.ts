import type { Logger } from '../../config/logger.js';
import { ExternalServiceError, NotFoundError } from '../../core/errors.js';
import { parseGroupSuggestion, type GroupSuggestion } from '../../integrations/ai/ai.group.js';
import type { AiProvider } from '../../integrations/ai/ai.provider.js';
import type { Article, Paginated } from '../news/news.types.js';
import type { GroupInput, GroupPatch, NewsGroup, SavedListQuery, SavedRepository } from './saved.repository.js';

export type SavedDeps = {
  repository: SavedRepository;
  news: { findById(id: string): Promise<Article | null> };
  provider: AiProvider;
  language: string;
  maxContentChars: number;
  minConfidence: number;
  logger: Logger;
};

/**
 * Salvamento de noticias em grupos. O CRUD e fino (so repassa ao repositorio);
 * a logica real esta em validar o vinculo (grupo/noticia existem) e em sugerir
 * um grupo por IA, que e chamada paga e por isso falha alto.
 */
export class SavedService {
  constructor(private readonly deps: SavedDeps) {}

  listGroups(): Promise<NewsGroup[]> {
    return this.deps.repository.listGroups();
  }

  createGroup(input: GroupInput): Promise<NewsGroup> {
    return this.deps.repository.createGroup(input);
  }

  async updateGroup(id: string, patch: GroupPatch): Promise<NewsGroup> {
    const updated = await this.deps.repository.updateGroup(id, patch);
    if (!updated) throw new NotFoundError(`Grupo ${id} nao encontrado`);
    return updated;
  }

  async removeGroup(id: string): Promise<void> {
    if (!(await this.deps.repository.removeGroup(id))) throw new NotFoundError(`Grupo ${id} nao encontrado`);
  }

  /** Salvar e idempotente; valida as duas pontas para devolver 404 em vez de erro de FK. */
  async save(groupId: string, articleId: string): Promise<void> {
    if (!(await this.deps.repository.findGroupById(groupId))) throw new NotFoundError(`Grupo ${groupId} nao encontrado`);
    if (!(await this.deps.news.findById(articleId))) throw new NotFoundError(`Noticia ${articleId} nao encontrada`);
    await this.deps.repository.save(groupId, articleId);
  }

  async unsave(groupId: string, articleId: string): Promise<void> {
    await this.deps.repository.unsave(groupId, articleId);
  }

  listGroupArticles(groupId: string, query: SavedListQuery): Promise<Paginated<Article>> {
    return this.deps.repository.listGroupArticles(groupId, query);
  }

  listSaved(query: SavedListQuery): Promise<Paginated<Article>> {
    return this.deps.repository.listSaved(query);
  }

  listSavedIds(): Promise<Record<string, string[]>> {
    return this.deps.repository.listSavedIds();
  }

  /** Sugere um grupo existente ou um nome novo. A IA sempre responde JSON (ou falha). */
  async suggestGroup(articleId: string): Promise<GroupSuggestion> {
    const article = await this.deps.news.findById(articleId);
    if (!article) throw new NotFoundError(`Noticia ${articleId} nao encontrada`);

    const groups = await this.deps.repository.listGroups();
    const offered = groups.map((group) => ({ id: group.id, name: group.name }));

    const raw = await this.deps.provider.suggestGroup({
      title: article.title,
      description: article.description,
      content: article.content,
      groups: offered,
    });

    const suggestion = parseGroupSuggestion(raw.text, offered, this.deps.minConfidence);
    if (!suggestion) {
      throw new ExternalServiceError('AI_BAD_RESPONSE', 'Resposta de sugestao de grupo ilegivel');
    }

    this.deps.logger.info(
      { articleId, suggestedGroupId: suggestion.groupId, newGroupName: suggestion.newGroupName },
      'sugestao de grupo gerada por IA',
    );
    return suggestion;
  }
}
