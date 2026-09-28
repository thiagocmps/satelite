import pino, { type Logger } from 'pino';
import type { Env } from './env.js';

export function createLogger(env: Env): Logger {
  return pino({
    level: env.LOG_LEVEL,
    base: { service: 'satelite-api', env: env.NODE_ENV },
    // nunca logar credenciais, mesmo em request logs
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers["x-api-key"]',
        '*.apiKey',
        '*.api_key',
        'config.OPENROUTER_API_KEY',
      ],
      censor: '[redacted]',
    },
  });
}

export type { Logger };
