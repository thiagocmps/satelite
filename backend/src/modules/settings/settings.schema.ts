import cron from 'node-cron';
import { z } from 'zod';
import type { AiSettings, AiSettingsPatch, ProviderSettings } from './settings.types.js';

/**
 * Shapes e schema do grupo `ai`. O schema valida o objeto EFETIVO (defaults do
 * .env + overrides do banco) — cross-field aqui: provedor existe no registry,
 * cadeia sem repeticao, chave presente para quem vai ser usado, cron valida.
 * PATCH usa o shape parcial e a validacao completa roda no service apos merge.
 */

/** URL absoluta (qualquer esquema) — mesmo criterio do env.ts. */
const url = (message = 'deve ser uma URL valida') =>
  z.string().min(1).refine((value) => {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }, message);

export const providerShape = z.object({
  apiKey: z.string().max(500),
  baseUrl: url(),
  model: z.string().min(1),
  fallbackModels: z.array(z.string().min(1)),
  classifyModel: z.string(),
  classifyFallbackModels: z.array(z.string().min(1)),
}) satisfies z.ZodType<ProviderSettings>;

export const classifyShape = z.object({
  enabled: z.boolean(),
  timeoutMs: z.number().int().min(1_000).max(600_000),
  maxRetries: z.number().int().min(0).max(5),
  batch: z.number().int().min(1).max(500),
  batchSize: z.number().int().min(1).max(50),
  concurrency: z.number().int().min(1).max(16),
  minConfidence: z.number().min(0).max(1),
  minTextChars: z.number().int().min(0).max(100_000),
  maxContentChars: z.number().int().min(0).max(100_000),
});

export const summarizeShape = z.object({
  language: z.string().min(2).max(10),
  timeoutMs: z.number().int().min(1_000).max(600_000),
  maxRetries: z.number().int().min(0).max(5),
  maxContentChars: z.number().int().min(100).max(100_000),
});

export const schedulerShape = z.object({
  classifyEnabled: z.boolean(),
  classifyCron: z.string().min(1).max(100),
});

export const aiShape = z.object({
  provider: z.string().min(1),
  fallbackProviders: z.array(z.string().min(1)),
  providers: z.record(z.string(), providerShape),
  classify: classifyShape,
  summarize: summarizeShape,
  scheduler: schedulerShape,
}) satisfies z.ZodType<AiSettings>;

/** Validacao cruzada: so exige chave de quem vai ser usado (principal + cadeia). */
export function buildAiSettingsSchema(providerIds: string[]) {
  return aiShape.superRefine((value, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });

    if (!providerIds.includes(value.provider)) {
      issue(['provider'], `provedor desconhecido (registrados: ${providerIds.join(', ')})`);
    }
    for (const id of value.fallbackProviders) {
      if (!providerIds.includes(id)) {
        issue(['fallbackProviders'], `provedor de fallback desconhecido: "${id}"`);
      }
    }
    if (value.fallbackProviders.includes(value.provider)) {
      issue(['fallbackProviders'], 'o fallback nao pode repetir o provedor principal');
    }
    if (new Set(value.fallbackProviders).size !== value.fallbackProviders.length) {
      issue(['fallbackProviders'], 'provedor de fallback repetido');
    }

    const chain = [value.provider, ...value.fallbackProviders];
    for (const id of chain) {
      const config = value.providers[id];
      if (!config) {
        issue(['providers'], `provedor "${id}" sem configuracao`);
        continue;
      }
      if (!config.apiKey.trim()) {
        issue(['providers', id, 'apiKey'], `chave obrigatoria para o provedor "${id}" (configure na tela ou no .env)`);
      }
    }

    if (!cron.validate(value.scheduler.classifyCron)) {
      issue(['scheduler', 'classifyCron'], 'expressao cron invalida (use 5 campos, ex.: */10 * * * *)');
    }
  });
}

/**
 * PATCH parcial: cada secao opcional; dentro da secao, campo opcional.
 * `.strict()` protege contra typo de cliente — campo desconhecido = 400.
 */
export const aiPatchShape = z
  .object({
    provider: z.string().min(1).optional(),
    fallbackProviders: z.array(z.string().min(1)).optional(),
    providers: z.record(z.string(), providerShape.partial()).optional(),
    classify: classifyShape.partial().optional(),
    summarize: summarizeShape.partial().optional(),
    scheduler: schedulerShape.partial().optional(),
  })
  .strict() satisfies z.ZodType<AiSettingsPatch>;
