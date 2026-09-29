import { ExternalServiceError, TimeoutError } from '../../core/errors.js';
import { fetchWithTimeout } from '../../core/http.js';
import { buildClassifyMessages } from './ai.classify.js';
import type { AiProvider, AiSummaryResult, ChatMessage, ClassifyInput, SummarizeInput } from './ai.provider.js';
import { buildMessages, sanitizeSummary } from './ai.prompts.js';

/**
 * Provedor generico para qualquer gateway com API compativel com OpenAI
 * /chat/completions (OpenRouter, OpenCode Zen, ...). A unica diferenca entre
 * eles e `name` (gravado no banco), a chave, o endpoint e o modelo.
 */
export type OpenAICompatibleConfig = {
  /** Identificador estavel gravado no banco junto do resumo. */
  name: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  fallbackModels: string[];
  timeoutMs: number;
  maxRetries: number;
  language: string;
  maxContentChars: number;
  /** Identidade do app enviada ao gateway (OpenRouter usa HTTP-Referer/X-Title). */
  appUrl?: string;
  appName?: string;
  /** Classificacao: modelo proprio ('' = usa `model`). */
  classifyModel: string;
  classifyFallbackModels: string[];
  classifyTimeoutMs: number;
  classifyMaxRetries: number;
};

/** Erro do provedor que carrega Retry-After para orientar o backoff. */
class UpstreamError extends ExternalServiceError {
  constructor(code: string, message: string, readonly retryAfterMs?: number) {
    super(code, message);
  }
}

/** Falhas que valem nova tentativa no mesmo modelo e/ou troca de modelo. */
const RETRYABLE = new Set(['AI_RATE_LIMIT', 'AI_UPSTREAM_ERROR', 'UPSTREAM_UNREACHABLE']);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(seconds * 1_000, 30_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.min(date - Date.now(), 30_000));
}

function backoffMs(attempt: number, retryAfterMs?: number): number {
  return retryAfterMs ?? Math.min(500 * 2 ** attempt + Math.random() * 250, 8_000);
}

type ChatRequestBody = {
  model: string;
  messages: ChatMessage[];
  temperature: number;
  response_format?: { type: 'json_object' };
};

/**
 * Adaptador comum (API compativel com OpenAI /chat/completions) via fetch puro:
 * uma unica chamada nao justifica um SDK. A chave vive apenas no backend.
 */
export class OpenAICompatibleProvider implements AiProvider {
  readonly name: string;
  readonly model: string;

  constructor(protected readonly config: OpenAICompatibleConfig) {
    this.name = config.name;
    this.model = config.model;
  }

  async summarize(input: SummarizeInput): Promise<AiSummaryResult> {
    // modelos roteados (ex.: "openrouter/free") ja fazem failover interno; a
    // lista de fallback cobre o caso de o modelo fixo estar lotado no plano gratuito.
    const candidates = [this.config.model, ...this.config.fallbackModels.filter((model) => model !== this.config.model)];
    return this.#runCandidates(candidates, (model) =>
      this.#callWithRetry((m) => this.#summarizeBody(m, input), this.config.maxRetries, this.config.timeoutMs, model),
    );
  }

  async classify(input: ClassifyInput): Promise<AiSummaryResult> {
    const primary = this.config.classifyModel || this.config.model;
    const extras = this.config.classifyFallbackModels.length
      ? this.config.classifyFallbackModels
      : this.config.fallbackModels;
    const candidates = [primary, ...extras.filter((model) => model !== primary)];
    return this.#runCandidates(candidates, (model) =>
      this.#callWithRetry((m) => this.#classifyBody(m, input), this.config.classifyMaxRetries, this.config.classifyTimeoutMs, model),
    );
  }

  async #runCandidates(
    candidates: string[],
    attempt: (model: string) => Promise<AiSummaryResult>,
  ): Promise<AiSummaryResult> {
    let lastError: unknown;

    for (const model of candidates) {
      try {
        return await attempt(model);
      } catch (error) {
        lastError = error;
        const canSwitchModel =
          error instanceof TimeoutError || (error instanceof ExternalServiceError && RETRYABLE.has(error.code));
        if (!canSwitchModel) throw error;
      }
    }

    throw lastError instanceof Error ? lastError : new ExternalServiceError('AI_ERROR', 'Falha desconhecida da IA');
  }

  async #callWithRetry(
    buildBody: (model: string) => ChatRequestBody,
    maxRetries: number,
    timeoutMs: number,
    model: string,
  ): Promise<AiSummaryResult> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.#complete(model, timeoutMs, buildBody(model));
      } catch (error) {
        const retryable =
          error instanceof TimeoutError || (error instanceof ExternalServiceError && RETRYABLE.has(error.code));
        if (!retryable || attempt >= maxRetries) throw error;

        const retryAfterMs = error instanceof UpstreamError ? error.retryAfterMs : undefined;
        await sleep(backoffMs(attempt, retryAfterMs));
      }
    }
  }

  #summarizeBody(model: string, input: SummarizeInput): ChatRequestBody {
    return {
      model,
      messages: buildMessages(input, { language: this.config.language, maxContentChars: this.config.maxContentChars }),
      temperature: 0.3,
    };
  }

  #classifyBody(model: string, input: ClassifyInput): ChatRequestBody {
    return {
      model,
      messages: buildClassifyMessages(input, { language: this.config.language, maxContentChars: this.config.maxContentChars }),
      temperature: 0,
      // JSON estrito: o modelo deve responder somente com o objeto de classificacao
      response_format: { type: 'json_object' },
    };
  }

  async #complete(model: string, timeoutMs: number, body: ChatRequestBody): Promise<AiSummaryResult> {
    const startedAt = Date.now();

    const headers: Record<string, string> = {
      authorization: `Bearer ${this.config.apiKey}`,
      'content-type': 'application/json',
    };
    if (this.config.appUrl) headers['http-referer'] = this.config.appUrl;
    if (this.config.appName) headers['x-title'] = this.config.appName;

    const response = await fetchWithTimeout(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      timeoutMs,
      headers,
      body: JSON.stringify(body),
    });

    return this.#parseCompletions(response, model, startedAt);
  }

  async #parseCompletions(response: Response, requestedModel: string, startedAt: number): Promise<AiSummaryResult> {
    const raw = await response.text();

    if (!response.ok) {
      const upstream = /"message"\s*:\s*"([^"]*)"/.exec(raw)?.[1] ?? raw.slice(0, 200);
      if (response.status === 401 || response.status === 403) {
        throw new UpstreamError('AI_AUTH_INVALID', `O gateway recusou a credencial: ${upstream}`);
      }
      if (response.status === 402) {
        throw new UpstreamError('AI_QUOTA', `Gateway sem creditos disponiveis: ${upstream}`);
      }
      if (response.status === 429) {
        throw new UpstreamError(
          'AI_RATE_LIMIT',
          `Limite de requisicoes do plano gratuito: ${upstream}`,
          parseRetryAfter(response.headers.get('retry-after')),
        );
      }
      throw new UpstreamError('AI_UPSTREAM_ERROR', `O gateway respondeu HTTP ${response.status}: ${upstream}`);
    }

    let payload: {
      model?: string;
      choices?: Array<{ message?: { content?: string | null } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new UpstreamError('AI_BAD_RESPONSE', 'Resposta do gateway nao e JSON valido');
    }

    const text = sanitizeSummary(payload.choices?.[0]?.message?.content);
    if (!text) throw new UpstreamError('AI_BAD_RESPONSE', 'O modelo nao retornou texto utilizavel');

    return {
      text,
      provider: this.name,
      model: payload.model ?? requestedModel,
      promptTokens: payload.usage?.prompt_tokens,
      completionTokens: payload.usage?.completion_tokens,
      latencyMs: Date.now() - startedAt,
    };
  }
}