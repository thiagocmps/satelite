import { ExternalServiceError, TimeoutError } from './errors.js';

export type FetchOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
  maxBytes?: number;
};

/**
 * fetch com timeout e limite de tamanho. Converte falha de rede/timeout em erro
 * tipado da aplicacao (o middleware central cuida do status HTTP).
 */
export async function fetchWithTimeout(url: string, options: FetchOptions): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: { 'user-agent': 'satelite/1.0 (+news aggregator)', ...options.headers },
      ...(options.body ? { body: options.body } : {}),
      signal: AbortSignal.timeout(options.timeoutMs),
      redirect: 'follow',
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new TimeoutError(`Tempo limite de ${options.timeoutMs}ms excedido ao buscar ${url}`);
    }
    throw new ExternalServiceError('UPSTREAM_UNREACHABLE', `Falha ao buscar ${url}: ${(error as Error).message}`);
  }

  const declaredLength = Number(response.headers.get('content-length') ?? '0');
  if (options.maxBytes && declaredLength > options.maxBytes) {
    throw new ExternalServiceError(
      'UPSTREAM_TOO_LARGE',
      `Resposta de ${url} tem ${declaredLength} bytes (limite ${options.maxBytes})`,
    );
  }

  return response;
}
