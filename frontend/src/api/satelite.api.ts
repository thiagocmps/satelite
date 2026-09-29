import { api, buildQuery } from './client';
import type {
  AiSummaryPayload,
  Article,
  Category,
  CategoryRule,
  ClassificationReport,
  ClassificationStatus,
  IngestionReport,
  IngestionRun,
  NewsFilters,
  Paginated,
  Source,
  SourcesImportReport,
} from './types';

/* ------------------------------------------------------------------ noticias */

export function fetchNews(filters: NewsFilters): Promise<Paginated<Article>> {
  return api.get<Paginated<Article>>(`/news${buildQuery({ ...filters })}`);
}

export function fetchArticle(id: string): Promise<{ data: Article }> {
  return api.get<{ data: Article }>(`/news/${id}`);
}

/** `data: null` significa "ainda nao gerado" — nao e erro. */
export function fetchSummary(id: string): Promise<{ data: AiSummaryPayload | null }> {
  return api.get<{ data: AiSummaryPayload | null }>(`/news/${id}/summary`);
}

export function generateSummary(id: string): Promise<{ data: AiSummaryPayload }> {
  return api.post<{ data: AiSummaryPayload }>(`/news/${id}/summary`);
}

/* --------------------------------------------------------------- categorias */

export function fetchCategories(): Promise<{ data: Category[] }> {
  return api.get<{ data: Category[] }>('/categories');
}

export function createCategory(input: { slug: string; name: string; description?: string | null; color?: string | null }): Promise<{ data: Category }> {
  return api.post<{ data: Category }>('/categories', input);
}

export function deleteCategory(id: string): Promise<void> {
  return api.delete<void>(`/categories/${id}`);
}

export function fetchCategoryRules(): Promise<{ data: CategoryRule[] }> {
  return api.get<{ data: CategoryRule[] }>('/categories/rules');
}

export function addCategoryRule(categoryId: string, keyword: string): Promise<{ data: CategoryRule }> {
  return api.post<{ data: CategoryRule }>(`/categories/${categoryId}/rules`, { keyword });
}

export function deleteCategoryRule(categoryId: string, ruleId: string): Promise<void> {
  return api.delete<void>(`/categories/${categoryId}/rules/${ruleId}`);
}

/* ------------------------------------------------------------------- fontes */

export function fetchSources(): Promise<{ data: Source[] }> {
  return api.get<{ data: Source[] }>('/sources');
}

export function createSource(input: { slug: string; name: string; feedUrl: string; siteUrl?: string | null; defaultCategoryId?: string | null }): Promise<{ data: Source }> {
  return api.post<{ data: Source }>('/sources', input);
}

export function updateSource(id: string, patch: { enabled?: boolean; defaultCategoryId?: string | null }): Promise<{ data: Source }> {
  return api.patch<{ data: Source }>(`/sources/${id}`, patch);
}

export function deleteSource(id: string): Promise<void> {
  return api.delete<void>(`/sources/${id}`);
}

export function ingestSourceNow(id: string): Promise<{ data: unknown }> {
  return api.post<{ data: unknown }>(`/sources/${id}/ingest`);
}

/** Import de fontes: corpo cru (conteudo de um arquivo OPML ou JSON). */
export function importSources(raw: string): Promise<{ data: SourcesImportReport }> {
  return api.postRaw<{ data: SourcesImportReport }>('/sources/import', raw);
}

/* ---------------------------------------------------------------- ingestao */

export function runIngestion(): Promise<{ data: IngestionReport }> {
  return api.post<{ data: IngestionReport }>('/ingest/run');
}

export function fetchIngestionRuns(limit = 20): Promise<{ data: IngestionRun[] }> {
  return api.get<{ data: IngestionRun[] }>(`/ingest/runs?limit=${limit}`);
}

/* ---------------------------------------------------- classificacao por IA */

export function runClassification(): Promise<{ data: ClassificationReport }> {
  return api.post<{ data: ClassificationReport }>('/ingest/classify');
}

export function fetchClassificationStatus(): Promise<{ data: ClassificationStatus }> {
  return api.get<{ data: ClassificationStatus }>('/ingest/classify/status');
}
