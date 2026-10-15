import { NotFoundError } from '../../core/errors.js';
import { fetchWithTimeout } from '../../core/http.js';
import type { NewsRepository } from './news.repository.js';
import type { NewsListQuery, Paginated, Article } from './news.types.js';

/** Foto para o cartao de compartilhamento: stories nao precisam de mais que isso. */
const PHOTO_MAX_BYTES = 4 * 1024 * 1024;
const PHOTO_TIMEOUT_MS = 5000;

export type ArticlePhoto = { buffer: Buffer; contentType: string };

/**
 * Busca a foto no CDN com teto de tamanho proprio. O content-length (checado
 * pelo fetchWithTimeout) mente ou nao existe em chunked — entao o stream e
 * lido com um teto tambem.
 */
async function fetchArticlePhoto(url: string): Promise<ArticlePhoto> {
  const response = await fetchWithTimeout(url, { timeoutMs: PHOTO_TIMEOUT_MS, maxBytes: PHOTO_MAX_BYTES });
  if (!response.ok || !response.body) throw new Error(`upstream status ${response.status}`);

  // so imagem interessa: um 200 com HTML (bloqueio, captcha) nao vira "foto"
  const contentType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
  if (!contentType.startsWith('image/')) throw new Error(`content-type nao imagem: ${contentType}`);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > PHOTO_MAX_BYTES) {
      await reader.cancel();
      throw new Error(`imagem maior que ${PHOTO_MAX_BYTES} bytes`);
    }
    chunks.push(value);
  }

  return { buffer: Buffer.concat(chunks), contentType };
}

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

  /**
   * Foto da noticia para o proxy de compartilhamento (mesma origem do app,
   * para que o canvas do cartao nao contamine). Qualquer falha vira 404 em
   * vez de 502: o cliente trata "sem foto" desenhando o placeholder, entao
   * um CDN bloqueando nunca quebra o fluxo de share.
   */
  async getPhoto(id: string): Promise<ArticlePhoto> {
    const article = await this.news.findById(id);
    if (!article) throw new NotFoundError(`Noticia ${id} nao encontrada`);
    if (!article.imageUrl) throw new NotFoundError(`Noticia ${id} nao tem imagem`);

    let remote: URL;
    try {
      remote = new URL(article.imageUrl);
    } catch {
      throw new NotFoundError('Imagem da noticia tem URL invalida');
    }
    // image_url vem do feed, mas ainda e URL de terceiro: so http(s)
    if (remote.protocol !== 'http:' && remote.protocol !== 'https:') {
      throw new NotFoundError('Imagem da noticia nao e http(s)');
    }

    try {
      return await fetchArticlePhoto(remote.toString());
    } catch {
      throw new NotFoundError('Imagem da noticia indisponivel');
    }
  }
}
