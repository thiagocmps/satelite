/**
 * Tipos do contrato da API. Espelham `backend/src/modules/**\/*.types.ts`
 * (ver docs/API.md). Mantidos a mao de proposito: o contrato e pequeno e estavel.
 */

export type SourceRef = {
  id: string;
  slug: string;
  name: string;
  siteUrl: string | null;
};

export type CategoryRef = {
  id: string;
  slug: string;
  name: string;
  color: string | null;
};

export type SummaryView = {
  text: string;
  generatedByAi: true;
  provider: string;
  model: string;
  promptVersion: string;
  language: string;
  createdAt: string;
  updatedAt: string;
  tokensIn: number | null;
  tokensOut: number | null;
};

export type Article = {
  id: string;
  title: string;
  description: string | null;
  content: string | null;
  imageUrl: string | null;
  author: string | null;
  url: string;
  publishedAt: string;
  ingestedAt: string;
  source: SourceRef;
  category: CategoryRef | null;
  summary: SummaryView | null;
};

export type AiSummaryPayload = SummaryView & { cached: boolean };

export type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
};

export type Paginated<T> = { data: T[]; pagination: Pagination };

export type Category = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  color: string | null;
  articleCount: number;
  createdAt: string;
};

export type CategoryRule = {
  id: string;
  categoryId: string;
  keyword: string;
  createdAt: string;
};

export type Source = {
  id: string;
  slug: string;
  name: string;
  feedUrl: string;
  siteUrl: string | null;
  defaultCategoryId: string | null;
  enabled: boolean;
  etag: string | null;
  lastModified: string | null;
  lastFetchedAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  category: CategoryRef | null;
  createdAt: string;
};

export type IngestionRun = {
  id: string;
  sourceId: string | null;
  sourceName: string | null;
  status: 'running' | 'ok' | 'error' | 'skipped';
  httpStatus: number | null;
  notModified: boolean;
  fetched: number;
  inserted: number;
  duplicates: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

/** Resultado do import de fontes: o que entrou e o que foi ignorado (com motivo). */
export type SourcesImportReport = {
  imported: number;
  skipped: Array<{ name: string; feedUrl: string; reason: string }>;
};

export type SourceIngestionResult = {
  sourceId: string;
  slug: string;
  name: string;
  status: 'ok' | 'not_modified' | 'error';
  fetched: number;
  inserted: number;
  duplicates: number;
  error?: string;
};

export type IngestionReport = {
  startedAt: string;
  finishedAt: string;
  sources: number;
  inserted: number;
  duplicates: number;
  failed: number;
  results: SourceIngestionResult[];
};

/** Filtros da listagem de noticias (espelha a query da API). */
export type NewsFilters = {
  q?: string;
  category?: string;
  source?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
  sort?: 'recent' | 'relevance';
};
