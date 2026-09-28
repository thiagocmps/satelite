import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { pinoHttp } from 'pino-http';
import type { Container } from './container.js';
import type { Logger } from './config/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js';
import { createApiRouter } from './routes/index.js';

export function createApp(container: Container, logger: Logger): Express {
  const { env } = container;
  const app = express();

  app.disable('x-powered-by');
  // atras do proxy nginx no compose: necessario para req.ip e rate limit corretos
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // a API nao serve imagens; a CSP restritiva atrapalharia o consumidor
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(
    cors({
      // vazio = mesma origem (frontend via proxy). Preencha CORS_ORIGINS para
      // servir o frontend de um dominio diferente.
      origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : false,
    }),
  );
  app.use(express.json({ limit: '256kb' }));
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req.headers['x-request-id'] as string) ?? randomUUID(),
      autoLogging: { ignore: (req) => req.url?.endsWith('/health') ?? false },
    }),
  );

  app.use('/api/v1', createApiRouter(container));
  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return app;
}
