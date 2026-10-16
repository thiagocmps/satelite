import { useEffect, useState } from 'react';
import type { AiSettings, AiSettingsPatch, AiSettingsView, ClassificationReport, SettingsField } from '../api/types';
import { PageHeader } from '../components/PageHeader';
import { ErrorBox } from '../components/States';
import {
  useAiSettings,
  useClassificationStatus,
  useRunClassification,
  useUpdateAiSettings,
} from '../hooks/useSatelite';

/**
 * Tela de configuracao da IA (/config-ia). Os campos vem do backend como
 * DESCRIPTORES (types/sections/options): a pagina renderiza por `type`, então
 * um knob novo no backend aparece aqui sem mexer neste arquivo — a unica
 * particularidade visual sao os CARDS de provedor (secao 'providers').
 *
 * Salvar = PATCH parcial (so o que mudou). O backend persiste em app_settings,
 * valida o efetivo e aplica em runtime: provider/modelo trocam na proxima
 * chamada e o cron e reagendado na hora — nada de reiniciar container.
 */

/* ------------------------------------------------------------------ helpers */

function readPath(target: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined,
      target,
    );
}

/** Imutavel: devolve `target` com `value` escrito em `path` (cria os objetos). */
function writePath<T>(target: T, path: string, value: unknown): T {
  const [head, ...rest] = path.split('.');
  if (!head) return target;
  const base = (target && typeof target === 'object' ? target : {}) as Record<string, unknown>;
  const child =
    rest.length > 0 ? writePath((base[head] ?? {}) as unknown, rest.join('.'), value) : value;
  return { ...base, [head]: child } as T;
}

/** So o que mudou de verdade vira PATCH (a chave mascarada nunca volta). */
function collectPatch(original: AiSettings, current: AiSettings, fields: SettingsField[]): AiSettingsPatch {
  let patch: Record<string, unknown> = {};
  for (const field of fields) {
    const before = readPath(original, field.key);
    const after = readPath(current, field.key);
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    // campo de chave limpo = "manter a atual" (backend trata igual)
    if (field.type === 'password' && after === '') continue;
    patch = writePath(patch, field.key, after) as Record<string, unknown>;
  }
  return patch as AiSettingsPatch;
}

const providerLabel = (view: AiSettingsView, id: string) =>
  view.providers.find((provider) => provider.id === id)?.label ?? id;

const cronLabel = (field: SettingsField | undefined, cron: string) =>
  field?.options?.find((option) => option.value === cron)?.label ?? cron;

/* ------------------------------------------------------------- controles */

function formatRange(value: unknown, field: SettingsField): string {
  const number = Number(value);
  if (field.step !== undefined && field.step < 1) return number.toFixed(2);
  return number.toLocaleString('pt-BR');
}

function FieldControl({
  field,
  value,
  onChange,
  passwordPlaceholder,
}: {
  field: SettingsField;
  value: unknown;
  onChange: (value: unknown) => void;
  passwordPlaceholder: string;
}) {
  switch (field.type) {
    case 'boolean':
      return (
        <label className="switch">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(event) => onChange(event.target.checked)}
          />
          <span className="switch__track" aria-hidden="true">
            <span className="switch__thumb" />
          </span>
        </label>
      );

    case 'password':
      return (
        <input
          className="input"
          type="password"
          autoComplete="off"
          placeholder={passwordPlaceholder || 'sem chave'}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        />
      );

    case 'number':
      return (
        <input
          className="input"
          type="number"
          min={field.min}
          max={field.max}
          value={typeof value === 'number' ? value : 0}
          onChange={(event) => {
            const next = event.target.value === '' ? 0 : Number(event.target.value);
            if (Number.isFinite(next)) onChange(next);
          }}
        />
      );

    case 'range':
      return (
        <div className="range">
          <input
            type="range"
            min={field.min}
            max={field.max}
            step={field.step}
            value={typeof value === 'number' ? value : 0}
            onChange={(event) => onChange(Number(event.target.value))}
          />
          <output className="range__value">{formatRange(value, field)}</output>
        </div>
      );

    case 'select':
      return (
        <select
          className="select"
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
        >
          {field.options?.some((option) => option.value === value) ? null : (
            <option value={String(value)}>{String(value)} (atual)</option>
          )}
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );

    case 'cron': {
      const current = String(value);
      const isPreset = (field.options ?? []).some((option) => option.value === current);
      return (
        <div className="cron-inputs">
          <select
            className="select"
            value={isPreset ? current : ''}
            onChange={(event) => event.target.value && onChange(event.target.value)}
          >
            {isPreset ? null : <option value="">personalizado: {current}</option>}
            {(field.options ?? []).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <input
            className="input"
            value={current}
            placeholder="*/10 * * * *"
            aria-label="Expressao cron (5 campos)"
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
      );
    }

    case 'csv':
      return (
        <input
          className="input"
          value={Array.isArray(value) ? (value as string[]).join(', ') : ''}
          placeholder="modelo-a, modelo-b"
          onChange={(event) =>
            onChange(
              event.target.value
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean),
            )
          }
        />
      );

    default:
      return (
        <input
          className="input"
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
}

/* ------------------------------------------------------------------ pagina */

export function AiSettingsPage() {
  const settings = useAiSettings();
  const status = useClassificationStatus();
  const update = useUpdateAiSettings();
  const [classifyResult, setClassifyResult] = useState<ClassificationReport | null>(null);
  const run = useRunClassification(setClassifyResult);
  const [draft, setDraft] = useState<AiSettings | null>(null);
  const [saved, setSaved] = useState(false);

  const view = settings.data?.data;
  useEffect(() => {
    if (view && !draft) setDraft(view.settings);
  }, [view, draft]);

  if (settings.isLoading) {
    return (
      <div className="stack">
        <PageHeader eyebrow="AJUSTES · IA" title="Configuracao da IA" />
        <div className="skeleton skeleton--card" style={{ height: 220 }} />
        <div className="skeleton skeleton--card" style={{ height: 260 }} />
      </div>
    );
  }

  if (settings.isError) return <ErrorBox message={settings.error.message} />;
  if (!view || !draft) return <ErrorBox message="Configuracao indisponivel." />;

  const fields = view.fields;
  const patch = collectPatch(view.settings, draft, fields);
  const dirty = Object.keys(patch).length > 0;
  const fieldOf = (key: string) => fields.find((field) => field.key === key);

  const set = (key: string) => (value: unknown) => {
    setSaved(false);
    setDraft((current) => (current ? writePath(current, key, value) : current));
  };

  const save = () => {
    if (!dirty) return;
    update.mutate(patch, {
      onSuccess: (response) => {
        setDraft(response.data.settings);
        setSaved(true);
      },
    });
  };

  const discard = () => {
    setDraft(view.settings);
    setSaved(false);
    update.reset();
  };

  const renderField = (field: SettingsField) => (
    <div className="field" key={field.key}>
      <span className="field__label">{field.label}</span>
      <FieldControl
        field={field}
        value={readPath(draft, field.key)}
        onChange={set(field.key)}
        passwordPlaceholder={
          field.provider ? (view.settings.providers[field.provider]?.apiKey ?? '') : ''
        }
      />
      {field.hint ? <span className="field__hint">{field.hint}</span> : null}
    </div>
  );

  /** Seccao descritora: campos principais + "Avancado" recolhido. */
  const renderSection = (section: SettingsField['section']) => {
    const own = fields.filter((field) => field.section === section);
    const main = own.filter((field) => !field.advanced);
    const advanced = own.filter((field) => field.advanced);
    return (
      <>
        {main.map((field) =>
          field.type === 'boolean' ? (
            <div className="switch-row" key={field.key}>
              <div>
                <span className="field__label">{field.label}</span>
                {field.hint ? <span className="field__hint">{field.hint}</span> : null}
              </div>
              <FieldControl
                field={field}
                value={readPath(draft, field.key)}
                onChange={set(field.key)}
                passwordPlaceholder=""
              />
            </div>
          ) : (
            renderField(field)
          ),
        )}
        {advanced.length > 0 ? (
          <details className="details">
            <summary>Avancado</summary>
            <div className="form-grid">{advanced.map(renderField)}</div>
          </details>
        ) : null}
      </>
    );
  };

  const fallbackField = fieldOf('fallbackProviders');
  const pending = status.data?.data.pending ?? 0;

  return (
    <div className="stack">
      <PageHeader
        eyebrow="AJUSTES · IA"
        title="Configuracao da IA"
        description="Provedor, tuning da fila e agendador. Salvar aplica na hora, sem reiniciar nada."
        action={
          <button
            className="button button--primary"
            onClick={() => run.mutate()}
            disabled={run.isPending || pending === 0}
            title={
              pending > 0
                ? `${pending} artigo${pending > 1 ? 's' : ''} esperando a IA`
                : 'Nenhum artigo na fila de classificação'
            }
          >
            {run.isPending ? 'Classificando…' : `✦ Classificar agora${pending > 0 ? ` (${pending})` : ''}`}
          </button>
        }
      />

      {run.isError ? <ErrorBox message={run.error.message} /> : null}
      {classifyResult ? (
        <p className="toast toast--ok" role="status">
          Classificação concluída:{' '}
          <strong>
            {classifyResult.processed} artigo{classifyResult.processed === 1 ? '' : 's'} processado
            {classifyResult.processed === 1 ? '' : 's'}
          </strong>
          {classifyResult.aiAssigned > 0 && `, ${classifyResult.aiAssigned} por IA`}
          {classifyResult.resolvedKeyword > 0 && `, ${classifyResult.resolvedKeyword} por regra`}
          {classifyResult.errors > 0 && `, ${classifyResult.errors} com erro`}
          {classifyResult.pending > 0 ? ` (${classifyResult.pending} ainda na fila)` : '.'}
        </p>
      ) : null}

      <div className="stat-tiles">
        <div className="stat-tile">
          <span className="stat-tile__label">Fila de IA</span>
          <strong className="stat-tile__value">{pending.toLocaleString('pt-BR')}</strong>
          <span className="stat-tile__hint">artigos aguardando</span>
        </div>
        <div className="stat-tile">
          <span className="stat-tile__label">Provedor</span>
          <strong className="stat-tile__value">{providerLabel(view, draft.provider)}</strong>
          <span className="stat-tile__hint">{draft.providers[draft.provider]?.model}</span>
        </div>
        <div className="stat-tile">
          <span className="stat-tile__label">Classificacao</span>
          <strong className="stat-tile__value">{draft.classify.enabled ? 'IA ligada' : 'so keyword'}</strong>
          <span className="stat-tile__hint">
            {draft.classify.batch}/rodada · {draft.classify.batchSize}/lote ·{' '}
            {draft.classify.concurrency}x simultaneas
          </span>
        </div>
        <div className="stat-tile">
          <span className="stat-tile__label">Agendador</span>
          <strong className="stat-tile__value">
            {draft.scheduler.classifyEnabled && draft.classify.enabled ? 'automatico' : 'desligado'}
          </strong>
          <span className="stat-tile__hint">
            {draft.scheduler.classifyEnabled && draft.classify.enabled
              ? cronLabel(fieldOf('scheduler.classifyCron'), draft.scheduler.classifyCron)
              : 'so manual'}
          </span>
        </div>
      </div>

      {/* ------------------------------------------------------- provedores */}
      <section className="panel">
        <h2 className="panel__title">Provedores</h2>
        <p className="panel__hint">
          O principal recebe as chamadas; o fallback so entra quando o principal falha (cota, 429,
          5xx). Trocar aqui vale ja na proxima chamada.
        </p>

        <div className="provider-grid">
          {view.providers.map((provider) => {
            const active = provider.id === draft.provider;
            const cardFields = fields.filter(
              (field) => field.section === 'providers' && field.provider === provider.id,
            );
            const main = cardFields.filter((field) => !field.advanced);
            const advanced = cardFields.filter((field) => field.advanced);
            const masked = view.settings.providers[provider.id]?.apiKey ?? '';
            return (
              <div className={active ? 'provider-card is-active' : 'provider-card'} key={provider.id}>
                <button
                  type="button"
                  className="provider-card__head"
                  onClick={() => set('provider')(provider.id)}
                >
                  <span className="provider-card__radio" aria-hidden="true" />
                  <span className="provider-card__name">{provider.label}</span>
                  {active ? <span className="badge badge--ai">principal</span> : null}
                </button>

                {main.map(renderField)}

                {advanced.length > 0 ? (
                  <details className="details">
                    <summary>Avancado</summary>
                    <div className="stack">{advanced.map(renderField)}</div>
                  </details>
                ) : null}

                <div className="provider-card__foot">
                  <label
                    className={
                      draft.fallbackProviders.includes(provider.id)
                        ? 'check-chip is-on'
                        : 'check-chip'
                    }
                  >
                    <input
                      type="checkbox"
                      checked={draft.fallbackProviders.includes(provider.id)}
                      onChange={(event) => {
                        const next = event.target.checked
                          ? [...draft.fallbackProviders, provider.id]
                          : draft.fallbackProviders.filter((id) => id !== provider.id);
                        set('fallbackProviders')(next);
                      }}
                    />
                    fallback
                  </label>
                  {masked ? (
                    <span className="badge">chave {masked}</span>
                  ) : (
                    <a
                      className="provider-card__link"
                      href={provider.keyUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      pegar chave ↗
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {fallbackField ? (
          <p className="panel__hint" style={{ marginTop: 'var(--sp-3)' }}>
            {fallbackField.hint}
          </p>
        ) : null}
      </section>

      {/* ---------------------------------------------------- classificacao */}
      <section className="panel">
        <h2 className="panel__title">Classificacao da fila</h2>
        {renderSection('classify')}
      </section>

      {/* ------------------------------------------------------- agendador */}
      <section className="panel">
        <h2 className="panel__title">Agendador</h2>
        {renderSection('scheduler')}
      </section>

      {/* ---------------------------------------------------------- resumo */}
      <section className="panel">
        <h2 className="panel__title">Resumo (sob demanda)</h2>
        {renderSection('summarize')}
      </section>

      {/* --------------------------------------------------------- salvar */}
      <div className="save-bar">
        <button
          className="button button--primary"
          onClick={save}
          disabled={!dirty || update.isPending}
        >
          {update.isPending ? 'Salvando…' : 'Salvar alteracoes'}
        </button>
        <button
          className="button button--ghost"
          onClick={discard}
          disabled={!dirty || update.isPending}
        >
          Descartar
        </button>
        {dirty ? <span className="save-bar__hint">alteracoes nao salvas</span> : null}
        {!dirty && saved ? (
          <span className="badge badge--ok">✓ aplicado na hora, sem reiniciar</span>
        ) : null}
        {update.isError ? <ErrorBox message={update.error.message} /> : null}
      </div>
    </div>
  );
}
