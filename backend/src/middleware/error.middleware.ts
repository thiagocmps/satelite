import type { NextFunction, Request, Response } from 'express';
import type { Logger } from '../config/logger.js';
import { AppError, NotFoundError } from '../core/errors.js';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError(`Rota nao encontrada: ${req.method} ${req.originalUrl}`));
}

/**
 * Tratamento centralizado: normaliza qualquer erro no formato
 * { error: { code, message, details?, requestId } } e escolhe o nivel de log.
 * Stack trace nunca vaza para o cliente.
 */
export function errorHandler(logger: Logger) {
  return (error: unknown, req: Request, res: Response, next: NextFunction): void => {
    if (res.headersSent) return next(error);

    const appError = error instanceof AppError ? error : undefined;
    const status = appError?.status ?? 500;
    const code = appError?.code ?? 'INTERNAL_ERROR';
    const message = appError?.message ?? 'Erro interno do servidor';

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
