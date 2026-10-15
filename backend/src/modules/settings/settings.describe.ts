import type { AiProviderMeta, SettingsField } from './settings.types.js';

/** Presets de cadencia do agendador de classificacao (a UI mostra estas opcoes). */
export const CRON_PRESETS = [
  { value: '*/5 * * * *', label: 'a cada 5 minutos' },
  { value: '*/10 * * * *', label: 'a cada 10 minutos' },
  { value: '*/15 * * * *', label: 'a cada 15 minutos' },
  { value: '*/30 * * * *', label: 'a cada 30 minutos' },
  { value: '0 * * * *', label: 'de hora em hora' },
];

export const LANGUAGE_OPTIONS = [
  { value: 'pt-BR', label: 'Portugues (Brasil)' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Espanol' },
];

/**
 * Descritores dos campos do grupo `ai`: a tela renderiza por `type`/`section`
 * sem conhecer a regra por tras. Acrescentar um knob = 1 linha aqui + 1 no
 * schema (settings.schema.ts) + leitura no service que consome.
 */
export function describeAiFields(providers: AiProviderMeta[]): SettingsField[] {
  const fields: SettingsField[] = [
    {
      key: 'provider',
      section: 'provider',
      type: 'select',
      label: 'Provedor principal',
      hint: 'Quem recebe as chamadas de IA. O fallback entra so quando o principal falha (cota, 429, 5xx).',
      order: 10,
    },
    {
      key: 'fallbackProviders',
      section: 'provider',
      type: 'multiselect',
      label: 'Fallback entre provedores',
      hint: 'Ordem de tentativa quando o principal nao responde. Nao repita o principal.',
      order: 20,
    },
  ];

  providers.forEach(({ id, label }, index) => {
    const base = 100 + index * 100;
    fields.push(
      {
        key: `providers.${id}.apiKey`,
        section: 'providers',
        provider: id,
        type: 'password',
        label: `Chave da ${label}`,
        hint: 'Deixe vazio para manter a atual. A chave nunca volta no GET (aparece mascarada).',
        order: base + 10,
      },
      {
        key: `providers.${id}.model`,
        section: 'providers',
        provider: id,
        type: 'string',
        label: 'Modelo',
        hint: 'Modelo padrao deste provedor para resumo e classificacao.',
        order: base + 20,
      },
      {
        key: `providers.${id}.fallbackModels`,
        section: 'providers',
        provider: id,
        type: 'csv',
        label: 'Modelos de fallback',
        hint: 'Separados por virgula; tentados quando o modelo principal falha.',
        order: base + 30,
        advanced: true,
      },
      {
        key: `providers.${id}.classifyModel`,
        section: 'providers',
        provider: id,
        type: 'string',
        label: 'Modelo da classificacao',
        hint: 'Vazio = reusa o modelo acima.',
        order: base + 40,
        advanced: true,
      },
      {
        key: `providers.${id}.classifyFallbackModels`,
        section: 'providers',
        provider: id,
        type: 'csv',
        label: 'Modelos de fallback da classificacao',
        order: base + 50,
        advanced: true,
      },
      {
        key: `providers.${id}.baseUrl`,
        section: 'providers',
        provider: id,
        type: 'string',
        label: 'Endpoint',
        order: base + 60,
        advanced: true,
      },
    );
  });

  fields.push(
    {
      key: 'classify.enabled',
      section: 'classify',
      type: 'boolean',
      label: 'Classificacao por IA',
      hint: 'Desligado = so a regra de keyword decide (custo 0); a fila da IA nao drena.',
      order: 500,
    },
    {
      key: 'classify.batch',
      section: 'classify',
      type: 'number',
      label: 'Artigos por rodada',
      hint: 'A fila processa este maximo a cada execucao (manual ou agendada).',
      min: 1,
      max: 500,
      order: 510,
    },
    {
      key: 'classify.batchSize',
      section: 'classify',
      type: 'number',
      label: 'Artigos por requisicao (lote)',
      hint: 'Uma chamada cobre este lote: o catalogo e as regras aparecem uma unica vez.',
      min: 1,
      max: 50,
      order: 520,
    },
    {
      key: 'classify.concurrency',
      section: 'classify',
      type: 'number',
      label: 'Requisicoes simultaneas',
      min: 1,
      max: 16,
      order: 530,
    },
    {
      key: 'classify.minConfidence',
      section: 'classify',
      type: 'range',
      label: 'Confianca minima',
      hint: 'Abaixo deste piso o veredito da IA e descartado (o artigo sai da fila sem categoria nova).',
      min: 0,
      max: 1,
      step: 0.05,
      order: 540,
    },
    {
      key: 'classify.minTextChars',
      section: 'classify',
      type: 'number',
      label: 'Texto minimo para a IA',
      hint: 'Artigo menor que isso sai da fila sem custo, como esta.',
      min: 0,
      max: 100_000,
      order: 550,
    },
    {
      key: 'classify.maxContentChars',
      section: 'classify',
      type: 'range',
      label: 'Conteudo por artigo (classificacao)',
      hint: 'Corte do texto no prompt de classificacao. 0 = so titulo + descricao. Menos = mais artigos na cota diaria.',
      min: 0,
      max: 8_000,
      step: 100,
      order: 560,
    },
    {
      key: 'classify.timeoutMs',
      section: 'classify',
      type: 'number',
      label: 'Timeout da chamada (ms)',
      min: 1_000,
      max: 600_000,
      order: 570,
      advanced: true,
    },
    {
      key: 'classify.maxRetries',
      section: 'classify',
      type: 'number',
      label: 'Tentativas por modelo',
      min: 0,
      max: 5,
      order: 580,
      advanced: true,
    },
    {
      key: 'scheduler.classifyEnabled',
      section: 'scheduler',
      type: 'boolean',
      label: 'Agendador automatico',
      hint: 'Drena a fila sozinha na cadencia abaixo, sem clicar em nada. Fila vazia = zero chamadas.',
      order: 900,
    },
    {
      key: 'scheduler.classifyCron',
      section: 'scheduler',
      type: 'cron',
      label: 'Cadencia',
      hint: 'Expressao cron de 5 campos. O teto de artigos/dia e a cota do plano gratuito, nao a cadencia.',
      options: CRON_PRESETS,
      order: 910,
    },
    {
      key: 'summarize.language',
      section: 'summarize',
      type: 'select',
      label: 'Idioma dos prompts',
      options: LANGUAGE_OPTIONS,
      order: 1_100,
    },
    {
      key: 'summarize.maxContentChars',
      section: 'summarize',
      type: 'range',
      label: 'Conteudo por artigo (resumo)',
      hint: 'Corte do texto no prompt de resumo (a classificacao tem o corte proprio la em cima).',
      min: 100,
      max: 8_000,
      step: 100,
      order: 1_110,
    },
    {
      key: 'summarize.timeoutMs',
      section: 'summarize',
      type: 'number',
      label: 'Timeout da chamada (ms)',
      min: 1_000,
      max: 600_000,
      order: 1_120,
      advanced: true,
    },
    {
      key: 'summarize.maxRetries',
      section: 'summarize',
      type: 'number',
      label: 'Tentativas por modelo',
      min: 0,
      max: 5,
      order: 1_130,
      advanced: true,
    },
  );

  return fields.sort((a, b) => a.order - b.order);
}
