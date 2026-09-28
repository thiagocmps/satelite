import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorBox } from '../components/States';
import { suggestSlug } from '../components/Filters';
import type { SourcesImportReport } from '../api/types';
import {
  useCategories,
  useCreateSource,
  useDeleteSource,
  useImportSources,
  useIngestNow,
  useIngestionRuns,
  useSources,
  useUpdateSource,
} from '../hooks/useSatelite';
import { formatDateTime, slugify } from '../utils/format';

function statusBadge(status: string | null, error: string | null) {
  if (status === 'ok') return <span className="badge badge--ok">ok</span>;
  if (status === 'not_modified') return <span className="badge">304 sem mudancas</span>;
  if (status === 'error') return <span className="badge badge--error" title={error ?? undefined}>erro</span>;
  return <span className="badge">nunca executada</span>;
}

export function SourcesPage() {
  const sources = useSources();
  const runs = useIngestionRuns();
  const categories = useCategories();
  const createSource = useCreateSource();
  const updateSource = useUpdateSource();
  const deleteSource = useDeleteSource();
  const ingest = useIngestNow();
  const importSources = useImportSources();
  const fileInput = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({ name: '', slug: '', feedUrl: '', siteUrl: '', categoryId: '' });
  const [importResult, setImportResult] = useState<SourcesImportReport | null>(null);

  const error =
    sources.error ?? createSource.error ?? ingest.error ?? deleteSource.error ?? importSources.error;

  function onImportFileSelected(file: File | undefined) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setImportResult({
        imported: 0,
        skipped: [{ name: file.name, feedUrl: '', reason: 'arquivo maior que 2 MB' }],
      });
      return;
    }
    setImportResult(null);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        importSources.mutate(reader.result, {
          onSuccess: (response) => setImportResult(response.data),
        });
      }
    };
    reader.readAsText(file);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    createSource.mutate(
      {
        slug: form.slug || slugify(form.name),
        name: form.name,
        feedUrl: form.feedUrl,
        siteUrl: form.siteUrl || null,
        defaultCategoryId: form.categoryId || null,
      },
      { onSuccess: () => setForm({ name: '', slug: '', feedUrl: '', siteUrl: '', categoryId: '' }) },
    );
  }

  const list = sources.data?.data ?? [];
  const recentRuns = runs.data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Fontes"
        description="Feeds RSS/Atom monitorados. A ingestao roda por agendamento e tambem pode ser disparada aqui."
        action={
          <>
            <input
              ref={fileInput}
              className="visually-hidden"
              type="file"
              accept=".opml,.xml,.json,text/xml,text/x-opml,application/json"
              onChange={(event) => onImportFileSelected(event.target.files?.[0])}
            />
            <button
              type="button"
              className="button"
              onClick={() => fileInput.current?.click()}
              disabled={importSources.isPending}
            >
              {importSources.isPending ? (
                <>
                  <span className="spinner" aria-hidden="true" /> Importando…
                </>
              ) : (
                '⇧ Importar'
              )}
            </button>
            <a className="button" href="/api/v1/sources/export?format=opml" title="Baixar lista de feeds (OPML - importavel em leitores de RSS)">
              ⇩ OPML
            </a>
            <a className="button" href="/api/v1/sources/export?format=json" title="Baixar backup em JSON">
              ⇩ JSON
            </a>
            <button type="button" className="button button--primary" onClick={() => ingest.mutate({})} disabled={ingest.isPending}>
              {ingest.isPending ? (
                <>
                  <span className="spinner" aria-hidden="true" /> Ingerindo todas…
                </>
              ) : (
                '⟳ Ingerir tudo'
              )}
            </button>
          </>
        }
      />

      {error ? <ErrorBox message={error.message} /> : null}
      {ingest.isSuccess ? (
        <p className="toast toast--ok" style={{ marginBottom: 'var(--sp-4)' }}>
          Ingestao concluida. Va em Noticias para ver os resultados.
        </p>
      ) : null}

      {importResult ? (
        <div className="toast toast--ok" style={{ marginBottom: 'var(--sp-4)' }} role="status">
          <strong>
            {importResult.imported > 0
              ? `${importResult.imported} fonte${importResult.imported > 1 ? 's' : ''} importada${importResult.imported > 1 ? 's' : ''}.`
              : 'Nenhuma fonte nova para importar.'}
          </strong>
          {importResult.skipped.length > 0 ? (
            <ul style={{ margin: 'var(--sp-2) 0 0', paddingLeft: 'var(--sp-4)' }}>
              {importResult.skipped.map((item) => (
                <li key={`${item.feedUrl}-${item.reason}`} className="small">
                  <strong>{item.name}</strong> — {item.reason}
                </li>
              ))}
            </ul>
          ) : null}
          {importResult.imported > 0 ? (
            <p className="small" style={{ marginTop: 'var(--sp-2)' }}>
              As novas fontes ainda nao coletaram noticias: use "Ingerir tudo" para buscar agora.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="stack">
        <section className="panel">
          <h2 className="panel__title">Nova fonte</h2>
          <p className="panel__hint">Qualquer feed publico RSS ou Atom. O slug e derivado do nome se voce deixar vazio.</p>

          <form className="form-grid" onSubmit={submit}>
            <div className="field">
              <label className="field__label" htmlFor="fonte-nome">
                Nome
              </label>
              <input
                id="fonte-nome"
                className="input"
                required
                minLength={2}
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="Meu Journal"
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="fonte-slug">
                Slug
              </label>
              <input
                id="fonte-slug"
                className="input"
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                value={form.slug}
                onChange={(event) => setForm({ ...form, slug: event.target.value })}
                placeholder={suggestSlug(form.name) || 'meu-journal'}
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="fonte-feed">
                URL do feed
              </label>
              <input
                id="fonte-feed"
                className="input"
                type="url"
                required
                value={form.feedUrl}
                onChange={(event) => setForm({ ...form, feedUrl: event.target.value })}
                placeholder="https://exemplo.com/rss.xml"
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="fonte-site">
                Site
              </label>
              <input
                id="fonte-site"
                className="input"
                type="url"
                value={form.siteUrl}
                onChange={(event) => setForm({ ...form, siteUrl: event.target.value })}
                placeholder="https://exemplo.com"
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="fonte-categoria">
                Categoria padrao
              </label>
              <select
                id="fonte-categoria"
                className="select"
                value={form.categoryId}
                onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
              >
                <option value="">Sem padrao</option>
                {(categories.data?.data ?? []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="field__label" aria-hidden="true">
                &nbsp;
              </label>
              <button type="submit" className="button button--primary" disabled={createSource.isPending || !form.feedUrl}>
                {createSource.isPending ? 'Adicionando…' : 'Adicionar fonte'}
              </button>
            </div>
          </form>
        </section>

        <section className="panel">
          <h2 className="panel__title">Fontes ativas</h2>
          <p className="panel__hint">Desativar uma fonte interrompe a coleta; as noticias ja ingeridas permanecem.</p>

          {sources.isPending ? (
            <div className="skeleton" style={{ height: 160 }} />
          ) : list.length === 0 ? (
            <EmptyState title="Nenhuma fonte cadastrada" hint="Adicione um feed RSS acima." />
          ) : (
            <div className="table__scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Fonte</th>
                    <th>Status</th>
                    <th>Ultima execucao</th>
                    <th aria-label="Acoes" />
                  </tr>
                </thead>
                <tbody>
                  {list.map((source) => (
                    <tr key={source.id}>
                      <td>
                        <div className="row" style={{ gap: 'var(--sp-2)' }}>
                          <strong>{source.name}</strong>
                          {source.category ? <span className="badge">{source.category.name}</span> : null}
                          {!source.enabled ? <span className="badge badge--warning">desativada</span> : null}
                        </div>
                        <div className="mono">{source.feedUrl}</div>
                        {source.lastError ? (
                          <div className="small" style={{ color: 'var(--danger)' }}>
                            {source.lastError}
                          </div>
                        ) : null}
                      </td>
                      <td>{statusBadge(source.lastStatus, source.lastError)}</td>
                      <td className="muted small">{formatDateTime(source.lastFetchedAt)}</td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="button button--sm"
                            onClick={() => ingest.mutate({ sourceId: source.id })}
                            disabled={ingest.isPending}
                          >
                            Ingerir
                          </button>
                          <button
                            type="button"
                            className="button button--sm"
                            onClick={() => updateSource.mutate({ id: source.id, patch: { enabled: !source.enabled } })}
                            disabled={updateSource.isPending}
                          >
                            {source.enabled ? 'Desativar' : 'Ativar'}
                          </button>
                          <button
                            type="button"
                            className="button button--sm button--danger"
                            onClick={() => deleteSource.mutate(source.id)}
                            disabled={deleteSource.isPending}
                          >
                            Remover
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel">
          <h2 className="panel__title">Historico de ingestao</h2>
          <p className="panel__hint">Ultimas execucoes: quantos itens vieram do feed, quantos entraram e quantos eram duplicados.</p>

          {runs.isPending ? (
            <div className="skeleton" style={{ height: 120 }} />
          ) : recentRuns.length === 0 ? (
            <EmptyState title="Nenhuma execucao registrada" />
          ) : (
            <div className="table__scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Inicio</th>
                    <th>Fonte</th>
                    <th>Status</th>
                    <th>Itens</th>
                    <th>Inseridos</th>
                    <th>Duplicados</th>
                  </tr>
                </thead>
                <tbody>
                  {recentRuns.map((run) => (
                    <tr key={run.id}>
                      <td className="muted small">{formatDateTime(run.startedAt)}</td>
                      <td>{run.sourceName ?? '—'}</td>
                      <td>
                        <span
                          className={`badge ${
                            run.status === 'ok' ? 'badge--ok' : run.status === 'error' ? 'badge--error' : ''
                          }`}
                          title={run.error ?? undefined}
                        >
                          {run.status}
                          {run.httpStatus ? ` · ${run.httpStatus}` : ''}
                        </span>
                      </td>
                      <td>{run.fetched}</td>
                      <td>{run.inserted}</td>
                      <td>{run.duplicates}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
