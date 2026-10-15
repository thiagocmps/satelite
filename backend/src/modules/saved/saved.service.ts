import AdmZip from 'adm-zip';
import { slugify } from '../../core/slug.js';
import type { Logger } from '../../config/logger.js';
import { ConflictError, ExternalServiceError, NotFoundError } from '../../core/errors.js';
import { parseGroupSuggestion, type GroupSuggestion } from '../../integrations/ai/ai.group.js';
import type { AiProvider } from '../../integrations/ai/ai.provider.js';
import type { Article, Paginated } from '../news/news.types.js';
import type { AiSettingsSource } from '../settings/settings.types.js';
import { buildCollectionMarkdown } from './saved.export.js';
import {
  parseCollectionJson,
  parseCollectionMarkdown,
  type ParsedCollection,
  type ParsedCollectionItem,
} from './saved.import.js';
import type { GroupInput, GroupPatch, NewsGroup, SavedListQuery, SavedRepository } from './saved.repository.js';

/** Teto do export: coleção gigante vira arquivo gigante, e ninguém lê tudo. */
const EXPORT_MAX_ARTICLES = 500;
/** Titulos de notícias fora do banco: suficiente pra orientar, sem inflar a resposta. */
const IMPORT_MISSING_SAMPLE = 10;
/** Pasta raiz no ZIP: ao extrair, os .md nao se espalham na pasta do usuario. */
const ZIP_ROOT_FOLDER = 'satelite-colecoes';

/**
 * O import aceita tudo que o export ja emitiu (e o que o usuario escrever):
 * JSON comeca com `{`; Markdown comeca com `#` — e dentro dele, `###` detecta
 * o formato unico atual, ausencia dele cai no legado `#`/`##`.
 * (Tambem cobre `?format=` errado — o conteudo manda, nao o parametro.)
 */
function parseCollection(raw: string): ParsedCollection {
  return raw.trimStart().startsWith('{') ? parseCollectionJson(raw) : parseCollectionMarkdown(raw);
}

/** Resultado da importação de coleção (Markdown ou JSON -> coleção + vínculos). */
export type CollectionImportReport = {
  group: NewsGroup;
  /** Itens unicos no arquivo (URL repetida conta uma vez). */
  total: number;
  /** Vinculos criados agora. */
  added: number;
  /** Ja estavam na colecao. */
  already: number;
  /** Noticias do arquivo que nao existem no banco (nao ha como vincular). */
  notFound: number;
  /** Amostra dos titulos nao encontrados. */
  missingTitles: string[];
  /** Anotacoes gravadas (so as nao vazias de itens que casaram por URL). */
  notesApplied: number;
};

export type SavedDeps = {
  repository: SavedRepository;
  news: { findById(id: string): Promise<Article | null> };
  provider: AiProvider;
  /** Piso de confianca da sugestao de grupo (config em runtime). */
  settings: AiSettingsSource;
  logger: Logger;
};

/**
 * Salvamento de noticias em grupos. O CRUD e fino (so repassa ao repositorio);
 * a logica real esta em validar o vinculo (grupo/noticia existem) e em sugerir
 * um grupo por IA, que e chamada paga e por isso falha alto.
 */
/**
 * Colapsa espacos internos ("Eleicoes   2026" -> "Eleicoes 2026"). O Zod ja
 * trima as pontas; o banco ainda garante unicidade case-insensitive (007), entao
 * a normalizacao aqui e conforto de escrita, nao a garantia final.
 */
function normalizeGroupInput<T extends GroupInput | GroupPatch>(input: T): T {
  if (typeof input.name !== 'string') return input;
  return { ...input, name: input.name.trim().replace(/\s+/g, ' ') };
}

export class SavedService {
  constructor(private readonly deps: SavedDeps) {}

  listGroups(): Promise<NewsGroup[]> {
    return this.deps.repository.listGroups();
  }

  createGroup(input: GroupInput): Promise<NewsGroup> {
    return this.deps.repository.createGroup(normalizeGroupInput(input));
  }

  async updateGroup(id: string, patch: GroupPatch): Promise<NewsGroup> {
    const updated = await this.deps.repository.updateGroup(id, normalizeGroupInput(patch));
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

  /**
   * Exporta uma coleção. Markdown é o formato de leitura (abre em qualquer
   * editor); JSON é o backup fiel. Falha alto com 404 se o grupo não existe.
   */
  async exportGroup(
    id: string,
    format: 'markdown' | 'json',
  ): Promise<{ contentType: string; filename: string; body: string }> {
    const group = await this.deps.repository.findGroupById(id);
    if (!group) throw new NotFoundError(`Grupo ${id} nao encontrado`);

    const articles = await this.deps.repository.listGroupArticlesForExport(id, EXPORT_MAX_ARTICLES);
    const stamp = new Date().toISOString().slice(0, 10);
    const slug = slugify(group.name);

    if (format === 'json') {
      return {
        contentType: 'application/json; charset=utf-8',
        filename: `satelite-colecao-${slug}-${stamp}.json`,
        body: JSON.stringify({ data: { group, articles } }, null, 2),
      };
    }

    return {
      contentType: 'text/markdown; charset=utf-8',
      filename: `satelite-colecao-${slug}-${stamp}.md`,
      body: buildCollectionMarkdown(group, articles),
    };
  }

  /**
   * ZIP com TODAS as colecoes: um `.md` por colecao (o mesmo formato do
   * export unico) dentro de `satelite-colecoes/`. Colecao vazia vai com so
   * o titulo — o arquivo e fiel ao que existe. Slug repetido ganha `-2`.
   */
  async exportAllCollectionsZip(): Promise<{ filename: string; buffer: Buffer }> {
    const groups = await this.deps.repository.listGroups();
    const perGroup = await Promise.all(
      groups.map(async (group) => ({
        group,
        articles: await this.deps.repository.listGroupArticlesForExport(group.id, EXPORT_MAX_ARTICLES),
      })),
    );

    const zip = new AdmZip();
    const usedSlugs = new Map<string, number>();
    for (const { group, articles } of perGroup) {
      const base = slugify(group.name);
      const occurrence = (usedSlugs.get(base) ?? 0) + 1;
      usedSlugs.set(base, occurrence);
      const filename = occurrence === 1 ? base : `${base}-${occurrence}`;
      zip.addFile(
        `${ZIP_ROOT_FOLDER}/${filename}.md`,
        Buffer.from(buildCollectionMarkdown(group, articles), 'utf8'),
      );
    }

    const stamp = new Date().toISOString().slice(0, 10);
    return { filename: `satelite-colecoes-${stamp}.zip`, buffer: zip.toBuffer() };
  }

  /**
   * Importa uma coleção de Markdown ou JSON (o formato do export). Reusa a
   * coleção de mesmo nome se existir — importar duas vezes acumula, nunca
   * duplica: o vínculo é idempotente e a URL é a chave de junção.
   *
   * Notas: só as não vazias são gravadas, e só nos itens que casaram por URL.
   * Nota vazia no arquivo NUNCA apaga nota existente — apagar é papel do
   * editor (ou do PUT /saved/articles/:articleId/note), não da importação.
   */
  async importGroup(raw: string): Promise<CollectionImportReport> {
    // o parser ja entrega o nome tratado e itens unicos por URL
    const { name, items } = parseCollection(raw);
    const group = await this.#findOrCreateGroup(name);

    const found = await this.deps.repository.findArticleIdsByUrls(items.map((item) => item.url));
    const entries = items.flatMap((item) => {
      const articleId = found.get(item.url);
      return articleId ? [{ articleId, savedAt: item.savedAt }] : [];
    });
    const alreadyIds = await this.deps.repository.listSavedArticleIds(
      group.id,
      entries.map((entry) => entry.articleId),
    );
    const added = await this.deps.repository.saveMany(
      group.id,
      entries.filter((entry) => !alreadyIds.has(entry.articleId)),
    );

    const notesApplied = await this.#applyNotes(items, found);

    const missing = items.filter((item) => !found.has(item.url));
    const report: CollectionImportReport = {
      group,
      total: items.length,
      added,
      already: entries.length - added,
      notFound: missing.length,
      missingTitles: missing.slice(0, IMPORT_MISSING_SAMPLE).map((item) => item.title),
      notesApplied,
    };

    this.deps.logger.info(
      {
        groupId: group.id,
        total: report.total,
        added: report.added,
        already: report.already,
        notFound: report.notFound,
        notesApplied: report.notesApplied,
      },
      'colecao importada',
    );
    return report;
  }

  /** Anotação pessoal de uma noticia. Vazia ou so espaço limpa a nota. */
  async setNote(articleId: string, note: string): Promise<void> {
    if (!(await this.deps.news.findById(articleId))) {
      throw new NotFoundError(`Noticia ${articleId} nao encontrada`);
    }
    const trimmed = note.trim();
    await this.deps.repository.setNote(articleId, trimmed || null);
  }

  /** Grava as notas não vazias dos itens que existem no banco. */
  async #applyNotes(items: ParsedCollectionItem[], found: Map<string, string>): Promise<number> {
    const entries = items.flatMap((item) => {
      const articleId = found.get(item.url);
      const note = item.note?.trim();
      return articleId && note ? [{ articleId, note }] : [];
    });
    // sem nada a gravar, nao toca no repositorio (nem um UPDATE inutil)
    if (entries.length === 0) return 0;
    return this.deps.repository.setNotes(entries);
  }

  /** Reusa coleção de mesmo nome (sem diferenciar maiúsculas) ou cria uma nova. */
  async #findOrCreateGroup(name: string): Promise<NewsGroup> {
    const existing = await this.deps.repository.findGroupByName(name);
    if (existing) return existing;
    try {
      return await this.createGroup({ name });
    } catch (error) {
      // corrida: outra importação criou o mesmo nome entre a busca e o insert
      if (error instanceof ConflictError) {
        const raced = await this.deps.repository.findGroupByName(name);
        if (raced) return raced;
      }
      throw error;
    }
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

    const suggestion = parseGroupSuggestion(
      raw.text,
      offered,
      this.deps.settings.ai().classify.minConfidence,
    );
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
