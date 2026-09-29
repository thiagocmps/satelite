/** Tipos de dominio compartilhados entre repositorios, servicos e controllers. */

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

/** Resumo ja persistido. `generatedByAi` e explicito: a UI sempre sinaliza a origem. */
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

export type CategoryMethod = 'keyword' | 'ai';

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
  /** Origem da categoria: keyword (regra), IA (OpenRouter) ou null (padrao da fonte/ausente). */
  categoryMethod: CategoryMethod | null;
  /** Confianca da IA entre 0 e 1 (null quando nao foi a IA). */
  categoryConfidence: number | null;
  summary: SummaryView | null;
};

/** Noticia normalizada, pronta para insercao (pre-ou-pos-deduplicacao). */
export type NormalizedArticle = {
  sourceId: string;
  categoryId: string | null;
  title: string;
  description: string | null;
  content: string | null;
  imageUrl: string | null;
  author: string | null;
  url: string;
  urlHash: string;
  fingerprint: string;
  publishedAt: Date;
  /** Entra na fila da IA quando a keyword nao decide e ha texto suficiente. */
  needsAi: boolean;
  /** 'keyword' quando uma regra decidiu; null quando ficou com o padrao da fonte. */
  categoryMethod: 'keyword' | null;
};

export type NewsListQuery = {
  q?: string | undefined;
  categoryId?: string | undefined;
  sourceId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  page: number;
  limit: number;
  sort: 'recent' | 'relevance';
};

export type Paginated<T> = {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
};
