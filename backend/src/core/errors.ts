/**
 * Hierarquia de erros da aplicacao. Cada erro sabe o status HTTP e o codigo
 * estavel devolvido no corpo da resposta. Erros nao tratados viram 500 sem
 * vazar stack trace para o cliente.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Requisicao invalida', details?: unknown) {
    super(400, 'VALIDATION_ERROR', message, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Recurso nao encontrado', details?: unknown) {
    super(404, 'NOT_FOUND', message, details);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflito de estado', details?: unknown) {
    super(409, 'CONFLICT', message, details);
  }
}

/** Falha de terceiro (feed externo, provedor de IA). 502: a culpa nao e do cliente. */
export class ExternalServiceError extends AppError {
  constructor(code: string, message: string, details?: unknown) {
    super(502, code, message, details);
  }
}

export class TimeoutError extends AppError {
  constructor(message = 'Tempo limite excedido', details?: unknown) {
    super(504, 'TIMEOUT', message, details);
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
