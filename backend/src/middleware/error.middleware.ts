import type { NextFunction, Request, Response } from 'express';
import type { Logger } from '../config/logger.js';
import { AppError, NotFoundError } from '../core/errors.js';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError(`Rota nao encontrada: ${req.method} ${req.originalUrl}`));
}

/**
 * Erro do body-parser (express.json/text): SyntaxError com `type` 'entity.*'
 * e `status` 400/413. Sem este trato, um JSON malformado virava 500 — o
 * errorHandler so reconhecia AppError. Vale para TODAS as rotas, nao so a de
 * import.
 */
type BodyParserError = Error & { status?: number; type?: string };
const isBodyParserError = (error: unknown): error is BodyParserError =>
  error instanceof Error &&
  typeof (error as BodyParserError).status === 'number' &&
  typeof (error as BodyParserError).type === 'string' &&
  (error as BodyParserError).type!.startsWith('entity.');

/**
 * Tratamento centralizado: normaliza qualquer erro no formato
 * { error: { code, message, details?, requestId } } e escolhe o nivel de log.
 * Stack trace nunca vaza para o cliente.
 */
export function errorHandler(logger: Logger) {
  return (error: unknown, req: Request, res: Response, next: NextFunction): void => {
    if (res.headersSent) return next(error);

    const appError = error instanceof AppError ? error : undefined;
    const bodyError = !appError && isBodyParserError(error) ? error : undefined;
    const status = appError?.status ?? bodyError?.status ?? 500;
    const code = appError?.code ?? (bodyError ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR');
    const message =
      appError?.message ??
      (bodyError ? 'Corpo da requisicao ilegivel (JSON malformado ou grande demais)' : 'Erro interno do servidor');

    const log = status >= 500 ? logger.error.bind(logger) : logger.warn.bind(logger);
    log({ err: error, status, code, method: req.method, url: req.originalUrl, requestId: req.id }, message);

    res.status(status).json({
      error: {
        code,
        message,
        ...(appError?.details ? { details: appError.details } : {}),
        requestId: String(req.id ?? ''),
      },
    });
  };
}
