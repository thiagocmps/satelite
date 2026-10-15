import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/satelite.api';
import type {
  Article,
  ClassificationReport,
  NewsFilters,
  SourcesImportReport,
} from '../api/types';

/**
 * Hooks = unico lugar do frontend que conhece a API. Componentes so consomem
 * estes hooks e formatam o resultado.
 */

export const newsKeys = {
  list: (filters: NewsFilters) => ['news', filters] as const,
  detail: (id: string) => ['news', 'detail', id] as const,
  summary: (id: string) => ['news', 'summary', id] as const,
};

export function useNews(filters: NewsFilters) {
  return useQuery({
    queryKey: newsKeys.list(filters),
    queryFn: () => api.fetchNews(filters),
    // evita "piscada" de layout ao trocar os filtros
    placeholderData: (previous) => previous,
  });
}

export function useArticle(id: string) {
  return useQuery({ queryKey: newsKeys.detail(id), queryFn: () => api.fetchArticle(id) });
}

export function useSummary(id: string) {
  return useQuery({ queryKey: newsKeys.summary(id), queryFn: () => api.fetchSummary(id) });
}

export function useGenerateSummary(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.generateSummary(id),
    onSuccess: (response) => {
      queryClient.setQueryData(newsKeys.summary(id), response);
      // o card/listagem tambem mostra o resumo
      void queryClient.invalidateQueries({ queryKey: ['news'] });
    },
  });
}

export const categoriesKeys = {
  all: ['categories'] as const,
  rules: ['categories', 'rules'] as const,
};

export function useCategories() {
  return useQuery({ queryKey: categoriesKeys.all, queryFn: api.fetchCategories });
}

export function useCreateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.createCategory,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: categoriesKeys.all }),
  });
}

export function useDeleteCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.deleteCategory,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: categoriesKeys.all }),
  });
}

export function useCategoryRules() {
  return useQuery({ queryKey: categoriesKeys.rules, queryFn: api.fetchCategoryRules });
}

export function useAddCategoryRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ categoryId, keyword }: { categoryId: string; keyword: string }) =>
      api.addCategoryRule(categoryId, keyword),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: categoriesKeys.rules });
      void queryClient.invalidateQueries({ queryKey: categoriesKeys.all });
    },
  });
}

export function useDeleteCategoryRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ categoryId, ruleId }: { categoryId: string; ruleId: string }) =>
      api.deleteCategoryRule(categoryId, ruleId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: categoriesKeys.rules }),
  });
}

export const sourcesKeys = {
  all: ['sources'] as const,
  runs: ['sources', 'runs'] as const,
};

export function useSources() {
  return useQuery({ queryKey: sourcesKeys.all, queryFn: api.fetchSources });
}

export function useIngestionRuns() {
  return useQuery({ queryKey: sourcesKeys.runs, queryFn: () => api.fetchIngestionRuns(20) });
}

export function useCreateSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.createSource,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: sourcesKeys.all }),
  });
}

export function useUpdateSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { enabled?: boolean; defaultCategoryId?: string | null } }) =>
      api.updateSource(id, patch),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: sourcesKeys.all }),
  });
}

export function useDeleteSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.deleteSource,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: sourcesKeys.all }),
  });
}

/** Import de fontes a partir de um arquivo OPML ou JSON (leitura do arquivo fica no componente). */
export function useImportSources() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (raw: string) => api.importSources(raw),
    onSuccess: (response: { data: SourcesImportReport }) => {
      void queryClient.invalidateQueries({ queryKey: sourcesKeys.all });
      void queryClient.invalidateQueries({ queryKey: sourcesKeys.runs });
      // fontes novas ainda nao coletaram nada: o usuario pode disparar a ingestao
      void queryClient.invalidateQueries({ queryKey: ['news'] });
      return response;
    },
  });
}

/** Acao manual "Ingerir agora": roda as fontes e nao espera o agendador. */
export function useIngestNow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sourceId }: { sourceId?: string } = {}) =>
      sourceId ? api.ingestSourceNow(sourceId) : api.runIngestion(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sourcesKeys.runs });
      void queryClient.invalidateQueries({ queryKey: sourcesKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['news'] });
    },
  });
}

export const classificationKeys = {
  status: ['classification', 'status'] as const,
};

/** Quantos artigos aguardam a IA (fila needs_ai). */
export function useClassificationStatus() {
  return useQuery({ queryKey: classificationKeys.status, queryFn: api.fetchClassificationStatus });
}

/** Dispara a classificacao dos pendentes; atualiza a fila e a listagem. */
export function useRunClassification(onSuccess?: (report: ClassificationReport) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.runClassification(),
    onSuccess: (response) => {
      void queryClient.invalidateQueries({ queryKey: classificationKeys.status });
      queryClient.invalidateQueries({ queryKey: ['news'] });
      onSuccess?.(response.data);
    },
  });
}

export const aiSettingsKeys = {
  current: ['settings', 'ai'] as const,
};

/** Config efetiva da IA (descritores + provedores + valores, chave mascarada). */
export function useAiSettings() {
  return useQuery({ queryKey: aiSettingsKeys.current, queryFn: api.fetchAiSettings });
}

/** Salva e ja devolve a visao nova aplicada (o backend roda os appliers). */
export function useUpdateAiSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.updateAiSettings,
    onSuccess: (response) => {
      queryClient.setQueryData(aiSettingsKeys.current, response);
      // a fila muda de significado conforme a config (enabled, lote...)
      void queryClient.invalidateQueries({ queryKey: classificationKeys.status });
    },
  });
}

export const savedKeys = {
  groups: ['saved', 'groups'] as const,
  ids: ['saved', 'ids'] as const,
  list: (groupId: string | null, page: number, q: string) =>
    ['saved', 'list', groupId ?? 'all', page, q] as const,
};

export function useGroups() {
  return useQuery({ queryKey: savedKeys.groups, queryFn: api.fetchGroups });
}

/** Mapa artigo -> grupos, para marcar os cards sem uma requisicao por noticia. */
export function useSavedIds() {
  return useQuery({ queryKey: savedKeys.ids, queryFn: api.fetchSavedIds });
}

/** Noticias salvas: de um grupo especifico ou de todos (groupId null). `q` usa FTS. */
export function useSavedArticles(groupId: string | null, page: number, q = '') {
  return useQuery({
    queryKey: savedKeys.list(groupId, page, q),
    queryFn: () => (groupId ? api.fetchGroupArticles(groupId, page, 12, q) : api.fetchSaved(page, 12, q)),
    placeholderData: (previous) => previous,
  });
}

export function useCreateGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.createGroup,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['saved'] }),
  });
}

/** Renomear/repintar coleção — mesmos campos do PATCH /groups/:id. */
export function useUpdateGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { name?: string; color?: string | null } }) =>
      api.updateGroup(id, patch),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['saved'] }),
  });
}

/** Importar coleção de Markdown: cria/reusa o grupo e revalida a lista. */
export function useImportCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.importCollection,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['saved'] }),
  });
}

export function useDeleteGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.deleteGroup,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['saved'] }),
  });
}

export function useSaveArticle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, articleId }: { groupId: string; articleId: string }) =>
      api.saveArticleToGroup(groupId, articleId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['saved'] }),
  });
}

export function useUnsaveArticle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, articleId }: { groupId: string; articleId: string }) =>
      api.removeArticleFromGroup(groupId, articleId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['saved'] }),
  });
}

/** Pede a IA um grupo (existente ou novo) para a noticia. */
export function useSuggestGroup() {
  return useMutation({ mutationFn: (articleId: string) => api.suggestGroup(articleId) });
}

/**
 * Anotacao pessoal da noticia. Atualiza o cache do detalhe na hora (o usuario
 * esta olhando a nota) e revalida os salvos, onde a nota tambem aparece.
 */
export function useUpdateNote(articleId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (note: string) => api.updateNote(articleId, note),
    onSuccess: (response) => {
      // escrita otimista no detalhe: evita esperar o refetch pra mostrar a nota
      queryClient.setQueryData<{ data: Article }>(newsKeys.detail(articleId), (previous) =>
        previous ? { ...previous, data: { ...previous.data, note: response.data.note } } : previous,
      );
      void queryClient.invalidateQueries({ queryKey: savedKeys.ids });
      void queryClient.invalidateQueries({ queryKey: ['saved', 'list'] });
    },
  });
}
