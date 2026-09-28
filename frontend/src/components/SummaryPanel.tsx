import type { AiSummaryPayload } from '../api/types';
import { useGenerateSummary, useSummary } from '../hooks/useSatelite';
import { formatDateTime } from '../utils/format';

/**
 * Painel de resumo por IA. Le o resumo ja salvo (GET) e, sob demanda, pede a
 * geracao (POST). Todo o trabalho de rede fica nos hooks.
 */
export function SummaryPanel({ articleId }: { articleId: string }) {
  const summaryQuery = useSummary(articleId);
  const generate = useGenerateSummary(articleId);

  const summary: AiSummaryPayload | null = summaryQuery.data?.data ?? null;
  const failed = generate.error instanceof Error ? generate.error.message : null;

  return (
    <section className="panel" aria-labelledby="resumo-titulo">
      <h2 className="panel__title" id="resumo-titulo">
        Resumo
      </h2>
      <p className="panel__hint">
        Gerado por um modelo de linguagem e salvo no banco: o mesmo resumo e reaproveitado, sem chamar a IA de novo.
      </p>

      {summary ? (
        <div className="ai-box">
          <p className="ai-box__label">✦ Gerado por IA</p>
          <p className="ai-box__text">{summary.text}</p>
          <p className="ai-box__meta">
            {summary.provider} · {summary.model} · prompt {summary.promptVersion}
            {summary.cached ? ' · do cache' : ''}
            {summary.tokensOut ? ` · ${summary.tokensOut} tokens` : ''} · {formatDateTime(summary.updatedAt)}
          </p>
        </div>
      ) : summaryQuery.isPending ? (
        <div className="skeleton" style={{ height: 110 }} aria-hidden="true" />
      ) : summaryQuery.isError ? (
        <p className="small muted">Nao foi possivel consultar o resumo salvo.</p>
      ) : (
        <p className="small muted">
          Nenhum resumo gerado para esta noticia ainda. A geracao consome a cota gratuita da OpenRouter, entao
          resumo e gerado sob demanda.
        </p>
      )}

      {failed ? (
        <p className="toast toast--error" style={{ marginTop: 'var(--sp-3)' }} role="alert">
          {failed}
        </p>
      ) : null}

      <button
        type="button"
        className="button button--primary"
        style={{ marginTop: 'var(--sp-4)', width: '100%' }}
        onClick={() => generate.mutate()}
        disabled={generate.isPending}
      >
        {generate.isPending ? (
          <>
            <span className="spinner" aria-hidden="true" /> Gerando resumo…
          </>
        ) : summary ? (
          'Regerar resumo'
        ) : (
          '✦ Gerar resumo com IA'
        )}
      </button>
    </section>
  );
}
