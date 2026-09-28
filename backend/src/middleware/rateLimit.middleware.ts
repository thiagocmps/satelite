import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';

type Options = { windowMs: number; limit: number; message: string };

const build = ({ windowMs, limit, message }: Options): RateLimitRequestHandler =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: { code: 'RATE_LIMITED', message } });
    },
  });

/** Limite geral da API. Saira de lugar quando entrar autenticacao por usuario. */
export const generalRateLimit = (windowMs: number, limit: number): RateLimitRequestHandler =>
  build({ windowMs, limit, message: 'Muitas requisicoes. Tente novamente em instantes.' });

/** Resumo por IA custa tokens: limite bem mais apertado ate existir autenticacao. */
export const summaryRateLimit = (windowMs: number, limit: number): RateLimitRequestHandler =>
  build({ windowMs, limit, message: 'Limite de resumos por IA atingido. Aguarde um minuto.' });
