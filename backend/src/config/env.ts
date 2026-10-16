import { z } from 'zod';

/** URL absoluta (qualquer esquema). Evita depender de z.url()/z.string().url() entre versoes do zod. */
const url = (message = 'deve ser uma URL valida') =>
  z.string().min(1).refine((value) => {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }, message);

/** "a,b,c" -> ["a","b","c"] (usa `fallback` quando a lista vem vazia) */
const csv = (item: z.ZodType<string>, fallback: string[] = []) =>
  z
    .string()
    .optional()
    .transform((value) => {
      const parsed = (value ?? '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
      return parsed.length > 0 ? z.array(item).parse(parsed) : fallback;
    });

/** "true"/"false" (ou "") -> boolean */
const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === '' ? fallback : value === 'true' || value === '1'));

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    DATABASE_URL: url(),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

    APP_NAME: z.string().default('Satelite'),
    APP_URL: url().default('http://localhost:8080'),
    CORS_ORIGINS: csv(z.string()),

    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).default(15 * 60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(600),
    SUMMARY_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).default(60_000),
    SUMMARY_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),

    ENABLE_INGEST: bool(true),
    INGEST_CRON: z.string().min(1).default('*/15 * * * *'),
    INGEST_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
    INGEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(20_000),
    FEED_MAX_BYTES: z.coerce.number().int().min(10_000).default(8_000_000),

    // Groq e o provedor que funciona no plano gratuito (chat free util em pt-BR).
    AI_PROVIDER: z.string().min(1).default('groq'),
    // Alternativas registradas em ai.registry.ts, tentadas em sequencia quando o
    // principal falha (cota zerada, 429, 5xx, gateway fora, timeout).
    AI_FALLBACK_PROVIDERS: csv(z.string().min(1)),
    AI_MODEL: z.string().min(1).default('openrouter/free'),
    AI_FALLBACK_MODELS: csv(z.string().min(1)),
    AI_PROMPT_VERSION: z.string().min(1).default('v1'),
    AI_LANGUAGE: z.string().min(1).default('pt-BR'),
    AI_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(45_000),
    AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    AI_MAX_CONTENT_CHARS: z.coerce.number().int().min(200).max(100_000).default(4_000),

    // Classificacao hibrida: a IA so entra quando a keyword nao decide.
    AI_CLASSIFY_ENABLED: bool(true),
    // Vazio = reusa o modelo de resumo (AI_MODEL).
    AI_CLASSIFY_MODEL: z.string().default(''),
    AI_CLASSIFY_FALLBACK_MODELS: csv(z.string().min(1)),
    AI_CLASSIFY_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(45_000),
    AI_CLASSIFY_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    AI_CLASSIFY_BATCH: z.coerce.number().int().min(1).max(500).default(25),
    // Artigos por requisicao de IA (lote). 1 = comportamento antigo, uma chamada por noticia.
    AI_CLASSIFY_BATCH_SIZE: z.coerce.number().int().min(1).max(50).default(8),
    // 1 = chamadas sequenciais. Groq free tem 8K tokens/min (TPM): concorrência
    // maior dispara 429 em rajada (cada lote de classify já custa ~2-3K tokens).
    AI_CLASSIFY_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(1),
    AI_CLASSIFY_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.6),
    AI_CLASSIFY_MIN_TEXT_CHARS: z.coerce.number().int().min(0).default(120),
    // Corte do conteudo SO no prompt de classificacao (resumos continuam em
    // AI_MAX_CONTENT_CHARS). Groq free cobra tokens/DIA (TPD 200K): payload
    // enxuto = mais artigos por cota; titulo e a fonte primaria da decisao, o
    // texto (lead) e so apoio. 0 = so titulo e descricao.
    AI_CLASSIFY_MAX_CONTENT_CHARS: z.coerce.number().int().min(0).max(100_000).default(350),

    // Classificacao periodica da fila needs_ai (sem depender do botao manual).
    // ENABLE_CLASSIFY_SCHEDULER=false desliga so o agendador (o botao continua).
    ENABLE_CLASSIFY_SCHEDULER: bool(true),
    CLASSIFY_CRON: z.string().min(1).default('*/10 * * * *'),

    // Conteudo esportivo e descartado na ingestao (e sai da fila de IA).
    CONTENT_FILTER_SPORTS: bool(true),

    OPENROUTER_API_KEY: z.string().default(''),
    OPENROUTER_BASE_URL: url().default('https://openrouter.ai/api/v1'),

    // Provedor OpenCode Zen (ai.registry.ts -> 'opencode'). Atencao: o free tier
    // so aceita chamadas de dentro do app OpenCode — de fora responde 403
    // FreeTierError (testado em 2026-10). Vale para uma Console key propria.
    OPENCODE_API_KEY: z.string().default('public'),
    OPENCODE_BASE_URL: url().default('https://opencode.ai/zen/v1'),
    OPENCODE_MODEL: z.string().min(1).default('space-bunny-free'),
    OPENCODE_FALLBACK_MODELS: csv(z.string().min(1)),
    // Vazio = reusa OPENCODE_MODEL para classificar tambem.
    OPENCODE_CLASSIFY_MODEL: z.string().default(''),
    OPENCODE_CLASSIFY_FALLBACK_MODELS: csv(z.string().min(1)),

    // Provedor Groq (ai.registry.ts -> 'groq'): OpenAI-compativel com plano
    // gratuito por organizacao (RPM/RPD/TPM/TPD; saldo visivel nos headers
    // x-ratelimit-* de cada resposta). Chave em https://console.groq.com/keys.
    GROQ_API_KEY: z.string().default(''),
    GROQ_BASE_URL: url().default('https://api.groq.com/openai/v1'),
    GROQ_MODEL: z.string().min(1).default('qwen/qwen3.8-27b'),
    GROQ_FALLBACK_MODELS: csv(z.string().min(1)),
    // Vazio = reusa GROQ_MODEL para classificar tambem.
    GROQ_CLASSIFY_MODEL: z.string().default(''),
    GROQ_CLASSIFY_FALLBACK_MODELS: csv(z.string().min(1)),
  })
  .superRefine((env, ctx) => {
    const usesOpenRouter = [env.AI_PROVIDER, ...env.AI_FALLBACK_PROVIDERS].includes('openrouter');
    if (usesOpenRouter && !env.OPENROUTER_API_KEY.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['OPENROUTER_API_KEY'],
        message:
          'obrigatorio quando AI_PROVIDER ou AI_FALLBACK_PROVIDERS usa openrouter (https://openrouter.ai/keys)',
      });
    }
    const usesGroq = [env.AI_PROVIDER, ...env.AI_FALLBACK_PROVIDERS].includes('groq');
    if (usesGroq && !env.GROQ_API_KEY.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['GROQ_API_KEY'],
        message: 'obrigatorio quando AI_PROVIDER ou AI_FALLBACK_PROVIDERS usa groq (https://console.groq.com/keys)',
      });
    }
  });

export type Env = z.infer<typeof schema>;

/**
 * Le e valida o ambiente uma unica vez. Falha rapida: qualquer variavel ausente ou
 * invalida derruba o processo com a lista de problemas (nunca no meio de um request).
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (parsed.success) return parsed.data;

  const problems = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Configuracao invalida:\n${problems}\n\nUse .env.example como referencia.`);
}
