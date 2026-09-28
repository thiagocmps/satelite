import { NotFoundError } from '../../core/errors.js';
import type { NewsRepository } from './news.repository.js';
import type { NewsListQuery, Paginated, Article } from './news.types.js';

/**
 * Leitura de noticias. Escrita (ingestao) nao passa por aqui: quem insere e o
 * IngestionService, via repositorio.
 */
export class NewsService {
  constructor(private readonly news: NewsRepository) {}

  list(query: NewsListQuery): Promise<Paginated<Article>> {
    return this.news.list(query);
  }

  async get(id: string): Promise<Article> {
    const article = await this.news.findById(id);
    if (!article) throw new NotFoundError(`Noticia ${id} nao encontrada`);
    return article;
  }
}
