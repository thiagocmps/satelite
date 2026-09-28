import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/satelite.api';
import type { NewsFilters } from '../api/types';

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
